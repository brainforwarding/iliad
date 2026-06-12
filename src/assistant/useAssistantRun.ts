import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppStrings } from "../i18n/strings";
import {
  fallbackChatThreadTitle,
  upsertChatThreadSummary,
  visibleHistoryEntries
} from "./chatHistory";
import {
  agentErrorMessage,
  compactStatusText,
  isGenericRunningStatus,
  localizedStatusMessage,
  localizedRunPhase,
  mergeRunActivityEvent,
  previouslyReferencedDocumentPaths,
  thinkingStatusText
} from "./assistantUtils";
import {
  contextFileBasename,
  contextFileDragMimeType,
  isVisibleMarkdownContextPath,
  manualContextAttachmentLimit,
  normalizeRelativePath,
  readContextFileDragPayload,
  workspaceContextApiSessionId,
  workspaceContextDragSessionId,
  type AssistantContextAttachmentChip,
  type AssistantContextAttachmentSource
} from "./contextAttachments";
import { buildRunOutcomeEntry, type AssistantEntry } from "./runEntries";
import { lineRangeOf, selectionRangesEqual, type EditorSelectionRange } from "./selectionContext";
import { applyTextDelta, emptyStreamingText, isScrolledToBottom, visibleStreamingText } from "./streaming";
import {
  chooseInitialReviewTarget,
  type ReviewTarget
} from "./reviewNavigation";
import { useDictation } from "./useDictation";
import type {
  AgentActivityRunEvent,
  AgentChangeProposal,
  AgentChatThreadSummary,
  AgentChatThreadTitleSource,
  AgentRunContextManifest,
  AgentMessage,
  AgentMode,
  AgentRunEvent,
  AgentSettingsSnapshot,
  CodexAccountStatusResponse,
  CodexDeviceLoginResponse,
  CodexOpenDeviceLoginResponse,
  FileTreeNode,
  NormalizeContextDropResponse,
  TelegramRemotePairingStartResponse,
  TelegramRemoteSettings,
  WorkspaceInfo
} from "../types/iliad";

export type { AssistantEntry } from "./runEntries";
type AssistantChatEntry = { id: string; kind: "user" | "assistant"; text: string };
type AgentApiWithRunEvents = typeof window.iliad.agent & {
  onRunEvent?: (listener: (event: AgentRunEvent) => void) => () => void;
};
type AgentApiWithCodexAccount = typeof window.iliad.agent & {
  codexStatus?: () => Promise<CodexAccountStatusResponse>;
  startCodexDeviceLogin?: () => Promise<CodexDeviceLoginResponse>;
  cancelCodexLogin?: () => Promise<CodexAccountStatusResponse>;
  logoutCodex?: () => Promise<CodexAccountStatusResponse>;
  openCodexDeviceLogin?: () => Promise<CodexOpenDeviceLoginResponse>;
};
type IliadApiWithContextDrop = typeof window.iliad & {
  normalizeContextDrop?: (workspaceSessionId: string, absolutePath: string) => Promise<NormalizeContextDropResponse>;
};
type IliadApiWithRemoteSettings = typeof window.iliad & {
  remote?: {
    getSettings?: () => Promise<TelegramRemoteSettings>;
    startPairing?: () => Promise<TelegramRemotePairingStartResponse>;
    updateSettings?: (update: { enabled?: boolean; activeThreadId?: string; workspaceSessionId?: string }) => Promise<TelegramRemoteSettings>;
    revokeSettings?: () => Promise<TelegramRemoteSettings>;
  };
};

