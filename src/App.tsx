import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { EditorPane, type EditorSelectionCommentsProps } from "./components/EditorPane";
import { IliadMark } from "./components/IliadMark";
import { AssistantPanel, type AssistantPanelSelectionComments } from "./components/AssistantPanel";
import { FileTree } from "./components/FileTree";
import { LanguageMenu } from "./components/LanguageMenu";
import { TreeContextMenu, type TreeContextMenuState } from "./components/TreeContextMenu";
import { TypographyMenu } from "./components/TypographyMenu";
import { scrollEditorToPosition } from "./editor/selectionComments/scroll";
import { useFileActions } from "./files/fileActions";
import { findNodeByRelativePath } from "./files/fileTree";
import { useAppLanguage } from "./i18n/appLanguage";
import { useEditorPreferences } from "./preferences/editorPreferences";
import type { EditorView } from "@codemirror/view";
import type { FileTreeNode, WorkspaceInfo } from "./types/iliad";

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

export default function App() {
  const { language, setLanguage, t: strings } = useAppLanguage();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { isInitializing, workspace, setWorkspace, tree, setTree, refreshTree, recentWorkspaces, pruneRecentWorkspace } =
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [revealFolderPath, setRevealFolderPath] = useState<string | null>(null);
  const [reviewRevealPath, setReviewRevealPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const typographyMenuRef = useRef<HTMLDivElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const closeDocumentInFlightRef = useRef(false);
  const runningAssistantRunIdRef = useRef<string | null>(null);
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
    recordNormalNavigation
  } = useDocumentHistory(tree);
  const {
    createFolder,
    createMarkdownFile,
    creatingFile,
    creatingFolder,
    duplicateNode,
    insertImage,
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
    rejectAgentProposal,
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

  const completeDocumentClose = useCallback(() => {
    setActiveFile(null);
    setSelectedTreePath(null);
    setRevealFolderPath(null);
    setReviewRevealPath(null);
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

  const resetForWorkspaceSwitch = useCallback(() => {
    setActiveFile(null);
    setSelectedTreePath(null);
    setRevealFolderPath(null);
    setReviewRevealPath(null);
    setRenamingPath(null);
    closeTreeContextMenu();
    setAgentProposals([]);
    setAgentReviewTarget(null);
    clearDocument();
    clearHistory();
    setError(null);
    setNotice(null);
    setAssistantOpen(false);
    setLanguageOpen(false);
    setTypographyOpen(false);
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
  }, [flushSave, isInitializing, language, refreshTree, resetForWorkspaceSwitch, setTree, setWorkspace]);

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
    [flushSave, isInitializing, pruneRecentWorkspace, resetForWorkspaceSwitch, setTree, setWorkspace, strings.workspaceMessages]
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

    return classes.join(" ");
  }, [assistantOpen, focusMode, sidebarOpen]);
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
  const editorValue = activeReview?.file.kind === "create_file" ? activeReview.file.content : documentText;
  const documentTabLabel = markdownDisplayName(activeFile, strings.appName);
  const sidebarToggleLabel = sidebarOpen ? strings.topbar.hideFileTree : strings.topbar.showFileTree;
  const backLabel = backTarget
    ? strings.topbar.backTo(markdownDisplayName(backTarget.node, strings.appName))
    : strings.topbar.noPreviousDocument;
  const forwardLabel = forwardTarget
    ? strings.topbar.forwardTo(markdownDisplayName(forwardTarget.node, strings.appName))
    : strings.topbar.noNextDocument;
  const focusModeLabel = focusMode ? strings.topbar.exitFocusMode : strings.topbar.focusMode;

  if (!workspace) {
    return (
      <div className="launch-screen">
        <div className="launch-panel">
          <IliadMark size={60} className="launch-mark" />
          <span className="launch-name">{strings.appName}</span>
          <h1>{isInitializing ? strings.launch.openingWorkspace : strings.launch.localMarkdownWriting}</h1>
          <button type="button" className="primary-button" onClick={openWorkspace} disabled={isInitializing}>
            <FolderOpen size={18} />
            {strings.launch.openFolder}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={shellClassName}>
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
            <div className="topbar-brand" aria-label={strings.appName}>
              {strings.appName}
            </div>
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
          <FileTree
            workspace={workspace}
            recentWorkspaces={recentWorkspaces}
            nodes={tree}
            activePath={editorFile?.path}
            selectedPath={selectedTreePath}
            pendingChanges={pendingTreeChanges}
            creatingFile={creatingFile}
            creatingFolder={creatingFolder}
            renamingPath={renamingPath}
            revealPath={reviewRevealPath ?? revealFolderPath}
            labels={strings.sidebar}
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
            onSelectNode={(node) => setSelectedTreePath(node.path)}
            onShowContextMenu={(node, position) => setTreeContextMenu({ node, ...position })}
            onCancelRename={() => setRenamingPath(null)}
            onCommitRename={renameNodeWithNavigation}
          />
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
            onActiveSelectionChange={handleActiveSelectionChange}
            onChange={handleEditorChange}
            onInsertImage={insertImage}
            onOpenLink={openDocumentLinkWithNavigation}
            onCreateDocument={createMarkdownFileWithNavigation}
            onEditorViewChange={handleEditorViewChange}
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
            editorSelection={chipEditorSelection}
            getEditorSelection={getEditorSelection}
          />
        ) : null}
      </div>

      <TreeContextMenu
        menu={treeContextMenu}
        menuRef={treeContextMenuRef}
        labels={strings.treeContextMenu}
        onDuplicate={duplicateNodeWithNavigation}
        onMoveToTrash={moveNodeToTrashWithNavigation}
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
    </div>
  );
}
