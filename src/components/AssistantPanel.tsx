import { useMemo, useState } from "react";
import { contextFileDragMimeType } from "../assistant/contextAttachments";
import { fileBasename } from "../assistant/assistantUtils";
import {
  pendingSelectionComments,
  selectionCommentExcerpt,
  sortSelectionCommentsForDisplay
} from "../assistant/selectionComments";
import { isAnchoredSelectionComment } from "../app/selectionCommentsAnchor";
import { useAssistantRun, type AssistantRunSelectionComments } from "../assistant/useAssistantRun";
import { useMarkdownContextDocuments } from "../assistant/useMarkdownContextDocuments";
import type { ReviewTarget } from "../app/useAgentProposals";
import { AssistantComposer, type AssistantComposerSelectionComments } from "./assistant/AssistantComposer";
import { AssistantHeader } from "./assistant/AssistantHeader";
import { AssistantHistoryView } from "./assistant/AssistantHistoryView";
import { AssistantPanelView } from "./assistant/AssistantPanelView";
import { AssistantPendingProposals } from "./assistant/AssistantPendingProposals";
import { AssistantSettings } from "./assistant/AssistantSettings";
import { AssistantTranscript } from "./assistant/AssistantTranscript";
import type { AppStrings } from "../i18n/strings";
import type { AgentChangeProposal, FileTreeNode, SelectionComment, WorkspaceInfo } from "../types/iliad";

export interface AssistantPanelSelectionComments {
  /** Pending comments for the open document only — never another document's. */
  comments: SelectionComment[];
  documentName: string;
  documentPath: string;
  buildPayload: (hasTypedText: boolean) => { block: string; ids: string[]; count: number } | null;
  onMarkSent: (ids: string[]) => void;
  onRevert: (ids: string[]) => void;
  onDiscard: (id: string) => void;
  onSelect: (id: string) => void;
}

interface AssistantPanelProps {
  activeFile: FileTreeNode | null;
  documentText: string;
  fileTree: FileTreeNode[];
  labels: AppStrings["assistant"];
  language: "en" | "es";
  proposals: AgentChangeProposal[];
  selectionComments?: AssistantPanelSelectionComments;
  workspace: WorkspaceInfo;
  onProposalsChanged: (proposals: AgentChangeProposal[]) => void;
  onRejectProposal: (proposalId: string) => Promise<void>;
  onReviewTargetChange: (target: ReviewTarget | null) => void | Promise<void>;
  onAutoReviewTargetChange?: (target: ReviewTarget | null) => void | Promise<void>;
  editorNavigationChangedDuringRun?: (runId: string) => boolean;
  onRunningRunChange?: (runId: string | null) => void;
  onOpenDocumentRequest?: (relativePath: string) => void;
  editorSelection?: { from: number; to: number } | null;
  getEditorSelection?: () => { from: number; to: number } | null;
}

