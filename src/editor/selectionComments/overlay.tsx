import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject
} from "react";
import type { SelectionComment } from "../../types/iliad";
import { isAnchoredSelectionComment } from "../../app/selectionCommentsAnchor";
import { anchoredOverlayPosition, type OverlayPosition } from "./positioning";

const SETTLE_DELAY_MS = 180;
const HOVER_SHOW_DELAY_MS = 300;
const HOVER_HIDE_DELAY_MS = 180;

export interface SelectionCommentsEditorLabels {
  action: string;
  composerLabel: string;
  composerPlaceholder: string;
  edit: string;
  delete: string;
}

export interface SelectionCommentsOverlayApi {
  handleMouseUp: (view: EditorView) => void;
  handleMouseMove: (event: MouseEvent, view: EditorView) => void;
  handleEditorUpdate: (update: ViewUpdate) => void;
  handleCommentShortcut: (view: EditorView) => boolean;
  handleEscape: (view: EditorView) => boolean;
}

interface SelectionCommentsOverlayProps {
  view: EditorView | null;
  comments: SelectionComment[];
  labels: SelectionCommentsEditorLabels;
  apiRef: MutableRefObject<SelectionCommentsOverlayApi | null>;
  onCreateComment: (draft: { from: number; to: number; comment: string }) => void;
  onUpdateComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  onProvisionalRangeChange: (range: { from: number; to: number } | null) => void;
}

interface ComposerState {
  from: number;
  to: number;
  anchorPos: number;
  editingId: string | null;
}

interface HoverState {
  ids: string[];
  anchorPos: number;
}

function surfaceMetricsFor(view: EditorView) {
  const surface = view.dom.closest<HTMLElement>(".editor-surface");

  if (!surface) {
    return null;
  }

  const rect = surface.getBoundingClientRect();
  return {
    rectTop: rect.top,
    rectLeft: rect.left,
    scrollTop: surface.scrollTop,
    scrollLeft: surface.scrollLeft,
    width: surface.clientWidth,
    viewportHeight: window.innerHeight
  };
}

function anchorCoords(view: EditorView, pos: number) {
  try {
    return view.coordsAtPos(Math.max(0, Math.min(pos, view.state.doc.length)));
  } catch {
    return null;
  }
}

function overlayPositionAt(
  view: EditorView,
  pos: number,
  size: { width: number; height: number },
  prefer: "above" | "below"
): OverlayPosition | null {
  const coords = anchorCoords(view, pos);
  const surface = surfaceMetricsFor(view);

  if (!coords || !surface) {
    return null;
  }

  return anchoredOverlayPosition({
    anchor: { top: coords.top, bottom: coords.bottom, left: coords.left },
    surface,
    size,
    prefer
  });
}

/**
 * Editor-anchored chrome for selection comments: the floating "Comentar"
 * action, the inline comment composer, and the hover popover. All positions
 * derive from `view.coordsAtPos()` converted into `.editor-surface` content
 * coordinates, so they travel with the document on scroll and are recomputed
 * (never cached) across layout reflows such as visualMarkdown syntax reveal.
 */
