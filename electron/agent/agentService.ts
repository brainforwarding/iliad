import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMarkdownFile, writeMarkdownFile } from "../fs/fileOps.js";
import { ensureMarkdownFile, ensureVisibleWorkspacePath } from "../fs/pathSafety.js";
import { trackWorkspaceMutation } from "../fs/workspaceMutationMarkers.js";
import {
  createDiagnosticsLogger,
  sanitizeUnknownError,
  type DiagnosticDetailValue,
  type DiagnosticsLogger
} from "../diagnostics/logger.js";
import {
  AgentRuntimeError,
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
import { unifiedDiff } from "./diff.js";
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
import { buildLineReviewHunks } from "./reviewDiff.js";
import {
  captureGitAdvisorySnapshot,
  checkGitAdvisorySnapshot,
  type GitAdvisorySnapshot
} from "./gitAdvisory.js";
import {
  captureMarkdownWorkspaceSnapshot,
  compareMarkdownSnapshots,
  type MarkdownSnapshot
} from "./markdownCapture.js";
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
  AUTOCOMPLETE_API_MODEL,
  AUTOCOMPLETE_CODEX_MODEL_PREFERENCES,
  autocompleteInstructions,
  autocompleteMaxOutputTokens,
  autocompleteModelInput,
  type IdeaAutocompleteTextRequest
} from "./autocomplete.js";
import {
  selectionTransformInstruction,
  selectionTransformMaxOutputTokens,
  tightenModelInput,
  tightenSelectedText,
  type TightenLanguage,
  type TightenMode,
  type TightenSelectionRange
} from "./tighten.js";
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
  AgentChangeProposal,
  AgentError,
  AgentChatThread,
  AgentErrorCode,
  AgentProposalFileChange,
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
  ApplyAgentProposalFileResponse,
  ApplyAgentPatchRequest,
  ApplyAgentPatchResponse,
  ExternalAgentCaptureCancelResponse,
  ExternalAgentCaptureFinishResponse,
  ExternalAgentCaptureStartResponse,
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

interface ExternalAgentCaptureSession {
  captureId: string;
  workspaceRoot: string;
  agentName?: string;
  startedAt: string;
  baselineId: string;
  snapshotId: string;
  snapshot: MarkdownSnapshot;
  gitSnapshot: GitAdvisorySnapshot;
  proposal: AgentChangeProposal | null;
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
  private readonly externalCaptures = new Map<string, ExternalAgentCaptureSession>();
  private readonly externalCaptureIdsByWorkspace = new Map<string, string>();
  private codexAppServerClient: CodexAppServerClient | null = null;
  private readonly unavailableAutocompleteModels = new Set<string>();
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
    this.externalCaptures.clear();
    this.externalCaptureIdsByWorkspace.clear();
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

