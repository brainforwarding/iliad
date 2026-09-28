import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, FolderOpen, PanelLeft } from "lucide-react";
import { Icon } from "./components/Icon";
import { useCliBridge, type CliOpenSteps } from "./app/useCliBridge";
import {
  DOCUMENT_HISTORY_SHORTCUT_LABELS,
  documentHistoryShortcut,
  useDocumentHistory,
  type DocumentHistoryDirection
} from "./app/useDocumentHistory";
import {
  documentCloseRequiresChoice,
  DocumentConflictError,
  useDocumentPersistence,
  type SaveStatus
} from "./app/useDocumentPersistence";
import { externalReviewTargetWithRevision, useOutsideReview } from "./app/useOutsideReview";
import { useSelectionComments } from "./app/useSelectionComments";
import { useSettingsPanel } from "./app/useSettingsPanel";
import { useSidebarPeek } from "./app/useSidebarPeek";
import { useWindowChrome } from "./app/useWindowChrome";
import { recentWorkspacesStorageKey, useWorkspace, workspaceStorageKey } from "./app/useWorkspace";
import { useAppUpdate } from "./app/useAppUpdate";
import { UpdateButton, UpdateConfirmPopover } from "./components/UpdateButton";
import { WhatsNewCard } from "./components/WhatsNewCard";
import { releaseNotesUrl, takeWhatsNew } from "./whatsNew/whatsNew";
import { useDocumentNaming } from "./app/useDocumentNaming";
import { applyPathRelocation } from "./app/pathRelocation";
import { BreadcrumbName } from "./components/BreadcrumbName";
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
import { TreeContextMenu, type TreeContextMenuState } from "./components/TreeContextMenu";
import { GeneralSettings, SUPPORT_URL } from "./components/settings/GeneralSettings";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { TypographySettings } from "./components/settings/TypographySettings";
import { GROQ_KEY_URL, WritingAssistsSettings } from "./components/settings/WritingAssistsSettings";
import {
  markLatestContentSearchRequestId,
  type FileTreeContentSearchProvider
} from "./files/fileTreeContentSearch";
import { fileHasMutableReview } from "./review/reviewFiles";
import { logReviewNavigation } from "./review/reviewDebug";
import { buildReviewQueueSummary, pendingFileTreeChangesFromQueue, shownFilesByProposal } from "./review/reviewQueue";
import type { ContentSearchRevealTarget } from "./editor/contentSearchReveal";
import { useFileActions, type AutoRenameOutcome } from "./files/fileActions";
import { findNode, findNodeByRelativePath } from "./files/fileTree";
import { documentBreadcrumbParts } from "./files/pathUtils";
import { isCompanionPath } from "./files/companionFiles";
import { fileNameFromRenameInput } from "./files/documentNaming";
import { useNamingCandidates, type PathRelocation } from "./preferences/namingCandidates";
import { useAppLanguage } from "./i18n/appLanguage";
import { useEditorPreferences } from "./preferences/editorPreferences";
import { recentDocumentItems, useRecentDocuments } from "./preferences/recentDocuments";
import {
  clampSidebarWidth,
  minimumSidebarWidth,
  maximumPreferredSidebarWidth,
  useSidebarWidth
} from "./preferences/sidebarPreferences";
import { TooltipLayer } from "./components/TooltipLayer";
import { useWritingAssistPreferences } from "./preferences/writingAssistPreferences";
import { useAutocompletePreferences } from "./preferences/autocompletePreferences";
import { useWritingPreferences, writingPreferencesForRequest } from "./preferences/writingPreferences";
import { builtInAiAssistsAllowed } from "./editor/aiRequestSnapshot";
import { createWarmConnectionThrottle } from "./editor/ideaAutocomplete/warmConnection";
import type { EditorView } from "@codemirror/view";
import type {
  FileTreeNode,
  MarkdownContentSearchResponse,
  WorkspaceInfo,
  WritingAssistStatus
} from "./types/iliad";

/** The running app's version (package.json, injected by Vite; main's app.getVersion() reads the same). */
const APP_VERSION = __ILIAD_VERSION__;

