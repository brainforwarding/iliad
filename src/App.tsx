import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Focus,
  FolderOpen,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X
} from "lucide-react";
import { useDocumentHistory, type DocumentHistoryDirection } from "./app/useDocumentHistory";
import {
  documentCloseRequiresChoice,
  useDocumentPersistence,
  type SaveStatus
} from "./app/useDocumentPersistence";
import { useAgentProposals } from "./app/useAgentProposals";
import { useSelectionComments } from "./app/useSelectionComments";
import { useWorkspace } from "./app/useWorkspace";
import { EditorErrorBoundary } from "./components/EditorErrorBoundary";
import {
  EditorPane,
  type EditorSelectionCommentsProps,
  type EditorTightenProps,
  type EditorWritingAssistsProps
} from "./components/EditorPane";
import { ClipMark } from "./components/ClipMark";
import { AssistantPanel, type AssistantPanelSelectionComments } from "./components/AssistantPanel";
import { FileTree } from "./components/FileTree";
import { LanguageMenu } from "./components/LanguageMenu";
import { TreeContextMenu, type TreeContextMenuState } from "./components/TreeContextMenu";
import { TypographyMenu } from "./components/TypographyMenu";
import { WritingAssistsMenu } from "./components/WritingAssistsMenu";
import { scrollEditorToPosition } from "./editor/selectionComments/scroll";
import {
  markLatestContentSearchRequestId,
  type FileTreeContentSearchProvider
} from "./assistant/fileTreeContentSearch";
import { fileHasMutableReview } from "./assistant/assistantUtils";
import { sameRelativePath } from "./assistant/pendingFileTree";
import {
  firstMutableReviewTarget,
  mutableReviewFileCount,
  mutableReviewProposalIds,
  mutableReviewProposals
} from "./assistant/pendingReviewState";
import type { ContextAttachmentMoveHandler } from "./assistant/useAssistantRun";
import type { ContentSearchRevealTarget } from "./editor/contentSearchReveal";
import { useFileActions } from "./files/fileActions";
import { findNode, findNodeByRelativePath } from "./files/fileTree";
import { useAppLanguage } from "./i18n/appLanguage";
import { useEditorPreferences } from "./preferences/editorPreferences";
import {
  clampSidebarWidth,
  minimumSidebarWidth,
  maximumPreferredSidebarWidth,
  useSidebarWidth
} from "./preferences/sidebarPreferences";
import { useWritingAssistPreferences } from "./preferences/writingAssistPreferences";
import type { EditorView } from "@codemirror/view";
import type {
  AgentChangeProposal,
  ExternalAgentCaptureStartResponse,
  FileTreeNode,
  MarkdownContentSearchResponse,
  UpdateCheckResult,
  WorkspaceInfo,
  WritingAssistStatus
} from "./types/iliad";

function statusText(
  saveStatus: SaveStatus,
  lastSavedAt: string | null,
  labels: {
    saved: (time: string) => string;
    saving: string;
    unsaved: string;
    error: string;
  }
): string {
  if (saveStatus === "saved") {
    return lastSavedAt ? labels.saved(lastSavedAt) : "";
  }

  return labels[saveStatus];
}

function markdownDisplayName(file: FileTreeNode | null, fallbackName: string) {
  return file?.name.replace(/\.(md|markdown|mdown|mkd)$/i, "") ?? fallbackName;
}

function assistantColumnWidth(viewportWidth: number) {
  return Math.min(320, Math.max(280, viewportWidth * 0.24));
}

function effectiveSidebarMaximum(viewportWidth: number, assistantOpen: boolean) {
  const editorFloor = 320;
  const assistantWidth = assistantOpen ? assistantColumnWidth(viewportWidth) : 0;
  const availableWidth = viewportWidth - assistantWidth - editorFloor;

  return Math.round(
    Math.max(minimumSidebarWidth, Math.min(maximumPreferredSidebarWidth, viewportWidth * 0.45, availableWidth))
  );
}

function emptyContentSearchResponse(query: string): MarkdownContentSearchResponse {
  return {
    status: "ok",
    query,
    files: [],
    returnedFiles: 0,
    returnedMatches: 0,
    scannedMarkdownFiles: 0,
    visitedEntries: 0,
    skippedOversizedFiles: 0,
    skippedUnreadableFiles: 0,
    truncated: false,
    truncatedReasons: []
  };
}

const externalCaptureAutoFinishDelayMs = 1200;
const externalCaptureAutoRetryDelayMs = 500;

function debugExternalCapture(event: string, details: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug(`[external-capture] ${event} ${JSON.stringify(details)}`);
}