export interface CodexConnectionState {
  busy: boolean;
  error: string | null;
  login: CodexDeviceLoginResponse["login"] | null;
  status: CodexAccountStatusResponse | null;
  onCancelLogin: () => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onOpenLogin: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export interface TelegramRemoteConnectionState {
  activeChatLabel: string;
  busy: boolean;
  canUseCurrentChat: boolean;
  error: string | null;
  pairing: TelegramRemotePairingStartResponse | null;
  settings: TelegramRemoteSettings | null;
  onDisable: () => Promise<void>;
  onEnable: () => Promise<void>;
  onPair: () => Promise<void>;
  onRevoke: () => Promise<void>;
  onUseCurrentChat: () => Promise<void>;
}

export interface AssistantRunSelectionComments {
  pendingCount: number;
  buildPayload: (hasTypedText: boolean) => { block: string; ids: string[]; count: number } | null;
  onMarkSent: (ids: string[]) => void;
  onRevert: (ids: string[]) => void;
}

interface UseAssistantRunOptions {
  activeFile: FileTreeNode | null;
  documentText: string;
  labels: AppStrings["assistant"];
  language: "en" | "es";
  workspace: WorkspaceInfo;
  selectionComments?: AssistantRunSelectionComments;
  onProposalsChanged: (proposals: AgentChangeProposal[]) => void;
  onReviewTargetChange: (target: ReviewTarget | null) => void | Promise<void>;
  onAutoReviewTargetChange?: (target: ReviewTarget | null) => void | Promise<void>;
  editorNavigationChangedDuringRun?: (runId: string) => boolean;
  onRunningRunChange?: (runId: string | null) => void;
  /** Executes a validated agent open_document command (UI navigation). */
  onOpenDocumentRequest?: (relativePath: string) => void;
  /** Debounced selection range driving the composer chip (ADR-0017). */
  editorSelection?: EditorSelectionRange | null;
  /** Live selection read at send time — never the debounced copy. */
  getEditorSelection?: () => EditorSelectionRange | null;
}

function runId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const telegramRemoteThreadIdPattern = /^[A-Za-z0-9._:-]{1,120}$/;

function runHasThinkingSummary(summaries: Map<string, string>, id: string) {
  for (const [key, value] of summaries) {
    if (key.startsWith(`${id}:`) && value.trim()) {
      return true;
    }
  }

  return false;
}

function codexUnavailableStatus(message = "Codex account connection is unavailable."): CodexAccountStatusResponse {
  return {
    available: false,
    connected: false,
    requiresOpenaiAuth: true,
    pendingLogin: false,
    error: { code: "app_server_unavailable", message }
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Codex account request failed.";
}

function remoteSettingsErrorMessage(error: unknown, labels?: AppStrings["assistant"]["remote"]) {
  const message = error instanceof Error ? error.message : "Telegram Remote Chat settings request failed.";

  if (message === "Set up a Telegram relay URL before pairing.") {
    return labels?.setupRequired ?? message;
  }

  if (message === "Set a secure Telegram relay URL before connecting.") {
    return labels?.secureUrlRequired ?? message;
  }

  return message;
}

async function hashText(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function modeOptions(labels: AppStrings["assistant"]) {
  return [
    { value: "fast", label: labels.modes.fast },
    { value: "balanced", label: labels.modes.balanced },
    { value: "deep", label: labels.modes.deep }
  ] as Array<{ value: AgentMode; label: string }>;
}

export function canSendChat(
  settings: Pick<AgentSettingsSnapshot, "hasOpenAiApiKey"> | null,
  codexStatus: CodexAccountStatusResponse | null
) {
  return Boolean(settings?.hasOpenAiApiKey || (codexStatus?.available && codexStatus.connected));
}

function selectedRemoteThreadId(settings: TelegramRemoteSettings | null, workspaceRoot: string) {
  if (
    settings?.activeThreadId &&
    telegramRemoteThreadIdPattern.test(settings.activeThreadId) &&
    settings.boundWorkspaceRoot === workspaceRoot &&
    settings.activeThreadWorkspaceRoot === workspaceRoot
  ) {
    return settings.activeThreadId;
  }

  return null;
}

type TranscriptScrollElement = Pick<HTMLDivElement, "scrollHeight" | "scrollTo">;
type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export function scheduleTranscriptScrollToBottom(
  transcript: TranscriptScrollElement | null | undefined,
  scheduleFrame: ScheduleFrame = window.requestAnimationFrame.bind(window),
  cancelFrame: CancelFrame = window.cancelAnimationFrame.bind(window)
) {
  if (!transcript) {
    return undefined;
  }

  const scrollToBottom = () => {
    transcript.scrollTo({ top: transcript.scrollHeight });
  };

  scrollToBottom();
  const frame = scheduleFrame(scrollToBottom);
  return () => cancelFrame(frame);
}

export function useAssistantRun({
  activeFile,
  documentText,
  labels,
  language,
  workspace,
  selectionComments,
  onProposalsChanged,
  onReviewTargetChange,
  onAutoReviewTargetChange,
  editorNavigationChangedDuringRun,
  onRunningRunChange,
  onOpenDocumentRequest,
  editorSelection = null,
  getEditorSelection
}: UseAssistantRunOptions) {
  const [settings, setSettings] = useState<AgentSettingsSnapshot | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [mode, setMode] = useState<AgentMode>("balanced");
  const [entries, setEntries] = useState<AssistantEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [contextAttachments, setContextAttachments] = useState<AssistantContextAttachmentChip[]>([]);
  const [highlightedContextAttachmentId, setHighlightedContextAttachmentId] = useState<string | null>(null);
  const [contextStatusText, setContextStatusText] = useState<string | null>(null);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [runActivities, setRunActivities] = useState<AgentActivityRunEvent[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThreadTitle, setActiveThreadTitle] = useState("");
  const [activeThreadTitleSource, setActiveThreadTitleSource] = useState<AgentChatThreadTitleSource>("fallback");
  const [chatThreads, setChatThreads] = useState<AgentChatThreadSummary[]>([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexAccountStatusResponse | null>(null);
  const [codexLogin, setCodexLogin] = useState<CodexDeviceLoginResponse["login"] | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [telegramRemoteSettings, setTelegramRemoteSettings] = useState<TelegramRemoteSettings | null>(null);
  const [telegramRemotePairing, setTelegramRemotePairing] = useState<TelegramRemotePairingStartResponse | null>(null);
  const [telegramRemoteBusy, setTelegramRemoteBusy] = useState(false);
  const [telegramRemoteError, setTelegramRemoteError] = useState<string | null>(null);
  const telegramRemoteRefreshSequence = useRef(0);
  const telegramRemoteUpdateSequence = useRef(0);
  const telegramRemotePendingUpdates = useRef(0);
  const latestRunId = useRef<string | null>(null);
  // Mirror of runActivities so ask() can snapshot the merged trail at run end
  // without racing the state reset; resetRunActivities keeps both in sync.
  const runActivitiesRef = useRef<AgentActivityRunEvent[]>([]);
  const [streamingText, setStreamingText] = useState("");
  // Consumed-on-send / dismissed selection (ADR-0017): a range matching this
  // is skipped; any range change re-arms; failed runs un-consume.
  const [skippedSelection, setSkippedSelection] = useState<EditorSelectionRange | null>(null);
  const skippedSelectionRef = useRef<EditorSelectionRange | null>(null);
  const streamingStateRef = useRef(emptyStreamingText);
  // Held in a ref so the run-event subscription never re-subscribes mid-stream
  // (a teardown gap would drop IPC events).
  const onOpenDocumentRequestRef = useRef(onOpenDocumentRequest);
  // Auto-scroll follows the stream only while the user is at the bottom.
  const transcriptPinnedRef = useRef(true);
  const activeThreadIdRef = useRef<string | null>(null);
  const activeThreadWorkspaceRoot = useRef<string | null>(null);
  const historyMutationGeneration = useRef(0);
  const generatedTitleThreadIds = useRef<Set<string>>(new Set());
  const suppressNextHistorySaveThreadId = useRef<string | null>(null);
  const thinkingSummaries = useRef<Map<string, string>>(new Map());
  const historyRefreshSequence = useRef(0);
  const workspacePathRef = useRef(workspace.path);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contextStatusTimer = useRef<number | null>(null);
  const workspaceApiSessionId = useMemo(
    () => workspaceContextApiSessionId(workspace),
    [workspace.path, workspace.sessionId]
  );
  const workspaceDragSessionId = useMemo(
    () => workspaceContextDragSessionId(workspace),
    [workspace.path, workspace.sessionId]
  );

  const resetRunActivities = useCallback(() => {
    runActivitiesRef.current = [];
    setRunActivities([]);
    streamingStateRef.current = emptyStreamingText;
    setStreamingText("");
  }, []);

  useEffect(() => {
    onOpenDocumentRequestRef.current = onOpenDocumentRequest;
  }, [onOpenDocumentRequest]);

  useEffect(() => {
    skippedSelectionRef.current = skippedSelection;
  }, [skippedSelection]);

  // A new selection re-arms the chip.
  useEffect(() => {
    if (editorSelection && skippedSelectionRef.current && !selectionRangesEqual(editorSelection, skippedSelectionRef.current)) {
      setSkippedSelection(null);
    }
  }, [editorSelection]);

  const dismissSelectionChip = useCallback(() => {
    setSkippedSelection(editorSelection);
  }, [editorSelection]);

  const selectionChip = useMemo(() => {
    if (!editorSelection || selectionRangesEqual(editorSelection, skippedSelection) || activeFile?.kind !== "markdown") {
      return null;
    }

    return lineRangeOf(documentText, editorSelection.from, editorSelection.to);
  }, [activeFile?.kind, documentText, editorSelection, skippedSelection]);

  const handleTranscriptScroll = useCallback(() => {
    const transcript = transcriptRef.current;

    if (transcript) {
      transcriptPinnedRef.current = isScrolledToBottom(transcript);
    }
  }, []);

  const updateRunStatus = useCallback((id: string, text: string) => {
    const compact = compactStatusText(text);

    if (!compact) {
      return;
    }

    setEntries((current) =>
      current.map((entry) =>
        entry.id === `${id}-status` && entry.kind === "status" ? { ...entry, text: compact } : entry
      )
    );
  }, []);

  const announceContextStatus = useCallback((text: string) => {
    setContextStatusText(text);

    if (contextStatusTimer.current !== null) {
      window.clearTimeout(contextStatusTimer.current);
    }

    contextStatusTimer.current = window.setTimeout(() => {
      setContextStatusText(null);
      contextStatusTimer.current = null;
    }, 3200);
  }, []);

  const emphasizeContextAttachment = useCallback((id: string) => {
    setHighlightedContextAttachmentId(id);
    window.setTimeout(() => {
      setHighlightedContextAttachmentId((current) => (current === id ? null : current));
    }, 900);
  }, []);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    workspacePathRef.current = workspace.path;
  }, [workspace.path]);

  useEffect(() => {
    return () => {
      if (contextStatusTimer.current !== null) {
        window.clearTimeout(contextStatusTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    setContextAttachments([]);
    setHighlightedContextAttachmentId(null);
    setContextStatusText(null);
  }, [workspace.path]);

  useEffect(() => {
    void window.iliad.agent.getSettings().then((snapshot) => {
      setSettings(snapshot);
      setModelDraft(snapshot.model);
      setMode(snapshot.mode);
      setSettingsOpen(!snapshot.hasOpenAiApiKey);
    });
  }, []);

  useEffect(() => {
    let canceled = false;
    historyMutationGeneration.current += 1;
    if (latestRunId.current) {
      void window.iliad.agent.cancelRun(latestRunId.current);
    }
    latestRunId.current = null;
    activeThreadWorkspaceRoot.current = null;
    generatedTitleThreadIds.current.clear();
    suppressNextHistorySaveThreadId.current = null;
    setRunningRunId(null);
    resetRunActivities();
    setActiveThreadId(null);
    setActiveThreadTitle("");
    setActiveThreadTitleSource("fallback");
    setEntries([]);
    setChatThreads([]);
    setChatHistoryLoading(true);
    const refreshSequence = ++historyRefreshSequence.current;
    const workspaceRoot = workspace.path;

    window.iliad.agent
      .listChatThreads(workspaceRoot)
      .then((threads) => {
        if (!canceled && refreshSequence === historyRefreshSequence.current && workspacePathRef.current === workspaceRoot) {
          setChatThreads(threads);
        }
      })
      .catch((error) => {
        console.warn("agent:list-chat-threads failed", error);
      })
      .finally(() => {
        if (!canceled && refreshSequence === historyRefreshSequence.current && workspacePathRef.current === workspaceRoot) {
          setChatHistoryLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [workspace.path]);

  const refreshChatThreads = useCallback(async () => {
    const workspaceRoot = workspace.path;
    const refreshSequence = ++historyRefreshSequence.current;
    setChatHistoryLoading(true);

    try {
      const threads = await window.iliad.agent.listChatThreads(workspaceRoot);

      if (refreshSequence === historyRefreshSequence.current && workspacePathRef.current === workspaceRoot) {
        setChatThreads(threads);
      }

      return threads;
    } catch (error) {
      console.warn("agent:list-chat-threads refresh failed", error);
      return null;
    } finally {
      if (refreshSequence === historyRefreshSequence.current && workspacePathRef.current === workspaceRoot) {
        setChatHistoryLoading(false);
      }
    }
  }, [workspace.path]);

  useLayoutEffect(() => {
    if (!transcriptPinnedRef.current) {
      return;
    }

    return scheduleTranscriptScrollToBottom(transcriptRef.current);
  }, [entries, runActivities, runningRunId, streamingText]);

  const applyCodexStatus = useCallback((status: CodexAccountStatusResponse) => {
    setCodexStatus(status);

    if (status.connected || (!status.pendingLogin && status.available)) {
      setCodexLogin(null);
    }
  }, []);

  const refreshCodexStatus = useCallback(
    async (options?: { quiet?: boolean }) => {
      const agent = window.iliad.agent as AgentApiWithCodexAccount;

      if (!agent.codexStatus) {
        const unavailable = codexUnavailableStatus();
        applyCodexStatus(unavailable);
        return unavailable;
      }

      if (!options?.quiet) {
        setCodexBusy(true);
      }

      try {
        setCodexError(null);
        const status = await agent.codexStatus();
        applyCodexStatus(status);
        return status;
      } catch (error) {
        const unavailable = codexUnavailableStatus(errorMessage(error));
        applyCodexStatus(unavailable);
        setCodexError(errorMessage(error));
        return unavailable;
      } finally {
        if (!options?.quiet) {
          setCodexBusy(false);
        }
      }
    },
    [applyCodexStatus]
  );

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    void refreshCodexStatus({ quiet: true });
  }, [refreshCodexStatus, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen || (!codexLogin && !codexStatus?.pendingLogin)) {
      return;
    }

    const pollId = window.setInterval(() => {
      void refreshCodexStatus({ quiet: true });
    }, 3000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [codexLogin, codexStatus?.pendingLogin, refreshCodexStatus, settingsOpen]);

  const refreshTelegramRemoteSettings = useCallback(
    async (options?: { quiet?: boolean }) => {
      const remote = (window.iliad as IliadApiWithRemoteSettings).remote;

      if (!remote?.getSettings) {
        setTelegramRemoteError("Telegram Remote Chat settings are unavailable in this build.");
        setTelegramRemoteSettings(null);
        return null;
      }

      const sequence = ++telegramRemoteRefreshSequence.current;
      const updateSequenceAtStart = telegramRemoteUpdateSequence.current;
      const hadPendingUpdateAtStart = telegramRemotePendingUpdates.current > 0;

      if (!options?.quiet) {
        setTelegramRemoteBusy(true);
      }

      try {
        setTelegramRemoteError(null);
        const snapshot = await remote.getSettings();
        if (
          sequence !== telegramRemoteRefreshSequence.current ||
          updateSequenceAtStart !== telegramRemoteUpdateSequence.current ||
          hadPendingUpdateAtStart ||
          telegramRemotePendingUpdates.current > 0 ||
          workspacePathRef.current !== workspace.path
        ) {
          return snapshot;
        }

        setTelegramRemoteSettings(snapshot);

        if (!snapshot.enabled || snapshot.pairedChat) {
          setTelegramRemotePairing(null);
        }

        return snapshot;
      } catch (error) {
        if (
          sequence === telegramRemoteRefreshSequence.current &&
          updateSequenceAtStart === telegramRemoteUpdateSequence.current &&
          !hadPendingUpdateAtStart &&
          telegramRemotePendingUpdates.current === 0 &&
          workspacePathRef.current === workspace.path
        ) {
          setTelegramRemoteError(remoteSettingsErrorMessage(error, labels.remote));
        }
        return null;
      } finally {
        if (
          !options?.quiet &&
          sequence === telegramRemoteRefreshSequence.current &&
          workspacePathRef.current === workspace.path
        ) {
          setTelegramRemoteBusy(false);
        }
      }
    },
    [labels.remote, workspace.path]
  );

  useEffect(() => {
    void refreshTelegramRemoteSettings({ quiet: true });
  }, [refreshTelegramRemoteSettings]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    void refreshTelegramRemoteSettings({ quiet: true });
  }, [refreshTelegramRemoteSettings, settingsOpen]);

  useEffect(() => {
    const unsubscribe = (window.iliad.agent as AgentApiWithRunEvents).onRunEvent?.((event) => {
      if (event.runId !== latestRunId.current) {
        return;
      }

      if (event.type === "status") {
        updateRunStatus(event.runId, localizedStatusMessage(event.message, labels));
        return;
      }

      if (event.type === "run_phase") {
        const status = localizedRunPhase(event.phase, labels);

        if (!status || (runHasThinkingSummary(thinkingSummaries.current, event.runId) && isGenericRunningStatus(status, labels))) {
          return;
        }

        updateRunStatus(event.runId, status);
        return;
      }

      if (event.type === "activity") {
        const next = mergeRunActivityEvent(runActivitiesRef.current, event);
        runActivitiesRef.current = next;
        setRunActivities(next);
        return;
      }

      if (event.type === "text_delta") {
        const next = applyTextDelta(streamingStateRef.current, event);
        streamingStateRef.current = next;
        setStreamingText(visibleStreamingText(next.text));
        return;
      }

      if (event.type === "open_document") {
        onOpenDocumentRequestRef.current?.(event.relativePath);
        return;
      }

      if (event.type !== "thinking_delta" && event.type !== "thinking_done") {
        return;
      }

      const summaryKey = `${event.runId}:${event.itemId}:${event.summaryIndex}`;

      if (event.type === "thinking_done") {
        thinkingSummaries.current.set(summaryKey, event.text);
        updateRunStatus(event.runId, thinkingStatusText(event.text, labels));
        return;
      }

      const summary = `${thinkingSummaries.current.get(summaryKey) ?? ""}${event.delta}`;
      thinkingSummaries.current.set(summaryKey, summary);
      updateRunStatus(event.runId, thinkingStatusText(summary, labels));
    });

    return () => {
      unsubscribe?.();
    };
  }, [labels, updateRunStatus]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [prompt]);

  const chatMessages = useMemo<AgentMessage[]>(
    () =>
      entries
        .filter((entry): entry is AssistantChatEntry => entry.kind === "user" || entry.kind === "assistant")
        .map((entry) => ({ role: entry.kind, content: entry.text })),
    [entries]
  );

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    if (activeThreadWorkspaceRoot.current !== workspace.path) {
      return;
    }

    if (suppressNextHistorySaveThreadId.current === activeThreadId) {
      suppressNextHistorySaveThreadId.current = null;
      return;
    }

    const historyEntries = visibleHistoryEntries(entries);

    if (historyEntries.length === 0) {
      return;
    }

    const firstUser = historyEntries.find((entry) => entry.kind === "user");
    const title = activeThreadTitle || fallbackChatThreadTitle(firstUser?.text ?? "");
    const generation = historyMutationGeneration.current;
    let canceled = false;

    window.iliad.agent
      .saveChatThread({
        workspaceRoot: workspace.path,
        thread: {
          id: activeThreadId,
          title,
          titleSource: activeThreadTitleSource,
          createdAt: historyEntries[0].createdAt,
          updatedAt: new Date().toISOString(),
          entries: historyEntries
        }
      })
      .then((thread) => {
        if (canceled || generation !== historyMutationGeneration.current) {
          return;
        }

        setChatThreads((current) => upsertChatThreadSummary(current, {
          id: thread.id,
          title: thread.title,
          titleSource: thread.titleSource,
          updatedAt: thread.updatedAt,
          messageCount: thread.entries.length
        }));

        if (activeThreadIdRef.current === thread.id) {
          setActiveThreadTitle(thread.title);
          setActiveThreadTitleSource(thread.titleSource);
        }

        if (
          thread.titleSource === "fallback" &&
          thread.entries.some((entry) => entry.kind === "assistant") &&
          !generatedTitleThreadIds.current.has(thread.id)
        ) {
          generatedTitleThreadIds.current.add(thread.id);
          void window.iliad.agent
            .generateChatThreadTitle({
              workspaceRoot: workspace.path,
              threadId: thread.id,
              language
            })
            .then((updatedThread) => {
              if (!updatedThread || generation !== historyMutationGeneration.current) {
                return;
              }

              setChatThreads((current) => upsertChatThreadSummary(current, {
                id: updatedThread.id,
                title: updatedThread.title,
                titleSource: updatedThread.titleSource,
                updatedAt: updatedThread.updatedAt,
                messageCount: updatedThread.entries.length
              }));

              if (activeThreadIdRef.current === updatedThread.id) {
                setActiveThreadTitle(updatedThread.title);
                setActiveThreadTitleSource(updatedThread.titleSource);
              }
            })
            .catch((error) => {
              console.warn("agent:generate-chat-thread-title failed", error);
            });
        }
      })
      .catch((error) => {
        console.warn("agent:save-chat-thread failed", error);
      });

    return () => {
      canceled = true;
    };
  }, [
    activeThreadId,
    activeThreadTitle,
    activeThreadTitleSource,
    entries,
    language,
    workspace.path
  ]);

  const showDictationMissingKey = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const dictation = useDictation({
    hasOpenAiApiKey: Boolean(settings?.hasOpenAiApiKey),
    labels,
    prompt,
    textareaRef: composerTextareaRef,
    onMissingApiKey: showDictationMissingKey,
    setPrompt
  });

  const saveSettings = useCallback(async () => {
    const snapshot = await window.iliad.agent.updateSettings({
      openAiApiKey: apiKeyDraft,
      model: modelDraft,
      mode
    });
    setSettings(snapshot);
    setModelDraft(snapshot.model);
    setApiKeyDraft("");
    setSettingsOpen(false);
  }, [apiKeyDraft, mode, modelDraft]);

  const connectCodex = useCallback(async () => {
    const agent = window.iliad.agent as AgentApiWithCodexAccount;

    if (!agent.startCodexDeviceLogin) {
      applyCodexStatus(codexUnavailableStatus());
      return;
    }

    setCodexBusy(true);
    setCodexError(null);

    try {
      const response = await agent.startCodexDeviceLogin();
      setCodexStatus(response);
      setCodexLogin(response.login ?? null);
    } catch (error) {
      setCodexError(errorMessage(error));
    } finally {
      setCodexBusy(false);
    }
  }, [applyCodexStatus]);

  const openCodexLogin = useCallback(async () => {
    const agent = window.iliad.agent as AgentApiWithCodexAccount;

    if (!agent.openCodexDeviceLogin) {
      setCodexError("Codex login URL opener is unavailable.");
      return;
    }

    try {
      setCodexError(null);
      const response = await agent.openCodexDeviceLogin();

      if (!response.ok) {
        setCodexError(response.error.message);
      }
    } catch (error) {
      setCodexError(errorMessage(error));
    }
  }, []);

  const cancelCodexLogin = useCallback(async () => {
    const agent = window.iliad.agent as AgentApiWithCodexAccount;

    if (!agent.cancelCodexLogin) {
      applyCodexStatus(codexUnavailableStatus());
      return;
    }

    setCodexBusy(true);
    setCodexError(null);

    try {
      const status = await agent.cancelCodexLogin();
      setCodexLogin(null);
      applyCodexStatus(status);
    } catch (error) {
      setCodexError(errorMessage(error));
    } finally {
      setCodexBusy(false);
    }
  }, [applyCodexStatus]);

  const disconnectCodex = useCallback(async () => {
    const agent = window.iliad.agent as AgentApiWithCodexAccount;

    if (!agent.logoutCodex) {
      applyCodexStatus(codexUnavailableStatus());
      return;
    }

    setCodexBusy(true);
    setCodexError(null);

    try {
      const status = await agent.logoutCodex();
      setCodexLogin(null);
      applyCodexStatus(status);
    } catch (error) {
      setCodexError(errorMessage(error));
    } finally {
      setCodexBusy(false);
    }
  }, [applyCodexStatus]);

  const enableTelegramRemote = useCallback(async () => {
    const remote = (window.iliad as IliadApiWithRemoteSettings).remote;

    if (!remote?.updateSettings) {
      setTelegramRemoteError("Telegram Remote Chat settings are unavailable in this build.");
      return;
    }

    const sequence = ++telegramRemoteUpdateSequence.current;
    telegramRemotePendingUpdates.current += 1;
    setTelegramRemoteBusy(true);
    setTelegramRemoteError(null);

    try {
      const snapshot = await remote.updateSettings({
        enabled: true,
        workspaceSessionId: workspaceApiSessionId
      });
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemotePairing(null);
        setTelegramRemoteSettings(snapshot);
      }
    } catch (error) {
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteError(remoteSettingsErrorMessage(error, labels.remote));
      }
    } finally {
      telegramRemotePendingUpdates.current = Math.max(0, telegramRemotePendingUpdates.current - 1);
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteBusy(false);
      }
    }
  }, [labels.remote, workspace.path, workspaceApiSessionId]);

  const disableTelegramRemote = useCallback(async () => {
    const remote = (window.iliad as IliadApiWithRemoteSettings).remote;

    if (!remote?.updateSettings) {
      setTelegramRemoteError("Telegram Remote Chat settings are unavailable in this build.");
      return;
    }

    const sequence = ++telegramRemoteUpdateSequence.current;
    telegramRemotePendingUpdates.current += 1;
    setTelegramRemoteBusy(true);
    setTelegramRemoteError(null);
    setTelegramRemotePairing(null);

    try {
      const snapshot = await remote.updateSettings({ enabled: false });
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteSettings(snapshot);
      }
    } catch (error) {
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteError(remoteSettingsErrorMessage(error, labels.remote));
      }
    } finally {
      telegramRemotePendingUpdates.current = Math.max(0, telegramRemotePendingUpdates.current - 1);
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteBusy(false);
      }
    }
  }, [labels.remote, workspace.path]);

