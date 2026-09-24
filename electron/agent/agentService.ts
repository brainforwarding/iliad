import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { readMarkdownFile } from "../fs/fileOps.js";
import { ensureMarkdownFile, ensureVisibleWorkspacePath } from "../fs/pathSafety.js";
import { workspaceFingerprint } from "../review/externalReviewProjection.js";
import { WorkspaceBaselineService, type ExternalReviewActionResult } from "../review/workspaceBaseline.js";
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
import { CodexAppServerClient } from "./runtime/codexAppServerClient.js";
import { CodexAppServerRuntimeProvider } from "./runtime/codexAppServerProvider.js";
import { restoreSnapshotSafely, type MarkdownSnapshot } from "./runtime/codexFileChangeCapture.js";
import { CodexRunJournalStore } from "./runtime/codexRunJournal.js";
import { OpenAiResponsesRuntimeProvider } from "./runtime/openaiResponsesProvider.js";
import type {
  AgentRuntimeDiagnosticEvent,
  AgentRuntimeProvider,
  AgentRuntimeProviderMetadata
} from "./runtime/provider.js";
import { AgentSettingsStore } from "./settingsStore.js";
import { AUTOCOMPLETE_GEMINI_MODEL, generateGeminiAutocomplete } from "./geminiAutocomplete.js";
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
  ApplyAgentProposalFileRequest,
  ApplyAgentProposalFileResponse,
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
  baselineService?: WorkspaceBaselineService;
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
  private readonly baselineService: WorkspaceBaselineService;
  private readonly codexRunJournals: CodexRunJournalStore;
  private codexAppServerClient: CodexAppServerClient | null = null;
  private readonly unavailableAutocompleteModels = new Set<string>();
  private readonly compactionCacheStore: CompactionCacheStore;
  private readonly compactionFailures = new Map<string, number>();
  private compactionInFlight = false;

  constructor(private readonly userDataPath: string, options: AgentServiceOptions = {}) {
    this.settingsStore = new AgentSettingsStore(userDataPath);
    this.baselineService = options.baselineService ?? new WorkspaceBaselineService();
    this.proposalStore = new AgentProposalStore(userDataPath, {
      markdownWriter: this.baselineService.markdownWriter()
    });
    this.codexRunJournals = new CodexRunJournalStore(userDataPath);
    this.baselineService.onBeforeBaseline((workspaceRoot) => this.recoverCodexRunJournals(workspaceRoot));
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
    const geminiApiKey = await this.settingsStore.getGeminiApiKey();
    if (geminiApiKey) {
      const startedAt = Date.now();
      try {
        const text = await generateGeminiAutocomplete(geminiApiKey, request);
        this.diagnostics.info({ area: "provider", event: "autocomplete.gemini.completed",
          model: AUTOCOMPLETE_GEMINI_MODEL, durationMs: Date.now() - startedAt,
          details: { suggestionKind: request.suggestionKind, outputTextChars: text.length } });
        return text;
      } catch (error) {
        this.diagnostics.info({ area: "provider", event: "autocomplete.gemini.failed",
          model: AUTOCOMPLETE_GEMINI_MODEL, durationMs: Date.now() - startedAt,
          errorCode: normalizeAgentError(error, { wasCanceled: request.signal.aborted }).code });
        throw error;
      }
    }
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
            instructions: autocompleteInstructions(request.language, request.suggestionKind, request.extend),
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
    const [settings, apiKey, geminiApiKey, codexStatus] = await Promise.all([
      this.settingsStore.snapshot(),
      this.settingsStore.getApiKey(),
      this.settingsStore.getGeminiApiKey(),
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
        available: Boolean(geminiApiKey) || codexAvailable || (request.autocompleteApiFallbackEnabled && apiFallbackAvailable),
        provider: geminiApiKey ? ("gemini-api" as const) : codexAvailable ? ("codex-app-server" as const) : request.autocompleteApiFallbackEnabled && apiFallbackAvailable ? ("openai-api" as const) : null,
        apiFallbackAvailable,
        apiFallbackEnabled: request.autocompleteApiFallbackEnabled,
        model: geminiApiKey ? AUTOCOMPLETE_GEMINI_MODEL : codexAvailable
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

  async listProposals(workspaceRoot: string) {
    const proposals = (await this.proposalStore.listProposals(workspaceRoot)).filter(
      (proposal) => proposal.source.kind !== "external_agent" && proposal.metadata?.kind !== "external_filesystem"
    );
    const external = this.baselineService.currentReview(workspaceRoot).proposal;

    if (external) {
      proposals.push(external);
    }

    return proposals.sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  }

  getExternalReview(workspaceRoot: string) {
    return this.baselineService.currentReview(workspaceRoot);
  }

  /**
   * Restores files left behind by Codex runs that never finished (Iliad crash
   * mid-run) and turns the abandoned writes into reviewable proposals. Runs
   * before the workspace baseline is taken so nothing model-authored is
   * silently accepted.
   */
  async recoverCodexRunJournals(workspaceRoot: string) {
    const startedAt = Date.now();
    const records = await this.codexRunJournals.listForWorkspace(workspaceRoot);

    for (const record of records) {
      const resolvedRoot = path.resolve(record.workspaceRoot);
      const snapshot: MarkdownSnapshot = {
        workspaceRoot: resolvedRoot,
        files: new Map(
          record.files.map((file) => [
            file.relativePath,
            {
              absolutePath: path.join(resolvedRoot, file.relativePath),
              relativePath: file.relativePath,
              content: file.content,
              baseHash: file.hash,
              existed: true
            }
          ])
        )
      };

      try {
        const outcome = await restoreSnapshotSafely(snapshot);
        const restored = new Set(outcome.restored);
        const draftFileChanges = outcome.drafts.filter((draft) => restored.has(draft.relativePath));
        const proposals =
          draftFileChanges.length > 0
            ? await this.saveDraftProposals({
                request: {
                  runId: record.runId,
                  workspaceRoot: resolvedRoot,
                  activeFile: null,
                  messages: [],
                  prompt: "Recovered Codex changes",
                  mode: "balanced",
                  language: "en"
                },
                model: "codex",
                draftFileChanges,
                source: { kind: "codex_app_server" }
              })
            : [];

        this.diagnostics.info({
          area: "agent",
          event: "agent.codex_journal.recovered",
          runId: record.runId,
          durationMs: Date.now() - startedAt,
          details: {
            workspaceFingerprint: workspaceFingerprint(resolvedRoot),
            restoredCount: outcome.restored.length,
            unrestoredCount: outcome.unrestored.length,
            proposalCount: proposals.length
          }
        });
        // Only a completed recovery retires the journal; a failed one is
        // retried on the next attach instead of being silently accepted.
        await this.codexRunJournals.remove(record.runId);
      } catch (error) {
        this.diagnostics.warn({
          area: "agent",
          event: "agent.codex_journal.recovery_failed",
          runId: record.runId,
          details: {
            workspaceFingerprint: workspaceFingerprint(resolvedRoot),
            ...sanitizeUnknownError(error)
          }
        });
      }
    }

    await this.codexRunJournals.pruneStale();
  }

  async applyProposalFile(request: ApplyAgentProposalFileRequest) {
    const startedAt = Date.now();
    const external = this.baselineService.isExternalProposalId(request.workspaceRoot, request.proposalId);
    const actionDetails = await this.proposalActionDetails(request.workspaceRoot, request.proposalId, request.fileId, external);

    this.logProposalActionInfo("agent.proposal_file.apply_started", startedAt, actionDetails);

    try {
      const result = external
        ? externalApplyResponse(await this.baselineService.keep(request.workspaceRoot, request.fileId), request.fileId)
        : await this.proposalStore.applyProposalFile(request.workspaceRoot, request.proposalId, request.fileId);

      this.logProposalActionInfo("agent.proposal_file.apply_finished", startedAt, {
        ...this.proposalActionDetailsFromProposal(request.workspaceRoot, result.proposal, request.fileId, external),
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
    const external = this.baselineService.isExternalProposalId(request.workspaceRoot, request.proposalId);
    const actionDetails = await this.proposalActionDetails(request.workspaceRoot, request.proposalId, request.fileId, external);

    this.logProposalActionInfo("agent.proposal_file.reject_started", startedAt, actionDetails);

    try {
      const proposal = external
        ? (await this.baselineService.restore(request.workspaceRoot, request.fileId)).proposal
        : await this.proposalStore.rejectProposalFile(request.workspaceRoot, request.proposalId, request.fileId);

      this.logProposalActionInfo(
        "agent.proposal_file.reject_finished",
        startedAt,
        this.proposalActionDetailsFromProposal(request.workspaceRoot, proposal, request.fileId, external)
      );
      return proposal;
    } catch (error) {
      this.logProposalActionWarn("agent.proposal_file.reject_failed", startedAt, actionDetails, error);
      throw error;
    }
  }

  async rejectProposal(request: RejectAgentProposalRequest) {
    const startedAt = Date.now();
    const external = this.baselineService.isExternalProposalId(request.workspaceRoot, request.proposalId);
    const actionDetails = await this.proposalActionDetails(request.workspaceRoot, request.proposalId, undefined, external);

    this.logProposalActionInfo("agent.proposal.reject_started", startedAt, actionDetails);

    try {
      let proposal: AgentChangeProposal;

      if (external) {
        const result = await this.baselineService.restoreAll(request.workspaceRoot);

        if (result.unrestored.length > 0) {
          throw new Error(
            `Some outside changes could not be restored: ${result.unrestored
              .map((entry) => `${entry.relativePath} (${entry.reason})`)
              .join("; ")}`
          );
        }

        proposal = result.proposal;
      } else {
        proposal = await this.proposalStore.rejectProposal(request.workspaceRoot, request.proposalId);
      }

      this.logProposalActionInfo(
        "agent.proposal.reject_finished",
        startedAt,
        this.proposalActionDetailsFromProposal(request.workspaceRoot, proposal, undefined, external)
      );
      return proposal;
    } catch (error) {
      this.logProposalActionWarn("agent.proposal.reject_failed", startedAt, actionDetails, error);
      throw error;
    }
  }

  resolveProposalHunk(request: ResolveAgentProposalHunkRequest) {
    if (this.baselineService.isExternalProposalId(request.workspaceRoot, request.proposalId)) {
      throw new Error("Outside changes are kept or restored per file.");
    }

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
          model,
          journal: this.codexRunJournals,
          onWorkspaceRestored: (workspaceRoot) => this.baselineService.requestFullRefresh(workspaceRoot)
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

  private async proposalActionDetails(
    workspaceRoot: string,
    proposalId: string,
    fileId: string | undefined,
    external: boolean
  ): Promise<Record<string, DiagnosticDetailValue>> {
    const proposal = external
      ? this.baselineService.currentReview(workspaceRoot).proposal
      : await this.proposalStore.getProposal(workspaceRoot, proposalId);

    return this.proposalActionDetailsFromProposal(workspaceRoot, proposal, fileId, external, proposalId);
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

function externalApplyResponse(result: ExternalReviewActionResult, fileId: string): ApplyAgentProposalFileResponse {
  const file = result.proposal.files.find((candidate) => candidate.id === fileId);
  const kind =
    result.kind === "edit"
      ? "edit_file"
      : result.kind === "create"
        ? "create_file"
        : result.kind === "delete"
          ? "delete_file"
          : (file?.kind ?? "edit_file");
  const status = result.status === "applied" ? "applied" : "stale";

  if (kind === "create_file") {
    return {
      kind,
      proposal: result.proposal,
      fileId,
      status,
      ...(result.relativePath
        ? {
            file: {
              name: path.basename(result.relativePath),
              path: path.join(result.snapshot.workspaceRoot, result.relativePath),
              relativePath: result.relativePath,
              kind: "markdown" as const
            },
            content: result.content
          }
        : {})
    };
  }

  if (kind === "delete_file") {
    return { kind, proposal: result.proposal, fileId, status };
  }

  return { kind, proposal: result.proposal, fileId, status, content: result.content };
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