/** The View menu's Toggle Sidebar key (electron/main.ts), shown in the toggle's tooltip. */
const SIDEBAR_SHORTCUT_LABEL = "\u2303\u2318S";

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
    isDocumentSettled,
    loadDocument,
    noteActiveFileRelocated,
    resumeAfterConflict,
    runWithAutosavePaused
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
  // Sent with autocomplete and ✦ AI edits only (never naming or the corrector);
  // read at request time so typing in Settings never rebuilds the editor.
  const { writingPreferences, setWritingPreferences } = useWritingPreferences();
  const writingPreferencesRef = useRef(writingPreferences);
  writingPreferencesRef.current = writingPreferences;
  const requestWritingPreferences = useCallback(() => writingPreferencesForRequest(writingPreferencesRef.current), []);
  // Pinned sidebar. The hover peek (useSidebarPeek) is separate, transient state.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Right-side top-row slot; EditorPane portals into it once it exists (stage 5).
  const [topbarSlot, setTopbarSlot] = useState<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth
  );
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [revealFolderPath, setRevealFolderPath] = useState<string | null>(null);
  const [reviewRevealPath, setReviewRevealPath] = useState<string | null>(null);
  const [contentSearchRevealTarget, setContentSearchRevealTarget] = useState<ContentSearchRevealTarget | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeHandleRef = useRef<HTMLDivElement | null>(null);
  const closeDocumentInFlightRef = useRef(false);
  const latestContentSearchRequestIdRef = useRef(0);
  const contentSearchRevealRequestIdRef = useRef(0);
  const closeTreeContextMenu = useCallback(() => setTreeContextMenu(null), []);
  const {
    settingsOpen,
    settingsTab,
    settingsPanelRef,
    keyFieldFocusRequest,
    openSettings,
    closeSettings,
    toggleSettings,
    selectSettingsTab,
    requestKeyField
  } = useSettingsPanel();
  const {
    peekOpen: sidebarPeekOpen,
    closePeek: closeSidebarPeek,
    regionHandlers: sidebarPeekRegion
  } = useSidebarPeek({ enabled: !sidebarOpen, hold: Boolean(treeContextMenu) || renamingPath !== null || settingsOpen });
  const toggleSidebar = useCallback(() => {
    closeSidebarPeek();
    setSidebarOpen((open) => !open);
  }, [closeSidebarPeek]);
  const { isFullscreen } = useWindowChrome({
    onMenuCommand: (command) => {
      if (command === "toggle-sidebar") {
        toggleSidebar();
      } else if (command === "open-settings") {
        openSettings();
      }
    }
  });
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
  const { recentEntries, recordRecent, relocateRecent } = useRecentDocuments(workspace?.path ?? null);
  const handleDocumentOpened = useCallback(
    (workspaceRoot: string, node: FileTreeNode) => recordRecent(workspaceRoot, node.relativePath),
    [recordRecent]
  );
  const {
    candidates: namingCandidates,
    dropCandidate: dropNamingCandidate,
    recordCandidate: recordNamingCandidate,
    relocateCandidates: relocateNamingCandidates
  } = useNamingCandidates(workspace?.path ?? null);
  const handleDocumentCreated = useCallback(
    (workspaceRoot: string, node: FileTreeNode) => recordNamingCandidate(workspaceRoot, node.relativePath),
    [recordNamingCandidate]
  );
  // The one relocation path for renames (manual or automatic) and moves:
  // recents, Back/Forward history and naming candidates all follow.
  const handlePathRelocated = useCallback(
    (relocation: PathRelocation) =>
      applyPathRelocation(relocation, { relocateRecent, relocateHistoryPaths, relocateNamingCandidates }),
    [relocateHistoryPaths, relocateNamingCandidates, relocateRecent]
  );
  const {
    autoRenameDocument,
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
    onDocumentOpened: handleDocumentOpened,
    onPathRelocated: handlePathRelocated,
    onDocumentCreated: handleDocumentCreated,
    onActiveFileRelocated: noteActiveFileRelocated,
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

    // The banner acts on the revision it was built from; a newer one is stale.
    return externalReviewTargetWithRevision(agentProposals, workspace.path, activeFile.relativePath);
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
        void rejectAgentProposalFile(
          conflictReviewTarget.proposalId,
          conflictReviewTarget.fileId,
          conflictReviewTarget.revision
        ).catch(() => undefined);
      },
      onKeep: () => {
        if (!window.confirm(strings.editor.conflictBanner.confirmDiscard)) {
          return;
        }

        // The writer confirmed discarding the buffer: the only Keep that may
        // load disk over a conflicted buffer (spec V5).
        void applyAgentProposalFile(
          conflictReviewTarget.proposalId,
          conflictReviewTarget.fileId,
          conflictReviewTarget.revision,
          { discardBuffer: true }
        ).catch(() => undefined);
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
  const reviewedRelativePaths = useMemo(
    () => pendingTreeChanges.map((change) => change.normalizedRelativePath),
    [pendingTreeChanges]
  );
  // The auto-named document's name types itself (tree row and breadcrumb).
  const [namingAnimation, setNamingAnimation] = useState<{ path: string; id: number } | null>(null);
  const [breadcrumbRenaming, setBreadcrumbRenaming] = useState(false);
  const handleDocumentNamed = useCallback((node: FileTreeNode) => {
    setNamingAnimation({ path: node.path, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!namingAnimation) {
      return;
    }

    const timer = window.setTimeout(
      () => setNamingAnimation((current) => (current?.id === namingAnimation.id ? null : current)),
      2400
    );

    return () => window.clearTimeout(timer);
  }, [namingAnimation]);

  // Pending comment edits are written first, so the comments file main moves
  // with the document is complete (a failed write skips the rename).
  const autoRenameWithComments = useCallback(
    async (node: FileTreeNode, stem: string, expectedHash: string): Promise<AutoRenameOutcome> => {
      try {
        await flushSelectionComments();
      } catch {
        return { ok: false, reason: "failed" };
      }

      return autoRenameDocument(node, stem, expectedHash);
    },
    [autoRenameDocument, flushSelectionComments]
  );

  useDocumentNaming({
    workspace,
    activeFile,
    editorShowsActiveFile: !virtualReviewFile,
    documentText,
    saveStatus,
    tree,
    candidates: namingCandidates,
    reviewedRelativePaths,
    renaming: renamingPath !== null || breadcrumbRenaming,
    language,
    stateRef,
    isDocumentSettled,
    runWithAutosavePaused,
    autoRenameDocument: autoRenameWithComments,
    dropCandidate: dropNamingCandidate,
    onNamed: handleDocumentNamed
  });
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
  // The AI route (free / own key / blocked) and key state; main picks the route on each request.
  const [writingAssistStatus, setWritingAssistStatus] = useState<WritingAssistStatus | null>(null);
  const aiRoute = writingAssistStatus?.ai.route ?? null;
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

  const saveGroqKey = useCallback(
    async (key: string | null) => {
      const result = await window.iliad.setGroqApiKey(key);
      await refreshWritingAssistStatus();
      return result;
    },
    [refreshWritingAssistStatus]
  );

  const openGroqKeyPage = useCallback(() => {
    void window.iliad.openUrl(GROQ_KEY_URL);
  }, []);

  // A notice's "Use my key" / "Update key": Settings on the Writing tab with the key form expanded.
  const requestGroqKey = useCallback(() => {
    requestKeyField();
    void refreshWritingAssistStatus();
  }, [refreshWritingAssistStatus, requestKeyField]);

  const writingSettingsShown = settingsOpen && settingsTab === "writing";
  useEffect(() => {
    if (writingSettingsShown) {
      void refreshWritingAssistStatus();
    }
  }, [refreshWritingAssistStatus, writingSettingsShown]);

  // In-app updates (spec 2026-09-27): the footer button, Settings → General,
  // and this window's save preflight before Iliad restarts for an update.
  const pendingReviewCountRef = useRef(pendingReviewFileCount);
  pendingReviewCountRef.current = pendingReviewFileCount;
  const openGeneralSettingsForUpdateCheck = useCallback(() => openSettings("general"), [openSettings]);
  const handleUpdateSaveFailed = useCallback(
    (saveError: unknown) => {
      // Save and comment failures already show their own message; a conflict doesn't.
      if (saveError instanceof DocumentConflictError) {
        setError(strings.updates.restartSaveFailed);
      }
    },
    [strings.updates.restartSaveFailed]
  );
  const appUpdate = useAppUpdate({
    flushSave,
    hasPendingReview: () => pendingReviewCountRef.current > 0,
    onSaveFailed: handleUpdateSaveFailed,
    onMenuCheck: openGeneralSettingsForUpdateCheck
  });
  const updateButtonLabels = useMemo(
    () => ({ ...strings.updates, restartToUpdate: strings.settings.restartToUpdate }),
    [strings]
  );
  const [whatsNewEntry, setWhatsNewEntry] = useState(() =>
    takeWhatsNew({
      currentVersion: APP_VERSION,
      storage: window.localStorage,
      usedBefore: () =>
        localStorage.getItem(workspaceStorageKey) !== null || localStorage.getItem(recentWorkspacesStorageKey) !== null
    })
  );
  const whatsNewCard = whatsNewEntry ? (
    <WhatsNewCard
      entry={whatsNewEntry}
      language={language}
      labels={strings.whatsNew}
      illustrationLabels={{ settings: strings.sidebar.settings, update: strings.updates.update }}
      onClose={() => setWhatsNewEntry(null)}
      onOpenReleaseNotes={() => void window.iliad.openUrl(releaseNotesUrl(whatsNewEntry.version)).catch(() => undefined)}
    />
  ) : null;
  const updateConfirm = appUpdate.confirmOpen ? (
    <UpdateConfirmPopover labels={strings.updates} onResolve={appUpdate.resolveConfirm} />
  ) : null;

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
    let stale = false;

    try {
      // Each item carries the revision it was built from: a file that changed
      // since the tree showed it comes back stale and is left for review.
      for (const item of items) {
        for (const expected of item.files) {
          const { fileId, ...revision } = expected;
          stale = (await applyAgentProposalFile(item.proposalId, fileId, revision)) === "stale" || stale;
        }
      }

      if (!stale) {
        // On a stale outcome the hook already showed the refreshed-review notice.
        setNotice(strings.review.applied);
      }
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
    // The exact set the tree showed, per proposal: main restores nothing when
    // the pending set or any file's revision differs from it.
    const shownByProposal = shownFilesByProposal(items);
    let stale = false;

    try {
      // Outside items are restored as one batch in main, which continues past
      // individual failures and reports them. One failure never stops the rest.
      for (const [proposalId, files] of shownByProposal) {
        try {
          stale = (await rejectAgentProposal(proposalId, files)) === "stale" || stale;
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
    closeSettings({ restoreFocus: false });
  }, [
    clearDocument,
    clearHistory,
    closeSettings,
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

  // The breadcrumb's rename field belongs to one document shown with the sidebar hidden.
  useEffect(() => {
    setBreadcrumbRenaming(false);
  }, [activeFile?.path, sidebarOpen]);

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

        // Settings closes first (it may sit over the peek) and hands focus back.
        if (settingsOpen) {
          closeSettings();
          return;
        }

        // Escape with the peek showing hides only the peek.
        if (sidebarPeekOpen) {
          closeSidebarPeek();
          return;
        }

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
        return;
      }

      const newDocumentShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === "n" || event.key === "N");

      if (newDocumentShortcut && !event.defaultPrevented && !event.repeat && !event.isComposing) {
        event.preventDefault();
        void createMarkdownFile();
        return;
      }

      // ⌘[ / ⌘]: the editor leaves these keys to the app (CodeMirrorHost).
      const historyDirection = documentHistoryShortcut(event);

      if (historyDirection) {
        event.preventDefault();
        void navigateDocumentHistory(historyDirection);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeFile,
    closeDialogOpen,
    closeSettings,
    closeSidebarPeek,
    closeTreeContextMenu,
    createMarkdownFile,
    navigateDocumentHistory,
    openWorkspace,
    requestCloseDocument,
    settingsOpen,
    sidebarPeekOpen
  ]);

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

    if (!sidebarOpen) {
      classes.push("sidebar-is-collapsed");
    }

    if (!sidebarOpen && sidebarPeekOpen) {
      classes.push("sidebar-is-peeking");
    }

    if (isFullscreen) {
      classes.push("is-fullscreen");
    }

    if (sidebarResizing) {
      classes.push("is-sidebar-resizing");
    }

    return classes.join(" ");
  }, [isFullscreen, sidebarOpen, sidebarPeekOpen, sidebarResizing]);
  const visibleStatus = statusText(saveStatus, lastSavedAt, strings.topbar.saveStatus);
  const shouldShowStatus = saveStatus !== "saved";
  const editorFile = virtualReviewFile ?? activeFile;
  // Empty state G: the day labels are computed when the list changes; a list
  // left open past midnight keeps yesterday's labels until the next change.
  const recentDocuments = useMemo(
    () =>
      recentDocumentItems(recentEntries, tree, new Date(), language, {
        today: strings.editor.emptyToday,
        yesterday: strings.editor.emptyYesterday
      }),
    [language, recentEntries, strings.editor.emptyToday, strings.editor.emptyYesterday, tree]
  );
  const openRecentDocument = useCallback(
    (relativePath: string) => {
      const node = findNodeByRelativePath(tree, relativePath);

      if (node?.kind !== "markdown") {
        return;
      }

      // Same path as a tree click: leave a normal review, then open (the
      // open flushes the pending save first and stops if it fails).
      clearReviewForNormalNavigation(node);
      void openNode(node);
    },
    [clearReviewForNormalNavigation, openNode, tree]
  );
  const editorSelectionComments = useMemo<EditorSelectionCommentsProps | undefined>(() => {
    // No comments on a comments file itself (spec V12).
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
    // No ✦ AI edits inside a comments companion (spec 2026-09-27).
    if (!activeFile || activeFile.kind !== "markdown" || editorFile !== activeFile || !builtInAiAssistsAllowed(activeFile.path)) {
      return undefined;
    }

    return {
      enabled: true,
      onRequestKey: requestGroqKey,
      route: aiRoute,
      language,
      noticeLabels: strings.editor.aiNotices,
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
          instruction: options?.instruction,
          document: options?.document,
          preferences: requestWritingPreferences()
        }),
      cancel: (requestId) => window.iliad.cancelTighten(requestId)
    };
  }, [activeFile, aiRoute, editorFile, language, requestGroqKey, requestWritingPreferences, strings.editor.aiNotices, strings.editor.tighten]);
  // One throttle for the app: typing and focus keep the AI connection warm, at most one IPC a minute.
  const warmWritingAiConnection = useMemo(() => createWarmConnectionThrottle(() => window.iliad.warmWritingAi?.()), []);
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
      aiAssistsAvailable: builtInAiAssistsAllowed(activeFile.path),
      writingPreferences: requestWritingPreferences,
      aiRoute,
      warmConnection: aiRoute && aiRoute !== "blocked" ? warmWritingAiConnection : undefined,
      onRequestAiKey: requestGroqKey,
      preferences: autocompleteOptions.preferences,
      onPartial: window.iliad.onAutocompletePartial,
      language,
      workspaceSessionId,
      documentRelativePath,
      labels: {
        corrector: strings.editor.writingCorrector,
        autocomplete: strings.editor.ideaAutocomplete,
        aiNotices: strings.editor.aiNotices
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
    aiRoute,
    requestGroqKey,
    requestWritingPreferences,
    strings.editor.aiNotices,
    autocompleteOptions.preferences,
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
  const breadcrumbParts = editorFile ? documentBreadcrumbParts(workspace?.name ?? "", editorFile.relativePath) : [];
  // Only the real open document renames from the breadcrumb (no review ghosts, companions or pending reviews).
  const breadcrumbCanRename = Boolean(
    activeFile &&
      activeFile.kind === "markdown" &&
      editorFile === activeFile &&
      !isCompanionPath(activeFile.path) &&
      !activeFileHasPendingReview
  );
  const commitBreadcrumbRename = (value: string) => {
    setBreadcrumbRenaming(false);

    if (!activeFile) {
      return;
    }

    const nextName = fileNameFromRenameInput(activeFile, value);

    if (nextName && nextName !== activeFile.name) {
      void renameNode(activeFile, nextName);
    }
  };
  const sidebarToggleLabel = sidebarOpen ? strings.topbar.hideSidebar : strings.topbar.showSidebar;
  const backLabel = backTarget ? strings.topbar.backTo(markdownDisplayName(backTarget.node, strings.appName)) : "";
  const forwardLabel = forwardTarget ? strings.topbar.forwardTo(markdownDisplayName(forwardTarget.node, strings.appName)) : "";

  if (!workspace) {
    return (
      <div className="launch-screen">
        <div className="launch-panel">
          <ClipMark size={60} className="launch-mark" />
          <span className="launch-name">{strings.appName}</span>
          <h1>{isInitializing ? strings.launch.openingWorkspace : strings.launch.localMarkdownWriting}</h1>
          <button type="button" className="primary-button" onClick={openWorkspace} disabled={isInitializing}>
            <Icon icon={FolderOpen} />
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

        {whatsNewCard}
      </div>
    );
  }

  const fileTree = (
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
      onCreateFolder={() => void createFolder()}
      onOpenFolder={openWorkspace}
      onOpenRecent={openRecentWorkspace}
      onRevealWorkspace={() => void window.iliad.revealInFinder(workspace.path, workspace.path)}
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
      onStartRename={startRenameFromContextMenu}
      namingAnimation={namingAnimation}
      contentSearchProvider={fileTreeContentSearchProvider}
      companionCommentCount={activeFile && commentsEnabled ? { documentPath: activeFile.path, count: commentCount } : null}
      onOpenSettings={toggleSettings}
      settingsOpen={settingsOpen}
      footerAccessory={
        <UpdateButton
          state={appUpdate.state}
          labels={updateButtonLabels}
          confirming={appUpdate.confirmOpen}
          onInstall={appUpdate.install}
          onOpenDownload={appUpdate.openDownload}
        />
      }
    />
  );

  return (
    <div ref={appShellRef} className={shellClassName} style={shellStyle}>
      <TooltipLayer />
      <header className="app-topbar">
        <div className="topbar-sidebar-zone" {...sidebarPeekRegion("topbar")}>
          <div className="topbar-navigation">
            <button
              type="button"
              className="icon-button"
              data-tooltip={sidebarToggleLabel}
              data-tooltip-shortcut={SIDEBAR_SHORTCUT_LABEL}
              aria-label={sidebarToggleLabel}
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
              {...sidebarPeekRegion("toggle")}
            >
              <Icon icon={PanelLeft} />
            </button>
            {/* Back/Forward appear only when there is somewhere to go; they sit
                after the toggle, so the toggle never moves. */}
            {canGoBack ? (
              <button
                type="button"
                className="icon-button topbar-history-button"
                data-tooltip={backLabel}
                data-tooltip-shortcut={DOCUMENT_HISTORY_SHORTCUT_LABELS.back}
                aria-label={backLabel}
                onClick={() => void navigateDocumentHistory("back")}
              >
                <Icon icon={ArrowLeft} />
              </button>
            ) : null}
            {canGoForward ? (
              <button
                type="button"
                className="icon-button topbar-history-button"
                data-tooltip={forwardLabel}
                data-tooltip-shortcut={DOCUMENT_HISTORY_SHORTCUT_LABELS.forward}
                aria-label={forwardLabel}
                onClick={() => void navigateDocumentHistory("forward")}
              >
                <Icon icon={ArrowRight} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-editor-zone">
          {!sidebarOpen && !sidebarPeekOpen && breadcrumbParts.length > 0 ? (
            <nav className="topbar-breadcrumb" aria-label={strings.topbar.documentLocation}>
              <bdi className="topbar-breadcrumb-path">
                {breadcrumbParts.map((part, index) =>
                  index === breadcrumbParts.length - 1 ? (
                    <BreadcrumbName
                      key={`${index}:current`}
                      name={part}
                      typingKey={namingAnimation && namingAnimation.path === editorFile?.path ? namingAnimation.id : null}
                      canRename={breadcrumbCanRename}
                      renaming={breadcrumbRenaming}
                      renameLabel={strings.sidebar.rename(part)}
                      onStartRename={() => setBreadcrumbRenaming(true)}
                      onCancelRename={() => setBreadcrumbRenaming(false)}
                      onCommitRename={commitBreadcrumbRename}
                    />
                  ) : (
                    <span key={`${index}:${part}`} className="topbar-breadcrumb-part">
                      {part}
                    </span>
                  )
                )}
              </bdi>
            </nav>
          ) : null}
          <div ref={setTopbarSlot} className="topbar-slot" />
          <div className="topbar-actions">
            {shouldShowStatus && visibleStatus ? <span className="document-save-state">{visibleStatus}</span> : null}
          </div>
        </div>
      </header>

      {!sidebarOpen ? <div className="sidebar-peek-edge" aria-hidden="true" {...sidebarPeekRegion("edge")} /> : null}
      {!sidebarOpen && sidebarPeekOpen ? (
        <div id={sidebarRegionId} className="sidebar-frame sidebar-peek" {...sidebarPeekRegion("sidebar")}>
          {fileTree}
        </div>
      ) : null}

      <div className="app-content">
        {sidebarOpen ? (
          <div id={sidebarRegionId} className="sidebar-frame">
            {fileTree}
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
            recentDocuments={editorFile ? undefined : recentDocuments}
            onOpenRecentDocument={openRecentDocument}
            topbarSlot={topbarSlot}
            onEditorViewChange={handleEditorViewChange}
            contentSearchRevealTarget={contentSearchRevealTarget}
            onContentSearchRevealHandled={(requestId) => {
              cliRevealWaitersRef.current.get(requestId)?.(true);
              setContentSearchRevealTarget((current) => (current?.requestId === requestId ? null : current));
            }}
          />
        </EditorErrorBoundary>

      </div>

      {settingsOpen ? (
        <SettingsPanel
          labels={strings.settings}
          tab={settingsTab}
          onSelectTab={selectSettingsTab}
          panelRef={settingsPanelRef}
        >
          {settingsTab === "general" ? (
            <GeneralSettings
              labels={{ ...strings.settings, english: strings.language.english, spanish: strings.language.spanish }}
              language={language}
              onSetLanguage={setLanguage}
              version={APP_VERSION}
              update={appUpdate.state}
              onCheckForUpdates={appUpdate.check}
              onInstallUpdate={appUpdate.install}
              onOpenDownload={appUpdate.openDownload}
              onOpenReleaseNotes={appUpdate.openReleaseNotes}
              onOpenSupport={() => void window.iliad.openUrl(SUPPORT_URL).catch(() => undefined)}
            />
          ) : settingsTab === "typography" ? (
            <TypographySettings
              editorFontPreset={editorFontPreset}
              editorFontSize={editorFontSize}
              labels={{ ...strings.typography, font: strings.settings.font, size: strings.settings.size, sizeValue: strings.settings.sizeValue }}
              onReset={resetEditorPreferences}
              onSetFontPreset={setEditorFontPreset}
              onSetFontSize={setEditorFontSize}
            />
          ) : (
            <WritingAssistsSettings
              preferences={autocompleteOptions.preferences}
              onPreferencesChange={autocompleteOptions.setPreferences}
              onResetShortcuts={autocompleteOptions.resetShortcuts}
              writingPreferences={writingPreferences}
              onWritingPreferencesChange={setWritingPreferences}
              labels={strings.writingAssists}
              correctorEnabled={correctorEnabled}
              autocompleteEnabled={autocompleteEnabled}
              correctorAvailable={language === "en"}
              groqKey={writingAssistStatus?.groqKey ?? null}
              onSaveGroqKey={saveGroqKey}
              onGetGroqKey={openGroqKeyPage}
              onOpenPrivacy={() => void window.iliad.openUrl(strings.writingAssists.privacyUrl)}
              onRecordingShortcutChange={(recording) => void window.iliad.setRecordingShortcut(recording).catch(() => undefined)}
              keyFieldFocusRequest={keyFieldFocusRequest}
              onSetCorrectorEnabled={setCorrectorEnabled}
              onSetAutocompleteEnabled={setAutocompleteEnabled}
            />
          )}
        </SettingsPanel>
      ) : null}

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
        onNewFolder={(node) => {
          closeTreeContextMenu();
          return createFolder(node.path);
        }}
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

      {updateConfirm}
      {whatsNewCard}
    </div>
  );
}
