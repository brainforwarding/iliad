import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMarkdownFile, writeMarkdownFile } from "../fs/fileOps.js";
import { ensureMarkdownFile, ensureVisibleWorkspacePath } from "../fs/pathSafety.js";
import {
  createDiagnosticsLogger,
  sanitizeUnknownError,
  type DiagnosticDetailValue,
  type DiagnosticsLogger
} from "../diagnostics/logger.js";
import {
  agentErrorDiagnostic,
  missingApiKeyError,
  normalizeAgentError
} from "./errors.js";
import { AgentChatHistoryStore, sanitizeGeneratedChatThreadTitle, type SaveAgentChatThreadRequest } from "./chatHistoryStore.js";
import { hashMarkdown } from "./hash.js";
import {
  buildAgentRunContextManifest,
  manifestStatusForAgentError,
  sanitizeManifestError
} from "./contextManifest.js";
import { AgentContextManifestStore } from "./contextManifestStore.js";
import { createAgentDocumentTools } from "./documentTools.js";
import { prepareExplicitDocumentContext, preparedRunRequest } from "./documentContext.js";
import {
  compactionInputTokenCap,
  compactionStaleTokens,
  compactionSummaryPrompt,
  estimateTokensFromText,
  minCompactionTokens,
  sanitizeGeneratedConversationSummary,
  sanitizePreviouslyReferencedDocuments,
  selectConversationHistory,
  type ConversationHistoryMessage,
  type ConversationSummary
} from "./conversationHistory.js";
import { CompactionCacheStore, compactionPrefixHash, type CompactionCacheHit } from "./compactionCacheStore.js";
import { sanitizeEditorSelection } from "./documentContext.js";
import { AgentProposalStore } from "./proposalStore.js";
import { buildMarkdownChangeProposal } from "./markdownChangeContract.js";
import { CodexAppServerClient } from "./runtime/codexAppServerClient.js";
import { CodexAppServerRuntimeProvider } from "./runtime/codexAppServerProvider.js";
import { OpenAiResponsesRuntimeProvider } from "./runtime/openaiResponsesProvider.js";
import type {
  AgentRuntimeDiagnosticEvent,
  AgentRuntimeProvider,
  AgentRuntimeProviderMetadata
} from "./runtime/provider.js";
import { AgentSettingsStore } from "./settingsStore.js";
import {
  AGENT_TRANSCRIPTION_MODEL,
  createOpenAiAudioTranscription,
  missingDictationApiKeyError,
  normalizeTranscriptionError,
  requestIdFromTranscriptionRequest,
  transcriptionFailedResponse,
  validateTranscribeAudioRequest
} from "./transcription.js";
import type {
  AgentDraftFileChange,
  AgentError,
  AgentChatThread,
  AgentErrorCode,
  AgentProposalSource,
  AgentRunContextItem,
  AgentRunPhase,
  AgentRunEventListener,
  AgentRunRequest,
  AgentRunResponse,
  AgentTranscribeAudioResponse,
  ApplyAgentCreateDocumentRequest,
  ApplyAgentCreateDocumentResponse,
  ApplyAgentProposalFileRequest,
  ApplyAgentPatchRequest,
  ApplyAgentPatchResponse,
  RejectAgentProposalFileRequest,
  RejectAgentProposalRequest,
  ResolveAgentProposalHunkRequest
} from "./types.js";

export interface AgentStartRunOptions {
  proposalPolicy?: "persist" | "suppress";
}

export interface AgentServiceOptions {
  chatHistoryStore?: AgentChatHistoryStore;
  compactionCacheStore?: CompactionCacheStore;
}

const compactionTimeoutMs = 60_000;
const compactionFailureLimit = 2;

export class AgentService {
  private readonly settingsStore: AgentSettingsStore;
  private readonly proposalStore: AgentProposalStore;
  private readonly chatHistoryStore: AgentChatHistoryStore;
  private readonly contextManifestStore: AgentContextManifestStore;
  private readonly diagnostics: DiagnosticsLogger;
  private readonly activeRuns = new Map<string, AbortController>();
  private codexAppServerClient: CodexAppServerClient | null = null;
  private readonly compactionCacheStore: CompactionCacheStore;
  private readonly compactionFailures = new Map<string, number>();
  private compactionInFlight = false;

  constructor(private readonly userDataPath: string, options: AgentServiceOptions = {}) {
    this.settingsStore = new AgentSettingsStore(userDataPath);
    this.proposalStore = new AgentProposalStore(userDataPath);
    this.chatHistoryStore = options.chatHistoryStore ?? new AgentChatHistoryStore(userDataPath);
    this.compactionCacheStore = options.compactionCacheStore ?? new CompactionCacheStore(userDataPath);
    this.contextManifestStore = new AgentContextManifestStore(userDataPath);
    this.diagnostics = createDiagnosticsLogger(userDataPath);
  }

  settings() {
    return this.settingsStore.snapshot();
  }

  updateSettings(update: Parameters<AgentSettingsStore["update"]>[0]) {
    return this.settingsStore.update(update);
  }

