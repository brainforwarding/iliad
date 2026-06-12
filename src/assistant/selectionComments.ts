import { isAnchoredSelectionComment } from "../app/selectionCommentsAnchor";
import type { SelectionComment } from "../types/iliad";

const EXCERPT_LIMIT = 46;

export function pendingSelectionComments(comments: SelectionComment[]) {
  return comments.filter((comment) => comment.status === "pending");
}

/** Chip list order: anchored comments by position, "sin ancla" orphans last. */
export function sortSelectionCommentsForDisplay(comments: SelectionComment[]) {
  return [...comments].sort((a, b) => {
    const aAnchored = isAnchoredSelectionComment(a);
    const bAnchored = isAnchoredSelectionComment(b);

    if (aAnchored !== bAnchored) {
      return aAnchored ? -1 : 1;
    }

    if (aAnchored) {
      return a.from - b.from;
    }

    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

export function selectionCommentExcerpt(quote: string) {
  const flattened = quote.replace(/\r\n|\r|\n/g, "⏎").trim();
  return flattened.length > EXCERPT_LIMIT ? `${flattened.slice(0, EXCERPT_LIMIT - 1)}…` : flattened;
}

export function markSelectionCommentsSent(comments: SelectionComment[], ids: string[]): SelectionComment[] {
  const sentIds = new Set(ids);
  return comments.map((comment) =>
    sentIds.has(comment.id) && comment.status === "pending" ? { ...comment, status: "sent" as const } : comment
  );
}

/** Run-error path: sent comments revert to pending (mirror of contextAttachments restore). */
export function revertSelectionCommentsToPending(comments: SelectionComment[], ids: string[]): SelectionComment[] {
  const revertIds = new Set(ids);
  return comments.map((comment) =>
    revertIds.has(comment.id) && comment.status === "sent" ? { ...comment, status: "pending" as const } : comment
  );
}

export function removeSelectionComment(comments: SelectionComment[], id: string): SelectionComment[] {
  return comments.filter((comment) => comment.id !== id);
}

/** Sent trace is none: after the fade, sent comments are cleared entirely. */
export function clearSentSelectionComments(comments: SelectionComment[], ids: string[]): SelectionComment[] {
  const clearIds = new Set(ids);
  return comments.filter((comment) => !(clearIds.has(comment.id) && comment.status === "sent"));
}
