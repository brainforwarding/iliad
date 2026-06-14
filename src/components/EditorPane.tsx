import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiReviewExtension } from "../editor/aiReview/extension";
import { reviewHunksForDisplay, type DisplayReviewHunk } from "../editor/aiReview/diff";
import type { EditorReviewState } from "../editor/aiReview/types";
import { imageDropPasteExtension } from "../editor/imageDropPaste";
import {
  selectionCommentsExtension,
  type SelectionCommentPositionUpdate,
  type SelectionCommentWashRange
} from "../editor/selectionComments/extension";
import {
  SelectionCommentsOverlay,
  type SelectionCommentsEditorLabels,
  type SelectionCommentsOverlayApi,
  type TightenOverlayLabels
} from "../editor/selectionComments/overlay";
import { visualMarkdown } from "../editor/visualMarkdown";
import type { TightenInlineReview } from "../editor/tightenSafeRange";
import type { EditorFontPreset } from "../preferences/editorPreferences";
import type { FileTreeNode, SelectionComment, TightenResult } from "../types/iliad";
import { ClipMark } from "./ClipMark";
import { FilePlus } from "lucide-react";

export interface EditorSelectionCommentsProps {
  comments: SelectionComment[];
  onCreateComment: (draft: { from: number; to: number; comment: string }) => void;
  onUpdateComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  onPositionsChanged: (documentPath: string, updates: SelectionCommentPositionUpdate[]) => void;
  onFullReplacement: (documentPath: string, documentText: string) => void;
}

export interface EditorTightenProps {
  enabled: boolean;
  minChars: number;
  maxChars: number;
  labels: TightenOverlayLabels;
  run: (
    requestId: string,
    text: string,
    selection: { from: number; to: number },
    options?: { mode?: "tighten" | "edit"; instruction?: string }
  ) => Promise<TightenResult>;
  cancel: (requestId: string) => void;
}

interface EditorPaneProps {
  file: FileTreeNode | null;
  /** Reports the live main selection (ADR-0017); null when empty/whitespace. */
  onActiveSelectionChange?: (range: { from: number; to: number } | null) => void;
  value: string;
  editorFontSize: number;
  editorFontPreset: EditorFontPreset;
  labels: {
    emptyTitle: string;
    emptyNewDocument: string;
    visualMarkdown: {
      markdownImage: string;
      youtubeVideo: string;
      markTaskIncomplete: string;
      markTaskComplete: string;
    };
    selectionComments: SelectionCommentsEditorLabels;
    reviewToolbar: {
      changes: (count: number) => string;
      previous: string;
      next: string;
      acceptAll: string;
      rejectAll: string;
      rejectRemaining: string;
      create: string;
      discard: string;
      stale: string;
      acceptChange: string;
      rejectChange: string;
      pendingDocument: (path: string) => string;
    };
  };
  review: EditorReviewState | null;
  selectionComments?: EditorSelectionCommentsProps;
  tighten?: EditorTightenProps;
  onChange: (value: string) => void;
  onInsertImage: (file: File) => Promise<string>;
  onOpenLink: (href: string) => void | Promise<void>;
  onCreateDocument?: () => void;
  onEditorViewChange?: (view: EditorView) => void;
}

const fontStacks: Record<EditorFontPreset, string> = {
  serif: "'Iowan Old Style', 'New York', ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  sans: "'Avenir Next', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"
};

function lineNumberAt(text: string, offset: number) {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));

  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }

  return line;
}

function splitReviewLines(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function createEditorTheme(editorFontSize: number, editorFontPreset: EditorFontPreset) {
  const fontStack = fontStacks[editorFontPreset];

  return EditorView.theme({
    "&": {
      "--editor-body-font": fontStack,
      "--editor-heading-font": fontStack,
      backgroundColor: "var(--editor)",
      color: "var(--ink-1)",
      minHeight: "100%",
      fontSize: `${editorFontSize}px`
    },
    ".cm-scroller": {
      fontFamily: "var(--editor-body-font)",
      lineHeight: editorFontPreset === "mono" ? "1.58" : "1.62",
      overflow: "auto",
      padding: "112px 0 80px"
    },
    ".cm-content": {
      maxWidth: "760px",
      minHeight: "auto",
      margin: "0 auto",
      padding: "0 44px 36vh",
      caretColor: "var(--accent)"
    },
    ".cm-focused": {
      outline: "none"
    },
    ".cm-line": {
      padding: "1px 0"
    },
    ".cm-activeLine": {
      backgroundColor: "transparent"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--selection-wash)"
    },
    ".cm-content ::selection": {
      backgroundColor: "var(--selection-wash)"
    },
    ".cm-gutters": {
      display: "none"
    }
  });
}

