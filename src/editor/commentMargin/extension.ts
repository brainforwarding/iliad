import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** A passage whose comment is hovered or open in the margin. */
export interface ActiveCommentRange {
  from: number;
  to: number;
  author?: "ai";
}

/**
 * Sets the passages to mark as active. Dispatched by the margin on hover and
 * when a card opens, so hovering never rebuilds the editor's extensions.
 */
export const setActiveComments = StateEffect.define<ActiveCommentRange[]>();

const writerMark = Decoration.mark({ class: "cm-comment-active" });
const aiMark = Decoration.mark({ class: "cm-comment-active-ai" });

export function activeCommentDecorations(ranges: ActiveCommentRange[], documentLength: number): DecorationSet {
  const clamp = (value: number) => Math.max(0, Math.min(value, documentLength));
  const marks: Range<Decoration>[] = [];

  for (const range of ranges) {
    const from = clamp(range.from);
    const to = clamp(range.to);

    if (to > from) {
      marks.push((range.author === "ai" ? aiMark : writerMark).range(from, to));
    }
  }

  return Decoration.set(marks, true);
}

/** Active-passage marks; mapped through edits until the margin sets them again. */
export const activeCommentsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = transaction.docChanged ? value.map(transaction.changes) : value;

    for (const effect of transaction.effects) {
      if (effect.is(setActiveComments)) {
        next = activeCommentDecorations(effect.value, transaction.state.doc.length);
      }
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

/** The column shifts left to make room for the margin (CSS in commentMargin.css). */
export const commentMarginColumn = EditorView.editorAttributes.of({ class: "cm-has-comment-margin" });

/**
 * The margin's editor extension: the active-passage field always (so the
 * margin can dispatch to it), plus the column shift while the margin shows.
 */
export function commentMarginExtension(marginShown: boolean) {
  return marginShown ? [activeCommentsField, commentMarginColumn] : [activeCommentsField];
}