  codexStatus() {
    return this.codexClient().status();
  }

  startCodexDeviceLogin() {
    return this.codexClient().startDeviceLogin();
  }

  cancelCodexLogin() {
    return this.codexClient().cancelLogin();
  }

  logoutCodex() {
    return this.codexClient().logout();
  }

  dispose() {
    for (const controller of this.activeRuns.values()) {
      controller.abort();
    }

    this.activeRuns.clear();
    this.codexAppServerClient?.dispose();
    this.codexAppServerClient = null;
    void this.diagnostics.flush();
  }

  async startRun(
    request: AgentRunRequest,
    emitRunEvent?: AgentRunEventListener,
    options: AgentStartRunOptions = {}
  ): Promise<AgentRunResponse> {
    const startedAt = Date.now();
    const runRequest = sanitizeRunRequest(request);
    emitRunPhase(emitRunEvent, runRequest, "reading_context");
    const settings = await this.settingsStore.snapshot();

    try {
      if (runRequest.activeFile) {
        ensureMarkdownFile(runRequest.workspaceRoot, runRequest.activeFile.path);
      }
    } catch (error) {
      const agentError = normalizeAgentError(error);
      emitRunPhase(emitRunEvent, runRequest, "failed", { errorCode: agentError.code });
      this.logRunFailed(runRequest, settings.model, startedAt, agentError, undefined, error);
      return failedRunResponse(runRequest.runId, agentError);
    }

    this.logRunStarted(runRequest, settings.model);

    const providerSelection = await this.selectRuntimeProvider(settings.model);
    let selectedProvider: AgentRuntimeProviderMetadata | undefined;

    if ("error" in providerSelection) {
      const agentError = providerSelection.error;
      emitRunPhase(emitRunEvent, runRequest, "failed", { errorCode: agentError.code });
      this.logRunFailed(runRequest, settings.model, startedAt, agentError, undefined);
      return failedRunResponse(runRequest.runId, agentError);
    }

    const controller = new AbortController();
    this.activeRuns.set(runRequest.runId, controller);
    let contextManifest: AgentRunResponse["contextManifest"];
    let compactionEligible = false;
    const toolContextItems: AgentRunContextItem[] = [];

    try {
      const { provider } = providerSelection;
      selectedProvider = provider.metadata;
      this.logProviderSelected(runRequest, settings.model, provider.metadata);
      // Single emission point for the open command + its receipt row, both
      // providers: validation already succeeded inside the tool. The high
      // sequence base keeps "Abrió" rows sorted after Codex's small per-run
      // tool sequences.
      let openDocumentSequence = 0;
      const documentTools = createAgentDocumentTools({
        workspaceRoot: runRequest.workspaceRoot,
        onOpenDocument: (relativePath) => {
          openDocumentSequence += 1;
          emitRunEvent?.({ type: "open_document", runId: runRequest.runId, relativePath });
          emitRunEvent?.({
            type: "activity",
            runId: runRequest.runId,
            activityId: `open-document-${openDocumentSequence}`,
            sequence: 10_000 + openDocumentSequence,
            kind: "document_open",
            status: "completed",
            title: relativePath,
            relativePath
          });
        }
      });
      const explicitContext = await this.prepareContextDocuments(runRequest, settings.model, controller.signal, documentTools);
      const conversationSummary = await this.lookupConversationSummary(runRequest);
      const preparedRequest = preparedRunRequest(runRequest, explicitContext, conversationSummary);
      compactionEligible = true;
      const workspaceId = await this.contextManifestStore.workspaceId(runRequest.workspaceRoot);
      contextManifest = await this.contextManifestStore.saveManifest(
        buildAgentRunContextManifest({
          request: preparedRequest,
          provider: provider.metadata,
          model: settings.model,
          workspaceId
        })
      );

      emitRunPhase(emitRunEvent, preparedRequest, "asking_model");
      const result = await provider.startRun({
        request: preparedRequest,
        signal: controller.signal,
        documentTools,
        onRunEvent: emitRunEvent,
        onDiagnosticEvent: (event) => this.logProviderEvent(preparedRequest, settings.model, provider.metadata, event),
        onToolContext: (item) => {
          toolContextItems.push(item);
        }
      });

      // Remote read-only runs still use the normal provider path, but any draft
      // changes from a model that ignored instructions must not become proposals.
      const persistProposals =
        options.proposalPolicy !== "suppress" && preparedRequest.runProfile !== "remote_read_only";
      const draftFileChanges = persistProposals ? result.draftFileChanges : [];

      if (draftFileChanges.length > 0) {
        emitRunPhase(emitRunEvent, preparedRequest, "reviewing_changes");
      }

      const proposals = persistProposals
        ? await this.saveDraftProposals({
            request: preparedRequest,
            responseId: result.responseId,
            model: settings.model,
            draftFileChanges,
            source: proposalSourceFromProviderResponse(result.proposalSource, provider.metadata)
          })
        : [];

      if (proposals.length > 0) {
        emitRunPhase(emitRunEvent, preparedRequest, "waiting_for_review", {
          proposalFileCount: proposals.reduce((count, proposal) => count + proposal.files.length, 0)
        });
      }

      this.logRunCompleted(preparedRequest, settings.model, startedAt, result.responseId, proposals.length);
      // Post-run, fire-and-forget (ADR-0015): the user's turn never waits on
      // summarization; the next turn picks up whatever lands in the cache.
      void this.maybeCompactConversation(runRequest);
      contextManifest =
        (await this.contextManifestStore.updateManifest(preparedRequest.runId, {
          status: "completed",
          updatedAt: new Date().toISOString(),
          responseId: result.responseId,
          proposalIds: proposals.map((proposal) => proposal.id),
          items: cleanupCodexSupersededDiscoveryRows({
            provider: contextManifest.provider,
            items: mergeContextManifestItems(contextManifest.items, toolContextItems)
          })
        })) ?? contextManifest;

      emitRunPhase(emitRunEvent, preparedRequest, "completed");

      return {
        runId: runRequest.runId,
        responseId: result.responseId,
        text: result.text,
        proposalIds: proposals.map((proposal) => proposal.id),
        proposals,
        patch: null,
        newDocument: null,
        contextManifest
      };
    } catch (error) {
      const agentError = normalizeAgentError(error, { wasCanceled: controller.signal.aborted });
      if (contextManifest) {
        contextManifest =
          (await this.contextManifestStore.updateManifest(runRequest.runId, {
            status: manifestStatusForAgentError(agentError),
            updatedAt: new Date().toISOString(),
            error: sanitizeManifestError(agentError),
            items: mergeContextManifestItems(contextManifest.items, toolContextItems)
          })) ?? contextManifest;
      }

      if (agentError.code === "request_canceled") {
        emitRunPhase(emitRunEvent, runRequest, "canceled", { errorCode: agentError.code });
        this.diagnostics.info({
          area: "agent",
          event: "agent.run.cancelled",
          runId: runRequest.runId,
          model: settings.model,
          mode: runRequest.mode,
          durationMs: Date.now() - startedAt
        });
      } else {
        emitRunPhase(emitRunEvent, runRequest, "failed", { errorCode: agentError.code });
        console.warn(`agent:start-run failed ${agentErrorDiagnostic(agentError, selectedProvider?.id)}`);
        this.logRunFailed(runRequest, settings.model, startedAt, agentError, selectedProvider, error);

        // Provider failures still leave history worth compacting; pre-prepare
        // failures and canceled runs skip (compactionEligible is still false).
        if (compactionEligible) {
          void this.maybeCompactConversation(runRequest);
        }
      }

      return failedRunResponse(runRequest.runId, agentError, contextManifest);
    } finally {
      this.activeRuns.delete(runRequest.runId);
    }
  }

