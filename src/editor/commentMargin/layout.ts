/**
 * Where each comment goes in the margin (spec 2026-10-14, "Crowding"). Pure:
 * the component measures anchors and natural line counts, this decides tops,
 * line clamps and which comments fold into "+N more".
 */

export interface MarginNoteInput {
  id: string;
  /** Top of the passage's first visual line, in margin coordinates. */
  anchorTop: number;
  /** Document position of the passage: notes are laid out in document order. */
  from: number;
  /** Lines the note's full text takes at the margin width (at least 1). */
  lines: number;
}

export interface MarginNotePlacement {
  id: string;
  top: number;
  /** Lines shown; less than the note's lines means it is cut and ends in "…". */
  lines: number;
  /** Ids folded under this note ("+N more"), in document order. */
  folded: string[];
}

export interface MarginLayoutMetrics {
  lineHeight: number;
  /** Space between two notes. */
  gap: number;
  /** How far below its own passage a note may be pushed before it folds. */
  tolerance: number;
  /** Height of the "+N more" row. */
  moreRowHeight: number;
}

export const defaultMarginLayoutMetrics: MarginLayoutMetrics = {
  lineHeight: 18,
  gap: 6,
  tolerance: 45,
  moreRowHeight: 20
};

export function layoutMarginNotes(
  notes: MarginNoteInput[],
  metrics: MarginLayoutMetrics = defaultMarginLayoutMetrics
): MarginNotePlacement[] {
  const { lineHeight, gap, tolerance, moreRowHeight } = metrics;
  // Document order, with anchor tops made non-decreasing: a passage outside
  // the rendered viewport only has an estimate (its paragraph's top), which
  // can land above an earlier, measured passage in a long wrapped paragraph.
  let floor = Number.NEGATIVE_INFINITY;
  const sorted = [...notes]
    .sort((a, b) => a.from - b.from)
    .map((note) => {
      floor = Math.max(floor, note.anchorTop);
      return { ...note, anchorTop: floor };
    });
  const placed: MarginNotePlacement[] = [];
  let previousBottom = Number.NEGATIVE_INFINITY;

  sorted.forEach((note, index) => {
    const top = Math.max(note.anchorTop, previousBottom + gap);
    const last = placed[placed.length - 1];

    if (last && top - note.anchorTop > tolerance) {
      if (last.folded.length === 0) {
        previousBottom += moreRowHeight;
      }

      last.folded.push(note.id);
      return;
    }

    const wanted = Math.max(1, Math.round(note.lines));
    const next = sorted[index + 1];
    const room = next ? Math.floor((next.anchorTop + tolerance - top - gap) / lineHeight) : wanted;
    const lines = Math.min(wanted, Math.max(1, room));

    placed.push({ id: note.id, top, lines, folded: [] });
    previousBottom = top + lines * lineHeight;
  });

  return placed;
}

/** Narrowest editor that still fits a usable text column beside the margin. */
export const minimumEditorWidthForMargin = 780;

/** Whether the margin can show at this editor (surface) width. */
export function commentMarginFits(editorWidth: number) {
  return Number.isFinite(editorWidth) && editorWidth >= minimumEditorWidthForMargin;
}
