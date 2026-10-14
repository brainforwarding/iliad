import type { EditorView, ViewUpdate } from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { SelectionComment } from "../../types/iliad";
import { setActiveComments, type ActiveCommentRange } from "./extension";
import { defaultMarginLayoutMetrics, layoutMarginNotes, type MarginNotePlacement } from "./layout";

export interface CommentMarginLabels {
  region: string;
  writerComment: (text: string) => string;
  aiComment: (text: string) => string;
  deleteComment: string;
  more: (count: number) => string;
  edit: string;
  delete: string;
}

export interface CommentMarginApi {
  handleEditorUpdate: (update: ViewUpdate) => void;
}

interface CommentMarginProps {
  view: EditorView | null;
  /** Pending, anchored comments of both kinds. */
  comments: SelectionComment[];
  labels: CommentMarginLabels;
  apiRef: MutableRefObject<CommentMarginApi | null>;
  onDelete: (id: string) => void;
  /** Opens the edit composer for a writer comment at its passage. */
  onEdit: (id: string) => void;
}

/** Space between the text column and the notes. */
const MARGIN_GAP = 32;
const CARD_WIDTH = 260;
const SURFACE_EDGE = 8;
const { lineHeight: LINE_HEIGHT } = defaultMarginLayoutMetrics;

interface MarginGeometry {
  left: number;
  anchorTops: Map<string, number>;
}

/**
 * Reads where the margin starts and where each passage is, in `.editor-surface`
 * content coordinates (the same space the overlay uses), so notes scroll with
 * the text. Rendered lines use `coordsAtPos`; passages outside CodeMirror's
 * rendered viewport fall back to their line block's top and become exact once
 * scrolled in (the view reports a viewport change and this runs again).
 */
function readGeometry(view: EditorView, comments: SelectionComment[]): MarginGeometry | null {
  const surface = view.dom.closest<HTMLElement>(".editor-surface");

  if (!surface) {
    return null;
  }

  const surfaceRect = surface.getBoundingClientRect();
  const toSurfaceY = (clientY: number) => clientY - surfaceRect.top + surface.scrollTop;
  const contentRect = view.contentDOM.getBoundingClientRect();
  const paddingRight = Number.parseFloat(getComputedStyle(view.contentDOM).paddingRight) || 0;
  const left = contentRect.right - paddingRight - surfaceRect.left + surface.scrollLeft + MARGIN_GAP;
  const anchorTops = new Map<string, number>();

  for (const comment of comments) {
    const pos = Math.max(0, Math.min(comment.from, view.state.doc.length));
    let top: number | null = null;

    try {
      const coords = view.coordsAtPos(pos, 1);

      if (coords) {
        // Centre the note's first line on the passage's first visual line.
        top = toSurfaceY((coords.top + coords.bottom) / 2) - LINE_HEIGHT / 2;
      }
    } catch {
      top = null;
    }

    if (top === null) {
      top = toSurfaceY(view.documentTop + view.lineBlockAt(pos).top);
    }

    anchorTops.set(comment.id, Math.round(top));
  }

  return { left, anchorTops };
}

interface OpenGroup {
  hostId: string;
  ids: string[];
}

/**
 * Comments written out in the right margin beside their passages (spec
 * 2026-10-14, option B2). Crowding is decided by `layoutMarginNotes`; this
 * component measures, renders, and handles hover, the card and deletion.
 */