  cancelRun(runId: string) {
    this.activeRuns.get(runId)?.abort();
  }

  async transcribeAudio(request: unknown): Promise<AgentTranscribeAudioResponse> {
    const startedAt = Date.now();
    const requestId = requestIdFromTranscriptionRequest(request);
    const validated = validateTranscribeAudioRequest(request);

    if ("code" in validated) {
      return transcriptionFailedResponse(requestId, validated);
    }

    const apiKey = await this.settingsStore.getApiKey();

    if (!apiKey) {
      const agentError = missingDictationApiKeyError();
      this.logTranscriptionFailed(validated.requestId, startedAt, agentError);
      return transcriptionFailedResponse(validated.requestId, agentError);
    }

    try {
      this.diagnostics.info({
        area: "agent",
        event: "agent.transcription.started",
        runId: validated.requestId,
        model: AGENT_TRANSCRIPTION_MODEL,
        details: {
          mimeType: validated.mimeType,
          byteLength: validated.audioBytes.byteLength
        }
      });

      const text = await createOpenAiAudioTranscription({
        apiKey,
        request: validated
      });

      this.diagnostics.info({
        area: "agent",
        event: "agent.transcription.completed",
        runId: validated.requestId,
        model: AGENT_TRANSCRIPTION_MODEL,
        durationMs: Date.now() - startedAt,
        details: {
          textChars: text.length
        }
      });

      return {
        requestId: validated.requestId,
        text
      };
    } catch (error) {
      const agentError = normalizeTranscriptionError(error);
      console.warn(`agent:transcribe-audio failed ${agentErrorDiagnostic(agentError, "openai-api")}`);
      this.logTranscriptionFailed(validated.requestId, startedAt, agentError, error);
      return transcriptionFailedResponse(validated.requestId, agentError);
    }
  }

  async applyPatch(request: ApplyAgentPatchRequest): Promise<ApplyAgentPatchResponse> {
    const current = await readMarkdownFile(request.workspaceRoot, request.patch.path);
    const currentHash = hashMarkdown(current);

    if (currentHash !== request.patch.baseHash) {
      throw new Error("The document changed after this proposal was created. Ask the assistant to regenerate it.");
    }

    const result = await writeMarkdownFile(request.workspaceRoot, request.patch.path, request.patch.replacement);

    return {
      savedAt: result.savedAt,
      content: request.patch.replacement
    };
  }