  const startTelegramRemotePairing = useCallback(async () => {
    const remote = (window.iliad as IliadApiWithRemoteSettings).remote;

    if (!remote?.startPairing) {
      setTelegramRemoteError(labels.remote.pairingUnavailable);
      return;
    }

    const sequence = ++telegramRemoteUpdateSequence.current;
    telegramRemotePendingUpdates.current += 1;
    setTelegramRemoteBusy(true);
    setTelegramRemoteError(null);

    try {
      const pairing = await remote.startPairing();
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemotePairing(pairing);
      }
    } catch (error) {
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemotePairing(null);
        setTelegramRemoteError(remoteSettingsErrorMessage(error, labels.remote));
      }
    } finally {
      telegramRemotePendingUpdates.current = Math.max(0, telegramRemotePendingUpdates.current - 1);
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteBusy(false);
      }
    }
  }, [labels.remote, workspace.path]);

  const revokeTelegramRemote = useCallback(async () => {
    const remote = (window.iliad as IliadApiWithRemoteSettings).remote;

    if (!remote?.revokeSettings) {
      setTelegramRemoteError("Telegram Remote Chat settings are unavailable in this build.");
      return;
    }

    const sequence = ++telegramRemoteUpdateSequence.current;
    telegramRemotePendingUpdates.current += 1;
    setTelegramRemoteBusy(true);
    setTelegramRemoteError(null);
    setTelegramRemotePairing(null);

    try {
      const snapshot = await remote.revokeSettings();
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteSettings(snapshot);
      }
    } catch (error) {
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteError(remoteSettingsErrorMessage(error, labels.remote));
      }
    } finally {
      telegramRemotePendingUpdates.current = Math.max(0, telegramRemotePendingUpdates.current - 1);
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteBusy(false);
      }
    }
  }, [labels.remote, workspace.path]);

  const selectedTelegramRemoteThreadId = useMemo(
    () => selectedRemoteThreadId(telegramRemoteSettings, workspace.path),
    [telegramRemoteSettings, workspace.path]
  );
  const telegramRemoteActiveChatLabel = useMemo(() => {
    if (!selectedTelegramRemoteThreadId) {
      return labels.remote.defaultRemoteChat;
    }

    if (selectedTelegramRemoteThreadId === activeThreadId) {
      return activeThreadTitle.trim() || labels.remote.thisChat;
    }

    return chatThreads.find((thread) => thread.id === selectedTelegramRemoteThreadId)?.title || labels.remote.selectedChat;
  }, [
    activeThreadId,
    activeThreadTitle,
    chatThreads,
    labels.remote.defaultRemoteChat,
    labels.remote.selectedChat,
    labels.remote.thisChat,
    selectedTelegramRemoteThreadId
  ]);
  const canUseCurrentTelegramChat = Boolean(
    telegramRemoteSettings?.enabled &&
      activeThreadId &&
      telegramRemoteThreadIdPattern.test(activeThreadId) &&
      selectedTelegramRemoteThreadId !== activeThreadId
  );

  const useCurrentChatForTelegramRemote = useCallback(async () => {
    const remote = (window.iliad as IliadApiWithRemoteSettings).remote;
    const threadId = activeThreadId;

    if (!remote?.updateSettings || !threadId || !telegramRemoteThreadIdPattern.test(threadId)) {
      return;
    }

    const sequence = ++telegramRemoteUpdateSequence.current;
    telegramRemotePendingUpdates.current += 1;
    setTelegramRemoteBusy(true);
    setTelegramRemoteError(null);

    try {
      const snapshot = await remote.updateSettings({
        activeThreadId: threadId,
        workspaceSessionId: workspaceApiSessionId
      });

      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteSettings(snapshot);
      }
    } catch (error) {
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteError(remoteSettingsErrorMessage(error, labels.remote));
      }
    } finally {
      telegramRemotePendingUpdates.current = Math.max(0, telegramRemotePendingUpdates.current - 1);
      if (sequence === telegramRemoteUpdateSequence.current && workspacePathRef.current === workspace.path) {
        setTelegramRemoteBusy(false);
      }
    }
  }, [activeThreadId, labels.remote, workspace.path, workspaceApiSessionId]);

  useEffect(() => {
    if (!settingsOpen || !telegramRemotePairing) {
      return;
    }

    const pollId = window.setInterval(() => {
      void refreshTelegramRemoteSettings({ quiet: true });
    }, 3000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [refreshTelegramRemoteSettings, settingsOpen, telegramRemotePairing]);

  const addContextAttachment = useCallback(
    (relativePath: string, source: AssistantContextAttachmentSource) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      const normalizedKey = normalizedPath.toLowerCase();

      if (!isVisibleMarkdownContextPath(normalizedPath)) {
        announceContextStatus(labels.context.dropRejected);
        return false;
      }

      const automaticPath =
        activeFile?.kind === "markdown" ? normalizeRelativePath(activeFile.relativePath).toLowerCase() : null;

      if (automaticPath === normalizedKey) {
        announceContextStatus(labels.context.alreadyAttached(normalizedPath));
        return false;
      }

      const duplicate = contextAttachments.find(
        (attachment) => normalizeRelativePath(attachment.relativePath).toLowerCase() === normalizedKey
      );

      if (duplicate) {
        emphasizeContextAttachment(duplicate.id);
        announceContextStatus(labels.context.alreadyAttached(normalizedPath));
        return false;
      }

      if (contextAttachments.length >= manualContextAttachmentLimit) {
        announceContextStatus(labels.context.maxManualAttachments(manualContextAttachmentLimit));
        return false;
      }

      const attachment: AssistantContextAttachmentChip = {
        id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        relativePath: normalizedPath,
        label: contextFileBasename(normalizedPath),
        source
      };

      setContextAttachments((current) => [...current, attachment]);
      announceContextStatus(labels.context.attached(normalizedPath));
      return true;
    },
    [
      activeFile,
      announceContextStatus,
      contextAttachments,
      emphasizeContextAttachment,
      labels.context
    ]
  );

  const removeContextAttachment = useCallback(
    (attachmentId: string) => {
      const attachment = contextAttachments.find((candidate) => candidate.id === attachmentId);

      if (!attachment) {
        return;
      }

      setContextAttachments((current) => current.filter((candidate) => candidate.id !== attachmentId));
      announceContextStatus(labels.context.removed(attachment.relativePath));
    },
    [announceContextStatus, contextAttachments, labels.context]
  );

  const removeLastContextAttachment = useCallback(() => {
    const attachment = contextAttachments[contextAttachments.length - 1];

    if (!attachment) {
      return false;
    }

    setContextAttachments((current) => current.slice(0, -1));
    announceContextStatus(labels.context.removed(attachment.relativePath));
    return true;
  }, [announceContextStatus, contextAttachments, labels.context]);

  const rejectContextDrop = useCallback(() => {
    announceContextStatus(labels.context.dropRejected);
    return false;
  }, [announceContextStatus, labels.context]);

  const addContextAttachmentFromDrop = useCallback(
    async (dataTransfer: DataTransfer) => {
      const internalPayload = dataTransfer.getData(contextFileDragMimeType);

      if (internalPayload) {
        const payload = readContextFileDragPayload(internalPayload, workspaceDragSessionId);

        if (!payload) {
          return rejectContextDrop();
        }

        return addContextAttachment(payload.relativePath, "file_tree_drop");
      }

      const file = dataTransfer.files?.[0];

      if (!file) {
        return false;
      }

      const absolutePath = (file as File & { path?: string }).path;
      const api = window.iliad as IliadApiWithContextDrop;

      if (!absolutePath || !api.normalizeContextDrop) {
        return rejectContextDrop();
      }

      try {
        const normalized = await api.normalizeContextDrop(workspaceApiSessionId, absolutePath);

        if (!normalized.ok) {
          return rejectContextDrop();
        }

        return addContextAttachment(normalized.relativePath, "finder_drop");
      } catch (error) {
        console.warn("context:normalize-drop failed", error);
        return rejectContextDrop();
      }
    },
    [addContextAttachment, rejectContextDrop, workspaceApiSessionId, workspaceDragSessionId]
  );

  const ask = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    const pendingCommentCount = selectionComments?.pendingCount ?? 0;

    // Empty-prompt sends are allowed only when selection comments are pending.
    // latestRunId is the ref-based double-submit guard: two ask() calls in the
    // same tick both see stale runningRunId state, but not a stale ref.
    if ((!trimmedPrompt && pendingCommentCount === 0) || runningRunId || latestRunId.current) {
      return;
    }

    if (!canSendChat(settings, codexStatus)) {
      setSettingsOpen(true);
      setEntries((current) => [
        ...current.filter((entry) => entry.id !== "missing-key"),
        { id: "missing-key", kind: "error", text: labels.missingKey }
      ]);
      return;
    }

    const commentsPayload =
      pendingCommentCount > 0 ? selectionComments?.buildPayload(Boolean(trimmedPrompt)) ?? null : null;
    // The user entry text is ALWAYS the full composed message: stored history
    // and follow-up chatMessages are rebuilt from entries[].text.
    const composedPrompt = commentsPayload
      ? trimmedPrompt
        ? `${trimmedPrompt}\n\n${commentsPayload.block}`
        : commentsPayload.block
      : trimmedPrompt;

    const id = runId();
    const now = new Date().toISOString();
    const threadId = activeThreadId ?? `thread-${id}`;
    const fallbackTitle = fallbackChatThreadTitle(trimmedPrompt || composedPrompt);
    const contextAttachmentsSnapshot = contextAttachments;
    const runActiveRelativePath =
      activeFile?.kind === "markdown" ? normalizeRelativePath(activeFile.relativePath) : null;
    // Identifier-only index of documents this conversation already referenced
    // (ADR-0014); the main process re-sanitizes and re-filters after @-mention
    // resolution, so this exclusion list is a best-effort de-noiser.
    const liveSelection = getEditorSelection?.() ?? null;
    const sendSelection =
      liveSelection &&
      !selectionRangesEqual(liveSelection, skippedSelectionRef.current) &&
      activeFile?.kind === "markdown"
        ? liveSelection
        : null;
    const previouslyReferencedDocuments = previouslyReferencedDocumentPaths(entries, [
      ...(runActiveRelativePath ? [runActiveRelativePath] : []),
      ...contextAttachmentsSnapshot.map((attachment) => attachment.relativePath)
    ]);
    if (!activeThreadId) {
      activeThreadWorkspaceRoot.current = workspace.path;
      setActiveThreadId(threadId);
      setActiveThreadTitle(fallbackTitle);
      setActiveThreadTitleSource("fallback");
    }

    latestRunId.current = id;
    thinkingSummaries.current.clear();
    setRunningRunId(id);
    onRunningRunChange?.(id);
    resetRunActivities();
    setPrompt("");
    setContextAttachments([]);
    setHighlightedContextAttachmentId(null);

    if (sendSelection) {
      // Consumed on send: the editor selection itself persists, so the chip
      // disappears via the skip flag; failed runs un-consume below.
      setSkippedSelection(sendSelection);
    }

    if (commentsPayload) {
      // Optimistic pending → sent; reverted below if the run fails.
      selectionComments?.onMarkSent(commentsPayload.ids);
    }

    setEntries((current) => [
      ...current,
      {
        id: `${id}-user`,
        kind: "user",
        text: composedPrompt,
        createdAt: now,
        ...(contextAttachmentsSnapshot.length > 0
          ? {
              attachments: contextAttachmentsSnapshot.map((attachment) => ({
                relativePath: attachment.relativePath,
                label: attachment.label
              }))
            }
          : {}),
        ...(commentsPayload
          ? {
              selectionComments: {
                count: commentsPayload.count,
                block: commentsPayload.block,
                typedText: trimmedPrompt
              }
            }
          : {})
      },
      { id: `${id}-status`, kind: "status", text: labels.status.reading, createdAt: now }
    ]);

    let thinkingFallbackTimeout: number | null = null;

    try {
      const baseHash = await hashText(documentText);

      if (latestRunId.current !== id) {
        return;
      }

      thinkingFallbackTimeout = window.setTimeout(() => {
        if (latestRunId.current !== id) {
          return;
        }

        setEntries((current) =>
          current.map((entry) =>
            entry.id === `${id}-status` && entry.kind === "status" && entry.text === labels.status.asking
              ? { ...entry, text: labels.status.thinking }
              : entry
          )
        );
      }, 1600);

      const result = await window.iliad.agent.startRun({
        runId: id,
        workspaceRoot: workspace.path,
        activeFile:
          activeFile?.kind === "markdown"
            ? {
                path: activeFile.path,
                relativePath: activeFile.relativePath,
                content: documentText,
                baseHash
              }
            : null,
        messages: chatMessages,
        prompt: composedPrompt,
        mode,
        language,
        contextAttachments:
          contextAttachmentsSnapshot.length > 0
            ? contextAttachmentsSnapshot.map((attachment) => ({
                relativePath: attachment.relativePath,
                source: "manual_attachment" as const
              }))
            : undefined,
        previouslyReferencedDocuments:
          previouslyReferencedDocuments.length > 0 ? previouslyReferencedDocuments : undefined,
        editorSelection: sendSelection ?? undefined
      });

      if (latestRunId.current !== id) {
        return;
      }

      const runError = result.error;

      if (runError) {
        setContextAttachments((current) => (current.length > 0 ? current : contextAttachmentsSnapshot));

        if (sendSelection) {
          setSkippedSelection(null);
        }

        if (commentsPayload) {
          // Mirror the contextAttachments snapshot/restore: comments revert to
          // pending and their washes return.
          selectionComments?.onRevert(commentsPayload.ids);
        }

        setEntries((current) => [
          ...current.filter((entry) => entry.id !== `${id}-status`),
          buildRunOutcomeEntry({
            runId: id,
            kind: "error",
            text: agentErrorMessage(labels, runError),
            createdAt: new Date().toISOString(),
            contextManifest: result.contextManifest,
            activities: runActivitiesRef.current
          })
        ]);
        return;
      }

      setEntries((current) => [
        ...current.filter((entry) => entry.id !== `${id}-status`),
        buildRunOutcomeEntry({
          runId: id,
          kind: "assistant",
          text: result.text || labels.noTextResponse,
          createdAt: new Date().toISOString(),
          contextManifest: result.contextManifest,
          activities: runActivitiesRef.current
        })
      ]);

      onProposalsChanged(result.proposals);
      const reviewTarget = chooseInitialReviewTarget({
        proposals: result.proposals,
        runId: id,
        runActiveRelativePath,
        currentActiveRelativePath:
          activeFile?.kind === "markdown" ? normalizeRelativePath(activeFile.relativePath) : null,
        editorNavigationChangedDuringRun: editorNavigationChangedDuringRun?.(id) ?? false
      });

      if (reviewTarget) {
        void (onAutoReviewTargetChange ?? onReviewTargetChange)(reviewTarget);
      }
    } catch (error) {
      if (latestRunId.current !== id) {
        return;
      }

      setContextAttachments((current) => (current.length > 0 ? current : contextAttachmentsSnapshot));

      if (sendSelection) {
        setSkippedSelection(null);
      }

      if (commentsPayload) {
        selectionComments?.onRevert(commentsPayload.ids);
      }

      setEntries((current) => [
        ...current.filter((entry) => entry.id !== `${id}-status`),
        buildRunOutcomeEntry({
          runId: id,
          kind: "error",
          text: error instanceof Error ? error.message : labels.errorFallback,
          createdAt: new Date().toISOString(),
          activities: runActivitiesRef.current
        })
      ]);
    } finally {
      if (thinkingFallbackTimeout !== null) {
        window.clearTimeout(thinkingFallbackTimeout);
      }

      if (latestRunId.current === id) {
        latestRunId.current = null;
        setRunningRunId(null);
        onRunningRunChange?.(null);
        resetRunActivities();
      }
    }
  }, [
    activeFile,
    chatMessages,
    contextAttachments,
    documentText,
    entries,
    labels,
    language,
    mode,
    onProposalsChanged,
    onReviewTargetChange,
    onAutoReviewTargetChange,
    editorNavigationChangedDuringRun,
    onRunningRunChange,
    getEditorSelection,
    prompt,
    resetRunActivities,
    runningRunId,
    selectionComments,
    settings,
    codexStatus,
    updateRunStatus,
    activeThreadId,
    workspace.path
  ]);

  const cancel = useCallback(async () => {
    const id = runningRunId;

    if (!id) {
      return;
    }

    latestRunId.current = null;
    setRunningRunId(null);
    onRunningRunChange?.(null);
    resetRunActivities();
    await window.iliad.agent.cancelRun(id);
    setEntries((current) => [
      ...current.filter((entry) => entry.id !== `${id}-status`),
      { id: `${id}-canceled`, kind: "status", text: labels.status.canceled, createdAt: new Date().toISOString() }
    ]);
  }, [labels.status.canceled, onRunningRunChange, runningRunId]);

  const newChat = useCallback(() => {
    latestRunId.current = null;
    if (runningRunId) {
      void window.iliad.agent.cancelRun(runningRunId);
    }
    historyMutationGeneration.current += 1;
    setRunningRunId(null);
    onRunningRunChange?.(null);
    resetRunActivities();
    void onReviewTargetChange(null);
    activeThreadWorkspaceRoot.current = null;
    setActiveThreadId(null);
    setActiveThreadTitle("");
    setActiveThreadTitleSource("fallback");
    setContextAttachments([]);
    setHighlightedContextAttachmentId(null);
    setContextStatusText(null);
    setEntries([]);
  }, [onReviewTargetChange, onRunningRunChange, runningRunId]);

  const loadChatThread = useCallback(
    async (threadId: string) => {
      if (runningRunId) {
        return;
      }

      historyMutationGeneration.current += 1;
      const thread = await window.iliad.agent.getChatThread({
        workspaceRoot: workspace.path,
        threadId
      });

      if (!thread) {
        setChatThreads((current) => current.filter((candidate) => candidate.id !== threadId));
        return;
      }

      latestRunId.current = null;
      resetRunActivities();
      void onReviewTargetChange(null);
      activeThreadWorkspaceRoot.current = workspace.path;
      setActiveThreadId(thread.id);
      setActiveThreadTitle(thread.title);
      setActiveThreadTitleSource(thread.titleSource);
      suppressNextHistorySaveThreadId.current = thread.id;
      setContextAttachments([]);
      setHighlightedContextAttachmentId(null);
      setContextStatusText(null);
      setEntries(thread.entries);
    },
    [onReviewTargetChange, runningRunId, workspace.path]
  );

  const clearChatHistory = useCallback(async () => {
    if (runningRunId) {
      return;
    }

    const activeSaved = Boolean(activeThreadId && chatThreads.some((thread) => thread.id === activeThreadId));
    historyMutationGeneration.current += 1;
    await window.iliad.agent.clearChatHistory(workspace.path);
    generatedTitleThreadIds.current.clear();
    setChatThreads([]);

    if (activeSaved) {
      latestRunId.current = null;
      resetRunActivities();
      void onReviewTargetChange(null);
      activeThreadWorkspaceRoot.current = null;
      setActiveThreadId(null);
      setActiveThreadTitle("");
      setActiveThreadTitleSource("fallback");
      setEntries([]);
    }
  }, [activeThreadId, chatThreads, onReviewTargetChange, runningRunId, workspace.path]);

  return {
    activeThreadId,
    activeThreadTitle,
    apiKeyDraft,
    ask,
    cancel,
    chatHistoryLoading,
    chatThreads,
    clearChatHistory,
    codex: {
      busy: codexBusy,
      error: codexError,
      login: codexLogin,
      status: codexStatus,
      onCancelLogin: cancelCodexLogin,
      onConnect: connectCodex,
      onDisconnect: disconnectCodex,
      onOpenLogin: openCodexLogin,
      onRefresh: () => refreshCodexStatus().then(() => undefined)
    },
    remote: {
      activeChatLabel: telegramRemoteActiveChatLabel,
      busy: telegramRemoteBusy,
      canUseCurrentChat: canUseCurrentTelegramChat,
      error: telegramRemoteError,
      pairing: telegramRemotePairing,
      settings: telegramRemoteSettings,
      onDisable: disableTelegramRemote,
      onEnable: enableTelegramRemote,
      onPair: startTelegramRemotePairing,
      onRevoke: revokeTelegramRemote,
      onUseCurrentChat: useCurrentChatForTelegramRemote
    },
    composerTextareaRef,
    contextAttachments,
    contextStatusText,
    entries,
    runActivities,
    streamingText,
    handleTranscriptScroll,
    selectionChip,
    dismissSelectionChip,
    addContextAttachment,
    addContextAttachmentFromDrop,
    highlightedContextAttachmentId,
    mode,
    modelDraft,
    newChat,
    loadChatThread,
    prompt,
    refreshChatThreads,
    dictation,
    runningRunId,
    saveSettings,
    removeContextAttachment,
    removeLastContextAttachment,
    setApiKeyDraft,
    setMode,
    setModelDraft,
    setPrompt,
    setSettingsOpen,
    settings,
    settingsOpen,
    transcriptRef
  };
}