export default function App() {
  const { language, setLanguage, t: strings } = useAppLanguage();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    isInitializing,
    workspace,
    setWorkspace,
    tree,
    setTree,
    lastWorkspaceChange,
    refreshTree,
    recentWorkspaces,
    pruneRecentWorkspace
  } =
    useWorkspace({
      messages: strings.workspaceMessages,
      onError: setError
    });
  const switchInFlightRef = useRef(false);
  const [activeFile, setActiveFile] = useState<FileTreeNode | null>(null);
  const {
    documentText,
    saveStatus,
    lastSavedAt,
    stateRef,
    clearDocument,
    flushSave,
    handleEditorChange,
    loadDocument
  } = useDocumentPersistence({ activeFile, messages: strings.documentMessages, onError: setError, workspace });
  const {
    editorFontPreset,
    editorFontSize,
    resetEditorPreferences,
    setEditorFontPreset,
    setEditorFontSize
  } = useEditorPreferences();
  const { resetSidebarWidth, setSidebarWidth, sidebarWidth } = useSidebarWidth();
  const {
    correctorEnabled,
    autocompleteEnabled,
    autocompleteApiFallbackEnabled,
    setCorrectorEnabled,
    setAutocompleteEnabled,
    setAutocompleteApiFallbackEnabled
  } = useWritingAssistPreferences();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [externalCapture, setExternalCapture] = useState<ExternalAgentCaptureStartResponse | null>(null);
  const [externalCaptureBusy, setExternalCaptureBusy] = useState(false);
  const [runningAssistantRunId, setRunningAssistantRunId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth
  );
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [writingAssistsOpen, setWritingAssistsOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [revealFolderPath, setRevealFolderPath] = useState<string | null>(null);
  const [reviewRevealPath, setReviewRevealPath] = useState<string | null>(null);
  const [contentSearchRevealTarget, setContentSearchRevealTarget] = useState<ContentSearchRevealTarget | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const typographyMenuRef = useRef<HTMLDivElement | null>(null);
  const writingAssistsMenuRef = useRef<HTMLDivElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeHandleRef = useRef<HTMLDivElement | null>(null);
  const closeDocumentInFlightRef = useRef(false);
  const latestContentSearchRequestIdRef = useRef(0);
  const contentSearchRevealRequestIdRef = useRef(0);
  const runningAssistantRunIdRef = useRef<string | null>(null);
  const contextAttachmentMoveHandlerRef = useRef<ContextAttachmentMoveHandler | null>(null);
  const externalCaptureAutoFinishTimerRef = useRef<number | null>(null);
  const finishExternalCaptureRef = useRef<((options?: { automatic?: boolean }) => Promise<void>) | null>(null);
  const editorNavigationDuringRunRef = useRef<{ runId: string | null; changed: boolean }>({
    runId: null,
    changed: false
  });
  const closeTreeContextMenu = useCallback(() => setTreeContextMenu(null), []);
  const markEditorNavigationDuringRun = useCallback(() => {
    const runId = runningAssistantRunIdRef.current;

    if (!runId) {
      return;
    }

    editorNavigationDuringRunRef.current = { runId, changed: true };
  }, []);
  const handleRunningAssistantRunChange = useCallback((runId: string | null) => {
    runningAssistantRunIdRef.current = runId;
    setRunningAssistantRunId(runId);
    editorNavigationDuringRunRef.current = { runId, changed: false };
  }, []);
  const editorNavigationChangedDuringRun = useCallback((runId: string) => {
    const state = editorNavigationDuringRunRef.current;
    return state.runId === runId && state.changed;
  }, []);
  const {
    backTarget,
    canGoBack,
    canGoForward,
    clearHistory,
    completeHistoryNavigation,
    forwardTarget,
    getNavigationTarget,
    relocateHistoryPaths,
    recordNormalNavigation
  } = useDocumentHistory(tree);
  const {
    copyNodePath,
    createFolder,
    createMarkdownFile,
    creatingFile,
    creatingFolder,
    duplicateNode,
    insertImage,
    insertImageReference,
    moveNode,
    moveNodeToTrash,
    openDocumentLink,
    openNode,
    renameNode,
    revealNodeInFinder,
    startRenameFromContextMenu
  } = useFileActions({
    activeFile,
    clearDocument,
    closeTreeContextMenu,
    flushSave,
    loadDocument,
    onMarkdownNavigation: recordNormalNavigation,
    onTreeNodeMoved: ({ oldNode, newNode, nextTree, activeFileAfterMove }) => {
      relocateHistoryPaths(oldNode.path, newNode.path);
      contextAttachmentMoveHandlerRef.current?.({
        oldRelativeRoot: oldNode.relativePath,
        newRelativeRoot: newNode.relativePath,
        nextTree,
        activeRelativePath: activeFileAfterMove?.relativePath ?? null
      });
    },
    refreshTree,
    renamingPath,
    selectedTreePath,
    setActiveFile,
    setError,
    messages: strings.fileMessages,
    setNotice,
    setRenamingPath,
    setRevealFolderPath,
    setSelectedTreePath,
    stateRef,
    tree,
    workspace
  });

  const {
    activeReview,
    agentProposals,
    clearReviewForNormalNavigation,
    editorReview,
    mergeAgentProposals,
    pendingTreeChanges,
    proposalLoadState,
    rejectAgentProposal,
    rejectAgentProposalStateOnly,
    selectAgentReviewTarget,
    setAgentProposals,
    setAgentReviewTarget,
    virtualReviewFile
  } = useAgentProposals({
    activeFile,
    documentText,
    flushSave,
    loadDocument,
    openNode,
    recordNormalNavigation,
    refreshTree,
    setActiveFile,
    setError,
    setNotice,
    setSelectedTreePath,
    requestReviewReveal: setReviewRevealPath,
    onReviewNavigation: markEditorNavigationDuringRun,
    strings,
    tree,
    workspace
  });
  const pendingReviewProposals = useMemo(() => mutableReviewProposals(agentProposals), [agentProposals]);
  const pendingReviewFileCount = useMemo(() => mutableReviewFileCount(pendingReviewProposals), [pendingReviewProposals]);
  const firstPendingReviewTarget = useMemo(() => firstMutableReviewTarget(pendingReviewProposals), [pendingReviewProposals]);
  const pendingReviewActive = Boolean(activeReview && fileHasMutableReview(activeReview.file));
  const hasPendingExternalFilesystemReview = useMemo(
    () =>
      agentProposals.some(
        (proposal) =>
          proposal.metadata?.kind === "external_filesystem" && proposal.files.some((file) => fileHasMutableReview(file))
      ),
    [agentProposals]
  );
  const [pendingReviewDiscarding, setPendingReviewDiscarding] = useState(false);

  // One transient signal bridges the panel-closed gap: the first comment saved
  // while the agent panel is closed pulses the toggle once. No persistent badge.
  const [assistantTogglePulse, setAssistantTogglePulse] = useState(false);
  const assistantPulsedWhileClosedRef = useRef(false);
  const assistantOpenRef = useRef(assistantOpen);
  const focusModeRef = useRef(focusMode);

  useEffect(() => {
    assistantOpenRef.current = assistantOpen;

    if (assistantOpen) {
      assistantPulsedWhileClosedRef.current = false;
    }
  }, [assistantOpen]);

  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSelectionCommentSaved = useCallback(() => {
    if (assistantOpenRef.current || focusModeRef.current || assistantPulsedWhileClosedRef.current) {
      return;
    }

    assistantPulsedWhileClosedRef.current = true;
    setAssistantTogglePulse(true);
    window.setTimeout(() => setAssistantTogglePulse(false), 700);
  }, []);

  const {
    comments: pendingSelectionComments,
    createComment: createSelectionComment,
    updateComment: updateSelectionComment,
    deleteComment: deleteSelectionComment,
    applyPositionUpdates: applySelectionCommentPositions,
    applyFullReplacement: applySelectionCommentFullReplacement,
    buildSendPayload: buildSelectionCommentsPayload,
    markSent: markSelectionCommentsSent,
    revertSent: revertSelectionCommentsSent
  } = useSelectionComments({
    activeFile,
    documentText,
    language,
    workspace,
    onCommentSaved: handleSelectionCommentSaved
  });
  const editorViewRef = useRef<EditorView | null>(null);
  const handleEditorViewChange = useCallback((view: EditorView) => {
    editorViewRef.current = view;
  }, []);
  // Gates the editor's Tighten action; main re-checks identity on each request.
  const [editorCanTighten, setEditorCanTighten] = useState(false);
  const [agentHasOpenAiApiKey, setAgentHasOpenAiApiKey] = useState(false);
  const [writingAssistStatus, setWritingAssistStatus] = useState<WritingAssistStatus | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckResult | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const updateCheckRequestIdRef = useRef(0);
  const refreshWritingAssistStatus = useCallback(async () => {
    try {
      const status = await window.iliad.getWritingAssistStatus({ autocompleteApiFallbackEnabled });
      setWritingAssistStatus(status);
      setAgentHasOpenAiApiKey(status.autocomplete.apiFallbackAvailable);
    } catch {
      setWritingAssistStatus(null);
    }
  }, [autocompleteApiFallbackEnabled]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      let hasOpenAiApiKey = false;
      let hasCodexAccount = false;

      try {
        const snapshot = await window.iliad.agent.getSettings();
        hasOpenAiApiKey = snapshot.hasOpenAiApiKey;
      } catch {}

      try {
        const codexStatus = await window.iliad.agent.codexStatus();
        hasCodexAccount = Boolean(codexStatus.available && codexStatus.connected);
      } catch {}

      if (!cancelled) {
        setEditorCanTighten(hasOpenAiApiKey || hasCodexAccount);
        setAgentHasOpenAiApiKey(hasOpenAiApiKey);
        void refreshWritingAssistStatus();
      }
    };

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [assistantOpen, refreshWritingAssistStatus]);

  useEffect(() => {
    if (writingAssistsOpen) {
      void refreshWritingAssistStatus();
    }
  }, [refreshWritingAssistStatus, writingAssistsOpen]);

  const checkForUpdates = useCallback(async () => {
    const requestId = updateCheckRequestIdRef.current + 1;
    updateCheckRequestIdRef.current = requestId;
    setUpdateChecking(true);

    try {
      const result = await window.iliad.updates.check();

      if (updateCheckRequestIdRef.current !== requestId) {
        return;
      }

      setUpdateStatus(result);

      if (result.status === "current") {
        setNotice(strings.updates.current(result.latestVersion));
      } else if (result.status === "error") {
        setNotice(strings.updates.checkFailed);
      } else {
        setNotice(null);
      }
    } catch {
      if (updateCheckRequestIdRef.current !== requestId) {
        return;
      }

      setUpdateStatus({
        status: "error",
        currentVersion: "",
        message: strings.updates.checkFailed
      });
      setNotice(strings.updates.checkFailed);
    } finally {
      if (updateCheckRequestIdRef.current === requestId) {
        setUpdateChecking(false);
      }
    }
  }, [strings.updates]);

  const downloadUpdate = useCallback(async () => {
    if (updateStatus?.status !== "available" || !updateStatus.downloadUrl) {
      return;
    }

    await window.iliad.openUrl(updateStatus.downloadUrl);
  }, [updateStatus]);

  const viewUpdateRelease = useCallback(async () => {
    if (!updateStatus || updateStatus.status === "error") {
      return;
    }

    if (updateStatus.releaseUrl) {
      await window.iliad.openUrl(updateStatus.releaseUrl);
    }
  }, [updateStatus]);

  useEffect(() => window.iliad.updates.onCheckRequested(() => void checkForUpdates()), [checkForUpdates]);
  useEffect(() => {
    let cancelled = false;

    void window.iliad.updates
      .consumePendingCheckRequest()
      .then((pending) => {
        if (pending && !cancelled) {
          void checkForUpdates();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [checkForUpdates]);

  const scrollToSelectionComment = useCallback(
    (commentId: string) => {
      const view = editorViewRef.current;
      const comment = pendingSelectionComments.find((candidate) => candidate.id === commentId);

      if (!view || !comment || comment.to <= comment.from) {
        return;
      }

      scrollEditorToPosition(view, comment.from);
    },
    [pendingSelectionComments]
  );

  const handleManualReviewTargetChange = useCallback(
    (target: Parameters<typeof selectAgentReviewTarget>[0]) => {
      markEditorNavigationDuringRun();
      return selectAgentReviewTarget(target);
    },
    [markEditorNavigationDuringRun, selectAgentReviewTarget]
  );
  const reloadActiveFileAfterExternalCapture = useCallback(
    async ({
      restoredRelativePaths,
      restoredCreateRelativePaths,
      proposal
    }: {
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      proposal?: AgentChangeProposal;
    }) => {
      if (!activeFile || activeFile.kind !== "markdown") {
        return;
      }

      if (restoredCreateRelativePaths.some((relativePath) => sameRelativePath(relativePath, activeFile.relativePath))) {
        setActiveFile(null);
        setSelectedTreePath(null);
        clearDocument();
        return;
      }

      if (!restoredRelativePaths.some((relativePath) => sameRelativePath(relativePath, activeFile.relativePath))) {
        return;
      }

      const proposalFile = proposal?.files.find(
        (file) =>
          (file.kind === "edit_file" || file.kind === "delete_file") &&
          sameRelativePath(file.relativePath, activeFile.relativePath)
      );

      if (proposalFile?.kind === "edit_file" || proposalFile?.kind === "delete_file") {
        loadDocument(proposalFile.baseContent);
        return;
      }

      if (!workspace) {
        return;
      }

      try {
        const text = await window.iliad.readMarkdown(workspace.path, activeFile.path);
        loadDocument(text);
      } catch (readError) {
        setError(readError instanceof Error ? readError.message : strings.fileMessages.openFileFallback);
      }
    },
    [activeFile, clearDocument, loadDocument, setActiveFile, setError, setSelectedTreePath, strings.fileMessages.openFileFallback, workspace]
  );
  const clearExternalCaptureAutoFinishTimer = useCallback(() => {
    if (externalCaptureAutoFinishTimerRef.current === null) {
      return;
    }

    window.clearTimeout(externalCaptureAutoFinishTimerRef.current);
    externalCaptureAutoFinishTimerRef.current = null;
  }, []);
  const scheduleExternalCaptureAutoFinish = useCallback(
    (delayMs = externalCaptureAutoFinishDelayMs) => {
      clearExternalCaptureAutoFinishTimer();
      externalCaptureAutoFinishTimerRef.current = window.setTimeout(() => {
        externalCaptureAutoFinishTimerRef.current = null;
        void finishExternalCaptureRef.current?.({ automatic: true });
      }, delayMs);
    },
    [clearExternalCaptureAutoFinishTimer]
  );
  const startExternalCapture = useCallback(async (options: { silent?: boolean } = {}) => {
    const workspaceSessionId = workspace?.sessionId;

    if (!workspaceSessionId || externalCapture || externalCaptureBusy) {
      return;
    }

    setExternalCaptureBusy(true);
    try {
      clearExternalCaptureAutoFinishTimer();
      await flushSave();
      const capture = await window.iliad.agent.startExternalCapture({ workspaceSessionId });
      setExternalCapture(capture);
      debugExternalCapture("start_succeeded", {
        captureId: capture.captureId,
        markdownFileCount: capture.markdownFileCount,
        resumed: capture.resumed === true,
        silent: options.silent === true
      });
      if (capture.resumed) {
        scheduleExternalCaptureAutoFinish(externalCaptureAutoRetryDelayMs);
      }
      if (!options.silent) {
        setNotice(strings.assistant.externalCapture.started);
      }
    } catch (captureError) {
      if (import.meta.env.DEV) {
        console.warn(
          "[external-capture] start_failed",
          JSON.stringify({
            message: captureError instanceof Error ? captureError.message : String(captureError),
            silent: options.silent === true
          })
        );
      }
      if (!options.silent) {
        setError(captureError instanceof Error ? captureError.message : strings.assistant.externalCapture.errorFallback);
      }
    } finally {
      setExternalCaptureBusy(false);
    }
  }, [
    clearExternalCaptureAutoFinishTimer,
    externalCapture,
    externalCaptureBusy,
    flushSave,
    scheduleExternalCaptureAutoFinish,
    setError,
    strings.assistant.externalCapture.errorFallback,
    strings.assistant.externalCapture.started,
    workspace?.sessionId
  ]);
  const finishExternalCapture = useCallback(async (options: { automatic?: boolean } = {}) => {
    const automatic = options.automatic === true;
    const workspaceSessionId = workspace?.sessionId;

    if (!workspaceSessionId || !externalCapture) {
      return;
    }

    if (externalCaptureBusy) {
      if (automatic) {
        scheduleExternalCaptureAutoFinish(externalCaptureAutoRetryDelayMs);
      }
      return;
    }

    if (saveStatus !== "saved") {
      if (automatic) {
        scheduleExternalCaptureAutoFinish(externalCaptureAutoRetryDelayMs);
      } else {
        setNotice(strings.assistant.externalCapture.saveBeforeReview);
      }
      return;
    }

    setExternalCaptureBusy(true);
    try {
      clearExternalCaptureAutoFinishTimer();
      const result = await window.iliad.agent.finishExternalCapture({
        workspaceSessionId,
        captureId: externalCapture.captureId
      });
      debugExternalCapture("finish_result", {
        captureId: externalCapture.captureId,
        status: result.status,
        automatic,
        unsupportedNoteCount: result.unsupportedNotes.length,
        proposalFileCount: result.status === "proposal" ? result.proposal.files.length : 0
      });
      await refreshTree(workspace.path);

      if (result.status === "proposal") {
        mergeAgentProposals([result.proposal]);

        const file = result.proposal.files.find(fileHasMutableReview);
        if (file) {
          const alreadyReviewingFile =
            activeReview?.proposal.id === result.proposal.id && activeReview.file.id === file.id;

          if (!alreadyReviewingFile) {
            await selectAgentReviewTarget({ proposalId: result.proposal.id, fileId: file.id });
          }
        }

        if (result.unsupportedNotes.length > 0) {
          setNotice(strings.assistant.externalCapture.proposalReadyWithNotes(result.unsupportedNotes.length));
        }
      } else if (result.status === "git_baseline_changed") {
        setNotice(strings.assistant.externalCapture.gitBaselineChanged);
      } else if (result.status === "unsafe") {
        setError(result.message || strings.assistant.externalCapture.unsafe);
      } else {
        if (result.status === "empty") {
          const hadExternalFilesystemReview = hasPendingExternalFilesystemReview;
          setAgentProposals((current) =>
            current.filter((proposal) => proposal.metadata?.kind !== "external_filesystem")
          );
          setAgentReviewTarget((current) => {
            if (!current) {
              return current;
            }

            const proposal = agentProposals.find((candidate) => candidate.id === current.proposalId);
            return proposal?.metadata?.kind === "external_filesystem" ? null : current;
          });

          if (hadExternalFilesystemReview && activeFile?.kind === "markdown") {
            try {
              const text = await window.iliad.readMarkdown(workspace.path, activeFile.path);
              loadDocument(text);
            } catch {
              setActiveFile(null);
              setSelectedTreePath(null);
              clearDocument();
            }
          }

          if (automatic) {
            return;
          }
        }

        setNotice(
          result.status === "unsupported_restored"
            ? strings.assistant.externalCapture.unsupportedRestored
            : strings.assistant.externalCapture.noChanges
        );
      }

    } catch (captureError) {
      if (automatic) {
        scheduleExternalCaptureAutoFinish(externalCaptureAutoRetryDelayMs);
      } else {
        setError(captureError instanceof Error ? captureError.message : strings.assistant.externalCapture.errorFallback);
      }
    } finally {
      setExternalCaptureBusy(false);
    }
  }, [
    clearExternalCaptureAutoFinishTimer,
    externalCapture,
    externalCaptureBusy,
    activeReview,
    activeFile,
    agentProposals,
    clearDocument,
    hasPendingExternalFilesystemReview,
    loadDocument,
    mergeAgentProposals,
    refreshTree,
    saveStatus,
    scheduleExternalCaptureAutoFinish,
    selectAgentReviewTarget,
    setActiveFile,
    setAgentProposals,
    setAgentReviewTarget,
    setError,
    setSelectedTreePath,
    strings.assistant.externalCapture,
    workspace
  ]);
  useEffect(() => {
    finishExternalCaptureRef.current = finishExternalCapture;
  }, [finishExternalCapture]);
  useEffect(() => {
    return () => clearExternalCaptureAutoFinishTimer();
  }, [clearExternalCaptureAutoFinishTimer]);
  useEffect(() => {
    if (!externalCapture || externalCaptureBusy || !workspace || !lastWorkspaceChange?.markdownChanged) {
      return;
    }

    if (lastWorkspaceChange.workspaceRoot !== workspace.path) {
      return;
    }

    debugExternalCapture("workspace_change_scheduled_finish", {
      workspaceRootMatches: true,
      treeChanged: lastWorkspaceChange.treeChanged,
      markdownChanged: lastWorkspaceChange.markdownChanged
    });
    scheduleExternalCaptureAutoFinish();
  }, [externalCapture, externalCaptureBusy, lastWorkspaceChange, scheduleExternalCaptureAutoFinish, workspace]);
  useEffect(() => {
    debugExternalCapture("arm_gate", {
      hasCapture: Boolean(externalCapture),
      externalCaptureBusy,
      hasWorkspaceSession: Boolean(workspace?.sessionId),
      proposalLoadState,
      saveStatus,
      runningAssistantRunId
    });

    if (
      externalCapture ||
      externalCaptureBusy ||
      !workspace?.sessionId ||
      proposalLoadState !== "loaded" ||
      saveStatus !== "saved" ||
      runningAssistantRunId
    ) {
      return;
    }

    void startExternalCapture({ silent: true });
  }, [
    externalCapture,
    externalCaptureBusy,
    proposalLoadState,
    runningAssistantRunId,
    saveStatus,
    startExternalCapture,
    workspace?.sessionId
  ]);
  useEffect(() => {
    if (
      externalCapture ||
      externalCaptureBusy ||
      !workspace?.sessionId ||
      !lastWorkspaceChange?.markdownChanged ||
      lastWorkspaceChange.workspaceRoot !== workspace.path ||
      proposalLoadState !== "loaded" ||
      saveStatus !== "saved" ||
      runningAssistantRunId
    ) {
      return;
    }

    debugExternalCapture("reclaim_on_workspace_change", {
      hasCapture: false,
      proposalLoadState,
      saveStatus,
      runningAssistantRunId
    });
    void startExternalCapture({ silent: true });
  }, [
    externalCapture,
    externalCaptureBusy,
    lastWorkspaceChange,
    proposalLoadState,
    runningAssistantRunId,
    saveStatus,
    startExternalCapture,
    workspace
  ]);
  useEffect(() => {
    if (!externalCapture || externalCaptureBusy) {
      return;
    }

    if (runningAssistantRunId) {
      void finishExternalCapture({ automatic: true });
    }
  }, [
    externalCapture,
    externalCaptureBusy,
    finishExternalCapture,
    runningAssistantRunId
  ]);
  useEffect(() => {
    if (externalCapture) {
      return;
    }

    clearExternalCaptureAutoFinishTimer();
  }, [clearExternalCaptureAutoFinishTimer, externalCapture]);
  const cancelExternalCapture = useCallback(async (options: { silent?: boolean } = {}) => {
    const workspaceSessionId = workspace?.sessionId;

    if (!workspaceSessionId || !externalCapture || externalCaptureBusy) {
      return;
    }

    if (saveStatus === "saving") {
      if (!options.silent) {
        setNotice(strings.assistant.externalCapture.saveBeforeCancel);
      }
      return;
    }

    if (saveStatus !== "saved" && !options.silent) {
      setNotice(strings.assistant.externalCapture.saveBeforeCancel);
      return;
    }

    setExternalCaptureBusy(true);
    try {
      clearExternalCaptureAutoFinishTimer();
      const result = await window.iliad.agent.cancelExternalCapture({
        workspaceSessionId,
        captureId: externalCapture.captureId
      });
      await refreshTree(workspace.path);
      await reloadActiveFileAfterExternalCapture({
        restoredRelativePaths: result.restoredRelativePaths,
        restoredCreateRelativePaths: result.restoredCreateRelativePaths
      });
      setExternalCapture(null);
      if (!options.silent) {
        setNotice(strings.assistant.externalCapture.canceled);
      }
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : strings.assistant.externalCapture.errorFallback);
    } finally {
      setExternalCaptureBusy(false);
    }
  }, [
    clearExternalCaptureAutoFinishTimer,
    externalCapture,
    externalCaptureBusy,
    refreshTree,
    reloadActiveFileAfterExternalCapture,
    saveStatus,
    setError,
    strings.assistant.externalCapture,
    workspace
  ]);
  useEffect(() => {
    if (!externalCapture || externalCaptureBusy || saveStatus !== "unsaved") {
      return;
    }

    void cancelExternalCapture({ silent: true });
  }, [cancelExternalCapture, externalCapture, externalCaptureBusy, saveStatus]);
  const createMarkdownFileWithNavigation = useCallback(() => {
    markEditorNavigationDuringRun();
    return createMarkdownFile();
  }, [createMarkdownFile, markEditorNavigationDuringRun]);
  const duplicateNodeWithNavigation = useCallback(
    (node: Parameters<typeof duplicateNode>[0]) => {
      markEditorNavigationDuringRun();
      return duplicateNode(node);
    },
    [duplicateNode, markEditorNavigationDuringRun]
  );
  const moveNodeToTrashWithNavigation = useCallback(
    (node: Parameters<typeof moveNodeToTrash>[0]) => {
      markEditorNavigationDuringRun();
      return moveNodeToTrash(node);
    },
    [markEditorNavigationDuringRun, moveNodeToTrash]
  );
  const moveNodeWithNavigation = useCallback(
    (node: Parameters<typeof moveNode>[0], targetDirectoryPath: Parameters<typeof moveNode>[1]) => {
      markEditorNavigationDuringRun();
      return moveNode(node, targetDirectoryPath);
    },
    [markEditorNavigationDuringRun, moveNode]
  );
  const renameNodeWithNavigation = useCallback(
    (node: Parameters<typeof renameNode>[0], requestedName: Parameters<typeof renameNode>[1]) => {
      markEditorNavigationDuringRun();
      return renameNode(node, requestedName);
    },
    [markEditorNavigationDuringRun, renameNode]
  );
  const openDocumentLinkWithNavigation = useCallback(
    (href: string) => {
      markEditorNavigationDuringRun();
      return openDocumentLink(href);
    },
    [markEditorNavigationDuringRun, openDocumentLink]
  );
  const rejectAgentProposalWithNavigation = useCallback(
    (proposalId: Parameters<typeof rejectAgentProposal>[0]) => {
      markEditorNavigationDuringRun();
      return rejectAgentProposal(proposalId);
    },
    [markEditorNavigationDuringRun, rejectAgentProposal]
  );
  const reviewPendingTreeChanges = useCallback(() => {
    if (!firstPendingReviewTarget) {
      return;
    }

    void handleManualReviewTargetChange(firstPendingReviewTarget);
  }, [firstPendingReviewTarget, handleManualReviewTargetChange]);
  const discardPendingTreeChanges = useCallback(async () => {
    const proposalIds = mutableReviewProposalIds(pendingReviewProposals);

    if (proposalIds.length === 0 || pendingReviewDiscarding) {
      return;
    }

    const hasExternalReview = pendingReviewProposals.some(
      (proposal) => proposal.metadata?.kind === "external_filesystem"
    );
    const activeExternalReview =
      activeReview?.proposal.metadata?.kind === "external_filesystem" ? activeReview : null;

    markEditorNavigationDuringRun();
    setPendingReviewDiscarding(true);

    try {
      for (const proposalId of proposalIds) {
        await rejectAgentProposalStateOnly(proposalId);
      }

      if (workspace) {
        const proposals = await window.iliad.agent.listProposals(workspace.path);
        setAgentProposals(proposals);

        if (hasExternalReview) {
          const nextTree = await refreshTree(workspace.path);
          setAgentReviewTarget(null);

          if (activeExternalReview) {
            const node = findNodeByRelativePath(nextTree, activeExternalReview.file.relativePath);

            if (node) {
              try {
                const text = await window.iliad.readMarkdown(workspace.path, node.path);
                setActiveFile(node);
                setSelectedTreePath(node.path);
                loadDocument(text);
              } catch {
                setActiveFile(null);
                setSelectedTreePath(null);
                clearDocument();
              }
            } else {
              setActiveFile(null);
              setSelectedTreePath(null);
              clearDocument();
            }
          }
        }
      }

      setNotice(strings.assistant.status.discarded);
    } finally {
      setPendingReviewDiscarding(false);
    }
  }, [
    activeReview,
    clearDocument,
    loadDocument,
    markEditorNavigationDuringRun,
    pendingReviewDiscarding,
    pendingReviewProposals,
    refreshTree,
    rejectAgentProposalStateOnly,
    setActiveFile,
    setAgentProposals,
    setAgentReviewTarget,
    setNotice,
    setSelectedTreePath,
    strings.assistant.status.discarded,
    workspace
  ]);

  const completeDocumentClose = useCallback(() => {
    setActiveFile(null);
    setSelectedTreePath(null);
    setRevealFolderPath(null);
    setReviewRevealPath(null);
    setContentSearchRevealTarget(null);
    setRenamingPath(null);
    closeTreeContextMenu();
    markEditorNavigationDuringRun();
    setAgentReviewTarget(null);
    clearDocument();
    clearHistory();
    setCloseDialogOpen(false);
    setError(null);
  }, [clearDocument, clearHistory, closeTreeContextMenu, markEditorNavigationDuringRun, setAgentReviewTarget]);

  const requestCloseDocument = useCallback(() => {
    if (!activeFile) {
      return;
    }

    if (saveStatus === "saving") {
      setNotice(strings.documentClose.saving);
      return;
    }

    if (documentCloseRequiresChoice(saveStatus)) {
      setCloseDialogOpen(true);
      return;
    }

    completeDocumentClose();
  }, [activeFile, completeDocumentClose, saveStatus, strings.documentClose.saving]);

  const saveAndCloseDocument = useCallback(async () => {
    if (saveStatus === "saving" || closeDocumentInFlightRef.current) {
      return;
    }

    closeDocumentInFlightRef.current = true;
    try {
      await flushSave();
      completeDocumentClose();
    } catch {
      setCloseDialogOpen(true);
    } finally {
      closeDocumentInFlightRef.current = false;
    }
  }, [completeDocumentClose, flushSave, saveStatus]);

  const closeWithoutSavingDocument = useCallback(() => {
    if (saveStatus === "saving") {
      setNotice(strings.documentClose.saving);
      return;
    }

    completeDocumentClose();
  }, [completeDocumentClose, saveStatus, strings.documentClose.saving]);

  const navigateDocumentHistory = useCallback(
    async (direction: DocumentHistoryDirection) => {
      const currentPath = activeFile?.path;
      const target = getNavigationTarget(direction);

      if (!currentPath || !target) {
        return;
      }

      markEditorNavigationDuringRun();
      setAgentReviewTarget(null);
      const result = await openNode(target.node, { recordHistory: false });

      if (result.kind === "markdown") {
        completeHistoryNavigation(direction, currentPath, result.path);
      }
    },
    [
      activeFile?.path,
      completeHistoryNavigation,
      getNavigationTarget,
      markEditorNavigationDuringRun,
      openNode,
      setAgentReviewTarget
    ]
  );

  // ADR-0017: live editor selection — ref is always current (read at send);
  // the debounced state drives only the composer chip display.
  const liveEditorSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const [chipEditorSelection, setChipEditorSelection] = useState<{ from: number; to: number } | null>(null);
  const chipSelectionTimerRef = useRef<number | null>(null);
  const handleActiveSelectionChange = useCallback((range: { from: number; to: number } | null) => {
    liveEditorSelectionRef.current = range;

    if (chipSelectionTimerRef.current !== null) {
      window.clearTimeout(chipSelectionTimerRef.current);
    }

    chipSelectionTimerRef.current = window.setTimeout(() => {
      chipSelectionTimerRef.current = null;
      setChipEditorSelection(range);
    }, 150);
  }, []);
  const getEditorSelection = useCallback(() => liveEditorSelectionRef.current, []);

  const handleAgentOpenDocument = useCallback(
    (relativePath: string) => {
      void (async () => {
        let node = findNodeByRelativePath(tree, relativePath);

        if (!node && workspace) {
          const refreshed = await refreshTree(workspace.path);
          node = findNodeByRelativePath(refreshed, relativePath);
        }

        if (!node || node.kind !== "markdown") {
          console.warn("agent open_document: node not found in tree", relativePath);
          return;
        }

        // Agent-directed navigation: deliberately NOT marked as user
        // navigation (markEditorNavigationDuringRun), so post-run review
        // auto-targeting keeps working; history is recorded so the user can
        // navigate back.
        await openNode(node);
      })();
    },
    [openNode, refreshTree, tree, workspace]
  );

  const searchMarkdownContentForFileTree = useCallback<FileTreeContentSearchProvider["search"]>(
    async (requestId, request) => {
      latestContentSearchRequestIdRef.current = markLatestContentSearchRequestId(
        latestContentSearchRequestIdRef.current,
        requestId
      );
      let usedSavedTextFallback = false;
      const current = stateRef.current;

      if (!workspace) {
        return { response: emptyContentSearchResponse(request.query), usedSavedTextFallback };
      }

      if (current.activeFile?.kind === "markdown" && current.documentText !== current.savedText) {
        try {
          await flushSave();
        } catch {
          usedSavedTextFallback = true;
        }
      }

      if (latestContentSearchRequestIdRef.current !== requestId) {
        return { response: emptyContentSearchResponse(request.query), usedSavedTextFallback };
      }

      const response = await window.iliad.searchMarkdownContent({
        ...request,
        workspaceRoot: workspace.path
      });

      if (latestContentSearchRequestIdRef.current !== requestId) {
        return { response: emptyContentSearchResponse(request.query), usedSavedTextFallback };
      }

      return { response, usedSavedTextFallback };
    },
    [flushSave, stateRef, workspace]
  );

  const markLatestFileTreeContentSearchRequest = useCallback<FileTreeContentSearchProvider["markLatestRequest"]>(
    (requestId) => {
      latestContentSearchRequestIdRef.current = markLatestContentSearchRequestId(
        latestContentSearchRequestIdRef.current,
        requestId
      );
    },
    []
  );

  const openContentSearchMatch = useCallback<FileTreeContentSearchProvider["onOpenMatch"]>(
    async (match) => {
      if (!workspace) {
        return;
      }

      markEditorNavigationDuringRun();
      let node = findNode(tree, match.filePath) ?? findNodeByRelativePath(tree, match.relativePath);

      if (!node) {
        const refreshed = await refreshTree(workspace.path);
        node = findNode(refreshed, match.filePath) ?? findNodeByRelativePath(refreshed, match.relativePath);
      }

      if (!node || node.kind !== "markdown") {
        console.warn("content search open match: node not found in tree", match.relativePath);
        return;
      }

      clearReviewForNormalNavigation(node);

      if (activeFile?.path !== node.path) {
        const result = await openNode(node);

        if (result.kind !== "markdown") {
          return;
        }
      } else {
        setSelectedTreePath(node.path);
      }

      contentSearchRevealRequestIdRef.current += 1;
      setContentSearchRevealTarget({
        filePath: node.path,
        startOffset: match.startOffset,
        endOffset: match.endOffset,
        lineNumber: match.lineNumber,
        matchedText: match.matchedText,
        requestId: contentSearchRevealRequestIdRef.current
      });
    },
    [
      activeFile?.path,
      clearReviewForNormalNavigation,
      markEditorNavigationDuringRun,
      openNode,
      refreshTree,
      tree,
      workspace
    ]
  );

  const fileTreeContentSearchProvider = useMemo<FileTreeContentSearchProvider>(
    () => ({
      markLatestRequest: markLatestFileTreeContentSearchRequest,
      search: searchMarkdownContentForFileTree,
      onOpenMatch: openContentSearchMatch
    }),
    [markLatestFileTreeContentSearchRequest, openContentSearchMatch, searchMarkdownContentForFileTree]
  );

  const resetForWorkspaceSwitch = useCallback(() => {
    setActiveFile(null);
    setSelectedTreePath(null);
    setRevealFolderPath(null);
    setReviewRevealPath(null);
    setContentSearchRevealTarget(null);
    setRenamingPath(null);
    closeTreeContextMenu();
    setAgentProposals([]);
    setAgentReviewTarget(null);
    setExternalCapture(null);
    setExternalCaptureBusy(false);
    clearDocument();
    clearHistory();
    setError(null);
    setNotice(null);
    setAssistantOpen(false);
    setLanguageOpen(false);
    setTypographyOpen(false);
    setWritingAssistsOpen(false);
  }, [
    clearDocument,
    clearHistory,
    closeTreeContextMenu,
    setActiveFile,
    setAgentProposals,
    setAgentReviewTarget,
    setNotice,
    setRenamingPath,
    setRevealFolderPath,
    setReviewRevealPath,
    setSelectedTreePath
  ]);

  const openWorkspace = useCallback(async () => {
    if (isInitializing || switchInFlightRef.current) {
      return;
    }

    switchInFlightRef.current = true;
    try {
      if (externalCapture) {
        await cancelExternalCapture({ silent: true });
      }

      await flushSave();
      const nextWorkspace = await window.iliad.openWorkspaceDialog(language);

      if (!nextWorkspace) {
        return;
      }

      resetForWorkspaceSwitch();
      setWorkspace(nextWorkspace);
      setTree([]);
      await refreshTree(nextWorkspace.path);
    } finally {
      switchInFlightRef.current = false;
    }
  }, [
    cancelExternalCapture,
    externalCapture,
    flushSave,
    isInitializing,
    language,
    refreshTree,
    resetForWorkspaceSwitch,
    setTree,
    setWorkspace
  ]);

  const openRecentWorkspace = useCallback(
    async (target: WorkspaceInfo) => {
      if (isInitializing || switchInFlightRef.current) {
        return;
      }

      switchInFlightRef.current = true;
      try {
        if (externalCapture) {
          await cancelExternalCapture({ silent: true });
        }

        await flushSave();
        const result = await window.iliad.readDirectory(target.path);

        if (result.status === "missing") {
          pruneRecentWorkspace(target.path);
          setError(strings.workspaceMessages.recentMissing);
          return;
        }

        resetForWorkspaceSwitch();
        setWorkspace(result.workspace);
        setTree(result.tree);
      } finally {
        switchInFlightRef.current = false;
      }
    },
    [
      cancelExternalCapture,
      externalCapture,
      flushSave,
      isInitializing,
      pruneRecentWorkspace,
      resetForWorkspaceSwitch,
      setTree,
      setWorkspace,
      strings.workspaceMessages
    ]
  );

  useEffect(() => {
    clearHistory();
  }, [clearHistory, workspace?.path]);

  useEffect(() => {
    if (!activeFile) {
      clearHistory();
    }
  }, [activeFile, clearHistory]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 4200);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closeDialogOpen) {
          event.preventDefault();
          setCloseDialogOpen(false);
          return;
        }

        setFocusMode(false);
        setLanguageOpen(false);
        setTypographyOpen(false);
        setWritingAssistsOpen(false);
        closeTreeContextMenu();
        return;
      }

      const closeShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === "w" || event.key === "W");

      if (
        closeShortcut &&
        (activeFile || closeDialogOpen) &&
        !event.defaultPrevented &&
        !event.repeat &&
        !event.isComposing
      ) {
        event.preventDefault();
        requestCloseDocument();
        return;
      }

      const openShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === "o" || event.key === "O");

      if (openShortcut && !event.defaultPrevented && !event.repeat && !event.isComposing) {
        event.preventDefault();
        void openWorkspace();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFile, closeDialogOpen, closeTreeContextMenu, openWorkspace, requestCloseDocument]);

  useEffect(() => {
    if (!languageOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (languageMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setLanguageOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [languageOpen]);

  useEffect(() => {
    if (!treeContextMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (treeContextMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      closeTreeContextMenu();
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [closeTreeContextMenu, treeContextMenu]);

  useEffect(() => {
    if (!typographyOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (typographyMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setTypographyOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [typographyOpen]);

  useEffect(() => {
    if (!writingAssistsOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (writingAssistsMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setWritingAssistsOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [writingAssistsOpen]);

  const sidebarMaximumWidth = useMemo(
    () => effectiveSidebarMaximum(viewportWidth, assistantOpen && !focusMode && viewportWidth > 760),
    [assistantOpen, focusMode, viewportWidth]
  );
  const renderedSidebarWidth = clampSidebarWidth(sidebarWidth, sidebarMaximumWidth);
  const shellStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${renderedSidebarWidth}px`
      }) as CSSProperties,
    [renderedSidebarWidth]
  );
  const applySidebarWidthFromClientX = useCallback(
    (clientX: number) => {
      const shellLeft = appShellRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth = clientX - shellLeft;

      setSidebarWidth(nextWidth);
    },
    [setSidebarWidth]
  );
  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setSidebarResizing(true);
      applySidebarWidthFromClientX(event.clientX);
    },
    [applySidebarWidthFromClientX]
  );
  const handleSidebarResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!sidebarResizing) {
        return;
      }

      event.preventDefault();
      applySidebarWidthFromClientX(event.clientX);
    },
    [applySidebarWidthFromClientX, sidebarResizing]
  );
  const stopSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setSidebarResizing(false);
  }, []);
  const handleSidebarResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 16;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth(renderedSidebarWidth - step);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth(sidebarWidth > renderedSidebarWidth ? sidebarWidth + step : renderedSidebarWidth + step);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setSidebarWidth(minimumSidebarWidth);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setSidebarWidth(maximumPreferredSidebarWidth);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        resetSidebarWidth();
      }
    },
    [renderedSidebarWidth, resetSidebarWidth, setSidebarWidth, sidebarMaximumWidth, sidebarWidth]
  );
  const sidebarRegionId = "file-tree-sidebar";
  const shellClassName = useMemo(() => {
    const classes = ["app-shell"];

    if (!sidebarOpen || focusMode) {
      classes.push("sidebar-is-collapsed");
    }

    if (focusMode) {
      classes.push("is-focus-mode");
    }

    if (assistantOpen && !focusMode) {
      classes.push("assistant-is-open");
    }

    if (sidebarResizing) {
      classes.push("is-sidebar-resizing");
    }

    return classes.join(" ");
  }, [assistantOpen, focusMode, sidebarOpen, sidebarResizing]);
  const visibleStatus = statusText(saveStatus, lastSavedAt, strings.topbar.saveStatus);
  const shouldShowStatus = saveStatus !== "saved";
  const editorFile = virtualReviewFile ?? activeFile;
  const editorSelectionComments = useMemo<EditorSelectionCommentsProps | undefined>(() => {
    if (!activeFile || activeFile.kind !== "markdown" || editorFile !== activeFile) {
      return undefined;
    }

    return {
      comments: pendingSelectionComments,
      onCreateComment: createSelectionComment,
      onUpdateComment: updateSelectionComment,
      onDeleteComment: deleteSelectionComment,
      onPositionsChanged: applySelectionCommentPositions,
      onFullReplacement: applySelectionCommentFullReplacement
    };
  }, [
    activeFile,
    applySelectionCommentFullReplacement,
    applySelectionCommentPositions,
    createSelectionComment,
    deleteSelectionComment,
    editorFile,
    pendingSelectionComments,
    updateSelectionComment
  ]);
  const editorTighten = useMemo<EditorTightenProps | undefined>(() => {
    if (!activeFile || activeFile.kind !== "markdown" || editorFile !== activeFile) {
      return undefined;
    }

    return {
      enabled: editorCanTighten,
      minChars: 12,
      maxChars: 4000,
      labels: strings.editor.tighten,
      run: (requestId, text, selection, options) =>
        window.iliad.tightenSelection({
          requestId,
          text,
          selection,
          language,
          mode: options?.mode,
          instruction: options?.instruction
        }),
      cancel: (requestId) => window.iliad.cancelTighten(requestId)
    };
  }, [activeFile, editorCanTighten, editorFile, language, strings.editor.tighten]);
  const editorWritingAssists = useMemo<EditorWritingAssistsProps | undefined>(() => {
    if (!activeFile || activeFile.kind !== "markdown" || editorFile !== activeFile) {
      return undefined;
    }

    const correctorMemoryApi = window.iliad.writingCorrectorMemory;
    const workspaceSessionId = workspace?.sessionId;
    const documentRelativePath = activeFile.relativePath;

    return {
      correctorEnabled,
      autocompleteEnabled,
      autocompleteApiFallbackEnabled,
      language,
      workspaceSessionId,
      documentRelativePath,
      labels: {
        corrector: strings.editor.writingCorrector,
        autocomplete: strings.editor.ideaAutocomplete
      },
      autocompleteIdea: (request) => window.iliad.autocompleteIdea(request),
      cancelAutocompleteIdea: (requestId) => window.iliad.cancelAutocompleteIdea(requestId),
      correctorMemory:
        correctorMemoryApi && workspaceSessionId
          ? {
              load: () =>
                correctorMemoryApi.get({
                  workspaceSessionId,
                  documentRelativePath,
                  language
                }),
              ignoreIssue: (fingerprint) =>
                correctorMemoryApi.ignoreIssue({
                  workspaceSessionId,
                  documentRelativePath,
                  language,
                  fingerprint
                }),
              addDictionaryWord: (word) => correctorMemoryApi.addDictionaryWord({ language, word })
            }
          : undefined
    };
  }, [
    activeFile,
    autocompleteApiFallbackEnabled,
    autocompleteEnabled,
    correctorEnabled,
    editorFile,
    language,
    strings.editor.ideaAutocomplete,
    strings.editor.writingCorrector,
    workspace?.sessionId
  ]);
  // The chip always reflects the open document; no chip for non-open documents.
  const assistantSelectionComments = useMemo<AssistantPanelSelectionComments | undefined>(() => {
    if (!activeFile || activeFile.kind !== "markdown") {
      return undefined;
    }

    return {
      comments: pendingSelectionComments,
      documentName: activeFile.name,
      documentPath: activeFile.path,
      buildPayload: buildSelectionCommentsPayload,
      onMarkSent: markSelectionCommentsSent,
      onRevert: revertSelectionCommentsSent,
      onDiscard: deleteSelectionComment,
      onSelect: scrollToSelectionComment
    };
  }, [
    activeFile,
    buildSelectionCommentsPayload,
    deleteSelectionComment,
    markSelectionCommentsSent,
    pendingSelectionComments,
    revertSelectionCommentsSent,
    scrollToSelectionComment
  ]);
  const editorValue =
    activeReview?.proposal.metadata?.kind === "external_filesystem" && activeReview.file.kind === "edit_file"
      ? activeReview.file.baseContent
      : activeReview?.file.kind === "create_file"
      ? activeReview.file.content
      : activeReview?.file.kind === "delete_file"
        ? activeReview.file.baseContent
        : documentText;
  const documentTabLabel = markdownDisplayName(activeFile, strings.appName);
  const sidebarToggleLabel = sidebarOpen ? strings.topbar.hideFileTree : strings.topbar.showFileTree;
  const backLabel = backTarget
    ? strings.topbar.backTo(markdownDisplayName(backTarget.node, strings.appName))
    : strings.topbar.noPreviousDocument;
  const forwardLabel = forwardTarget
    ? strings.topbar.forwardTo(markdownDisplayName(forwardTarget.node, strings.appName))
    : strings.topbar.noNextDocument;
  const focusModeLabel = focusMode ? strings.topbar.exitFocusMode : strings.topbar.focusMode;
  const autocompleteStatusNote = useMemo(() => {
    if (!autocompleteEnabled) {
      return undefined;
    }

    const status = writingAssistStatus?.autocomplete;

    if (!status) {
      return undefined;
    }

    if (status.provider === "codex-app-server") {
      return status.model
        ? `${strings.writingAssists.autocompleteCodex} · ${status.model}`
        : strings.writingAssists.autocompleteCodex;
    }

    if (status.provider === "openai-api") {
      return status.model
        ? `${strings.writingAssists.autocompleteApi} · ${status.model}`
        : strings.writingAssists.autocompleteApi;
    }

    if (status.apiFallbackAvailable && !status.apiFallbackEnabled) {
      return strings.writingAssists.autocompleteEnableApiFallback;
    }

    return strings.writingAssists.autocompleteUnavailable;
  }, [autocompleteEnabled, strings.writingAssists, writingAssistStatus?.autocomplete]);

  if (!workspace) {
    return (
      <div className="launch-screen">
        <div className="launch-panel">
          <ClipMark size={60} className="launch-mark" />
          <span className="launch-name">{strings.appName}</span>
          <h1>{isInitializing ? strings.launch.openingWorkspace : strings.launch.localMarkdownWriting}</h1>
          <button type="button" className="primary-button" onClick={openWorkspace} disabled={isInitializing}>
            <FolderOpen size={18} />
            {strings.launch.openFolder}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        {!error && notice ? (
          <div className="toast is-notice" role="status">
            {notice}
            <button type="button" onClick={() => setNotice(null)}>
              {strings.toast.dismiss}
            </button>
          </div>
        ) : null}

        {!error && !notice && updateStatus?.status === "available" ? (
          <div className="toast is-notice update-toast" role="status">
            <span>{strings.updates.available(updateStatus.latestVersion)}</span>
            <div className="update-toast-actions">
              {updateStatus.downloadUrl ? (
                <button type="button" onClick={() => void downloadUpdate()}>
                  {strings.updates.download}
                </button>
              ) : null}
              <button type="button" onClick={() => void viewUpdateRelease()}>
                {strings.updates.viewRelease}
              </button>
              <button type="button" onClick={() => setUpdateStatus(null)}>
                {strings.updates.dismiss}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={appShellRef} className={shellClassName} style={shellStyle}>
      <header className="app-topbar">
        <div className="topbar-sidebar-zone" />
        <div className="topbar-editor-zone">
          <div className="topbar-navigation">
            {focusMode ? (
              <span className="topbar-control-spacer" />
            ) : (
              <button
                type="button"
                className="icon-button"
                data-tooltip={sidebarToggleLabel}
                aria-label={sidebarToggleLabel}
                onClick={() => setSidebarOpen((open) => !open)}
              >
                {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              data-tooltip={backLabel}
              aria-label={backLabel}
              disabled={!canGoBack}
              onClick={() => void navigateDocumentHistory("back")}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              data-tooltip={forwardLabel}
              aria-label={forwardLabel}
              disabled={!canGoForward}
              onClick={() => void navigateDocumentHistory("forward")}
            >
              <ChevronRight size={17} />
            </button>
          </div>

          {activeFile ? (
            <div className="document-tab">
              <span>{documentTabLabel}</span>
              <button
                type="button"
                className="document-tab-close"
                aria-label={strings.documentClose.close}
                onClick={requestCloseDocument}
              >
                <X size={13} strokeWidth={2.2} />
              </button>
            </div>
          ) : (
            <div className="topbar-document-slot" aria-hidden="true" />
          )}

          <div className="topbar-actions">
            {shouldShowStatus && visibleStatus ? <span className="document-save-state">{visibleStatus}</span> : null}
            <TypographyMenu
              editorFontPreset={editorFontPreset}
              editorFontSize={editorFontSize}
              menuRef={typographyMenuRef}
              labels={strings.typography}
              onReset={resetEditorPreferences}
              onSetFontPreset={setEditorFontPreset}
              onSetFontSize={setEditorFontSize}
              onToggleOpen={() => setTypographyOpen((open) => !open)}
              open={typographyOpen}
            />
            <WritingAssistsMenu
              labels={strings.writingAssists}
              menuRef={writingAssistsMenuRef}
              open={writingAssistsOpen}
              correctorEnabled={correctorEnabled}
              autocompleteEnabled={autocompleteEnabled}
              autocompleteApiFallbackEnabled={autocompleteApiFallbackEnabled}
              correctorAvailable={language === "en"}
              autocompleteNote={autocompleteStatusNote}
              showApiFallback={writingAssistStatus?.autocomplete.apiFallbackAvailable ?? agentHasOpenAiApiKey}
              onToggleOpen={() => {
                setWritingAssistsOpen((open) => {
                  const nextOpen = !open;

                  if (nextOpen) {
                    void refreshWritingAssistStatus();
                  }

                  return nextOpen;
                });
              }}
              onSetCorrectorEnabled={setCorrectorEnabled}
              onSetAutocompleteEnabled={setAutocompleteEnabled}
              onSetAutocompleteApiFallbackEnabled={setAutocompleteApiFallbackEnabled}
            />
            <LanguageMenu
              language={language}
              labels={strings.language}
              menuRef={languageMenuRef}
              onSetLanguage={(nextLanguage) => {
                setLanguage(nextLanguage);
                setLanguageOpen(false);
              }}
              onToggleOpen={() => setLanguageOpen((open) => !open)}
              open={languageOpen}
            />
            {!focusMode ? (
              <button
                type="button"
                className={`icon-button${assistantTogglePulse ? " is-comment-pulse" : ""}`}
                data-tooltip={assistantOpen ? strings.assistant.close : strings.assistant.open}
                aria-label={assistantOpen ? strings.assistant.close : strings.assistant.open}
                onClick={() => setAssistantOpen((open) => !open)}
              >
                {assistantOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              data-tooltip={focusModeLabel}
              aria-label={focusModeLabel}
              onClick={() => setFocusMode((enabled) => !enabled)}
            >
              {focusMode ? <Minimize2 size={16} /> : <Focus size={16} />}
            </button>
          </div>
        </div>
      </header>

      <div className="app-content">
        {sidebarOpen && !focusMode ? (
          <div id={sidebarRegionId} className="sidebar-frame">
            <FileTree
              workspace={workspace}
              recentWorkspaces={recentWorkspaces}
              nodes={tree}
              activePath={editorFile?.path}
              selectedPath={selectedTreePath}
              pendingChanges={pendingTreeChanges}
              pendingReviewCount={pendingReviewFileCount}
              pendingReviewActive={pendingReviewActive}
              pendingReviewBusy={pendingReviewDiscarding}
              creatingFile={creatingFile}
              creatingFolder={creatingFolder}
              renamingPath={renamingPath}
              revealPath={reviewRevealPath ?? revealFolderPath}
              labels={strings.sidebar}
              updateLabels={strings.updates}
              updateStatus={updateStatus}
              updateChecking={updateChecking}
              onOpenNode={(node) => {
                markEditorNavigationDuringRun();
                clearReviewForNormalNavigation(node);
                return openNode(node);
              }}
              onOpenPendingChange={(target) =>
                handleManualReviewTargetChange({ proposalId: target.proposalId, fileId: target.fileId })
              }
              onRevealComplete={(path) => {
                if (reviewRevealPath === path) {
                  setReviewRevealPath(null);
                }

                if (revealFolderPath === path) {
                  setRevealFolderPath(null);
                }
              }}
              onCreateFile={createMarkdownFileWithNavigation}
              onCreateFolder={createFolder}
              onOpenFolder={openWorkspace}
              onOpenRecent={openRecentWorkspace}
              onRevealWorkspace={() => void window.iliad.revealInFinder(workspace.path, workspace.path)}
              onCheckForUpdates={checkForUpdates}
              onDownloadUpdate={downloadUpdate}
              onViewUpdateRelease={viewUpdateRelease}
              onSelectNode={(node) => setSelectedTreePath(node.path)}
              onSelectWorkspaceRoot={() => {
                setSelectedTreePath(workspace.path);
              }}
              onReviewPendingChanges={reviewPendingTreeChanges}
              onDiscardPendingChanges={discardPendingTreeChanges}
              onMoveNode={moveNodeWithNavigation}
              onShowContextMenu={(node, position) => setTreeContextMenu({ node, ...position })}
              contextMenuOpen={Boolean(treeContextMenu)}
              onCloseContextMenu={closeTreeContextMenu}
              onCancelRename={() => setRenamingPath(null)}
              onCommitRename={renameNodeWithNavigation}
              contentSearchProvider={fileTreeContentSearchProvider}
            />
            <div
              ref={sidebarResizeHandleRef}
              className="sidebar-resize-handle"
              role="separator"
              tabIndex={0}
              aria-controls={sidebarRegionId}
              aria-label={strings.sidebar.resizeFileTree}
              aria-orientation="vertical"
              aria-valuemin={minimumSidebarWidth}
              aria-valuemax={sidebarMaximumWidth}
              aria-valuenow={renderedSidebarWidth}
              aria-valuetext={strings.sidebar.fileTreeWidthValue(renderedSidebarWidth)}
              data-tooltip={strings.sidebar.resizeFileTree}
              onDoubleClick={resetSidebarWidth}
              onKeyDown={handleSidebarResizeKeyDown}
              onPointerCancel={stopSidebarResize}
              onPointerDown={handleSidebarResizePointerDown}
              onPointerMove={handleSidebarResizePointerMove}
              onPointerUp={stopSidebarResize}
            />
          </div>
        ) : null}

        <EditorErrorBoundary labels={strings.editor} resetKey={editorFile?.path ?? "empty"}>
          <EditorPane
            file={editorFile}
            value={editorValue}
            editorFontSize={editorFontSize}
            editorFontPreset={editorFontPreset}
            labels={strings.editor}
            review={editorReview}
            selectionComments={editorSelectionComments}
            tighten={editorTighten}
            writingAssists={editorWritingAssists}
            onActiveSelectionChange={handleActiveSelectionChange}
            onChange={handleEditorChange}
            onInsertImage={insertImage}
            onInsertImageReference={insertImageReference}
            onOpenLink={openDocumentLinkWithNavigation}
            onCreateDocument={createMarkdownFileWithNavigation}
            onEditorViewChange={handleEditorViewChange}
            contentSearchRevealTarget={contentSearchRevealTarget}
            onContentSearchRevealHandled={(requestId) => {
              setContentSearchRevealTarget((current) => (current?.requestId === requestId ? null : current));
            }}
          />
        </EditorErrorBoundary>

        {assistantOpen && !focusMode ? (
          <AssistantPanel
            activeFile={activeFile}
            documentText={documentText}
            fileTree={tree}
            labels={strings.assistant}
            language={language}
            proposals={agentProposals}
            selectionComments={assistantSelectionComments}
            workspace={workspace}
            onProposalsChanged={mergeAgentProposals}
            onRejectProposal={rejectAgentProposalWithNavigation}
            onReviewTargetChange={handleManualReviewTargetChange}
            onAutoReviewTargetChange={selectAgentReviewTarget}
            editorNavigationChangedDuringRun={editorNavigationChangedDuringRun}
            onRunningRunChange={handleRunningAssistantRunChange}
            onOpenDocumentRequest={handleAgentOpenDocument}
            onContextAttachmentMoveHandlerChange={(handler) => {
              contextAttachmentMoveHandlerRef.current = handler;
            }}
            editorSelection={chipEditorSelection}
            getEditorSelection={getEditorSelection}
          />
        ) : null}
      </div>

      <TreeContextMenu
        menu={treeContextMenu}
        menuRef={treeContextMenuRef}
        labels={strings.treeContextMenu}
        onCopyPath={copyNodePath}
        onDuplicate={duplicateNodeWithNavigation}
        onMoveToTrash={moveNodeToTrashWithNavigation}
        onMoveToRoot={(node) => moveNodeWithNavigation(node, workspace.path)}
        canMoveToRoot={(node) => {
          if (!node.relativePath.includes("/")) {
            return false;
          }

          const nodePath = node.relativePath.replace(/\\/g, "/").toLowerCase();

          return !pendingTreeChanges.some((change) => {
            const pendingPath = change.normalizedRelativePath.toLowerCase();

            return pendingPath === nodePath || pendingPath.startsWith(`${nodePath}/`);
          });
        }}
        onRename={startRenameFromContextMenu}
        onRevealInFinder={revealNodeInFinder}
      />

      {closeDialogOpen ? (
        <div className="document-close-backdrop">
          <div
            className="document-close-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-close-title"
          >
            <h2 id="document-close-title">{strings.documentClose.title}</h2>
            <p>{strings.documentClose.body}</p>
            <div className="document-close-actions">
              <button type="button" onClick={saveAndCloseDocument}>
                {strings.documentClose.saveAndClose}
              </button>
              <button type="button" onClick={closeWithoutSavingDocument}>
                {strings.documentClose.closeWithoutSaving}
              </button>
              <button type="button" onClick={() => setCloseDialogOpen(false)}>
                {strings.documentClose.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="toast" role="status">
          {error}
          <button type="button" onClick={() => setError(null)}>
            {strings.toast.dismiss}
          </button>
        </div>
      ) : null}

      {!error && notice ? (
        <div className="toast is-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>
            {strings.toast.dismiss}
          </button>
        </div>
      ) : null}

      {!error && !notice && updateStatus?.status === "available" ? (
        <div className="toast is-notice update-toast" role="status">
          <span>{strings.updates.available(updateStatus.latestVersion)}</span>
          <div className="update-toast-actions">
            {updateStatus.downloadUrl ? (
              <button type="button" onClick={() => void downloadUpdate()}>
                {strings.updates.download}
              </button>
            ) : null}
            <button type="button" onClick={() => void viewUpdateRelease()}>
              {strings.updates.viewRelease}
            </button>
            <button type="button" onClick={() => setUpdateStatus(null)}>
              {strings.updates.dismiss}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