  async applyNewDocument(request: ApplyAgentCreateDocumentRequest): Promise<ApplyAgentCreateDocumentResponse> {
    const relativePath = request.document.relativePath.trim();
    const pathSegments = relativePath.split(/[\\/]+/);

    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
    ) {
      throw new Error("Assistant document paths must be relative Markdown paths.");
    }

    const filePath = path.join(request.workspaceRoot, relativePath);
    ensureMarkdownFile(request.workspaceRoot, filePath);
    ensureVisibleWorkspacePath(request.workspaceRoot, path.dirname(filePath));

    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await writeFile(filePath, request.document.content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A file with that assistant-proposed name already exists.");
      }

      throw error;
    }

    return {
      savedAt: new Date().toISOString(),
      file: {
        name: path.basename(filePath),
        path: filePath,
        relativePath: path.relative(request.workspaceRoot, filePath),
        kind: "markdown"
      },
      content: request.document.content
    };
  }

  listProposals(workspaceRoot: string) {
    return this.proposalStore.listProposals(workspaceRoot);
  }

  applyProposalFile(request: ApplyAgentProposalFileRequest) {
    return this.proposalStore.applyProposalFile(request.workspaceRoot, request.proposalId, request.fileId);
  }

  rejectProposalFile(request: RejectAgentProposalFileRequest) {
    return this.proposalStore.rejectProposalFile(request.workspaceRoot, request.proposalId, request.fileId);
  }

  rejectProposal(request: RejectAgentProposalRequest) {
    return this.proposalStore.rejectProposal(request.workspaceRoot, request.proposalId);
  }

  resolveProposalHunk(request: ResolveAgentProposalHunkRequest) {
    return this.proposalStore.resolveProposalHunk(
      request.workspaceRoot,
      request.proposalId,
      request.fileId,
      request.hunkId,
      request.decision
    );
  }

  listChatThreads(workspaceRoot: string) {
    return this.chatHistoryStore.listThreads(workspaceRoot);
  }

  getChatThread(request: { workspaceRoot: string; threadId: string }) {
    return this.chatHistoryStore.getThread(request.workspaceRoot, request.threadId);
  }

  saveChatThread(request: SaveAgentChatThreadRequest) {
    return this.chatHistoryStore.saveThread(request);
  }

  async clearChatHistory(workspaceRoot: string) {
    // Summaries of deleted conversations must not outlive them; content-
    // addressing makes selective purge impossible, so the whole cache goes
    // (ADR-0015). Cost: one regeneration per long thread, fail-open.
    await this.compactionCacheStore.clearAll();
    return this.chatHistoryStore.clearWorkspace(workspaceRoot);
  }

  async generateChatThreadTitle(request: {
    workspaceRoot: string;
    threadId: string;
    language: "en" | "es";
  }): Promise<AgentChatThread | null> {
    const thread = await this.chatHistoryStore.getThread(request.workspaceRoot, request.threadId);

    if (!thread || thread.titleSource === "ai") {
      return thread;
    }

    const titleMessages = titleGenerationMessages(thread);
    if (!titleMessages) {
      return thread;
    }

    const settings = await this.settingsStore.snapshot();
    const providerSelection = await this.selectRuntimeProvider(settings.model);

    if ("error" in providerSelection) {
      return thread;
    }

const controller = new AbortController();
    const titleWorkspaceRoot = path.join(this.userDataPath, "assistant", "title-generation-workspace");
    await mkdir(titleWorkspaceRoot, { recursive: true });

    try {
      const result = await providerSelection.provider.startRun({
        request: {
          runId: `title-${thread.id}-${Date.now()}`,
          workspaceRoot: titleWorkspaceRoot,
          activeFile: null,
          messages: titleMessages,
          prompt:
            request.language === "es"
              ? "Escribe solo un titulo breve para esta conversacion. No agregues comillas ni explicacion."
              : "Write only a brief title for this conversation. Do not add quotes or explanation.",
          mode: "fast",
          language: request.language
        },
        signal: controller.signal
      });
      const title = sanitizeGeneratedChatThreadTitle(result.text);
      return title ? await this.chatHistoryStore.updateThreadTitle(request.workspaceRoot, thread.id, title) : thread;
    } catch (error) {
      this.diagnostics.warn({
        area: "agent",
        event: "agent.chat_history.title.failed",
        runId: `title-${thread.id}`,
        model: settings.model,
        details: sanitizeUnknownError(error)
      });
      return thread;
    }
  }

  /**
   * Prepare-side cache lookup (ADR-0015). Gate-first: below the token
   * threshold the lookup is skipped entirely. Fail open — a store error means
   * this turn behaves like today (plain omission note).
   */
  private async lookupConversationSummary(runRequest: AgentRunRequest): Promise<ConversationSummary | undefined> {
    try {
      const selection = selectConversationHistory(runRequest.messages);

      if (selection.omittedCount === 0) {
        return undefined;
      }

      const omitted = runRequest.messages.slice(0, selection.omittedCount);

      if (estimateMessagesTokens(omitted) < minCompactionTokens) {
        return undefined;
      }

      const hit = await this.compactionCacheStore.lookup(runRequest.messages, selection.omittedCount);
      return hit ? { text: hit.text, coveredMessageCount: hit.coveredMessageCount } : undefined;
    } catch (error) {
      this.diagnostics.warn({
        area: "agent",
        event: "agent.compaction.lookup_failed",
        runId: runRequest.runId,
        details: sanitizeUnknownError(error)
      });
      return undefined;
    }
  }

  /**
   * Post-run compaction (ADR-0015): fire-and-forget, globally one-at-a-time
   * (all Codex compactions share one synthetic workspace root and its run
   * lock), with a per-prefix failure cooldown so a revoked key or persistently
   * unusable output never re-bills every run. Must never reject — the caller
   * voids the promise.
   */
  private async maybeCompactConversation(runRequest: AgentRunRequest): Promise<void> {
    try {
      if (this.compactionInFlight) {
        return;
      }

      const selection = selectConversationHistory(runRequest.messages);

      if (selection.omittedCount === 0) {
        return;
      }

      const omitted = runRequest.messages.slice(0, selection.omittedCount);

      if (estimateMessagesTokens(omitted) < minCompactionTokens) {
        return;
      }

      const hit = await this.compactionCacheStore.lookup(runRequest.messages, selection.omittedCount);
      const uncovered = omitted.slice(hit?.coveredMessageCount ?? 0);

      if (hit && estimateMessagesTokens(uncovered) < compactionStaleTokens) {
        return;
      }

      // Oldest uncovered messages, whole messages only, up to the input cap:
      // coverage stays a true head-anchored prefix and rolls forward run by run.
      const inputMessages: ConversationHistoryMessage[] = [];
      let inputTokens = 0;

      for (const message of uncovered) {
        const tokens = estimateTokensFromText(message.content);

        if (inputMessages.length > 0 && inputTokens + tokens > compactionInputTokenCap) {
          break;
        }

        inputMessages.push(message);
        inputTokens += tokens;
      }

      if (inputMessages.length === 0) {
        return;
      }

      const coveredMessageCount = (hit?.coveredMessageCount ?? 0) + inputMessages.length;
      const prefixHash = compactionPrefixHash(runRequest.messages.slice(0, coveredMessageCount));

      if ((this.compactionFailures.get(prefixHash) ?? 0) >= compactionFailureLimit) {
        return;
      }

      this.compactionInFlight = true;

      try {
        await this.generateConversationSummary({
          runRequest,
          predecessor: hit,
          inputMessages,
          inputTokens,
          coveredMessageCount,
          prefixHash
        });
      } finally {
        this.compactionInFlight = false;
      }
    } catch (error) {
      this.diagnostics.warn({
        area: "agent",
        event: "agent.compaction.failed",
        runId: runRequest.runId,
        details: sanitizeUnknownError(error)
      });
    }
  }

  private async generateConversationSummary(input: {
    runRequest: AgentRunRequest;
    predecessor: CompactionCacheHit | null;
    inputMessages: ConversationHistoryMessage[];
    inputTokens: number;
    coveredMessageCount: number;
    prefixHash: string;
  }): Promise<void> {
    const settings = await this.settingsStore.snapshot();
    const providerSelection = await this.selectRuntimeProvider(settings.model);

    if ("error" in providerSelection) {
      return;
    }

    const generation = this.compactionCacheStore.clearGeneration();
    const compactionWorkspaceRoot = path.join(this.userDataPath, "assistant", "compaction-workspace");
    await mkdir(compactionWorkspaceRoot, { recursive: true });

    const runSummarizer = async (shorter: boolean) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), compactionTimeoutMs);

      try {
        // Least-privilege by profile: remote_read_only yields read-only
        // sandbox + approval never on Codex and no UI tools on either
        // provider; no documentTools are passed. Up to 20k tokens of raw
        // conversation is the largest injected surface in the app.
        const result = await providerSelection.provider.startRun({
          request: {
            runId: `compaction-${input.prefixHash.slice(0, 12)}`,
            workspaceRoot: compactionWorkspaceRoot,
            runProfile: "remote_read_only",
            activeFile: null,
            messages: [],
            prompt: compactionSummaryPrompt({
              previousSummary: input.predecessor?.text,
              messages: input.inputMessages,
              language: input.runRequest.language,
              shorter
            }),
            mode: "fast",
            language: input.runRequest.language
          },
          signal: controller.signal
        });

        return sanitizeGeneratedConversationSummary(result.text, input.inputTokens + (input.predecessor ? estimateTokensFromText(input.predecessor.text) : 0));
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      let summary = await runSummarizer(false);

      if (!summary.ok && summary.reason === "oversized") {
        summary = await runSummarizer(true);
      }

      if (!summary.ok) {
        this.recordCompactionFailure(input.prefixHash, input.runRequest.runId, summary.reason);
        return;
      }

      await this.compactionCacheStore.put(
        {
          prefixMessageCount: input.coveredMessageCount,
          prefixHash: input.prefixHash,
          summary: summary.text,
          estimatedTokens: summary.estimatedTokens,
          model: settings.model
        },
        generation,
        input.predecessor?.prefixHash
      );
      this.compactionFailures.delete(input.prefixHash);
    } catch (error) {
      this.recordCompactionFailure(input.prefixHash, input.runRequest.runId, sanitizeUnknownError(error));
    }
  }

  private recordCompactionFailure(
    prefixHash: string,
    runId: string,
    details: string | Record<string, DiagnosticDetailValue>
  ) {
    this.compactionFailures.set(prefixHash, (this.compactionFailures.get(prefixHash) ?? 0) + 1);
    this.diagnostics.warn({
      area: "agent",
      event: "agent.compaction.failed",
      runId,
      details: typeof details === "string" ? { reason: details } : details
    });
  }

  private codexClient() {
    if (!this.codexAppServerClient) {
      this.codexAppServerClient = new CodexAppServerClient({
        userDataPath: this.userDataPath
      });
    }

    return this.codexAppServerClient;
  }

  private async prepareContextDocuments(
    request: AgentRunRequest,
    model: string,
    signal: AbortSignal,
    documentTools = createAgentDocumentTools({ workspaceRoot: request.workspaceRoot })
  ) {
    const startedAt = Date.now();
    const context = await prepareExplicitDocumentContext({
      request,
      documentTools,
      signal
    });

    if (context.mentionCount > 0 || context.attachmentCount > 0) {
      this.diagnostics.info({
        area: "agent",
        event: "agent.context.documents.completed",
        runId: request.runId,
        model,
        mode: request.mode,
        durationMs: Date.now() - startedAt,
        details: {
          mentionCount: context.mentionCount,
          attachmentCount: context.attachmentCount,
          includedCount: context.contextDocuments.length,
          unresolvedCount: context.unresolvedContextReferences.length,
          unresolvedReasons: [...new Set(context.unresolvedContextReferences.map((reference) => reference.reason))].join(",")
        }
      });
    }

    return context;
  }

  private async selectRuntimeProvider(model: string): Promise<AgentRuntimeProviderSelection> {
    const codexStatus = await this.codexStatus().catch(() => null);

    if (codexStatus?.available && codexStatus.connected) {
      return {
        provider: new CodexAppServerRuntimeProvider({
          client: this.codexClient(),
          model
        })
      };
    }

    const apiKey = await this.settingsStore.getApiKey();

    if (apiKey) {
      return {
        provider: new OpenAiResponsesRuntimeProvider({
          apiKey,
          model
        })
      };
    }

    return {
      error: missingApiKeyError().agentError
    };
  }

  private async saveDraftProposals({
    request,
    responseId,
    model,
    draftFileChanges,
    source
  }: {
    request: AgentRunRequest;
    responseId?: string;
    model: string;
    draftFileChanges: AgentDraftFileChange[];
    source: AgentProposalSource;
  }) {
    const proposal = buildMarkdownChangeProposal({
      request,
      responseId,
      model,
      source,
      draftFileChanges
    });

    if (!proposal) {
      return [];
    }

    const savedProposal = await this.proposalStore.saveProposal(proposal);
    this.diagnostics.info({
      area: "agent",
      event: "agent.proposal.created",
      runId: request.runId,
      requestId: responseId,
      model,
      mode: request.mode,
      details: {
        proposalCount: 1,
        fileCount: savedProposal.files.length,
        editFileCount: savedProposal.files.filter((file) => file.kind === "edit_file").length,
        createFileCount: savedProposal.files.filter((file) => file.kind === "create_file").length
      }
    });

    return [savedProposal];
  }

  private logRunStarted(request: AgentRunRequest, model: string) {
    this.diagnostics.info({
      area: "agent",
      event: "agent.run.started",
      runId: request.runId,
      model,
      mode: request.mode,
      details: {
        language: request.language,
        messageCount: request.messages.length,
        promptChars: request.prompt.length,
        activeFileChars: request.activeFile?.content.length ?? 0,
        activeFileExtension: request.activeFile ? path.extname(request.activeFile.relativePath).toLowerCase() || "none" : "none"
      }
    });
  }

  private logRunCompleted(
    request: AgentRunRequest,
    model: string,
    startedAt: number,
    responseId: string | undefined,
    proposalCount: number
  ) {
    this.diagnostics.info({
      area: "agent",
      event: "agent.run.completed",
      runId: request.runId,
      requestId: responseId,
      model,
      mode: request.mode,
      durationMs: Date.now() - startedAt,
      details: {
        proposalCount
      }
    });
  }

  private logRunFailed(
    request: AgentRunRequest,
    model: string,
    startedAt: number,
    agentError: AgentRunResponse["error"],
    provider: AgentRuntimeProviderMetadata | undefined,
    rawError?: unknown
  ) {
    this.diagnostics.error({
      area: "agent",
      event: "agent.run.failed",
      runId: request.runId,
      model,
      mode: request.mode,
      durationMs: Date.now() - startedAt,
      errorCode: agentError?.code,
      providerStatus: agentError?.providerStatus,
      retryable: agentError?.retryable,
      details: runFailureDetails(provider, rawError)
    });
  }

  private logProviderSelected(request: AgentRunRequest, model: string, provider: AgentRuntimeProviderMetadata) {
    this.diagnostics.info({
      area: "agent",
      event: "agent.provider.selected",
      runId: request.runId,
      model,
      mode: request.mode,
      details: {
        providerId: provider.id,
        providerLabel: provider.label
      }
    });
  }

  private logProviderEvent(
    request: AgentRunRequest,
    model: string,
    provider: AgentRuntimeProviderMetadata,
    event: AgentRuntimeDiagnosticEvent
  ) {
    if (event.event === "provider.request.started") {
      this.diagnostics.info({
        area: "provider",
        event: event.event,
        runId: request.runId,
        model,
        mode: request.mode,
        details: {
          providerId: provider.id,
          providerLabel: provider.label,
          streaming: event.streaming,
          reasoning: event.reasoning ?? null,
          textVerbosity: event.textVerbosity ?? null
        }
      });
      return;
    }

    if (event.event === "provider.request.completed") {
      this.diagnostics.info({
        area: "provider",
        event: event.event,
        runId: request.runId,
        requestId: event.responseId,
        model,
        mode: request.mode,
        durationMs: event.durationMs,
        errorCode: event.errorCode,
        providerStatus: event.providerStatus,
        retryable: event.retryable,
        details: {
          providerId: provider.id,
          providerLabel: provider.label,
          streaming: event.streaming,
          outputTextChars: event.outputTextChars ?? null,
          draftFileChangeCount: event.draftFileChangeCount ?? null
        }
      });
      return;
    }

    if (event.event === "provider.tool_call") {
      this.diagnostics.info({
        area: "provider",
        event: event.event,
        runId: request.runId,
        model,
        mode: request.mode,
        durationMs: event.durationMs,
        errorCode: event.errorCode,
        details: {
          providerId: provider.id,
          providerLabel: provider.label,
          toolName: event.toolName,
          status: event.status,
          resultCount: event.resultCount ?? null,
          truncated: event.truncated ?? null,
          searchedFiles: event.searchedFiles ?? null
        }
      });
      return;
    }

    if (event.event === "provider.phase") {
      this.diagnostics.info({
        area: "provider",
        event: event.event,
        runId: request.runId,
        requestId: event.responseId,
        model,
        mode: request.mode,
        errorCode: event.failureCode,
        details: {
          providerId: provider.id,
          providerLabel: provider.label,
          phase: event.phase,
          method: event.method ?? null,
          status: event.status ?? null,
          threadId: event.threadId ?? null,
          turnId: event.turnId ?? null,
          itemType: event.itemType ?? null,
          changeCount: event.changeCount ?? null
        }
      });
      return;
    }

    this.diagnostics.warn({
      area: "provider",
      event: event.event,
      runId: request.runId,
      model,
      mode: request.mode,
      details: {
        providerId: provider.id,
        providerLabel: provider.label,
        reason: event.reason,
        from: event.from,
        to: event.to
      }
    });
  }

  private logTranscriptionFailed(
    requestId: string,
    startedAt: number,
    agentError: AgentRunResponse["error"],
    rawError?: unknown
  ) {
    this.diagnostics.error({
      area: "agent",
      event: "agent.transcription.failed",
      runId: requestId,
      model: AGENT_TRANSCRIPTION_MODEL,
      durationMs: Date.now() - startedAt,
      errorCode: agentError?.code,
      providerStatus: agentError?.providerStatus,
      retryable: agentError?.retryable,
      details: rawError ? sanitizeUnknownError(rawError) : undefined
    });
  }
}

