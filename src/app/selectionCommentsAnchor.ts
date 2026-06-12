import type { SelectionComment } from "../types/iliad";

export const SELECTION_COMMENT_PREFIX_LENGTH = 30;

/** A comment is anchored while it covers a non-empty range; `from === to` means "sin ancla". */
export function isAnchoredSelectionComment(comment: Pick<SelectionComment, "from" | "to">) {
  return comment.to > comment.from;
}

function occurrenceIndices(haystack: string, needle: string): number[] {
  if (!needle) {
    return [];
  }

  const indices: number[] = [];
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    indices.push(index);
    index = haystack.indexOf(needle, index + 1);
  }

  return indices;
}

/**
 * Captures the re-anchoring triple for a new comment: the exact quote, its
 * occurrence ordinal in the document, and ~30 chars of preceding context.
 * Long selections rely on prefix/occurrence because the serialized quote is
 * truncated to ~80 chars.
 */
export function captureSelectionAnchor(documentText: string, from: number, to: number) {
  const quote = documentText.slice(from, to);
  const before = documentText.slice(0, from);

  return {
    quote,
    occurrence: occurrenceIndices(before, quote).length + 1,
    prefix: before.slice(Math.max(0, from - SELECTION_COMMENT_PREFIX_LENGTH))
  };
}

function reanchorOne(comment: SelectionComment, documentText: string): SelectionComment {
  const candidates = occurrenceIndices(documentText, comment.quote);

  if (candidates.length === 0) {
    return { ...comment, from: 0, to: 0 };
  }

  if (candidates.length === 1) {
    return { ...comment, from: candidates[0], to: candidates[0] + comment.quote.length };
  }

  // Prefix tiebreaker: a unique candidate whose preceding text ends with the
  // stored prefix wins over the occurrence ordinal.
  if (comment.prefix) {
    const prefixMatches = candidates.filter((index) => documentText.slice(0, index).endsWith(comment.prefix));

    if (prefixMatches.length === 1) {
      return { ...comment, from: prefixMatches[0], to: prefixMatches[0] + comment.quote.length };
    }
  }

  const ordinal = Math.max(1, comment.occurrence);

  if (ordinal <= candidates.length) {
    const index = candidates[ordinal - 1];
    return { ...comment, from: index, to: index + comment.quote.length };
  }

  // Never mis-anchor: ambiguous failures become "sin ancla".
  return { ...comment, from: 0, to: 0 };
}

/**
 * Re-anchors comments against a document's current text (on open, after
 * restart, after any full-content replacement). Comments keyed to a different
 * relative path (e.g. after a file rename — v1 behavior) become orphans.
 */
export function reanchorSelectionComments(
  comments: SelectionComment[],
  documentText: string,
  documentRelativePath: string
): SelectionComment[] {
  const normalizedPath = documentRelativePath.toLowerCase();

  return comments.map((comment) => {
    if (comment.documentRelativePath.toLowerCase() !== normalizedPath) {
      return { ...comment, from: 0, to: 0 };
    }

    return reanchorOne(comment, documentText);
  });
}