export function AssistantPanel({
  activeFile,
  documentText,
  fileTree,
  labels,
  language,
  proposals,
  selectionComments,
  workspace,
  onProposalsChanged,
  onRejectProposal,
  onReviewTargetChange,
  onAutoReviewTargetChange,
  editorNavigationChangedDuringRun,
  onRunningRunChange,
  onOpenDocumentRequest,
  editorSelection,
  getEditorSelection
}: AssistantPanelProps) {
  // Purely derived from props: no selection-comment state lives in this panel
  // (it unmounts when closed and in focus mode), so the chip re-derives on
  // every mount.
  const pendingComments = useMemo(
    () => (selectionComments ? pendingSelectionComments(selectionComments.comments) : []),
    [selectionComments]
  );
  const pendingCommentCount = pendingComments.length;
  const runSelectionComments = useMemo<AssistantRunSelectionComments | undefined>(
    () =>
      selectionComments
        ? {
            pendingCount: pendingCommentCount,
            buildPayload: selectionComments.buildPayload,
            onMarkSent: selectionComments.onMarkSent,
            onRevert: selectionComments.onRevert
          }
        : undefined,
    [pendingCommentCount, selectionComments]
  );

  const {
    activeThreadId,
    activeThreadTitle,
    apiKeyDraft,
    ask,
    cancel,
    chatHistoryLoading,
    chatThreads,
    clearChatHistory,
    codex,
    composerTextareaRef,
    contextAttachments,
    contextStatusText,
    dictation,
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
    remote,
    runningRunId,
    saveApiKey,
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
  } = useAssistantRun({
    activeFile,
    documentText,
    labels,
    language,
    workspace,
    selectionComments: runSelectionComments,
    onProposalsChanged,
    onReviewTargetChange,
    onAutoReviewTargetChange,
    editorNavigationChangedDuringRun,
    onRunningRunChange,
    onOpenDocumentRequest,
    editorSelection,
    getEditorSelection
  });

  const [historyOpen, setHistoryOpen] = useState(false);
  const overlayOpen = historyOpen || settingsOpen;
  const markdownContextDocuments = useMarkdownContextDocuments(workspace, fileTree);

  const openHistory = () => {
    setSettingsOpen(false);
    if (!historyOpen) {
      void refreshChatThreads();
    }
    setHistoryOpen((open) => !open);
  };

  const toggleSettings = () => {
    setHistoryOpen(false);
    setSettingsOpen((open) => !open);
  };

  const clearHistory = async () => {
    if (!window.confirm(labels.history.clearConfirm)) {
      return;
    }

    await clearChatHistory();
    setHistoryOpen(false);
  };

  const selectThread = (threadId: string) => {
    void loadChatThread(threadId).then(() => setHistoryOpen(false));
  };

  const hasActiveMarkdown = activeFile?.kind === "markdown";
  const promptPlaceholder = hasActiveMarkdown ? labels.promptPlaceholder : labels.promptPlaceholderNoFile;
  // An empty prompt may be sent when selection comments are pending.
  const sendDisabledReason = dictation.isBusy
    ? dictation.status === "recording"
      ? labels.dictation.stopBeforeSending
      : labels.dictation.transcribing
    : !prompt.trim() && pendingCommentCount === 0
      ? labels.promptRequired
      : undefined;
  const contextFileName = hasActiveMarkdown ? fileBasename(activeFile.relativePath) : null;
  const contextFilePath = hasActiveMarkdown ? activeFile.relativePath : null;
  const composerSelectionComments = useMemo<AssistantComposerSelectionComments | undefined>(() => {
    if (!selectionComments || pendingCommentCount === 0) {
      return undefined;
    }

    return {
      count: pendingCommentCount,
      documentName: selectionComments.documentName,
      documentPath: selectionComments.documentPath,
      items: sortSelectionCommentsForDisplay(pendingComments).map((comment) => ({
        id: comment.id,
        excerpt: selectionCommentExcerpt(comment.quote),
        comment: comment.comment,
        anchored: isAnchoredSelectionComment(comment)
      })),
      onDiscardItem: selectionComments.onDiscard,
      onSelectItem: selectionComments.onSelect
    };
  }, [pendingCommentCount, pendingComments, selectionComments]);

  const acceptsContextDrop = (dataTransfer: DataTransfer) =>
    Array.from(dataTransfer.types).includes(contextFileDragMimeType) || dataTransfer.files.length > 0;

  return (
    <aside
      className="assistant-panel"
      aria-label={labels.title}
      onDragOver={(event) => {
        if (!acceptsContextDrop(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!acceptsContextDrop(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        void addContextAttachmentFromDrop(event.dataTransfer);
      }}
    >
      {overlayOpen ? null : (
        <AssistantHeader
          labels={labels}
          activeThreadTitle={activeThreadTitle}
          settings={settings}
          onNewChat={newChat}
          onToggleHistory={openHistory}
          onToggleSettings={toggleSettings}
        />
      )}

      {historyOpen ? (
        <AssistantHistoryView
          activeThreadId={activeThreadId}
          disabled={Boolean(runningRunId)}
          labels={labels}
          loading={chatHistoryLoading}
          threads={chatThreads}
          onBack={() => setHistoryOpen(false)}
          onClear={() => void clearHistory()}
          onSelect={selectThread}
        />
      ) : settingsOpen ? (
        <AssistantPanelView title={labels.settings} backLabel={labels.history.back} onBack={() => setSettingsOpen(false)}>
          <AssistantSettings
            apiKeyDraft={apiKeyDraft}
            codex={codex}
            labels={labels}
            mode={mode}
            modelDraft={modelDraft}
            remote={remote}
            settings={settings}
            onApiKeyDraftChange={setApiKeyDraft}
            onModeChange={setMode}
            onModelDraftChange={setModelDraft}
            onSaveApiKey={() => void saveApiKey()}
          />
        </AssistantPanelView>
      ) : (
        <>
          <AssistantPendingProposals
            labels={labels}
            proposals={proposals}
            onRejectProposal={onRejectProposal}
            onReviewTargetChange={onReviewTargetChange}
          />

          <AssistantTranscript
            entries={entries}
            labels={labels}
            runActivities={runActivities}
            runningRunId={runningRunId}
            streamingText={streamingText}
            transcriptRef={transcriptRef}
            onScroll={handleTranscriptScroll}
          />
        </>
      )}

      {overlayOpen ? null : (
        <AssistantComposer
          contextFileName={contextFileName}
          contextFilePath={contextFilePath}
          contextAttachments={contextAttachments}
          contextDocuments={markdownContextDocuments.files}
          contextDocumentsTruncated={markdownContextDocuments.truncated}
          contextStatusText={contextStatusText}
          labels={labels}
          dictation={dictation}
          highlightedContextAttachmentId={highlightedContextAttachmentId}
          prompt={prompt}
          promptPlaceholder={promptPlaceholder}
          runningRunId={runningRunId}
          selectionChip={
            selectionChip
              ? {
                  label: labels.context.selectionChip(selectionChip.lineStart, selectionChip.lineEnd),
                  tooltip: labels.context.selection(selectionChip.lineStart, selectionChip.lineEnd)
                }
              : null
          }
          onDismissSelectionChip={dismissSelectionChip}
          selectionComments={composerSelectionComments}
          sendDisabled={dictation.isBusy || (!prompt.trim() && pendingCommentCount === 0)}
          sendDisabledReason={sendDisabledReason}
          textareaRef={composerTextareaRef}
          onAddContextAttachment={addContextAttachment}
          onAsk={ask}
          onCancel={cancel}
          onPromptChange={setPrompt}
          onRemoveContextAttachment={removeContextAttachment}
          onRemoveLastContextAttachment={removeLastContextAttachment}
        />
      )}
    </aside>
  );
}