type AgentRuntimeProviderSelection =
  | {
      provider: AgentRuntimeProvider;
    }
  | {
      error: AgentError;
    };

function failedRunResponse(
  runId: string,
  error: AgentRunResponse["error"],
  contextManifest?: AgentRunResponse["contextManifest"]
): AgentRunResponse {
  return {
    runId,
    text: "",
    proposalIds: [],
    proposals: [],
    patch: null,
    newDocument: null,
    contextManifest,
    error
  };
}

function runFailureDetails(provider: AgentRuntimeProviderMetadata | undefined, rawError: unknown) {
  return {
    providerId: provider?.id ?? null,
    providerLabel: provider?.label ?? null,
    ...(rawError && provider?.id !== "codex-app-server" ? sanitizeUnknownError(rawError) : {})
  };
}

function titleGenerationMessages(thread: AgentChatThread): AgentRunRequest["messages"] | null {
  const firstUser = thread.entries.find((entry) => entry.kind === "user" && entry.text.trim());
  const firstAssistant = thread.entries.find((entry) => entry.kind === "assistant" && entry.text.trim());

  if (!firstUser || !firstAssistant) {
    return null;
  }

  return [
    {
      role: "user",
      content: titleContextSnippet(firstUser.text)
    },
    {
      role: "assistant",
      content: titleContextSnippet(firstAssistant.text)
    }
  ];
}

