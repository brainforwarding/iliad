import { captureSelectionAnchor, findQuoteAnchor, isAnchoredSelectionComment } from "../app/selectionCommentsAnchor";
import type { SelectionComment } from "../types/iliad";
import { countQuoteOccurrences, type CommentsFileEntry } from "./commentsFile";

/**
 * The file entry for one in-memory comment. Occurrence and prefix are
 * written only when the quote is not unique in the document (spec V14); for
 * an anchored comment they are recomputed from its live position.
 */
export function commentToEntry(comment: SelectionComment, documentText: string): CommentsFileEntry {
  const entry: CommentsFileEntry = { id: comment.id, quote: comment.quote, comment: comment.comment };

  if (!comment.quote || countQuoteOccurrences(documentText, comment.quote) <= 1) {
    return entry;
  }

  if (isAnchoredSelectionComment(comment) && documentText.slice(comment.from, comment.to) === comment.quote) {
    const anchor = captureSelectionAnchor(documentText, comment.from, comment.to);
    return { ...entry, occurrence: anchor.occurrence, prefix: anchor.prefix };
  }

  return { ...entry, occurrence: comment.occurrence || 1, prefix: comment.prefix };
}

/** An in-memory comment for a file entry, anchored against the document (detached when not found). */
export function entryToComment(
  entry: CommentsFileEntry,
  documentText: string,
  context: { workspacePath: string; documentRelativePath: string }
): SelectionComment {
  const range = entry.quote ? findQuoteAnchor(documentText, entry) : null;

  return {
    id: entry.id,
    workspacePath: context.workspacePath,
    documentRelativePath: context.documentRelativePath,
    from: range?.from ?? 0,
    to: range?.to ?? 0,
    quote: entry.quote,
    occurrence: entry.occurrence ?? 1,
    prefix: entry.prefix ?? "",
    comment: entry.comment,
    createdAt: "",
    status: "pending"
  };
}

export interface CommentsMergeResult {
  /** Merged entries, in fresh-disk order followed by comments created locally. */
  entries: Array<{ entry: CommentsFileEntry; local: SelectionComment | null }>;
  /** Local comments an outside tool deleted from the file (not edited locally), for spec V17. */
  removedOutside: SelectionComment[];
}

/**
 * Three-way merge by id (spec V16) between the last disk text Iliad read or
 * wrote (`base`), the comments in memory (`local`), and the file now
 * (`fresh`). An outside deletion wins unless the comment text was edited
 * locally; a local deletion wins; comments added on either side are kept; an
 * outside edit wins unless the same comment's text was edited locally.
 */
export function mergeCommentEntries(
  base: CommentsFileEntry[],
  local: SelectionComment[],
  fresh: CommentsFileEntry[]
): CommentsMergeResult {
  const baseById = new Map(base.map((entry) => [entry.id, entry]));
  const localById = new Map(local.map((comment) => [comment.id, comment]));
  const freshIds = new Set(fresh.map((entry) => entry.id));
  const entries: CommentsMergeResult["entries"] = [];
  const removedOutside: SelectionComment[] = [];

  for (const freshEntry of fresh) {
    const localComment = localById.get(freshEntry.id);
    const baseEntry = baseById.get(freshEntry.id);

    if (!localComment) {
      // Deleted here since the last read: the local deletion wins.
      if (!baseEntry) {
        entries.push({ entry: freshEntry, local: null });
      }

      continue;
    }

    const editedLocally = !baseEntry || localComment.comment !== baseEntry.comment;
    const quoteChangedOutside = Boolean(baseEntry && freshEntry.quote !== baseEntry.quote);
    const entry = editedLocally ? { ...freshEntry, comment: localComment.comment } : freshEntry;

    entries.push({ entry, local: quoteChangedOutside ? null : localComment });
  }

  for (const localComment of local) {
    if (freshIds.has(localComment.id)) {
      continue;
    }

    const baseEntry = baseById.get(localComment.id);

    if (!baseEntry || localComment.comment !== baseEntry.comment) {
      // Created here, or edited here while an outside tool deleted it.
      entries.push({
        entry: { id: localComment.id, quote: localComment.quote, comment: localComment.comment },
        local: localComment
      });
    } else {
      removedOutside.push(localComment);
    }
  }

  return { entries, removedOutside };
}

/**
 * Spec V17: after the writer restores an outside edit, comments an outside
 * tool removed this session come back when their quote is found again.
 */
export function readdRestoredComments(removed: SelectionComment[], current: SelectionComment[], documentText: string) {
  const present = new Set(current.map((comment) => comment.id));
  const readded: SelectionComment[] = [];
  const stillRemoved: SelectionComment[] = [];

  for (const comment of removed) {
    if (present.has(comment.id)) {
      continue;
    }

    const range = findQuoteAnchor(documentText, comment);

    if (range) {
      readded.push({ ...comment, ...range });
    } else {
      stillRemoved.push(comment);
    }
  }

  return { readded, stillRemoved };
}
