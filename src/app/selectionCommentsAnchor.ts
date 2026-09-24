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

/**
 * Finds the range a comment's quote covers now (spec V15). A unique quote
 * anchors directly. A quote that appears more than once anchors only when the
 * stored occurrence still has the stored prefix right before it; otherwise
 * the comment is detached. It never guesses between duplicates.
 */
export function findQuoteAnchor(
  documentText: string,
  anchor: { quote: string; occurrence?: number; prefix?: string }
): { from: number; to: number } | null {
  const candidates = occurrenceIndices(documentText, anchor.quote);

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return { from: candidates[0], to: candidates[0] + anchor.quote.length };
  }

  const ordinal = anchor.occurrence ?? 0;

  if (ordinal < 1 || ordinal > candidates.length) {
    return null;
  }

  const index = candidates[ordinal - 1];
  const prefix = anchor.prefix ?? "";
  const prefixMatches = prefix ? documentText.slice(0, index).endsWith(prefix) : index === 0;

  return prefixMatches ? { from: index, to: index + anchor.quote.length } : null;
}

function reanchorOne(comment: SelectionComment, documentText: string): SelectionComment {
  const range = findQuoteAnchor(documentText, comment);

  // Never mis-anchor: ambiguous or missing quotes become detached.
  return range ? { ...comment, ...range } : { ...comment, from: 0, to: 0 };
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
