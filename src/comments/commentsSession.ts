import type { CompanionReadResult, SelectionComment, WriteMarkdownResult } from "../types/iliad";
import { parseCommentsFile, serializeCommentsFile, type CommentsFileEntry } from "./commentsFile";
import { commentToEntry, entryToComment, mergeCommentEntries } from "./commentsMerge";

/** Disk access for one comments file; in the app it goes through the guarded IPC. */
export interface CommentsFileIo {
  read: () => Promise<CompanionReadResult>;
  /** Compare-and-swap write (`absent` = create exclusively). */
  write: (text: string, expected: { kind: "absent" } | { kind: "hash"; hash: string }) => Promise<WriteMarkdownResult>;
  /** Guarded remove (`file:remove-companion`) when the last comment is deleted. */
  remove: (expectedHash: string) => Promise<WriteMarkdownResult>;
  hash: (text: string) => Promise<string>;
}

export interface CommentsDiskState {
  /** Text last read or written; null when the file does not exist. */
  text: string | null;
  hash: string | null;
  entries: CommentsFileEntry[];
}

export const emptyCommentsDisk: CommentsDiskState = { text: null, hash: null, entries: [] };

/** One open document's comments as the sync logic sees them. */
export interface CommentsSessionState {
  workspacePath: string;
  documentRelativePath: string;
  comments: SelectionComment[];
  disk: CommentsDiskState;
  loaded: boolean;
  dirty: boolean;
  /** The document text positions refer to. */
  documentText: string;
}

export async function readCommentsDisk(io: CommentsFileIo): Promise<CommentsDiskState> {
  const result = await io.read();

  return result.status === "present"
    ? { text: result.content, hash: result.hash, entries: parseCommentsFile(result.content) }
    : emptyCommentsDisk;
}

function entryIdentity(entries: Array<Pick<CommentsFileEntry, "id" | "quote" | "comment">>) {
  return JSON.stringify(entries.map((entry) => [entry.id, entry.quote, entry.comment]));
}

/**
 * Merges a fresh read of the file into the session (three-way by id against
 * the last disk state; spec V16). Returns whether the merge kept local
 * changes the file lacks (so it must be written back) and the comments an
 * outside tool deleted (remembered for spec V17). A file an outside tool
 * wrote in its own style is not rewritten just because it was read.
 */
export function absorbCommentsDisk(state: CommentsSessionState, fresh: CommentsDiskState) {
  // Before the first read nothing is known on disk: every entry there is new here.
  const base = state.loaded ? state.disk.entries : [];
  const merge = mergeCommentEntries(base, state.comments, fresh.entries);
  const context = { workspacePath: state.workspacePath, documentRelativePath: state.documentRelativePath };

  state.comments = merge.entries.map(({ entry, local }) =>
    local ? { ...local, comment: entry.comment } : entryToComment(entry, state.documentText, context)
  );
  state.disk = fresh;
  state.loaded = true;

  return {
    needsWrite: entryIdentity(state.comments) !== entryIdentity(fresh.entries),
    removedOutside: merge.removedOutside
  };
}

export interface CommentsWriteOutcome {
  /** The file was created or removed (the tree changes). */
  fileListChanged: boolean;
  /** Comments an outside tool deleted, found while merging after a conflict. */
  removedOutside: SelectionComment[];
}

/**
 * Writes the session's comments when their serialized entries differ from the
 * file's (positions alone never write). The last comment deleted removes the
 * file. When the file changed on disk meanwhile, the fresh file is merged in
 * and the write is retried once; a second conflict is an error.
 */
export async function writeCommentsSession(
  state: CommentsSessionState,
  io: CommentsFileIo,
  onMerged?: () => void
): Promise<CommentsWriteOutcome> {
  const removedOutside: SelectionComment[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const entries = state.comments.map((comment) => commentToEntry(comment, state.documentText));
    const text = serializeCommentsFile(entries);

    if (text === serializeCommentsFile(state.disk.entries) && (entries.length > 0 || state.disk.text === null)) {
      state.dirty = false;
      return { fileListChanged: false, removedOutside };
    }

    const result =
      entries.length === 0
        ? await io.remove(state.disk.hash ?? "")
        : await io.write(text, state.disk.text === null ? { kind: "absent" } : { kind: "hash", hash: state.disk.hash ?? "" });

    if (result.status === "written") {
      const fileListChanged = entries.length === 0 || state.disk.text === null;
      state.disk = entries.length === 0 ? emptyCommentsDisk : { text, hash: await io.hash(text), entries: parseCommentsFile(text) };
      state.dirty = false;
      return { fileListChanged, removedOutside };
    }

    if (result.reason !== "disk_changed") {
      throw new Error(result.reason === "unsafe_path" ? "The comments file is not a regular file." : "");
    }

    // Someone else wrote the file since Iliad last read it: merge, retry once.
    const merged = absorbCommentsDisk(state, await readCommentsDisk(io));
    removedOutside.push(...merged.removedOutside);
    onMerged?.();
  }

  throw new Error("The comments file keeps changing outside Iliad.");
}