export function SelectionCommentsOverlay({
  view,
  comments,
  labels,
  apiRef,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  onProvisionalRangeChange
}: SelectionCommentsOverlayProps) {
  const [floatingPos, setFloatingPos] = useState<number | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [draft, setDraft] = useState("");
  const [hover, setHover] = useState<HoverState | null>(null);
  const [, setLayoutVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const settleTimer = useRef<number | null>(null);
  const hoverShowTimer = useRef<number | null>(null);
  const hoverHideTimer = useRef<number | null>(null);
  const composerRef = useRef<ComposerState | null>(null);
  composerRef.current = composer;
  const floatingRef = useRef<number | null>(null);
  floatingRef.current = floatingPos;
  const hoverRef = useRef<HoverState | null>(null);
  hoverRef.current = hover;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const clearTimer = (timer: MutableRefObject<number | null>) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const hideHover = useCallback(() => {
    clearTimer(hoverShowTimer);
    clearTimer(hoverHideTimer);
    setHover(null);
  }, []);

  const openComposer = useCallback(
    (from: number, to: number, anchorPos: number, editingId: string | null, initialDraft: string) => {
      setFloatingPos(null);
      hideHover();
      setComposer({ from, to, anchorPos, editingId });
      setDraft(initialDraft);

      // The provisional wash marks the range the moment composing starts, so
      // the user never types about unmarked text. Editing keeps its own wash.
      if (!editingId) {
        onProvisionalRangeChange({ from, to });
      }
    },
    [hideHover, onProvisionalRangeChange]
  );

  const closeComposer = useCallback(
    (save: boolean) => {
      const current = composerRef.current;

      if (!current) {
        return;
      }

      const text = draft.trim();

      if (save && text) {
        if (current.editingId) {
          onUpdateComment(current.editingId, text);
        } else {
          onCreateComment({ from: current.from, to: current.to, comment: text });
        }
      }

      onProvisionalRangeChange(null);
      setComposer(null);
      setDraft("");
      view?.focus();
    },
    [draft, onCreateComment, onProvisionalRangeChange, onUpdateComment, view]
  );

  const closeComposerRef = useRef(closeComposer);
  closeComposerRef.current = closeComposer;

  const handleMouseUp = useCallback((mouseUpView: EditorView) => {
    clearTimer(settleTimer);
    // Mouseup-only, after a settle delay: keyboard and programmatic selections
    // never summon the action, and it never appears mid-drag.
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;

      if (composerRef.current) {
        return;
      }

      const selection = mouseUpView.state.selection.main;

      if (selection.empty) {
        return;
      }

      if (!mouseUpView.state.sliceDoc(selection.from, selection.to).trim()) {
        return;
      }

      setFloatingPos(selection.head);
    }, SETTLE_DELAY_MS);
  }, []);

  const handleEditorUpdate = useCallback(
    (update: ViewUpdate) => {
      if (update.docChanged) {
        clearTimer(settleTimer);
        setFloatingPos(null);
        hideHover();

        if (composerRef.current) {
          // A document edit invalidates the range being composed: cancel.
          onProvisionalRangeChange(null);
          setComposer(null);
          setDraft("");
        }

        return;
      }

      if (update.selectionSet) {
        // Dismiss on selection change — but never on scroll.
        clearTimer(settleTimer);
        setFloatingPos(null);
      }

      if (update.geometryChanged) {
        // Layout reflowed (e.g. syntax reveal): recompute anchored positions.
        setLayoutVersion((version) => version + 1);
      }
    },
    [hideHover, onProvisionalRangeChange]
  );

  const handleCommentShortcut = useCallback(
    (shortcutView: EditorView) => {
      const selection = shortcutView.state.selection.main;

      if (!selection.empty && shortcutView.state.sliceDoc(selection.from, selection.to).trim()) {
        openComposer(selection.from, selection.to, selection.head, null, "");
        return true;
      }

      const cursor = selection.head;
      const target = commentsRef.current.find(
        (comment) =>
          comment.status === "pending" &&
          isAnchoredSelectionComment(comment) &&
          cursor >= comment.from &&
          cursor <= comment.to
      );

      if (target) {
        openComposer(target.from, target.to, target.from, target.id, target.comment);
        return true;
      }

      return false;
    },
    [openComposer]
  );

  const handleEscape = useCallback(() => {
    if (composerRef.current) {
      closeComposerRef.current(false);
      return true;
    }

    if (floatingRef.current !== null) {
      clearTimer(settleTimer);
      setFloatingPos(null);
      return true;
    }

    if (hoverRef.current) {
      hideHover();
      return true;
    }

    return false;
  }, [hideHover]);

  const handleMouseMove = useCallback(
    (event: MouseEvent, moveView: EditorView) => {
      if (composerRef.current) {
        return;
      }

      const pos = moveView.posAtCoords({ x: event.clientX, y: event.clientY });
      const hovered =
        pos === null
          ? []
          : commentsRef.current.filter(
              (comment) =>
                comment.status === "pending" &&
                isAnchoredSelectionComment(comment) &&
                pos >= comment.from &&
                pos <= comment.to
            );

      if (hovered.length === 0) {
        clearTimer(hoverShowTimer);

        if (hoverRef.current && hoverHideTimer.current === null) {
          hoverHideTimer.current = window.setTimeout(() => {
            hoverHideTimer.current = null;
            setHover(null);
          }, HOVER_HIDE_DELAY_MS);
        }

        return;
      }

      clearTimer(hoverHideTimer);
      const ids = hovered.map((comment) => comment.id);
      const anchorPos = Math.min(...hovered.map((comment) => comment.from));
      const current = hoverRef.current;

      if (current && current.ids.join("|") === ids.join("|")) {
        return;
      }

      if (current) {
        setHover({ ids, anchorPos });
        return;
      }

      if (hoverShowTimer.current === null) {
        hoverShowTimer.current = window.setTimeout(() => {
          hoverShowTimer.current = null;
          setHover({ ids, anchorPos });
        }, HOVER_SHOW_DELAY_MS);
      }
    },
    []
  );

  apiRef.current = {
    handleMouseUp,
    handleMouseMove,
    handleEditorUpdate,
    handleCommentShortcut,
    handleEscape
  };

  useEffect(() => {
    const ref = apiRef;

    return () => {
      ref.current = null;
    };
  }, [apiRef]);

  const onProvisionalRangeChangeRef = useRef(onProvisionalRangeChange);
  onProvisionalRangeChangeRef.current = onProvisionalRangeChange;

  useEffect(() => {
    return () => {
      clearTimer(settleTimer);
      clearTimer(hoverShowTimer);
      clearTimer(hoverHideTimer);
      // Never leave a provisional wash behind when the overlay unmounts.
      onProvisionalRangeChangeRef.current(null);
    };
  }, []);

  // Click elsewhere dismisses the floating action and cancels the composer.
  useEffect(() => {
    if (floatingPos === null && !composer) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      if (composerRef.current) {
        closeComposerRef.current(false);
      }

      clearTimer(settleTimer);
      setFloatingPos(null);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [composer, floatingPos]);

  // Auto-grow the composer textarea up to ~3 lines.
  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 66)}px`;
  }, [draft, composer]);

  if (!view) {
    return null;
  }

  const hoveredComments = hover
    ? hover.ids
        .map((id) => comments.find((comment) => comment.id === id))
        .filter((comment): comment is SelectionComment => Boolean(comment && comment.status === "pending"))
    : [];

  const floatingPosition =
    floatingPos !== null ? overlayPositionAt(view, floatingPos, { width: 96, height: 26 }, "above") : null;
  const composerPosition = composer
    ? overlayPositionAt(view, composer.anchorPos, { width: 280, height: 92 }, "below")
    : null;
  const hoverPosition =
    hoveredComments.length > 0 && hover
      ? overlayPositionAt(
          view,
          hover.anchorPos,
          { width: 300, height: Math.min(48 + hoveredComments.length * 56, 240) },
          "below"
        )
      : null;

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeComposer(false);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      closeComposer(true);
    }
  };

  return (
    <div className="editor-comment-overlay" ref={rootRef}>
      {floatingPosition ? (
        <button
          type="button"
          className="editor-comment-action"
          style={{ top: floatingPosition.top, left: floatingPosition.left }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const selection = view.state.selection.main;

            if (!selection.empty) {
              openComposer(selection.from, selection.to, selection.head, null, "");
            }
          }}
        >
          {labels.action}
        </button>
      ) : null}

      {composer && composerPosition ? (
        <div
          className="editor-comment-composer"
          style={{ top: composerPosition.top, left: composerPosition.left }}
          role="dialog"
          aria-label={labels.composerLabel}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            placeholder={labels.composerPlaceholder}
            rows={1}
            autoFocus
            aria-label={labels.composerLabel}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
          />
        </div>
      ) : null}

      {hoverPosition && hoveredComments.length > 0 ? (
        <div
          className="editor-comment-popover"
          style={{ top: hoverPosition.top, left: hoverPosition.left }}
          onMouseEnter={() => clearTimer(hoverHideTimer)}
          onMouseLeave={() => {
            clearTimer(hoverHideTimer);
            hoverHideTimer.current = window.setTimeout(() => {
              hoverHideTimer.current = null;
              setHover(null);
            }, HOVER_HIDE_DELAY_MS);
          }}
        >
          {hoveredComments.map((comment) => (
            <div className="editor-comment-popover-row" key={comment.id}>
              <p>{comment.comment}</p>
              <div className="editor-comment-popover-actions">
                <button
                  type="button"
                  onClick={() => openComposer(comment.from, comment.to, comment.from, comment.id, comment.comment)}
                >
                  {labels.edit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hideHover();
                    onDeleteComment(comment.id);
                  }}
                >
                  {labels.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