function titleContextSnippet(text: string) {
  const sanitized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/^diff --git .+$/gim, " ")
    .replace(/^@@ .+ @@.*$/gm, " ")
    .replace(/^\+{3} .+$/gm, " ")
    .replace(/^-{3} .+$/gm, " ")
    .replace(/^[-+].{40,}$/gm, " ")
    .replace(/\[[^\]]*]\((?:file|iliad-file|data):[^)]+\)/gi, " ")
    .replace(/\b(?:sk|sess|tok|key|secret|password|passwd)[-_A-Za-z0-9]{12,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length <= 360 ? sanitized : `${sanitized.slice(0, 360).trim()}...`;
}

function estimateMessagesTokens(messages: ConversationHistoryMessage[]) {
  return messages.reduce((total, message) => total + estimateTokensFromText(message.content), 0);
}

function sanitizeRunRequest(request: AgentRunRequest): AgentRunRequest {
  return {
    runId: request.runId,
    workspaceRoot: request.workspaceRoot,
    runProfile: request.runProfile === "remote_read_only" ? "remote_read_only" : undefined,
    activeFile: request.activeFile
      ? {
          path: request.activeFile.path,
          relativePath: request.activeFile.relativePath,
          content: request.activeFile.content,
          baseHash: request.activeFile.baseHash
        }
      : null,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    prompt: request.prompt,
    mode: request.mode,
    language: request.language,
    contextAttachments: sanitizeContextAttachments(request.contextAttachments),
    previouslyReferencedDocuments: sanitizePreviouslyReferencedDocuments(request.previouslyReferencedDocuments),
    ...(sanitizeEditorSelection(request) ? { editorSelection: sanitizeEditorSelection(request) } : {})
  };
}

function sanitizeContextAttachments(requestAttachments: AgentRunRequest["contextAttachments"]) {
  if (!Array.isArray(requestAttachments)) {
    return undefined;
  }

  const contextAttachments = requestAttachments
    .filter((attachment) => attachment?.source === "manual_attachment" && typeof attachment.relativePath === "string")
    .map((attachment) => ({
      relativePath: attachment.relativePath,
      source: "manual_attachment" as const
    }));

  return contextAttachments.length > 0 ? contextAttachments : undefined;
}

function mergeContextManifestItems(
  existingItems: AgentRunContextItem[],
  toolItems: AgentRunContextItem[]
): AgentRunContextItem[] {
  const merged = [...existingItems];
  const seenReadKeys = new Set(
    existingItems
      .filter((item) => item.kind === "document_read" && item.relativePath && item.baseHash)
      .map((item) => `${item.relativePath}:${item.baseHash}`)
  );
  for (const item of toolItems) {
    if (item.kind === "document_read" && item.relativePath && item.baseHash) {
      const key = `${item.relativePath}:${item.baseHash}`;
      if (seenReadKeys.has(key)) {
        continue;
      }

      seenReadKeys.add(key);
      merged.push(item);
      continue;
    }

    if (!merged.some((candidate) => candidate.id === item.id)) {
      merged.push(item);
    }
  }

  return merged;
}

export function cleanupCodexSupersededDiscoveryRows({
  provider,
  items
}: {
  provider: AgentRuntimeProviderMetadata;
  items: AgentRunContextItem[];
}): AgentRunContextItem[] {
  if (provider.id !== "codex-app-server") {
    return items;
  }

  return items.filter((item, index) => {
    if (!isSupersedableDiscoveryRow(item)) {
      return true;
    }

    return !items.slice(index + 1).some(isSuccessfulModelDirectedDocumentRead);
  });
}

function isSupersedableDiscoveryRow(item: AgentRunContextItem) {
  return (
    (item.reason === "model_directed_document_search" || item.reason === "model_directed_document_list") &&
    item.resultCount === 0 &&
    item.truncated === true
  );
}

function isSuccessfulModelDirectedDocumentRead(item: AgentRunContextItem) {
  return item.kind === "document_read" && item.reason === "model_directed_document_read";
}

export function proposalSourceFromProviderResponse(
  source: AgentProposalSource | undefined,
  provider: AgentRuntimeProviderMetadata
): AgentProposalSource {
  if (source) {
    return source;
  }

  if (provider.id === "codex-app-server") {
    return { kind: "codex_app_server" };
  }

  return { kind: "openai_response" };
}

function emitRunPhase(
  emitRunEvent: AgentRunEventListener | undefined,
  request: AgentRunRequest,
  phase: AgentRunPhase,
  metadata?: {
    proposalFileCount?: number;
    errorCode?: AgentErrorCode;
  }
) {
  emitRunEvent?.({
    type: "run_phase",
    runId: request.runId,
    phase,
    source: "agent_service",
    ...metadata
  });
}
