import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  absorbCommentsDisk,
  emptyCommentsDisk,
  readCommentsDisk,
  writeCommentsSession,
  type CommentsFileIo,
  type CommentsSessionState
} from "../comments/commentsSession";
import { readdRestoredComments } from "../comments/commentsMerge";
import { companionPathsFor, isCompanionPath } from "../files/companionFiles";
import { findNode } from "../files/fileTree";
import { captureSelectionAnchor, isAnchoredSelectionComment, reanchorSelectionComments } from "./selectionCommentsAnchor";
import { hashDocumentText } from "./useDocumentPersistence";
import type { FileTreeNode, SelectionComment, WorkspaceChangeEvent, WorkspaceInfo } from "../types/iliad";

const PERSIST_DEBOUNCE_MS = 280;

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "").trim();
}

interface UseSelectionCommentsOptions {
  activeFile: FileTreeNode | null;
  documentText: string;
  workspace: WorkspaceInfo | null;
  /** Watcher events: the comments file is re-read when an outside tool changes it. */
  lastWorkspaceChange?: WorkspaceChangeEvent | null;
  /** The tree, to notice the comments file appearing or disappearing. */
  tree?: FileTreeNode[];
  onError?: (message: string) => void;
  /** Called after Iliad created or removed the comments file (to refresh the tree). */
  onFileListChanged?: () => void;
  messages?: { saveCommentsFailed: string };
}

export interface SelectionCommentDraft {
  from: number;
  to: number;
  comment: string;
}

export interface SelectionCommentPositionUpdate {
  id: string;
  from: number;
  to: number;
}

/** One open document's comments; a new session starts on every document switch. */
interface CommentsSession extends CommentsSessionState {
  documentPath: string;
  commentsPath: string;
  commentsRelativePath: string;
  timer: number | null;
}

function sessionIo(session: CommentsSession): CommentsFileIo {
  return {
    read: () => window.iliad.companions.read(session.workspacePath, session.commentsPath),
    write: (text, expected) => window.iliad.writeMarkdown(session.workspacePath, session.commentsPath, text, expected),
    remove: (expectedHash) => window.iliad.companions.remove(session.workspacePath, session.commentsPath, expectedHash),
    hash: hashDocumentText
  };
}

