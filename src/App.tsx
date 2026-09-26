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
  X
} from "lucide-react";
import { useCliBridge, type CliOpenSteps } from "./app/useCliBridge";
import { useDocumentHistory, type DocumentHistoryDirection } from "./app/useDocumentHistory";
import {
  documentCloseRequiresChoice,
  useDocumentPersistence,
  type SaveStatus
} from "./app/useDocumentPersistence";
import { externalReviewTargetForActiveFile, useOutsideReview } from "./app/useOutsideReview";
import { useSelectionComments } from "./app/useSelectionComments";
import { useWorkspace } from "./app/useWorkspace";
import { useWritingNotes } from "./app/useWritingNotes";
import { EditorErrorBoundary } from "./components/EditorErrorBoundary";
import {
  EditorPane,
  type EditorConflictState,
  type EditorSelectionCommentsProps,
  type EditorTightenProps,
  type EditorWritingAssistsProps
} from "./components/EditorPane";
import { ClipMark } from "./components/ClipMark";
import { FileTree } from "./components/FileTree";
import { LanguageMenu } from "./components/LanguageMenu";
import { TreeContextMenu, type TreeContextMenuState } from "./components/TreeContextMenu";
import { TypographyMenu } from "./components/TypographyMenu";
import { GEMINI_KEY_URL, WritingAssistsMenu } from "./components/WritingAssistsMenu";
import {
  markLatestContentSearchRequestId,
  type FileTreeContentSearchProvider
} from "./files/fileTreeContentSearch";
import { fileHasMutableReview } from "./review/reviewFiles";
import { logReviewNavigation } from "./review/reviewDebug";
import { buildReviewQueueSummary, pendingFileTreeChangesFromQueue } from "./review/reviewQueue";
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
import { TooltipLayer } from "./components/TooltipLayer";
import { useWritingAssistPreferences } from "./preferences/writingAssistPreferences";
import { useAutocompletePreferences } from "./preferences/autocompletePreferences";
import type { EditorView } from "@codemirror/view";
import type {
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
    conflict: string;
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

function effectiveSidebarMaximum(viewportWidth: number) {
  const editorFloor = 320;
  const availableWidth = viewportWidth - editorFloor;

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
    flushSave: flushDocumentSave,
    handleEditorChange,
    loadDocument,
    resumeAfterConflict
  } = useDocumentPersistence({ activeFile, messages: strings.documentMessages, onError: setError, workspace });
  const activeFileInConflict = saveStatus === "conflict";
  const {
    comments: pendingSelectionComments,
    commentsEnabled,
    commentCount,
    detachedComments,
    createComment: createSelectionComment,
    updateComment: updateSelectionComment,
    deleteComment: deleteSelectionComment,
    applyPositionUpdates: applySelectionCommentPositions,
    applyFullReplacement: applySelectionCommentFullReplacement,
    flushPersist: flushSelectionComments,
    noteOutsideEditRestored
  } = useSelectionComments({
    activeFile,
    documentText,
    workspace,
    lastWorkspaceChange,
    tree,
    onError: setError,
    onFileListChanged: () => {
      if (workspace) {
        void refreshTree(workspace.path).catch(() => undefined);
      }
    },
    messages: strings.documentMessages
  });
  // Every save flush also writes pending comment changes (companion file), so
  // file operations and navigation wait for both and stop if either fails.
  const flushSave = useCallback(async () => {
    await flushDocumentSave();
    await flushSelectionComments();
  }, [flushDocumentSave, flushSelectionComments]);
  const {
    editorFontPreset,
    editorFontSize,
    resetEditorPreferences,
    setEditorFontPreset,
    setEditorFontSize
  } = useEditorPreferences();
  const { resetSidebarWidth, setSidebarWidth, sidebarWidth } = useSidebarWidth();
  const { correctorEnabled, autocompleteEnabled, setCorrectorEnabled, setAutocompleteEnabled } =
    useWritingAssistPreferences();
  const autocompleteOptions = useAutocompletePreferences();
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const closeTreeContextMenu = useCallback(() => setTreeContextMenu(null), []);
  const requestReviewReveal = useCallback((path: string) => {
    logReviewNavigation("file_tree_reveal_requested", { revealPath: path });
    setReviewRevealPath(path);
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
    onTreeNodeMoved: ({ oldNode, newNode }) => {
      relocateHistoryPaths(oldNode.path, newNode.path);
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
  const { notesText, notesAvailable, openNotes } = useWritingNotes({
    activeFile,
    workspace,
    lastWorkspaceChange,
    tree,
    openNode,
    refreshTree,
    onError: setError,
    messages: strings.documentMessages
  });

  const reloadActiveDocumentRef = useRef<(options?: { mayReplace?: () => boolean }) => Promise<void>>(
    async () => undefined
  );
  const {
    activeReview,
    agentProposals,
    applyAgentProposalFile,
    applyExternalReviewUpdate,
    clearReviewForNormalNavigation,
    editorReview,
    reviewActionBusy,
    rejectAgentProposal,
    rejectAgentProposalFile,
    selectAgentReviewTarget,
    setAgentProposals,
    setAgentReviewTarget,
    virtualReviewFile
  } = useOutsideReview({
    activeFile,
    loadDocument,
    openNode,
    recordNormalNavigation,
    refreshTree,
    setActiveFile,
    setError,
    setNotice,
    setSelectedTreePath,
    requestReviewReveal,
    activeFileInConflict,
    onActiveFileExternalItemCleared: resumeAfterConflict,
    reloadActiveDocument: (options) => reloadActiveDocumentRef.current(options),
    canReplaceActiveBuffer: () => stateRef.current.documentText === stateRef.current.savedText,
    onOutsideEditRestored: noteOutsideEditRestored,
    flushActiveDocument: flushSave,
    strings,
    tree,
    workspace
  });
  const activeReviewRef = useRef(activeReview);

  useEffect(() => {
    if (lastWorkspaceChange?.watcherDegraded && lastWorkspaceChange.workspaceRoot === workspace?.path) {
      setNotice(strings.workspaceMessages.watcherDegraded);
    }
  }, [lastWorkspaceChange, strings.workspaceMessages.watcherDegraded, workspace?.path]);

  // Outside-change review is owned by main: subscribe to its pushes for the
  // current workspace (the hook pulls the first snapshot itself).
  useEffect(() => {
    if (!workspace?.sessionId) {
      return;
    }

    return window.iliad.agent.onExternalReviewChanged((snapshot) => {
      applyExternalReviewUpdate(snapshot);
    });
  }, [applyExternalReviewUpdate, workspace?.sessionId]);

  const conflictReviewTarget = useMemo(() => {
    if (!activeFileInConflict || !workspace || activeFile?.kind !== "markdown") {
      return null;
    }

    return externalReviewTargetForActiveFile(agentProposals, workspace.path, activeFile.relativePath);
  }, [activeFile, activeFileInConflict, agentProposals, workspace]);
  const reloadActiveDocumentFromDisk = useCallback(
    async ({ mayReplace }: { mayReplace?: () => boolean } = {}) => {
      if (!workspace || !activeFile || activeFile.kind !== "markdown") {
        return;
      }

      // The buffer identity the read was started for: the same document and
      // the same saved text. Anything else by the time the read returns (another
      // document opened, or edits typed while it was in flight) keeps the
      // buffer and its save state untouched.
      const before = stateRef.current;
      const expectedSavedText = before.savedText;

      if (mayReplace && !mayReplace()) {
        return;
      }

      let text: string;

      try {
        text = await window.iliad.readMarkdown(workspace.path, activeFile.path);
      } catch (readError) {
        setError(readError instanceof Error ? readError.message : strings.fileMessages.openFileFallback);
        return;
      }

      const latest = stateRef.current;

      if (latest.workspace?.path !== workspace.path || latest.activeFile?.path !== activeFile.path) {
        return;
      }

      if (
        mayReplace &&
        (!mayReplace() || latest.savedText !== expectedSavedText || latest.documentText !== latest.savedText)
      ) {
        return;
      }

      loadDocument(text);
    },
    [activeFile, loadDocument, stateRef, strings.fileMessages.openFileFallback, workspace]
  );
  useEffect(() => {
    reloadActiveDocumentRef.current = reloadActiveDocumentFromDisk;
  }, [reloadActiveDocumentFromDisk]);
  const editorConflict = useMemo<EditorConflictState | null>(() => {
    if (!activeFile || activeFile.kind !== "markdown") {
      return null;
    }

    if (!conflictReviewTarget) {
      // Conflict with no pending item for this path: disk already matches
      // the baseline again, so the only honest exit is to reload from disk.
      if (!activeFileInConflict) {
        return null;
      }

      return {
        relativePath: activeFile.relativePath,
        busy: reviewActionBusy,
        orphan: true,
        onRestore: () => undefined,
        onKeep: () => {
          if (!window.confirm(strings.editor.conflictBanner.confirmDiscard)) {
            return;
          }

          void reloadActiveDocumentFromDisk();
        }
      };
    }

    return {
      relativePath: activeFile.relativePath,
      busy: reviewActionBusy,
      onRestore: () => {
        void rejectAgentProposalFile(conflictReviewTarget.proposalId, conflictReviewTarget.fileId).catch(() => undefined);
      },
      onKeep: () => {
        if (!window.confirm(strings.editor.conflictBanner.confirmDiscard)) {
          return;
        }

        // The writer confirmed discarding the buffer: the only Keep that may
        // load disk over a conflicted buffer (spec V5).
        void applyAgentProposalFile(conflictReviewTarget.proposalId, conflictReviewTarget.fileId, {
          discardBuffer: true
        }).catch(() => undefined);
      }
    };
  }, [
    activeFile,
    activeFileInConflict,
    applyAgentProposalFile,
    conflictReviewTarget,
    rejectAgentProposalFile,
    reloadActiveDocumentFromDisk,
    reviewActionBusy,
    strings.editor.conflictBanner.confirmDiscard
  ]);

  useEffect(() => {
    activeReviewRef.current = activeReview;
  }, [activeReview]);

  const reviewQueue = useMemo(() => buildReviewQueueSummary(agentProposals), [agentProposals]);
  const pendingTreeChanges = useMemo(
    () => pendingFileTreeChangesFromQueue(reviewQueue.items),
    [reviewQueue.items]
  );
  const pendingReviewFileCount = reviewQueue.items.length;
  const pendingReviewActive = Boolean(
    activeReview &&
      fileHasMutableReview(activeReview.file) &&
      reviewQueue.items.some(
        (item) => item.proposalId === activeReview.proposal.id && item.fileId === activeReview.file.id
      )
  );
  const selectedTreePathForFileTree = useMemo(() => {
    if (
      activeReview?.file.kind === "delete_file" &&
      findNodeByRelativePath(tree, activeReview.file.relativePath)?.kind !== "markdown"
    ) {
      // No document row to select: the delete is reviewed from its ghost row
      // (the file is gone, or a folder took its name).
      return null;
    }

    return selectedTreePath;
  }, [activeReview?.file.kind, activeReview?.file.relativePath, selectedTreePath, tree]);
  const [pendingReviewDiscarding, setPendingReviewDiscarding] = useState(false);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  const editorViewRef = useRef<EditorView | null>(null);
  const handleEditorViewChange = useCallback((view: EditorView) => {
    editorViewRef.current = view;
  }, []);
  // Gates autocomplete and the ✦ AI menu; main re-checks the key on each request.
  const [writingAssistStatus, setWritingAssistStatus] = useState<WritingAssistStatus | null>(null);
  const [keyFieldFocusRequest, setKeyFieldFocusRequest] = useState(0);
  const hasGeminiKey = Boolean(writingAssistStatus?.geminiKey.hasKey);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckResult | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const updateCheckRequestIdRef = useRef(0);
  const refreshWritingAssistStatus = useCallback(async () => {
    try {
      setWritingAssistStatus(await window.iliad.getWritingAssistStatus());
    } catch {
      setWritingAssistStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshWritingAssistStatus();
  }, [refreshWritingAssistStatus]);

  const saveGeminiKey = useCallback(
    async (key: string | null) => {
      await window.iliad.setGeminiApiKey(key);
      await refreshWritingAssistStatus();
    },
    [refreshWritingAssistStatus]
  );

  const openGeminiKeyPage = useCallback(() => {
    void window.iliad.openUrl(GEMINI_KEY_URL);
  }, []);

  // ✦ AI without a key: open Writing assists with the key field focused.
  const requestGeminiKey = useCallback(() => {
    setTypographyOpen(false);
    setLanguageOpen(false);
    setWritingAssistsOpen(true);
    setKeyFieldFocusRequest((request) => request + 1);
    void refreshWritingAssistStatus();
  }, [refreshWritingAssistStatus]);

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

  const handleManualReviewTargetChange = useCallback(
    (target: Parameters<typeof selectAgentReviewTarget>[0]) => {
      logReviewNavigation("manual_review_target_change", {
        target,
        activeRel: activeFile?.relativePath ?? null,
        activeRelativePath: activeFile?.relativePath ?? null,
        selectedTreePath
      });
      return selectAgentReviewTarget(target);
    },
    [activeFile?.relativePath, selectAgentReviewTarget, selectedTreePath]
  );
  const acceptPendingTreeChanges = useCallback(async () => {
    const items = reviewQueue.items;

    if (items.length === 0 || pendingReviewDiscarding) {
      return;
    }

    logReviewNavigation("bulk_accept_pending_changes_start", {
      count: items.length,
      items: items.map((item) => ({
        proposalId: item.proposalId,
        fileId: item.fileId,
        kind: item.kind,
        relativePath: item.relativePath,
        duplicateFileIds: item.duplicateFileIds
      }))
    });
    setPendingReviewDiscarding(true);

    try {
      for (const item of items) {
        for (const fileId of [item.fileId, ...item.duplicateFileIds]) {
          await applyAgentProposalFile(item.proposalId, fileId);
        }
      }

      setNotice(strings.review.applied);
    } finally {
      setPendingReviewDiscarding(false);
      logReviewNavigation("bulk_accept_pending_changes_finish", { count: items.length });
    }
  }, [
    applyAgentProposalFile,
    pendingReviewDiscarding,
    reviewQueue.items,
    setNotice,
    strings.review.applied
  ]);
  const rejectPendingTreeChanges = useCallback(async () => {
    const items = reviewQueue.items;

    if (items.length === 0 || pendingReviewDiscarding) {
      return;
    }

    logReviewNavigation("bulk_reject_pending_changes_start", {
      count: items.length,
      items: items.map((item) => ({
        proposalId: item.proposalId,
        fileId: item.fileId,
        kind: item.kind,
        relativePath: item.relativePath,
        duplicateFileIds: item.duplicateFileIds
      }))
    });
    setPendingReviewDiscarding(true);

    const failures: string[] = [];
    const proposalIds = new Set<string>();
    let stale = false;

    try {
      // Outside items are restored as one batch in main, which continues past
      // individual failures and reports them. One failure never stops the rest.
      for (const item of items) {
        if (proposalIds.has(item.proposalId)) {
          continue;
        }

        proposalIds.add(item.proposalId);

        try {
          stale = (await rejectAgentProposal(item.proposalId)) === "stale" || stale;
        } catch (rejectError) {
          failures.push(rejectError instanceof Error ? rejectError.message : String(rejectError));
        }
      }

      if (failures.length > 0) {
        setError(failures.join(" "));
      } else if (!stale) {
        // On a stale outcome the hook already showed the refreshed-review
        // notice; nothing was discarded.
        setNotice(strings.review.discarded);
      }
    } finally {
      setPendingReviewDiscarding(false);
      logReviewNavigation("bulk_reject_pending_changes_finish", { count: items.length, failures: failures.length });
    }
  }, [
    pendingReviewDiscarding,
    rejectAgentProposal,
    reviewQueue.items,
    setNotice,
    strings.review.discarded
  ]);

  const completeDocumentClose = useCallback(() => {
    setActiveFile(null);
    setSelectedTreePath(null);
    setRevealFolderPath(null);
    setReviewRevealPath(null);
    setContentSearchRevealTarget(null);
    setRenamingPath(null);
    closeTreeContextMenu();
    setAgentReviewTarget(null);
    clearDocument();
    clearHistory();
    setCloseDialogOpen(false);
    setError(null);
  }, [clearDocument, clearHistory, closeTreeContextMenu, setAgentReviewTarget]);

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
      openNode,
      setAgentReviewTarget
    ]
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

  // `iliad open` (electron/cli): open through the normal path and reveal the
  // line with the content-search reveal, then acknowledge to main.
  const cliRevealWaitersRef = useRef(new Map<number, (revealed: boolean) => void>());
  const cliTreeRef = useRef(tree);
  cliTreeRef.current = tree;
  const cliOpenSteps = useMemo<CliOpenSteps>(
    () => ({
      findNode: async (absolutePath) => {
        const current = findNode(cliTreeRef.current, absolutePath);

        if (current || !workspace) {
          return current;
        }

        return findNode(await refreshTree(workspace.path), absolutePath);
      },
      prepareNavigation: (node) => clearReviewForNormalNavigation(node),
      openNode: (node) => openNode(node),
      revealLine: (absolutePath, line) =>
        new Promise<boolean>((resolve) => {
          const waiters = cliRevealWaitersRef.current;
          contentSearchRevealRequestIdRef.current += 1;
          const requestId = contentSearchRevealRequestIdRef.current;
          const timer = window.setTimeout(() => {
            waiters.delete(requestId);
            resolve(false);
          }, 5000);

          waiters.set(requestId, (revealed) => {
            window.clearTimeout(timer);
            waiters.delete(requestId);
            resolve(revealed);
          });
          setContentSearchRevealTarget({
            filePath: absolutePath,
            startOffset: 0,
            endOffset: 0,
            lineNumber: line,
            matchedText: "",
            requestId
          });
        })
    }),
    [clearReviewForNormalNavigation, openNode, refreshTree, workspace]
  );
  useCliBridge({
    workspacePath: workspace?.path ?? null,
    tree,
    activeDocumentPath: activeFile?.kind === "markdown" ? activeFile.path : null,
    steps: cliOpenSteps
  });

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
    clearDocument();
    clearHistory();
    setError(null);
    setNotice(null);
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
    () => effectiveSidebarMaximum(viewportWidth),
    [viewportWidth]
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

    if (sidebarResizing) {
      classes.push("is-sidebar-resizing");
    }

    return classes.join(" ");
  }, [focusMode, sidebarOpen, sidebarResizing]);
  const visibleStatus = statusText(saveStatus, lastSavedAt, strings.topbar.saveStatus);
  const shouldShowStatus = saveStatus !== "saved";
  const editorFile = virtualReviewFile ?? activeFile;
  const editorSelectionComments = useMemo<EditorSelectionCommentsProps | undefined>(() => {
    // No comments on a notes or comments file itself (spec V12).
    if (!activeFile || activeFile.kind !== "markdown" || editorFile !== activeFile || !commentsEnabled) {
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
    commentsEnabled,
    createSelectionComment,
    deleteSelectionComment,
    editorFile,
    pendingSelectionComments,
    updateSelectionComment
  ]);
  // "N detached comments" hides while the document has pending outside changes (spec V18).
  const activeFileHasPendingReview = Boolean(
    activeFile &&
      pendingTreeChanges.some(
        (change) => change.normalizedRelativePath.toLowerCase() === activeFile.relativePath.replace(/\\/g, "/").toLowerCase()
      )
  );
  const editorDetachedComments = useMemo(
    () =>
      editorSelectionComments && !activeFileHasPendingReview
        ? { comments: detachedComments, onDelete: deleteSelectionComment }
        : undefined,
    [activeFileHasPendingReview, deleteSelectionComment, detachedComments, editorSelectionComments]
  );
  const editorTighten = useMemo<EditorTightenProps | undefined>(() => {
    if (!activeFile || activeFile.kind !== "markdown" || editorFile !== activeFile) {
      return undefined;
    }

    return {
      enabled: hasGeminiKey,
      onRequestKey: requestGeminiKey,
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
  }, [activeFile, editorFile, hasGeminiKey, language, requestGeminiKey, strings.editor.tighten]);
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
      hasAiKey: hasGeminiKey,
      preferences: autocompleteOptions.preferences,
      guidance: notesText,
      snoozedUntil: autocompleteOptions.snoozedUntil,
      onPartial: window.iliad.onAutocompletePartial,
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
    autocompleteEnabled,
    correctorEnabled,
    hasGeminiKey,
    autocompleteOptions.preferences,
    notesText,
    autocompleteOptions.snoozedUntil,
    editorFile,
    language,
    strings.editor.ideaAutocomplete,
    strings.editor.writingCorrector,
    workspace?.sessionId
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
  const autocompleteStatusNote =
    autocompleteEnabled && writingAssistStatus && !writingAssistStatus.geminiKey.hasKey
      ? strings.writingAssists.autocompleteNeedsKey
      : undefined;

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
      <TooltipLayer />
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
              preferences={autocompleteOptions.preferences}
              onPreferencesChange={autocompleteOptions.setPreferences}
              onOpenNotes={() => {
                setWritingAssistsOpen(false);
                void openNotes();
              }}
              notesAvailable={notesAvailable}
              hasNotes={Boolean(notesText.trim())}
              snoozed={autocompleteOptions.snoozedUntil > Date.now()}
              onToggleSnooze={autocompleteOptions.toggleSnooze}
              onResetShortcuts={autocompleteOptions.resetShortcuts}
              labels={strings.writingAssists}
              menuRef={writingAssistsMenuRef}
              open={writingAssistsOpen}
              correctorEnabled={correctorEnabled}
              autocompleteEnabled={autocompleteEnabled}
              correctorAvailable={language === "en"}
              autocompleteNote={autocompleteStatusNote}
              geminiKey={writingAssistStatus?.geminiKey ?? null}
              onSaveGeminiKey={saveGeminiKey}
              onGetGeminiKey={openGeminiKeyPage}
              keyFieldFocusRequest={keyFieldFocusRequest}
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
              selectedPath={selectedTreePathForFileTree}
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
                logReviewNavigation("file_tree_open_node", {
                  nodeRel: node.relativePath,
                  nodeKind: node.kind,
                  relativePath: node.relativePath,
                  path: node.path,
                  kind: node.kind
                });
                            clearReviewForNormalNavigation(node);
                return openNode(node);
              }}
              onOpenPendingChange={(target) => {
                logReviewNavigation("file_tree_open_pending_change", {
                  targetProposalId: target.proposalId,
                  targetFileId: target.fileId,
                  targetKind: target.kind,
                  targetRel: target.relativePath,
                  activeRel: activeFile?.relativePath ?? null,
                  kind: target.kind,
                  relativePath: target.relativePath
                });
                return handleManualReviewTargetChange({ proposalId: target.proposalId, fileId: target.fileId });
              }}
              onRevealComplete={(path) => {
                logReviewNavigation("file_tree_reveal_completed", { revealPath: path });
                if (reviewRevealPath === path) {
                  setReviewRevealPath(null);
                }

                if (revealFolderPath === path) {
                  setRevealFolderPath(null);
                }
              }}
              onRevealFailed={(path, reason) => {
                logReviewNavigation("file_tree_reveal_failed", {
                  revealPath: path,
                  clearReason: reason
                });
              }}
              onCreateFile={createMarkdownFile}
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
              onAcceptPendingChanges={acceptPendingTreeChanges}
              onRejectPendingChanges={rejectPendingTreeChanges}
              onMoveNode={moveNode}
              onShowContextMenu={(node, position) => setTreeContextMenu({ node, ...position })}
              contextMenuOpen={Boolean(treeContextMenu)}
              onCloseContextMenu={closeTreeContextMenu}
              onCancelRename={() => setRenamingPath(null)}
              onCommitRename={renameNode}
              contentSearchProvider={fileTreeContentSearchProvider}
              companionCommentCount={activeFile && commentsEnabled ? { documentPath: activeFile.path, count: commentCount } : null}
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
            detachedComments={editorDetachedComments}
            conflict={editorConflict}
            value={editorValue}
            editorFontSize={editorFontSize}
            editorFontPreset={editorFontPreset}
            labels={strings.editor}
            review={editorReview}
            selectionComments={editorSelectionComments}
            tighten={editorTighten}
            writingAssists={editorWritingAssists}
            onChange={handleEditorChange}
            onInsertImage={insertImage}
            onInsertImageReference={insertImageReference}
            onOpenLink={openDocumentLink}
            onCreateDocument={createMarkdownFile}
            onEditorViewChange={handleEditorViewChange}
            contentSearchRevealTarget={contentSearchRevealTarget}
            onContentSearchRevealHandled={(requestId) => {
              cliRevealWaitersRef.current.get(requestId)?.(true);
              setContentSearchRevealTarget((current) => (current?.requestId === requestId ? null : current));
            }}
          />
        </EditorErrorBoundary>

      </div>

      <TreeContextMenu
        menu={treeContextMenu}
        menuRef={treeContextMenuRef}
        labels={strings.treeContextMenu}
        onCopyPath={copyNodePath}
        onOpen={(node) => {
          closeTreeContextMenu();
          clearReviewForNormalNavigation(node);
          return openNode(node);
        }}
        onDuplicate={duplicateNode}
        onMoveToTrash={moveNodeToTrash}
        onMoveToRoot={(node) => moveNode(node, workspace.path)}
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