  async tightenSelection(request: {
    requestId: string;
    text: string;
    selection: TightenSelectionRange;
    language: TightenLanguage;
    mode?: TightenMode;
    instruction?: string;
    signal: AbortSignal;
  }): Promise<string> {
    const settings = await this.settingsStore.snapshot();
    const providerSelection = await this.selectRuntimeProvider(settings.model);

    if ("error" in providerSelection) {
      throw new AgentRuntimeError(providerSelection.error);
    }

    const { provider } = providerSelection;

    if (!provider.generateText) {
      throw new AgentRuntimeError({
        code: "provider_unavailable",
        userMessage: "The selected runtime cannot run this text request.",
        detail: "text_generation_unavailable",
        retryable: false
      });
    }

    const workspaceRoot = path.join(this.userDataPath, "assistant", "tighten-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const mode = request.mode ?? "tighten";
    const logRequest: AgentRunRequest = {
      runId: `tighten-${safeRunIdPart(request.requestId)}-${Date.now()}`,
      workspaceRoot,
      activeFile: null,
      messages: [],
      prompt: mode === "edit" ? "Edit selected text" : "Tighten selected text",
      mode: "fast",
      language: request.language
    };

    this.logProviderSelected(logRequest, settings.model, provider.metadata);
    const result = await provider.generateText({
      request: {
        instructions: selectionTransformInstruction({
          mode,
          language: request.language,
          instruction: request.instruction
        }),
        input: tightenModelInput(request.text, request.selection),
        maxOutputTokens: selectionTransformMaxOutputTokens(tightenSelectedText(request.text, request.selection), mode),
        language: request.language,
        cwd: workspaceRoot
      },
      signal: request.signal,
      onDiagnosticEvent: (event) => this.logProviderEvent(logRequest, settings.model, provider.metadata, event)
    });

    return result.text;
  }

  async autocompleteIdea(request: IdeaAutocompleteTextRequest): Promise<string> {
    const providerSelection = await this.selectWritingAssistTextProviders(request.allowApiFallback);

    if ("error" in providerSelection) {
      throw new AgentRuntimeError(providerSelection.error);
    }

    const workspaceRoot = path.join(this.userDataPath, "assistant", "autocomplete-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    let lastError: unknown = null;

    for (let index = 0; index < providerSelection.providers.length; index += 1) {
      const candidate = providerSelection.providers[index];
      const { provider, model } = candidate;

      if (!provider.generateText) {
        throw new AgentRuntimeError({
          code: "provider_unavailable",
          userMessage: "The selected runtime cannot run this text request.",
          detail: "text_generation_unavailable",
          retryable: false
        });
      }

      const logRequest: AgentRunRequest = {
        runId: `autocomplete-${safeRunIdPart(request.requestId)}-${safeRunIdPart(model)}-${Date.now()}`,
        workspaceRoot,
        activeFile: null,
        messages: [],
        prompt: "Autocomplete writing",
        mode: "fast",
        language: request.language
      };

      try {
        this.logProviderSelected(logRequest, model, provider.metadata);
        const result = await provider.generateText({
          request: {
            instructions: autocompleteInstructions(request.language, request.suggestionKind),
            input: autocompleteModelInput(request),
            maxOutputTokens: autocompleteMaxOutputTokens(request.suggestionKind),
            language: request.language,
            cwd: workspaceRoot
          },
          signal: request.signal,
          onDiagnosticEvent: (event) => this.logProviderEvent(logRequest, model, provider.metadata, event)
        });

        return result.text;
      } catch (error) {
        lastError = error;
        const nextIndex = nextAutocompleteProviderIndex(error, providerSelection.providers, index);
        const nextCandidate = nextIndex >= 0 ? providerSelection.providers[nextIndex] : undefined;

        if (nextCandidate) {
          if (shouldMarkAutocompleteModelUnavailable(error)) {
            this.unavailableAutocompleteModels.add(model);
          }
          this.logProviderEvent(logRequest, model, provider.metadata, {
            event: "provider.retry",
            reason: normalizeAgentError(error).code,
            from: model,
            fromProvider: provider.metadata.id,
            to: nextCandidate.model,
            toProvider: nextCandidate.provider.metadata.id
          });
          index = nextIndex - 1;
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new Error("Autocomplete provider failed.");
  }

  async writingAssistStatus(request: { autocompleteApiFallbackEnabled: boolean }) {
    const [settings, apiKey, codexStatus] = await Promise.all([
      this.settingsStore.snapshot(),
      this.settingsStore.getApiKey(),
      this.codexStatus().catch(() => null)
    ]);
    const codexAvailable = Boolean(codexStatus?.available && codexStatus.connected);
    const apiFallbackAvailable = Boolean(apiKey);

    return {
      corrector: {
        available: true,
        provider: "local" as const
      },
      autocomplete: {
        available: codexAvailable || (request.autocompleteApiFallbackEnabled && apiFallbackAvailable),
        provider: codexAvailable ? ("codex-app-server" as const) : request.autocompleteApiFallbackEnabled && apiFallbackAvailable ? ("openai-api" as const) : null,
        apiFallbackAvailable,
        apiFallbackEnabled: request.autocompleteApiFallbackEnabled,
        model: codexAvailable
          ? this.preferredAutocompleteCodexModel()
          : request.autocompleteApiFallbackEnabled && apiFallbackAvailable
            ? AUTOCOMPLETE_API_MODEL
            : settings.model
      }
    };
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

    const result = await trackWorkspaceMutation(request.workspaceRoot, [request.patch.path], () =>
      writeMarkdownFile(request.workspaceRoot, request.patch.path, request.patch.replacement)
    );

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

    await trackWorkspaceMutation(request.workspaceRoot, [filePath], async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      try {
        await writeFile(filePath, request.document.content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error("A file with that assistant-proposed name already exists.");
        }

        throw error;
      }
    });

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

  async startExternalCapture({
    workspaceRoot,
    agentName
  }: {
    workspaceRoot: string;
    agentName?: string;
  }): Promise<ExternalAgentCaptureStartResponse> {
    const startedAt = Date.now();
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    try {
      const existingCaptureId = this.externalCaptureIdsByWorkspace.get(resolvedWorkspaceRoot);

      if (existingCaptureId) {
        const existingSession = this.externalCaptures.get(existingCaptureId);

        if (existingSession) {
          this.logExternalCaptureInfo("external_capture.resumed", startedAt, existingSession.workspaceRoot, {
            captureId: existingSession.captureId,
            markdownFileCount: existingSession.snapshot.files.size,
            hasProposal: Boolean(existingSession.proposal),
            proposalFileCount: existingSession.proposal?.files.length ?? 0
          });

          return {
            captureId: existingSession.captureId,
            workspaceRoot: existingSession.workspaceRoot,
            startedAt: existingSession.startedAt,
            markdownFileCount: existingSession.snapshot.files.size,
            resumed: true
          };
        }

        this.externalCaptureIdsByWorkspace.delete(resolvedWorkspaceRoot);
      }

      const [snapshot, gitSnapshot] = await Promise.all([
        captureMarkdownWorkspaceSnapshot({ workspaceRoot: resolvedWorkspaceRoot }),
        captureGitAdvisorySnapshot(resolvedWorkspaceRoot)
      ]);
      const captureId = randomUUID();
      const startedAtIso = new Date().toISOString();

      this.externalCaptures.set(captureId, {
        captureId,
        workspaceRoot: resolvedWorkspaceRoot,
        agentName: agentName?.trim() || undefined,
        startedAt: startedAtIso,
        baselineId: randomUUID(),
        snapshotId: randomUUID(),
        snapshot,
        gitSnapshot,
        proposal: null
      });
      this.externalCaptureIdsByWorkspace.set(resolvedWorkspaceRoot, captureId);
      this.logExternalCaptureInfo("external_capture.started", startedAt, resolvedWorkspaceRoot, {
        captureId,
        markdownFileCount: snapshot.files.size,
        gitStatus: gitSnapshot.status,
        gitReason: gitSnapshot.status === "unavailable" ? gitSnapshot.reason : null
      });

      return {
        captureId,
        workspaceRoot: resolvedWorkspaceRoot,
        startedAt: startedAtIso,
        markdownFileCount: snapshot.files.size
      };
    } catch (error) {
      this.logExternalCaptureWarn("external_capture.start_failed", startedAt, resolvedWorkspaceRoot, error);
      throw error;
    }
  }

  async finishExternalCapture({
    workspaceRoot,
    captureId
  }: {
    workspaceRoot: string;
    captureId: string;
  }): Promise<ExternalAgentCaptureFinishResponse> {
    const startedAt = Date.now();
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    try {
      const session = this.externalCaptureSession(workspaceRoot, captureId);

      const after = await captureMarkdownWorkspaceSnapshot({ workspaceRoot: session.workspaceRoot });
      const diff = compareMarkdownSnapshots({
        before: session.snapshot,
        after,
        sourceLabel: session.agentName ?? "External agent"
      });
      session.gitSnapshot = await captureGitAdvisorySnapshot(session.workspaceRoot);
      session.snapshotId = randomUUID();

      if (diff.draftFileChanges.length === 0) {
        session.proposal = null;
        this.logExternalCaptureInfo("external_capture.finished", startedAt, session.workspaceRoot, {
          captureId,
          status: "empty",
          markdownFileCount: after.files.size,
          changeFileCount: 0,
          unsupportedNoteCount: diff.unsupportedNotes.length
        });

        return {
          status: "empty",
          captureId,
          restoredRelativePaths: [],
          restoredCreateRelativePaths: [],
          unsupportedNotes: diff.unsupportedNotes
        };
      }

      const proposal = buildExternalFilesystemProposal(session, diff.draftFileChanges);
      session.proposal = proposal;
      this.logExternalCaptureInfo("external_capture.finished", startedAt, session.workspaceRoot, {
        captureId,
        status: "proposal",
        markdownFileCount: after.files.size,
        unsupportedNoteCount: diff.unsupportedNotes.length,
        ...externalProposalFileKindDetails(proposal.files)
      });

      return {
        status: "proposal",
        captureId,
        proposal,
        restoredRelativePaths: [],
        restoredCreateRelativePaths: [],
        unsupportedNotes: diff.unsupportedNotes
      };
    } catch (error) {
      this.logExternalCaptureWarn("external_capture.finish_failed", startedAt, resolvedWorkspaceRoot, error, { captureId });
      throw error;
    }
  }

  async cancelExternalCapture({
    workspaceRoot,
    captureId
  }: {
    workspaceRoot: string;
    captureId: string;
  }): Promise<ExternalAgentCaptureCancelResponse> {
    const startedAt = Date.now();
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    try {
      const session = this.externalCaptureSession(workspaceRoot, captureId);
      this.clearExternalCaptureSession(session);
      this.logExternalCaptureInfo("external_capture.canceled", startedAt, session.workspaceRoot, { captureId });

      return {
        status: "canceled",
        captureId,
        restoredRelativePaths: [],
        restoredCreateRelativePaths: [],
        unsupportedNotes: []
      };
    } catch (error) {
      this.logExternalCaptureWarn("external_capture.cancel_failed", startedAt, resolvedWorkspaceRoot, error, { captureId });
      throw error;
    }
  }

  async listProposals(workspaceRoot: string) {
    const proposals = (await this.proposalStore.listProposals(workspaceRoot)).filter(
      (proposal) => proposal.source.kind !== "external_agent" && proposal.metadata?.kind !== "external_filesystem"
    );
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    for (const session of this.externalCaptures.values()) {
      if (session.workspaceRoot === resolvedWorkspaceRoot && session.proposal) {
        proposals.push(cloneAgentProposal(session.proposal));
      }
    }

    return proposals.sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  }

  async applyProposalFile(request: ApplyAgentProposalFileRequest) {
    const startedAt = Date.now();
    const externalSession = this.externalCaptureSessionForProposal(request.workspaceRoot, request.proposalId);
    const actionDetails = await this.proposalActionDetails(
      request.workspaceRoot,
      request.proposalId,
      request.fileId,
      externalSession
    );

    this.logProposalActionInfo("agent.proposal_file.apply_started", startedAt, actionDetails);

    try {
      const result = externalSession
        ? await this.applyExternalProposalFile(externalSession, request.fileId)
        : await trackWorkspaceMutation(request.workspaceRoot, undefined, () =>
            this.proposalStore.applyProposalFile(request.workspaceRoot, request.proposalId, request.fileId)
          );

      this.logProposalActionInfo("agent.proposal_file.apply_finished", startedAt, {
        ...this.proposalActionDetailsFromProposal(request.workspaceRoot, result.proposal, request.fileId, Boolean(externalSession)),
        resultKind: result.kind,
        resultStatus: result.status
      });
      return result;
    } catch (error) {
      this.logProposalActionWarn("agent.proposal_file.apply_failed", startedAt, actionDetails, error);
      throw error;
    }
  }

  async rejectProposalFile(request: RejectAgentProposalFileRequest) {
    const startedAt = Date.now();
    const externalSession = this.externalCaptureSessionForProposal(request.workspaceRoot, request.proposalId);
    const actionDetails = await this.proposalActionDetails(
      request.workspaceRoot,
      request.proposalId,
      request.fileId,
      externalSession
    );

    this.logProposalActionInfo("agent.proposal_file.reject_started", startedAt, actionDetails);

    try {
      const proposal = externalSession
        ? await this.rejectExternalProposalFile(externalSession, request.fileId)
        : await this.proposalStore.rejectProposalFile(request.workspaceRoot, request.proposalId, request.fileId);

      this.logProposalActionInfo(
        "agent.proposal_file.reject_finished",
        startedAt,
        this.proposalActionDetailsFromProposal(request.workspaceRoot, proposal, request.fileId, Boolean(externalSession))
      );
      return proposal;
    } catch (error) {
      this.logProposalActionWarn("agent.proposal_file.reject_failed", startedAt, actionDetails, error);
      throw error;
    }
  }

  async rejectProposal(request: RejectAgentProposalRequest) {
    const startedAt = Date.now();
    const externalSession = this.externalCaptureSessionForProposal(request.workspaceRoot, request.proposalId);
    const actionDetails = await this.proposalActionDetails(
      request.workspaceRoot,
      request.proposalId,
      undefined,
      externalSession
    );

    this.logProposalActionInfo("agent.proposal.reject_started", startedAt, actionDetails);

    try {
      const proposal = externalSession
        ? await this.rejectExternalProposal(externalSession)
        : await this.proposalStore.rejectProposal(request.workspaceRoot, request.proposalId);

      this.logProposalActionInfo(
        "agent.proposal.reject_finished",
        startedAt,
        this.proposalActionDetailsFromProposal(request.workspaceRoot, proposal, undefined, Boolean(externalSession))
      );
      return proposal;
    } catch (error) {
      this.logProposalActionWarn("agent.proposal.reject_failed", startedAt, actionDetails, error);
      throw error;
    }
  }

  resolveProposalHunk(request: ResolveAgentProposalHunkRequest) {
    return trackWorkspaceMutation(request.workspaceRoot, undefined, () =>
      this.proposalStore.resolveProposalHunk(
        request.workspaceRoot,
        request.proposalId,
        request.fileId,
        request.hunkId,
        request.decision
      )
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

  private async selectWritingAssistTextProviders(allowApiFallback: boolean): Promise<AgentRuntimeProviderCandidateSelection> {
    const [codexStatus, apiKey] = await Promise.all([
      this.codexStatus().catch(() => null),
      allowApiFallback ? this.settingsStore.getApiKey() : Promise.resolve("")
    ]);
    const providers: Array<{ provider: AgentRuntimeProvider; model: string }> = [];

    if (codexStatus?.available && codexStatus.connected) {
      const models = AUTOCOMPLETE_CODEX_MODEL_PREFERENCES.filter((model) => !this.unavailableAutocompleteModels.has(model));

      providers.push(
        ...(models.length > 0 ? models : [this.preferredAutocompleteCodexModel()]).map((model) => ({
          provider: new CodexAppServerRuntimeProvider({
            client: this.codexClient(),
            model
          }),
          model
        }))
      );
    }

    if (allowApiFallback && apiKey) {
      providers.push({
        provider: new OpenAiResponsesRuntimeProvider({
          apiKey,
          model: AUTOCOMPLETE_API_MODEL
        }),
        model: AUTOCOMPLETE_API_MODEL
      });
    }

    if (providers.length > 0) {
      return { providers };
    }

    if (!allowApiFallback) {
      return {
        error: {
          code: "missing_api_key",
          userMessage: "Connect Codex or explicitly enable OpenAI API fallback for autocomplete.",
          detail: "autocomplete_api_fallback_disabled",
          retryable: false
        }
      };
    }

    return {
      error: missingApiKeyError().agentError
    };
  }

  private preferredAutocompleteCodexModel() {
    return (
      AUTOCOMPLETE_CODEX_MODEL_PREFERENCES.find((model) => !this.unavailableAutocompleteModels.has(model)) ??
      AUTOCOMPLETE_CODEX_MODEL_PREFERENCES[AUTOCOMPLETE_CODEX_MODEL_PREFERENCES.length - 1]
    );
  }

  private externalCaptureSession(workspaceRoot: string, captureId: string) {
    const session = this.externalCaptures.get(captureId);
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    if (!session || session.workspaceRoot !== resolvedWorkspaceRoot) {
      throw new Error("External capture not found for this workspace.");
    }

    return session;
  }

  private externalCaptureSessionForProposal(workspaceRoot: string, proposalId: string) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

    for (const session of this.externalCaptures.values()) {
      if (session.workspaceRoot === resolvedWorkspaceRoot && session.proposal?.id === proposalId) {
        return session;
      }
    }

    return null;
  }

  private async refreshExternalCaptureProposal(session: ExternalAgentCaptureSession) {
    const startedAt = Date.now();
    const after = await captureMarkdownWorkspaceSnapshot({ workspaceRoot: session.workspaceRoot });
    const diff = compareMarkdownSnapshots({
      before: session.snapshot,
      after,
      sourceLabel: session.agentName ?? "External agent"
    });

    session.gitSnapshot = await captureGitAdvisorySnapshot(session.workspaceRoot);
    session.snapshotId = randomUUID();

    if (diff.draftFileChanges.length === 0) {
      session.proposal = null;
      this.logExternalCaptureInfo("external_capture.refreshed", startedAt, session.workspaceRoot, {
        captureId: session.captureId,
        status: "empty",
        markdownFileCount: after.files.size,
        changeFileCount: 0,
        unsupportedNoteCount: diff.unsupportedNotes.length
      });
      return null;
    }

    session.proposal = buildExternalFilesystemProposal(session, diff.draftFileChanges);
    this.logExternalCaptureInfo("external_capture.refreshed", startedAt, session.workspaceRoot, {
      captureId: session.captureId,
      status: "proposal",
      markdownFileCount: after.files.size,
      unsupportedNoteCount: diff.unsupportedNotes.length,
      ...externalProposalFileKindDetails(session.proposal.files)
    });
    return session.proposal;
  }

  private async applyExternalProposalFile(
    session: ExternalAgentCaptureSession,
    fileId: string
  ): Promise<ApplyAgentProposalFileResponse> {
    const proposal = externalProposalOrThrow(session);
    const action = await this.externalProposalFileForAction(session, proposal, fileId);

    if (!action) {
      const file = externalProposalFileOrThrow(proposal, fileId);
      return externalApplyResponse(file, terminalExternalProposal(proposal, fileId, "stale"), "stale");
    }

    const { file } = action;

    if (file.kind === "edit_file") {
      this.setExternalBaselineFile(session, file.relativePath, file.replacement);
      const refreshed = await this.refreshExternalCaptureProposal(session);
      return externalApplyResponse(file, refreshed ?? terminalExternalProposal(action.proposal, fileId, "applied"), "applied", {
        content: file.replacement
      });
    }

    if (file.kind === "create_file") {
      this.setExternalBaselineFile(session, file.relativePath, file.content);
      const refreshed = await this.refreshExternalCaptureProposal(session);
      return externalApplyResponse(file, refreshed ?? terminalExternalProposal(action.proposal, fileId, "applied"), "applied", {
        content: file.content,
        file: fileTreeNode(session.workspaceRoot, path.join(session.workspaceRoot, file.relativePath))
      });
    }

    this.deleteExternalBaselineFile(session, file.relativePath);
    const refreshed = await this.refreshExternalCaptureProposal(session);
    return externalApplyResponse(file, refreshed ?? terminalExternalProposal(action.proposal, fileId, "applied"), "applied");
  }

  private async rejectExternalProposalFile(
    session: ExternalAgentCaptureSession,
    fileId: string
  ): Promise<AgentChangeProposal> {
    const proposal = externalProposalOrThrow(session);
    const action = await this.externalProposalFileForAction(session, proposal, fileId);

    if (!action) {
      return cloneAgentProposal(terminalExternalProposal(proposal, fileId, "stale"));
    }

    const { file } = action;

    await this.ensureExternalDestructiveWriteAllowed(session);

    if (file.kind === "edit_file") {
      await trackWorkspaceMutation(session.workspaceRoot, [path.join(session.workspaceRoot, file.relativePath)], () =>
        writeMarkdownFile(session.workspaceRoot, path.join(session.workspaceRoot, file.relativePath), file.baseContent)
      );
    } else if (file.kind === "create_file") {
      await trackWorkspaceMutation(session.workspaceRoot, [path.join(session.workspaceRoot, file.relativePath)], () =>
        this.moveExternalFileToQuarantine(session.workspaceRoot, file.relativePath)
      );
    } else {
      await trackWorkspaceMutation(session.workspaceRoot, [path.join(session.workspaceRoot, file.relativePath)], async () => {
        const absolutePath = path.join(session.workspaceRoot, file.relativePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeMarkdownFile(session.workspaceRoot, absolutePath, file.baseContent);
      });
    }

    return cloneAgentProposal(
      (await this.refreshExternalCaptureProposal(session)) ?? terminalExternalProposal(action.proposal, fileId, "rejected")
    );
  }

  private async externalProposalFileForAction(
    session: ExternalAgentCaptureSession,
    proposal: AgentChangeProposal,
    fileId: string
  ) {
    const file = externalProposalFileOrThrow(proposal, fileId);
    const current = await this.readExternalPathState(session.workspaceRoot, file.relativePath);

    if (externalFileMatchesReviewedState(file, current)) {
      return { proposal, file };
    }

    const refreshed = await this.refreshExternalCaptureProposal(session);

    if (!refreshed) {
      return null;
    }

    const refreshedFile = refreshed.files.find((candidate) => candidate.id === fileId);

    if (!refreshedFile) {
      return null;
    }

    const refreshedCurrent = await this.readExternalPathState(session.workspaceRoot, refreshedFile.relativePath);

    if (!externalFileMatchesReviewedState(refreshedFile, refreshedCurrent)) {
      return null;
    }

    return { proposal: refreshed, file: refreshedFile };
  }

  private async rejectExternalProposal(session: ExternalAgentCaptureSession): Promise<AgentChangeProposal> {
    const proposal = externalProposalOrThrow(session);
    const mutableFiles = proposal.files.filter((file) => file.status === "pending" || file.status === "stale" || file.status === "failed");

    for (const file of mutableFiles) {
      const current = await this.readExternalPathState(session.workspaceRoot, file.relativePath);

      if (!externalFileMatchesReviewedState(file, current)) {
        return cloneAgentProposal(
          (await this.refreshExternalCaptureProposal(session)) ?? terminalExternalProposal(proposal, file.id, "stale")
        );
      }
    }

    await this.ensureExternalDestructiveWriteAllowed(session);

    for (const file of mutableFiles) {
      if (file.kind === "edit_file") {
        await trackWorkspaceMutation(session.workspaceRoot, [path.join(session.workspaceRoot, file.relativePath)], () =>
          writeMarkdownFile(session.workspaceRoot, path.join(session.workspaceRoot, file.relativePath), file.baseContent)
        );
      } else if (file.kind === "create_file") {
        await trackWorkspaceMutation(session.workspaceRoot, [path.join(session.workspaceRoot, file.relativePath)], () =>
          this.moveExternalFileToQuarantine(session.workspaceRoot, file.relativePath)
        );
      } else {
        await trackWorkspaceMutation(session.workspaceRoot, [path.join(session.workspaceRoot, file.relativePath)], async () => {
          const absolutePath = path.join(session.workspaceRoot, file.relativePath);
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeMarkdownFile(session.workspaceRoot, absolutePath, file.baseContent);
        });
      }
    }

    return cloneAgentProposal(
      (await this.refreshExternalCaptureProposal(session)) ?? terminalExternalProposal(proposal, mutableFiles[0]?.id ?? "", "rejected")
    );
  }

  private async readExternalPathState(workspaceRoot: string, relativePath: string) {
    const absolutePath = path.join(workspaceRoot, relativePath);

    try {
      ensureMarkdownFile(workspaceRoot, absolutePath);
      ensureVisibleWorkspacePath(workspaceRoot, path.dirname(absolutePath));
      await ensureSafeAncestors(workspaceRoot, path.dirname(absolutePath));
      const stats = await lstat(absolutePath);

      if (stats.isSymbolicLink() || !stats.isFile()) {
        return { status: "unsafe" as const };
      }

      return { status: "present" as const, content: await readFile(absolutePath, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "absent" as const };
      }

      return { status: "unsafe" as const };
    }
  }

  private setExternalBaselineFile(session: ExternalAgentCaptureSession, relativePath: string, content: string) {
    const absolutePath = path.join(session.workspaceRoot, relativePath);
    session.snapshot.files.set(relativePath, {
      absolutePath,
      relativePath,
      content,
      baseHash: hashMarkdown(content),
      existed: true
    });
    session.baselineId = randomUUID();
  }

  private deleteExternalBaselineFile(session: ExternalAgentCaptureSession, relativePath: string) {
    session.snapshot.files.delete(relativePath);
    session.baselineId = randomUUID();
  }

  private async ensureExternalDestructiveWriteAllowed(session: ExternalAgentCaptureSession) {
    const gitCheck = await checkGitAdvisorySnapshot(session.workspaceRoot, session.gitSnapshot);

    if (gitCheck.status === "head_changed") {
      throw new Error("Repository changed outside Iliad; refresh outside changes before restoring files.");
    }

    if (gitCheck.status === "unsafe") {
      throw new Error("Repository state could not be checked before restoring outside changes.");
    }
  }

  private async moveExternalFileToQuarantine(workspaceRoot: string, relativePath: string) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const quarantinePath = path.join(this.userDataPath, "external-review-trash", randomUUID(), relativePath);
    await mkdir(path.dirname(quarantinePath), { recursive: true });
    await rename(absolutePath, quarantinePath);
    await removeEmptyAncestors(path.dirname(absolutePath), workspaceRoot);
  }

  private clearExternalCaptureSession(session: ExternalAgentCaptureSession) {
    this.externalCaptures.delete(session.captureId);
    this.externalCaptureIdsByWorkspace.delete(session.workspaceRoot);
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
    const hydratedDraftFileChanges = await this.hydrateDeleteDrafts(request, draftFileChanges);
    const proposal = buildMarkdownChangeProposal({
      request,
      responseId,
      model,
      source,
      draftFileChanges: hydratedDraftFileChanges
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
        proposalId: savedProposal.id,
        proposalCount: 1,
        fileCount: savedProposal.files.length,
        editFileCount: savedProposal.files.filter((file) => file.kind === "edit_file").length,
        createFileCount: savedProposal.files.filter((file) => file.kind === "create_file").length,
        deleteFileCount: savedProposal.files.filter((file) => file.kind === "delete_file").length
      }
    });

    return [savedProposal];
  }

  private async hydrateDeleteDrafts(request: AgentRunRequest, draftFileChanges: AgentDraftFileChange[]) {
    const hydratedDrafts: AgentDraftFileChange[] = [];

    for (const draft of draftFileChanges) {
      if (draft.kind !== "delete_file") {
        hydratedDrafts.push(draft);
        continue;
      }

      const absolutePath = path.join(request.workspaceRoot, draft.relativePath);
      ensureMarkdownFile(request.workspaceRoot, absolutePath);
      ensureVisibleWorkspacePath(request.workspaceRoot, path.dirname(absolutePath));
      const stats = await lstat(absolutePath);

      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error("Only regular Markdown files can be deleted here.");
      }

      const baseContent = draft.baseContent || (await readMarkdownFile(request.workspaceRoot, absolutePath));
      const baseHash = draft.baseHash || hashMarkdown(baseContent);

      hydratedDrafts.push({
        ...draft,
        baseHash,
        baseContent,
        unifiedDiff: draft.unifiedDiff || unifiedDiff(baseContent, "", draft.relativePath)
      });
    }

    return hydratedDrafts;
  }

  private logExternalCaptureInfo(
    event: string,
    startedAt: number,
    workspaceRoot: string,
    details: Record<string, DiagnosticDetailValue>
  ) {
    this.diagnostics.info({
      area: "agent",
      event,
      durationMs: Date.now() - startedAt,
      details: {
        workspaceFingerprint: workspaceFingerprint(workspaceRoot),
        ...details
      }
    });
  }

  private logExternalCaptureWarn(
    event: string,
    startedAt: number,
    workspaceRoot: string,
    error: unknown,
    details: Record<string, DiagnosticDetailValue> = {}
  ) {
    this.diagnostics.warn({
      area: "agent",
      event,
      durationMs: Date.now() - startedAt,
      details: {
        workspaceFingerprint: workspaceFingerprint(workspaceRoot),
        ...details,
        ...sanitizeUnknownError(error)
      }
    });
  }

  private async proposalActionDetails(
    workspaceRoot: string,
    proposalId: string,
    fileId: string | undefined,
    externalSession: ExternalAgentCaptureSession | null
  ): Promise<Record<string, DiagnosticDetailValue>> {
    const proposal = externalSession?.proposal ?? (await this.proposalStore.getProposal(workspaceRoot, proposalId));

    return this.proposalActionDetailsFromProposal(workspaceRoot, proposal, fileId, Boolean(externalSession), proposalId);
  }

  private proposalActionDetailsFromProposal(
    workspaceRoot: string,
    proposal: AgentChangeProposal | null,
    fileId: string | undefined,
    externalSessionFound: boolean,
    requestedProposalId = proposal?.id ?? "missing"
  ): Record<string, DiagnosticDetailValue> {
    const file = fileId ? proposal?.files.find((candidate) => candidate.id === fileId) : undefined;

    return {
      workspaceFingerprint: workspaceFingerprint(workspaceRoot),
      proposalId: requestedProposalId,
      requestedFileId: fileId ?? null,
      externalSessionFound,
      proposalFound: Boolean(proposal),
      sourceKind: proposal?.source.kind ?? null,
      metadataKind: proposal?.metadata?.kind ?? null,
      proposalStatus: proposal?.status ?? null,
      proposalFileCount: proposal?.files.length ?? 0,
      fileFound: fileId ? Boolean(file) : null,
      fileKind: file?.kind ?? null,
      fileStatus: file?.status ?? null
    };
  }

  private logProposalActionInfo(event: string, startedAt: number, details: Record<string, DiagnosticDetailValue>) {
    this.diagnostics.info({
      area: "agent",
      event,
      durationMs: Date.now() - startedAt,
      details
    });
  }

  private logProposalActionWarn(
    event: string,
    startedAt: number,
    details: Record<string, DiagnosticDetailValue>,
    error: unknown
  ) {
    this.diagnostics.warn({
      area: "agent",
      event,
      durationMs: Date.now() - startedAt,
      details: {
        ...details,
        ...sanitizeUnknownError(error)
      }
    });
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

type AgentRuntimeProviderCandidateSelection =
  | {
      providers: Array<{
        provider: AgentRuntimeProvider;
        model: string;
      }>;
    }
  | {
      error: AgentError;
    };

function shouldMarkAutocompleteModelUnavailable(error: unknown) {
  const agentError = normalizeAgentError(error);

  if (agentError.code === "model_not_found") {
    return true;
  }

  if (agentError.code !== "provider_unavailable") {
    return false;
  }

  return /access|model|not_found|unsupported/i.test(agentError.detail ?? "");
}

function shouldTryNextAutocompleteProvider(
  error: unknown,
  currentCandidate: { provider: AgentRuntimeProvider; model: string },
  nextCandidate: { provider: AgentRuntimeProvider; model: string }
) {
  const agentError = normalizeAgentError(error);

  if (agentError.code === "request_canceled") {
    return false;
  }

  if (currentCandidate.provider.metadata.id === nextCandidate.provider.metadata.id) {
    return currentCandidate.model !== nextCandidate.model && shouldMarkAutocompleteModelUnavailable(error);
  }

  return ["provider_unavailable", "request_timeout", "network_unreachable", "dns_failure", "unknown"].includes(agentError.code);
}

export function nextAutocompleteProviderIndex(
  error: unknown,
  candidates: Array<{ provider: AgentRuntimeProvider; model: string }>,
  currentIndex: number
) {
  const currentCandidate = candidates[currentIndex];

  if (!currentCandidate) {
    return -1;
  }

  for (let index = currentIndex + 1; index < candidates.length; index += 1) {
    if (shouldTryNextAutocompleteProvider(error, currentCandidate, candidates[index])) {
      return index;
    }
  }

  return -1;
}

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

function safeRunIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "request";
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

function externalCaptureRunRequest(session: ExternalAgentCaptureSession): AgentRunRequest {
  return {
    runId: `external-agent-${session.captureId}`,
    workspaceRoot: session.workspaceRoot,
    activeFile: null,
    messages: [],
    prompt: "External agent changes",
    mode: "balanced",
    language: "en"
  };
}

function buildExternalFilesystemProposal(
  session: ExternalAgentCaptureSession,
  draftFileChanges: AgentDraftFileChange[]
): AgentChangeProposal {
  const sortedDrafts = [...draftFileChanges].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const proposal = buildMarkdownChangeProposal({
    request: externalCaptureRunRequest(session),
    model: "external-filesystem",
    source: {
      kind: "external_agent",
      agentName: session.agentName
    },
    draftFileChanges: sortedDrafts
  });

  if (!proposal) {
    throw new Error("External changes could not be prepared for review.");
  }

  proposal.id = externalProposalId(session);
  proposal.runId = `external-agent-${session.captureId}`;
  proposal.metadata = {
    kind: "external_filesystem",
    baselineId: session.baselineId,
    snapshotId: session.snapshotId,
    liveDisk: true,
    sessionScoped: true
  };
  proposal.files = proposal.files.map((file) => {
    file.id = externalFileId(file.relativePath);

    if (file.kind === "edit_file") {
      file.hunks = buildLineReviewHunks(file.baseContent, file.replacement, file.id);
      file.baselineState = "present";
      file.baselineContentHash = file.baseHash;
      file.reviewedState = "present";
      file.reviewedContentHash = hashMarkdown(file.replacement);
    } else if (file.kind === "create_file") {
      file.baselineState = "absent";
      file.reviewedState = "present";
      file.reviewedContentHash = hashMarkdown(file.content);
    } else {
      file.baselineState = "present";
      file.baselineContentHash = file.baseHash;
      file.reviewedState = "absent";
    }

    return file;
  });

  return proposal;
}

function externalProposalId(session: ExternalAgentCaptureSession) {
  return `proposal-external-filesystem-${session.captureId}`;
}

function externalFileId(relativePath: string) {
  return `external-file-${createHash("sha256").update(relativePath).digest("hex").slice(0, 16)}`;
}

function cloneAgentProposal(proposal: AgentChangeProposal): AgentChangeProposal {
  return JSON.parse(JSON.stringify(proposal)) as AgentChangeProposal;
}

function externalProposalOrThrow(session: ExternalAgentCaptureSession) {
  if (!session.proposal) {
    throw new Error("No outside changes are pending review.");
  }

  return session.proposal;
}

function externalProposalFileOrThrow(proposal: AgentChangeProposal, fileId: string) {
  const file = proposal.files.find((candidate) => candidate.id === fileId);

  if (!file) {
    throw new Error("Outside change was not found.");
  }

  return file;
}

async function ensureSafeAncestors(workspaceRoot: string, directoryPath: string) {
  const root = path.resolve(workspaceRoot);
  let current = path.resolve(directoryPath);
  const ancestors: string[] = [];

  while (current !== root) {
    if (path.relative(root, current).startsWith("..")) {
      throw new Error("Path is outside the workspace.");
    }

    ancestors.push(current);
    current = path.dirname(current);
  }

  for (const ancestor of ancestors.reverse()) {
    try {
      const stats = await lstat(ancestor);

      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("Path was replaced outside Iliad.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }

      throw error;
    }
  }
}

async function removeEmptyAncestors(directoryPath: string, workspaceRoot: string) {
  let currentPath = path.resolve(directoryPath);
  const root = path.resolve(workspaceRoot);

  while (currentPath !== root && !path.relative(root, currentPath).startsWith("..")) {
    try {
      await rmdir(currentPath);
    } catch {
      return;
    }

    currentPath = path.dirname(currentPath);
  }
}

function workspaceFingerprint(workspaceRoot: string) {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 12);
}

function externalProposalFileKindDetails(files: AgentProposalFileChange[]): Record<string, DiagnosticDetailValue> {
  return {
    changeFileCount: files.length,
    editFileCount: files.filter((file) => file.kind === "edit_file").length,
    createFileCount: files.filter((file) => file.kind === "create_file").length,
    deleteFileCount: files.filter((file) => file.kind === "delete_file").length
  };
}

function externalFileMatchesReviewedState(
  file: AgentProposalFileChange,
  current: { status: "present"; content: string } | { status: "absent" } | { status: "unsafe" }
) {
  if (current.status === "unsafe") {
    throw new Error("The reviewed path changed into an unsafe file type outside Iliad.");
  }

  if (file.reviewedState === "absent" || file.kind === "delete_file") {
    return current.status === "absent";
  }

  if (current.status !== "present") {
    return false;
  }

  const reviewedHash =
    file.reviewedContentHash ??
    (file.kind === "edit_file" ? hashMarkdown(file.replacement) : file.kind === "create_file" ? hashMarkdown(file.content) : undefined);

  return Boolean(reviewedHash && hashMarkdown(current.content) === reviewedHash);
}

function terminalExternalProposal(
  proposal: AgentChangeProposal,
  fileId: string,
  status: "applied" | "rejected" | "stale"
): AgentChangeProposal {
  const next = cloneAgentProposal(proposal);

  for (const file of next.files) {
    if (!fileId || file.id === fileId) {
      file.status = status === "stale" ? "stale" : status;
      if (file.kind === "edit_file") {
        for (const hunk of file.hunks ?? []) {
          if (hunk.status === "pending" || hunk.status === "stale") {
            hunk.status = status === "applied" ? "accepted" : status === "rejected" ? "rejected" : "stale";
          }
        }
      }
    }
  }

  next.status = status === "stale" ? "stale" : status;
  next.updatedAt = new Date().toISOString();
  return next;
}

function externalApplyResponse(
  file: AgentProposalFileChange,
  proposal: AgentChangeProposal,
  status: "applied" | "stale",
  options: { content?: string; file?: { name: string; path: string; relativePath: string; kind: "markdown" } } = {}
): ApplyAgentProposalFileResponse {
  return {
    kind: file.kind,
    proposal: cloneAgentProposal(proposal),
    fileId: file.id,
    status,
    ...options
  } as ApplyAgentProposalFileResponse;
}

function fileTreeNode(workspaceRoot: string, filePath: string) {
  return {
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(workspaceRoot, filePath),
    kind: "markdown" as const
  };
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