function commentId() {
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function removedOutsideKey(workspacePath: string, documentRelativePath: string) {
  return `${workspacePath}\u0000${documentRelativePath.toLowerCase()}`;
}

function changeTouchesPath(event: WorkspaceChangeEvent, relativePath: string) {
  if (event.watcherDegraded || (event.markdownChanged && (event.changedMarkdownPaths ?? []).length === 0)) {
    return true;
  }

  const target = relativePath.toLowerCase();
  return (event.changedMarkdownPaths ?? []).some((changed) => normalizeRelativePath(changed).toLowerCase() === target);
}

/**
 * File-backed selection comments for the open document (spec V14–V18): the
 * comments live in `stem.comments.md` next to the document. Positions are
 * kept in memory; the file is written (compare-and-swap) only when the
 * serialized entries differ from what is on disk. Outside changes to the file
 * are merged three ways by id.
 */
export function useSelectionComments({
  activeFile,
  documentText,
  workspace,
  lastWorkspaceChange = null,
  tree,
  onError,
  onFileListChanged,
  messages
}: UseSelectionCommentsOptions) {
  const [comments, setComments] = useState<SelectionComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const sessionRef = useRef<CommentsSession | null>(null);
  const pendingWritesRef = useRef(new Map<string, Promise<void>>());
  const removedOutsideRef = useRef(new Map<string, SelectionComment[]>());
  // Set when the writer restored this document's outside edit; resolved once
  // the restored text reaches the buffer (or soon after, if it never does).
  const restorePendingRef = useRef<{ textAtNotice: string; expiresAt: number } | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFileListChangedRef = useRef(onFileListChanged);
  onFileListChangedRef.current = onFileListChanged;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Updated during render so callbacks fired from CodeMirror effects (which run
  // before this hook's own effects) always see the latest file/text.
  const activeFilePathRef = useRef<string | null>(null);
  const documentTextRef = useRef(documentText);
  activeFilePathRef.current = activeFile?.path ?? null;
  documentTextRef.current = documentText;

  if (sessionRef.current && sessionRef.current.documentPath === activeFile?.path) {
    sessionRef.current.documentText = documentText;
  }

  const workspacePath = workspace?.path ?? null;
  const commentsEnabled = Boolean(
    workspacePath && activeFile?.kind === "markdown" && !isCompanionPath(activeFile.relativePath)
  );

  const publish = useCallback((session: CommentsSession) => {
    if (sessionRef.current === session) {
      setComments(session.comments);
    }
  }, []);

  const reportError = useCallback((error: unknown) => {
    const fallback = messagesRef.current?.saveCommentsFailed ?? "Comments could not be saved.";
    onErrorRef.current?.(error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback);
  }, []);

  const rememberRemovedOutside = useCallback((session: CommentsSession, removed: SelectionComment[]) => {
    if (removed.length === 0) {
      return;
    }

    const key = removedOutsideKey(session.workspacePath, session.documentRelativePath);
    const remembered = removedOutsideRef.current.get(key) ?? [];
    removedOutsideRef.current.set(key, [
      ...remembered.filter((comment) => !removed.some((item) => item.id === comment.id)),
      ...removed
    ]);
  }, []);

  const writeSession = useCallback(
    async (session: CommentsSession) => {
      const outcome = await writeCommentsSession(session, sessionIo(session), () => publish(session));
      rememberRemovedOutside(session, outcome.removedOutside);

      if (outcome.fileListChanged) {
        onFileListChangedRef.current?.();
      }
    },
    [publish, rememberRemovedOutside]
  );

  /** Queues a write of the session behind any pending write of the same file. */
  const persistSession = useCallback(
    (session: CommentsSession) => {
      if (session.timer !== null) {
        window.clearTimeout(session.timer);
        session.timer = null;
      }

      const previous = pendingWritesRef.current.get(session.commentsPath) ?? Promise.resolve();
      const run = previous.then(() => (session.dirty && session.loaded ? writeSession(session) : undefined));
      const settled = run.catch(() => undefined);
      pendingWritesRef.current.set(session.commentsPath, settled);
      void settled.then(() => {
        if (pendingWritesRef.current.get(session.commentsPath) === settled) {
          pendingWritesRef.current.delete(session.commentsPath);
        }
      });
      return run;
    },
    [writeSession]
  );

  const schedulePersist = useCallback(
    (session: CommentsSession) => {
      session.dirty = true;

      if (session.timer !== null) {
        window.clearTimeout(session.timer);
      }

      session.timer = window.setTimeout(() => {
        session.timer = null;
        persistSession(session).catch(reportError);
      }, PERSIST_DEBOUNCE_MS);
    },
    [persistSession, reportError]
  );

  /** Reads the file (after any pending write of it) and merges it into the session. */
  const reloadSession = useCallback(
    async (session: CommentsSession) => {
      await (pendingWritesRef.current.get(session.commentsPath) ?? Promise.resolve());
      const fresh = await readCommentsDisk(sessionIo(session));

      if (sessionRef.current !== session) {
        return;
      }

      const { needsWrite, removedOutside } = absorbCommentsDisk(session, fresh);
      rememberRemovedOutside(session, removedOutside);
      setLoaded(true);
      publish(session);

      if (needsWrite) {
        schedulePersist(session);
      }
    },
    [publish, rememberRemovedOutside, schedulePersist]
  );

  /**
   * Writes pending comment changes now. Chained into `flushSave`, so file
   * operations and navigation wait for (and stop on) a failed write.
   */
  const flushPersist = useCallback(async () => {
    const session = sessionRef.current;

    if (!session) {
      return;
    }

    try {
      await persistSession(session);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [persistSession, reportError]);

  // Document open / switch: write the switched-away session, then read the
  // companion of the newly opened document.
  useEffect(() => {
    if (!commentsEnabled || !workspacePath || !activeFile) {
      sessionRef.current = null;
      setComments([]);
      setLoaded(false);
      return;
    }

    const paths = companionPathsFor(activeFile.path);
    const relativePaths = companionPathsFor(normalizeRelativePath(activeFile.relativePath));

    if (!paths || !relativePaths) {
      sessionRef.current = null;
      setComments([]);
      setLoaded(false);
      return;
    }

    const session: CommentsSession = {
      workspacePath,
      documentPath: activeFile.path,
      documentRelativePath: normalizeRelativePath(activeFile.relativePath),
      commentsPath: paths.comments,
      commentsRelativePath: relativePaths.comments,
      comments: [],
      disk: emptyCommentsDisk,
      loaded: false,
      dirty: false,
      timer: null,
      documentText: documentTextRef.current
    };
    sessionRef.current = session;
    setComments([]);
    setLoaded(false);
    reloadSession(session).catch((error) => {
      console.warn("comments: read failed", error);
    });

    return () => {
      if (session.dirty) {
        persistSession(session).catch(reportError);
      }

      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, [activeFile?.path, commentsEnabled, persistSession, reloadSession, reportError, workspacePath]);

  // Workspace switch: forget comments remembered for restores.
  useEffect(() => {
    removedOutsideRef.current = new Map();
  }, [workspacePath]);

  // Outside changes to the comments file (or a degraded watcher): re-read.
  useEffect(() => {
    const session = sessionRef.current;

    if (!session || !lastWorkspaceChange || lastWorkspaceChange.workspaceRoot !== session.workspacePath) {
      return;
    }

    if (changeTouchesPath(lastWorkspaceChange, session.commentsRelativePath)) {
      reloadSession(session).catch((error) => console.warn("comments: re-read failed", error));
    }
  }, [lastWorkspaceChange, reloadSession]);

  // The comments file appeared or disappeared in the tree (created, trashed,
  // moved): re-read so memory never outlives the file.
  const commentsPathForTree = sessionRef.current?.commentsPath ?? null;
  const companionPresent = useMemo(
    () => (tree && commentsPathForTree ? Boolean(findNode(tree, commentsPathForTree)) : null),
    [commentsPathForTree, tree]
  );
  const companionPresentRef = useRef<{ path: string | null; present: boolean | null }>({ path: null, present: null });

  useEffect(() => {
    const previous = companionPresentRef.current;
    companionPresentRef.current = { path: commentsPathForTree, present: companionPresent };
    const session = sessionRef.current;

    if (
      !session ||
      companionPresent === null ||
      previous.path !== commentsPathForTree ||
      previous.present === null ||
      previous.present === companionPresent
    ) {
      return;
    }

    reloadSession(session).catch((error) => console.warn("comments: re-read failed", error));
  }, [commentsPathForTree, companionPresent, reloadSession]);

  useEffect(() => {
    const onBeforeUnload = () => {
      const session = sessionRef.current;

      if (session?.dirty) {
        void persistSession(session).catch(() => undefined);
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistSession]);

  const applyComments = useCallback(
    (updater: (current: SelectionComment[]) => SelectionComment[]) => {
      const session = sessionRef.current;

      if (!session) {
        return;
      }

      session.comments = updater(session.comments);
      publish(session);
      schedulePersist(session);
    },
    [publish, schedulePersist]
  );

  const createComment = useCallback(
    (draft: SelectionCommentDraft) => {
      const session = sessionRef.current;

      if (!session || !draft.comment.trim()) {
        return;
      }

      const anchor = captureSelectionAnchor(documentTextRef.current, draft.from, draft.to);
      const comment: SelectionComment = {
        id: commentId(),
        workspacePath: session.workspacePath,
        documentRelativePath: session.documentRelativePath,
        from: draft.from,
        to: draft.to,
        quote: anchor.quote,
        occurrence: anchor.occurrence,
        prefix: anchor.prefix,
        comment: draft.comment.trim(),
        createdAt: new Date().toISOString(),
        status: "pending"
      };

      applyComments((current) => [...current, comment]);
    },
    [applyComments]
  );

  const updateComment = useCallback(
    (id: string, text: string) => {
      if (!text.trim()) {
        return;
      }

      applyComments((current) =>
        current.map((comment) => (comment.id === id ? { ...comment, comment: text.trim() } : comment))
      );
    },
    [applyComments]
  );

  const deleteComment = useCallback(
    (id: string) => {
      applyComments((current) => current.filter((comment) => comment.id !== id));
    },
    [applyComments]
  );

  /** Position intake from the editor extension; ignored across document switches. */
  const applyPositionUpdates = useCallback(
    (documentPath: string, updates: SelectionCommentPositionUpdate[]) => {
      const session = sessionRef.current;

      if (!session || documentPath !== activeFilePathRef.current || documentPath !== session.documentPath || updates.length === 0) {
        return;
      }

      const byId = new Map(updates.map((update) => [update.id, update]));
      let changed = false;
      const next = session.comments.map((comment) => {
        const update = byId.get(comment.id);

        if (!update || (comment.from === update.from && comment.to === update.to)) {
          return comment;
        }

        changed = true;
        return { ...comment, from: update.from, to: update.to };
      });

      // Guard against update loops: only commit when positions actually
      // changed. The file is written only if the serialized entries differ.
      if (changed) {
        session.comments = next;
        publish(session);
        schedulePersist(session);
      }
    },
    [publish, schedulePersist]
  );

  /** Full-content replacements (reload from disk, restore) re-anchor instead of mapping. */
  const applyFullReplacement = useCallback(
    (documentPath: string, replacementText: string) => {
      const session = sessionRef.current;

      if (!session || documentPath !== activeFilePathRef.current || session.comments.length === 0) {
        return;
      }

      session.documentText = replacementText;
      session.comments = reanchorSelectionComments(session.comments, replacementText, session.documentRelativePath);
      publish(session);
    },
    [publish]
  );

  /**
   * The writer restored an outside edit of these documents (chunk or file):
   * comments an outside tool removed this session come back when their quote
   * is found again (spec V17). Runs after the restored text reaches the buffer.
   */
  const noteOutsideEditRestored = useCallback((relativePaths: string[]) => {
    const session = sessionRef.current;

    if (
      session &&
      relativePaths.some((relativePath) => normalizeRelativePath(relativePath).toLowerCase() === session.documentRelativePath.toLowerCase())
    ) {
      restorePendingRef.current = { textAtNotice: documentTextRef.current, expiresAt: Date.now() + 5000 };
      setRestoreTick((tick) => tick + 1);
    }
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    const pending = restorePendingRef.current;

    if (!pending || !session) {
      return;
    }

    if (Date.now() > pending.expiresAt) {
      restorePendingRef.current = null;
      return;
    }

    const key = removedOutsideKey(session.workspacePath, session.documentRelativePath);
    const { readded, stillRemoved } = readdRestoredComments(
      removedOutsideRef.current.get(key) ?? [],
      session.comments,
      documentText
    );

    // Before the restored text reaches the buffer the quotes are not found
    // yet: keep waiting for the reload.
    if (readded.length === 0 && documentText === pending.textAtNotice) {
      return;
    }

    restorePendingRef.current = null;
    removedOutsideRef.current.set(key, stillRemoved);

    if (readded.length > 0) {
      session.comments = [...session.comments, ...readded];
      publish(session);
      schedulePersist(session);
    }
  }, [documentText, publish, restoreTick, schedulePersist]);

  const detachedComments = useMemo(
    () => comments.filter((comment) => !isAnchoredSelectionComment(comment)),
    [comments]
  );

  return {
    comments,
    commentsEnabled,
    /** Number of entries in the comments file of the open document, once read. */
    commentCount: loaded ? comments.length : null,
    detachedComments,
    createComment,
    updateComment,
    deleteComment,
    applyPositionUpdates,
    applyFullReplacement,
    flushPersist,
    noteOutsideEditRestored
  };
}