export function CommentMargin({ view, comments, labels, apiRef, onDelete, onEdit }: CommentMarginProps) {
  const [, setLayoutVersion] = useState(0);
  const [lineCounts, setLineCounts] = useState<Map<string, number>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<OpenGroup | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const noteRefs = useRef(new Map<string, HTMLElement>());
  const returnFocusIdRef = useRef<string | null>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    if (update.docChanged || update.geometryChanged || update.viewportChanged) {
      setLayoutVersion((version) => version + 1);
    }
  }, []);

  apiRef.current = { handleEditorUpdate };

  useEffect(() => {
    const ref = apiRef;

    return () => {
      ref.current = null;
    };
  }, [apiRef]);

  // Natural line counts from the hidden full-length copy of every note.
  const measureKey = comments.map((comment) => `${comment.id}\u0000${comment.comment}`).join("\u0001");

  useLayoutEffect(() => {
    const container = measureRef.current;

    if (!container) {
      return;
    }

    const next = new Map<string, number>();

    for (const element of Array.from(container.children)) {
      const id = (element as HTMLElement).dataset.id;

      if (id) {
        next.set(id, Math.max(1, Math.round((element as HTMLElement).offsetHeight / LINE_HEIGHT)));
      }
    }

    setLineCounts((current) => {
      const same = current.size === next.size && [...next].every(([id, lines]) => current.get(id) === lines);
      return same ? current : next;
    });
  }, [measureKey]);

  // Comments that disappear (deleted here or outside) leave the card and hover.
  useEffect(() => {
    const present = new Set(comments.map((comment) => comment.id));

    setHoveredId((current) => (current && present.has(current) ? current : null));
    setOpenGroup((current) => {
      if (!current) {
        return current;
      }

      const ids = current.ids.filter((id) => present.has(id));
      return ids.length === 0 ? null : ids.length === current.ids.length ? current : { hostId: ids[0], ids };
    });
  }, [comments]);

  // The passages of the hovered note and of the open card get the active mark.
  const activeIds = openGroup ? openGroup.ids : hoveredId ? [hoveredId] : [];
  const activeKey = activeIds.join("|");

  useEffect(() => {
    if (!view) {
      return;
    }

    // Keyed on the ids only: once set, the marks map through edits on their own.
    const ranges: ActiveCommentRange[] = (activeKey ? activeKey.split("|") : [])
      .map((id) => commentsRef.current.find((comment) => comment.id === id))
      .filter((comment): comment is SelectionComment => Boolean(comment))
      .map((comment) => ({ from: comment.from, to: comment.to, author: comment.author }));

    view.dispatch({ effects: setActiveComments.of(ranges) });
  }, [activeKey, view]);

  useEffect(() => {
    return () => {
      view?.dispatch({ effects: setActiveComments.of([]) });
    };
  }, [view]);

  const closeCard = useCallback(() => {
    setOpenGroup(null);
    const id = returnFocusIdRef.current;
    returnFocusIdRef.current = null;

    if (id) {
      noteRefs.current.get(id)?.querySelector<HTMLButtonElement>(".comment-margin-note__text")?.focus();
    }
  }, []);

  // Esc or a click outside closes the card.
  useEffect(() => {
    if (!openGroup) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (cardRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpenGroup(null);
      returnFocusIdRef.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCard();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    // Focus the card, not its first button: Enter must never delete by accident.
    cardRef.current?.focus();

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [closeCard, openGroup]);

  if (!view) {
    return null;
  }

  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const geometry = readGeometry(view, comments);
  const placements: MarginNotePlacement[] = geometry
    ? layoutMarginNotes(
        comments.map((comment) => ({
          id: comment.id,
          anchorTop: geometry.anchorTops.get(comment.id) ?? 0,
          from: comment.from,
          lines: lineCounts.get(comment.id) ?? 1
        }))
      )
    : [];
  const surfaceWidth = view.dom.closest<HTMLElement>(".editor-surface")?.clientWidth ?? 0;
  const openHost = openGroup ? placements.find((placement) => placement.id === openGroup.hostId) : null;
  const cardLeft = geometry ? Math.max(SURFACE_EDGE, Math.min(geometry.left - 8, surfaceWidth - CARD_WIDTH - SURFACE_EDGE)) : 0;

  const openCard = (placement: MarginNotePlacement) => {
    returnFocusIdRef.current = placement.id;
    setHoveredId(null);
    setOpenGroup({ hostId: placement.id, ids: [placement.id, ...placement.folded] });
  };

  const glyph = (comment: SelectionComment) =>
    comment.author === "ai" ? (
      <span className="comment-margin-note__glyph" aria-hidden="true">
        ✦
      </span>
    ) : (
      <span className="comment-margin-note__glyph" aria-hidden="true">
        <span className="comment-margin-note__dot" />
      </span>
    );

  return (
    <aside className="comment-margin" aria-label={labels.region}>
      <div className="comment-margin-measure" ref={measureRef} aria-hidden="true">
        {comments.map((comment) => (
          <p key={comment.id} data-id={comment.id}>
            {comment.comment}
          </p>
        ))}
      </div>
      {geometry
        ? placements.map((placement) => {
            const comment = byId.get(placement.id);

            if (!comment) {
              return null;
            }

            const full = lineCounts.get(comment.id) ?? 1;
            const cut = placement.lines < full;
            const active = hoveredId === comment.id || Boolean(openGroup?.ids.includes(comment.id));

            return (
              <div
                key={comment.id}
                ref={(element) => {
                  if (element) {
                    noteRefs.current.set(comment.id, element);
                  } else {
                    noteRefs.current.delete(comment.id);
                  }
                }}
                className={active ? "comment-margin-note is-active" : "comment-margin-note"}
                style={{ top: placement.top, left: geometry.left }}
                onMouseEnter={() => setHoveredId(comment.id)}
                onMouseLeave={() => setHoveredId((current) => (current === comment.id ? null : current))}
              >
                {glyph(comment)}
                <button
                  type="button"
                  className="comment-margin-note__text"
                  style={cut ? { WebkitLineClamp: placement.lines } : undefined}
                  aria-label={comment.author === "ai" ? labels.aiComment(comment.comment) : labels.writerComment(comment.comment)}
                  aria-expanded={openGroup?.hostId === comment.id}
                  onClick={() => openCard(placement)}
                >
                  {comment.comment}
                </button>
                <button
                  type="button"
                  className="comment-margin-note__delete"
                  aria-label={labels.deleteComment}
                  data-tooltip={labels.deleteComment}
                  onClick={() => onDelete(comment.id)}
                >
                  ×
                </button>
                {placement.folded.length > 0 ? (
                  <button
                    type="button"
                    className="comment-margin-note__more"
                    aria-expanded={openGroup?.hostId === comment.id}
                    onClick={() => openCard(placement)}
                  >
                    {labels.more(placement.folded.length)}
                  </button>
                ) : null}
              </div>
            );
          })
        : null}
      {openGroup && openHost ? (
        <div
          ref={cardRef}
          className="comment-margin-card"
          role="dialog"
          tabIndex={-1}
          aria-label={labels.region}
          style={{ top: Math.max(0, openHost.top - 8), left: cardLeft }}
        >
          {openGroup.ids.map((id) => {
            const comment = byId.get(id);

            if (!comment) {
              return null;
            }

            return (
              <div className="comment-margin-card__row" key={id}>
                {glyph(comment)}
                <p>{comment.comment}</p>
                <div className="comment-margin-card__actions">
                  {comment.author === "ai" ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenGroup(null);
                        returnFocusIdRef.current = null;
                        onEdit(id);
                      }}
                    >
                      {labels.edit}
                    </button>
                  )}
                  <button type="button" onClick={() => onDelete(id)}>
                    {labels.delete}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