export function EditorPane({
  file,
  onActiveSelectionChange,
  value,
  editorFontSize,
  editorFontPreset,
  labels,
  review,
  selectionComments,
  tighten,
  onChange,
  onInsertImage,
  onOpenLink,
  onCreateDocument,
  onEditorViewChange
}: EditorPaneProps) {
  const editorTheme = useMemo(
    () => createEditorTheme(editorFontSize, editorFontPreset),
    [editorFontPreset, editorFontSize]
  );
  const editReviewDisplay = useMemo(() => {
    if (!review || review.mode !== "edit_file") {
      return null;
    }

    return reviewHunksForDisplay(review.currentContent, review.file);
  }, [review]);
  const unresolvedHunks = editReviewDisplay?.hunks ?? [];
  const readOnly = review?.mode === "create_file";
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [provisionalCommentRange, setProvisionalCommentRange] = useState<{ from: number; to: number } | null>(null);
  const [provisionalTightenRange, setProvisionalTightenRange] = useState<{ from: number; to: number } | null>(null);
  const [tightenReview, setTightenReview] = useState<TightenInlineReview | null>(null);
  const overlayApiRef = useRef<SelectionCommentsOverlayApi | null>(null);
  const selectionCommentRanges = useMemo<SelectionCommentWashRange[]>(() => {
    if (!selectionComments) {
      return [];
    }

    return selectionComments.comments
      .filter((comment) => (comment.status === "pending" || comment.status === "sent") && comment.to > comment.from)
      .map((comment) => ({
        id: comment.id,
        from: comment.from,
        to: comment.to,
        fading: comment.status === "sent"
      }));
  }, [selectionComments]);
  const handleOverlayMouseUp = useCallback((view: EditorView) => {
    overlayApiRef.current?.handleMouseUp(view);
  }, []);
  const handleOverlayMouseMove = useCallback((event: MouseEvent, view: EditorView) => {
    overlayApiRef.current?.handleMouseMove(event, view);
  }, []);
  const handleOverlayEditorUpdate = useCallback((update: ViewUpdate) => {
    overlayApiRef.current?.handleEditorUpdate(update);
  }, []);
  const handleOverlayShortcut = useCallback(
    (view: EditorView) => overlayApiRef.current?.handleCommentShortcut(view) ?? false,
    []
  );
  const handleOverlayEscape = useCallback(
    (view: EditorView) => overlayApiRef.current?.handleEscape(view) ?? false,
    []
  );
  const handleOverlayTightenShortcut = useCallback(
    (view: EditorView) => overlayApiRef.current?.handleTightenShortcut(view) ?? false,
    []
  );
  const handleRejectTightenReview = useCallback(() => {
    setTightenReview(null);
    setProvisionalTightenRange(null);
    editorView?.focus();
  }, [editorView]);
  const handleAcceptTightenReview = useCallback(() => {
    if (!tightenReview || !editorView || file?.path !== tightenReview.range.filePath) {
      setTightenReview(null);
      setProvisionalTightenRange(null);
      return;
    }

    const { range, rewrite } = tightenReview;

    // Stale-safe accept (ADR-0020): verify file + exact original text, then
    // dispatch synchronously (no await between check and dispatch).
    if (editorView.state.sliceDoc(range.from, range.to) !== range.originalText) {
      setTightenReview(null);
      setProvisionalTightenRange(null);
      return;
    }

    setTightenReview(null);
    setProvisionalTightenRange(null);
    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert: rewrite },
      selection: { anchor: range.from + rewrite.length }
    });
    editorView.focus();
  }, [editorView, file?.path, tightenReview]);

  const activeSelectionCallbackRef = useRef(onActiveSelectionChange);
  const lastReportedSelectionRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    activeSelectionCallbackRef.current = onActiveSelectionChange;
  }, [onActiveSelectionChange]);

  // Document switch reuses the CM instance; the old selection is meaningless.
  useEffect(() => {
    lastReportedSelectionRef.current = null;
    activeSelectionCallbackRef.current?.(null);
    setTightenReview(null);
    setProvisionalTightenRange(null);
  }, [file?.path]);

  useEffect(() => {
    if (review) {
      setTightenReview(null);
      setProvisionalTightenRange(null);
    }
  }, [review]);

  const reportActiveSelection = useCallback((update: ViewUpdate) => {
    const selection = update.state.selection.main;
    const next =
      selection.empty || !update.state.sliceDoc(selection.from, selection.to).trim()
        ? null
        : { from: selection.from, to: selection.to };
    const previous = lastReportedSelectionRef.current;

    if ((previous === null) !== (next === null) || previous?.from !== next?.from || previous?.to !== next?.to) {
      lastReportedSelectionRef.current = next;
      activeSelectionCallbackRef.current?.(next);
    }
  }, []);

  const tightenReviewHunk = useMemo<DisplayReviewHunk | null>(() => {
    if (!tightenReview) {
      return null;
    }

    const oldStartLine = lineNumberAt(value, tightenReview.range.from);
    const oldLines = splitReviewLines(tightenReview.range.originalText);
    const newLines = splitReviewLines(tightenReview.rewrite);
    const oldLineCount = Math.max(1, oldLines.length);
    const displayOldEndLine = oldStartLine + oldLineCount - 1;

    return {
      id: "tighten-inline-review",
      status: "pending",
      anchorLine: displayOldEndLine,
      oldStartLine,
      oldLines,
      newLines,
      displayOldStartLine: oldStartLine,
      displayOldEndLine,
      displayAnchorLine: displayOldEndLine
    };
  }, [tightenReview, value]);
  const tightenChangedLineRanges = useMemo(
    () => (tightenReviewHunk ? [{ from: tightenReviewHunk.displayOldStartLine, to: tightenReviewHunk.displayOldEndLine }] : []),
    [tightenReviewHunk]
  );
  const blockedLineRanges = useMemo(
    () => (review?.mode === "edit_file" ? editReviewDisplay?.changedLineRanges : tightenChangedLineRanges),
    [editReviewDisplay?.changedLineRanges, review?.mode, tightenChangedLineRanges]
  );

  const extensions = useMemo(
    () => {
      const nextExtensions = [
      markdown(),
      EditorView.lineWrapping,
      editorTheme,
      EditorView.updateListener.of(reportActiveSelection),
      visualMarkdown({
        documentPath: file?.path ?? "",
        blockedLineRanges,
        labels: labels.visualMarkdown,
        onOpenLink
      })
    ];

      if (file && selectionComments) {
        nextExtensions.push(
          selectionCommentsExtension({
            documentPath: file.path,
            ranges: selectionCommentRanges,
            provisionalRange: provisionalCommentRange,
            provisionalTightenRange,
            onPositionsChanged: selectionComments.onPositionsChanged,
            onFullReplacement: selectionComments.onFullReplacement,
            onMouseUpSelection: handleOverlayMouseUp,
            onMouseMove: handleOverlayMouseMove,
            onEditorUpdate: handleOverlayEditorUpdate,
            onCommentShortcut: handleOverlayShortcut,
            onTightenShortcut: handleOverlayTightenShortcut,
            onEscape: handleOverlayEscape
          })
        );
      }

      if (review?.mode === "edit_file" && editReviewDisplay && !editReviewDisplay.stale) {
        nextExtensions.push(
          aiReviewExtension({
            mode: "edit_file",
            hunks: editReviewDisplay.hunks,
            activeHunkId: null,
            createLineCount: 0,
            onAcceptHunk: review.onAcceptHunk,
            onRejectHunk: review.onRejectHunk,
            onOpenLink,
            renderInsertedAsSource: true,
            labels: {
              acceptChange: review.labels.acceptChange,
              rejectChange: review.labels.rejectChange
            }
          })
        );
      } else if (tightenReviewHunk) {
        nextExtensions.push(
          aiReviewExtension({
            mode: "edit_file",
            hunks: [tightenReviewHunk],
            activeHunkId: "tighten-inline-review",
            createLineCount: 0,
            renderInsertedAsSource: true,
            onAcceptHunk: handleAcceptTightenReview,
            onRejectHunk: handleRejectTightenReview,
            onOpenLink,
            labels: {
              acceptChange: labels.reviewToolbar.acceptChange,
              rejectChange: labels.reviewToolbar.rejectChange
            }
          })
        );
      }

      if (review?.mode === "create_file") {
        nextExtensions.push(
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          aiReviewExtension({
            mode: "create_file",
            hunks: [],
            activeHunkId: null,
            createLineCount: Math.max(1, review.currentContent.split(/\r\n|\r|\n/).length),
            labels: {}
          })
        );
      } else {
        nextExtensions.push(imageDropPasteExtension(onInsertImage));
      }

      return nextExtensions;
    },
    [
      editReviewDisplay,
      blockedLineRanges,
      editorTheme,
      file?.path,
      handleAcceptTightenReview,
      handleOverlayEditorUpdate,
      handleOverlayEscape,
      handleOverlayMouseMove,
      handleOverlayMouseUp,
      handleOverlayShortcut,
      handleOverlayTightenShortcut,
      handleRejectTightenReview,
      labels.visualMarkdown,
      labels.reviewToolbar.acceptChange,
      labels.reviewToolbar.rejectChange,
      onInsertImage,
      onOpenLink,
      provisionalCommentRange,
      provisionalTightenRange,
      reportActiveSelection,
      review,
      selectionCommentRanges,
      selectionComments,
      tightenReviewHunk
    ]
  );

  if (!file) {
    return (
      <main className="editor-shell">
        <div className="editor-empty">
          <ClipMark size={76} className="editor-empty__mark" />
          <h1>{labels.emptyTitle}</h1>
          {onCreateDocument ? (
            <button type="button" className="editor-empty__action" onClick={onCreateDocument}>
              <FilePlus size={16} />
              {labels.emptyNewDocument}
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="editor-shell">
      {review ? (
        <div className="editor-review-toolbar">
          {review.mode === "edit_file" ? (
            <>
              <div className="editor-review-title">
                <span className="editor-review-path">{review.file.relativePath}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {editReviewDisplay?.stale || review.file.status === "stale"
                    ? labels.reviewToolbar.stale
                    : labels.reviewToolbar.changes(unresolvedHunks.length)}
                </span>
              </div>
              <div className="editor-review-actions">
                <button
                  type="button"
                  disabled={Boolean(editReviewDisplay?.stale) || unresolvedHunks.length === 0}
                  onClick={review.onAcceptFile}
                >
                  {labels.reviewToolbar.acceptAll}
                </button>
                <button type="button" onClick={review.onRejectFile}>
                  {(review.file.hunks ?? []).some((hunk) => hunk.status === "accepted")
                    ? labels.reviewToolbar.rejectRemaining
                    : labels.reviewToolbar.rejectAll}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="editor-review-title">
                <span className="editor-review-path">{labels.reviewToolbar.pendingDocument(review.file.relativePath)}</span>
              </div>
              <div className="editor-review-actions">
                <button type="button" onClick={review.onAcceptFile}>
                  {labels.reviewToolbar.create}
                </button>
                <button type="button" onClick={review.onRejectFile}>
                  {labels.reviewToolbar.discard}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <div className="editor-surface">
        <CodeMirror
          value={value}
          basicSetup={{
            foldGutter: false,
            lineNumbers: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
            drawSelection: false,
            searchKeymap: true,
            // lintKeymap binds Mod-Shift-m to openLintPanel; the selection
            // comment shortcut owns that combination.
            lintKeymap: false
          }}
          extensions={extensions}
          onChange={readOnly ? undefined : onChange}
          onCreateEditor={(view) => {
            setEditorView(view);
            onEditorViewChange?.(view);
          }}
        />
        {selectionComments && !review ? (
          <SelectionCommentsOverlay
            view={editorView}
            comments={selectionComments.comments.filter((comment) => comment.status === "pending")}
            labels={labels.selectionComments}
            apiRef={overlayApiRef}
            onCreateComment={selectionComments.onCreateComment}
            onUpdateComment={selectionComments.onUpdateComment}
            onDeleteComment={selectionComments.onDeleteComment}
            onProvisionalRangeChange={setProvisionalCommentRange}
            tighten={
              tighten && file
                ? {
                    enabled: tighten.enabled,
                    minChars: tighten.minChars,
                    maxChars: tighten.maxChars,
                    labels: tighten.labels,
                    run: tighten.run,
                    cancel: tighten.cancel,
                    filePath: file.path,
                    onProposedRangeChange: setProvisionalTightenRange,
                    reviewActive: Boolean(tightenReview),
                    onReviewReady: setTightenReview,
                    onRejectReview: handleRejectTightenReview
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    </main>
  );
}
