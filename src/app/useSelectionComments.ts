import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeRelativePath, workspaceContextApiSessionId } from "../assistant/contextAttachments";
import {
  clearSentSelectionComments,
  markSelectionCommentsSent,
  pendingSelectionComments,
  removeSelectionComment,
  revertSelectionCommentsToPending
} from "../assistant/selectionComments";
import { captureSelectionAnchor, reanchorSelectionComments } from "./selectionCommentsAnchor";
import { serializeSelectionComments } from "./selectionCommentsSerialize";
import type { FileTreeNode, SelectionComment, WorkspaceInfo } from "../types/iliad";

const PERSIST_DEBOUNCE_MS = 280;
const SENT_FADE_MS = 220;

interface UseSelectionCommentsOptions {
  activeFile: FileTreeNode | null;
  documentText: string;
  language: "en" | "es";
  workspace: WorkspaceInfo | null;
  /** Fired when a comment is created (used for the one transient toggle pulse). */
  onCommentSaved?: () => void;
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

export interface SelectionCommentsSendPayload {
  block: string;
  ids: string[];
  count: number;
}

function commentId() {
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * State owner for selection comments on the open document: CRUD, position
 * intake from the editor extension, re-anchoring on document open / full
 * replacement, serialization, and sent/revert transitions. Lives in App.tsx
 * composition — no selection-comment state may live in useAssistantRun or
 * AssistantPanel (the panel unmounts when closed and in focus mode).
 */
export function useSelectionComments({
  activeFile,
  documentText,
  language,
  workspace,
  onCommentSaved
}: UseSelectionCommentsOptions) {
  const [comments, setComments] = useState<SelectionComment[]>([]);
  const stateRef = useRef<{ relativePath: string | null; comments: SelectionComment[]; dirty: boolean }>({
    relativePath: null,
    comments: [],
    dirty: false
  });
  // Updated during render so callbacks fired from CodeMirror effects (which run
  // before this hook's own effects) always see the latest file/text.
  const activeFilePathRef = useRef<string | null>(null);
  const documentTextRef = useRef(documentText);
  activeFilePathRef.current = activeFile?.path ?? null;
  documentTextRef.current = documentText;
  const persistTimer = useRef<number | null>(null);
  const fadeTimers = useRef<Set<number>>(new Set());
  const onCommentSavedRef = useRef(onCommentSaved);
  onCommentSavedRef.current = onCommentSaved;
  const workspaceSessionId = useMemo(
    () => (workspace ? workspaceContextApiSessionId(workspace) : null),
    [workspace?.path, workspace?.sessionId]
  );
  const workspaceSessionIdRef = useRef(workspaceSessionId);
  workspaceSessionIdRef.current = workspaceSessionId;
  const workspacePath = workspace?.path ?? null;
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;

  const flushPersist = useCallback(() => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }

    const { relativePath, comments: current, dirty } = stateRef.current;
    const sessionId = workspaceSessionIdRef.current;

    if (!dirty || !relativePath || !sessionId) {
      return;
    }

    stateRef.current.dirty = false;
    window.iliad.selectionComments
      ?.save(sessionId, relativePath, pendingSelectionComments(current))
      .catch((error) => {
        console.warn("selection-comments:save failed", error);
      });
  }, []);

  const schedulePersist = useCallback(() => {
    stateRef.current.dirty = true;

    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }

    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }, [flushPersist]);

  const applyComments = useCallback(
    (updater: (current: SelectionComment[]) => SelectionComment[], options?: { persist?: boolean }) => {
      const next = updater(stateRef.current.comments);
      stateRef.current.comments = next;
      setComments(next);

      if (options?.persist !== false) {
        schedulePersist();
      }
    },
    [schedulePersist]
  );

  // Document open / switch: persist switched-away state, then load and
  // re-anchor the stored comments for the newly opened document.
  useEffect(() => {
    flushPersist();
    stateRef.current = { relativePath: null, comments: [], dirty: false };
    setComments([]);

    if (!workspacePath || !activeFile || activeFile.kind !== "markdown") {
      return;
    }

    const relativePath = normalizeRelativePath(activeFile.relativePath);
    stateRef.current.relativePath = relativePath;
    const sessionId = workspaceSessionIdRef.current;
    let canceled = false;

    if (!sessionId) {
      return;
    }

    window.iliad.selectionComments
      ?.list(sessionId)
      .then((stored) => {
        if (canceled || stateRef.current.relativePath !== relativePath) {
          return;
        }

        const documentComments = stored.filter(
          (comment) =>
            comment.status === "pending" &&
            normalizeRelativePath(comment.documentRelativePath).toLowerCase() === relativePath.toLowerCase()
        );

        if (documentComments.length === 0) {
          return;
        }

        const anchored = reanchorSelectionComments(
          documentComments.map((comment) => ({
            ...comment,
            documentRelativePath: normalizeRelativePath(comment.documentRelativePath)
          })),
          documentTextRef.current,
          relativePath
        );
        stateRef.current.comments = anchored;
        setComments(anchored);
      })
      .catch((error) => {
        console.warn("selection-comments:list failed", error);
      });

    return () => {
      canceled = true;
    };
  }, [activeFile?.path, flushPersist, workspacePath]);

  useEffect(() => {
    const timers = fadeTimers.current;
    const onBeforeUnload = () => flushPersist();
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushPersist();

      for (const timer of timers) {
        window.clearTimeout(timer);
      }

      timers.clear();
    };
  }, [flushPersist]);

  const createComment = useCallback(
    (draft: SelectionCommentDraft) => {
      const relativePath = stateRef.current.relativePath;
      const currentWorkspacePath = workspacePathRef.current;

      if (!relativePath || !currentWorkspacePath || !draft.comment.trim()) {
        return;
      }

      const anchor = captureSelectionAnchor(documentTextRef.current, draft.from, draft.to);
      const comment: SelectionComment = {
        id: commentId(),
        workspacePath: currentWorkspacePath,
        documentRelativePath: relativePath,
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
      onCommentSavedRef.current?.();
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
      applyComments((current) => removeSelectionComment(current, id));
    },
    [applyComments]
  );

  /** Position intake from the editor extension; ignored across document switches. */
  const applyPositionUpdates = useCallback(
    (documentPath: string, updates: SelectionCommentPositionUpdate[]) => {
      if (documentPath !== activeFilePathRef.current || updates.length === 0) {
        return;
      }

      const byId = new Map(updates.map((update) => [update.id, update]));
      let changed = false;
      const next = stateRef.current.comments.map((comment) => {
        const update = byId.get(comment.id);

        if (!update || comment.status !== "pending" || (comment.from === update.from && comment.to === update.to)) {
          return comment;
        }

        changed = true;
        return { ...comment, from: update.from, to: update.to };
      });

      // Guard against update loops: only commit when positions actually changed.
      if (changed) {
        stateRef.current.comments = next;
        setComments(next);
        schedulePersist();
      }
    },
    [schedulePersist]
  );

  /** Full-content replacements (proposal apply, document swap) re-anchor instead of mapping. */
  const applyFullReplacement = useCallback(
    (documentPath: string, replacementText: string) => {
      if (documentPath !== activeFilePathRef.current) {
        return;
      }

      const relativePath = stateRef.current.relativePath;

      if (!relativePath || stateRef.current.comments.length === 0) {
        return;
      }

      applyComments((current) => {
        const pending = pendingSelectionComments(current);
        const others = current.filter((comment) => comment.status !== "pending");
        return [...reanchorSelectionComments(pending, replacementText, relativePath), ...others];
      });
    },
    [applyComments]
  );

  const buildSendPayload = useCallback(
    (hasTypedText: boolean): SelectionCommentsSendPayload | null => {
      const pending = pendingSelectionComments(stateRef.current.comments);
      const relativePath = stateRef.current.relativePath;

      if (pending.length === 0 || !relativePath) {
        return null;
      }

      const documentName = relativePath.split("/").filter(Boolean).pop() ?? relativePath;

      return {
        block: serializeSelectionComments({
          comments: pending,
          documentText: documentTextRef.current,
          documentName,
          language,
          userTypedText: hasTypedText
        }),
        ids: pending.map((comment) => comment.id),
        count: pending.length
      };
    },
    [language]
  );

  const markSent = useCallback(
    (ids: string[]) => {
      applyComments((current) => markSelectionCommentsSent(current, ids));
      const timer = window.setTimeout(() => {
        fadeTimers.current.delete(timer);
        // Sent trace is none: after the wash fade, sent comments are cleared
        // entirely (the transcript is the record). Reverted ones are skipped.
        applyComments((current) => clearSentSelectionComments(current, ids), { persist: false });
      }, SENT_FADE_MS);
      fadeTimers.current.add(timer);
    },
    [applyComments]
  );

  const revertSent = useCallback(
    (ids: string[]) => {
      applyComments((current) => revertSelectionCommentsToPending(current, ids));
    },
    [applyComments]
  );

  return {
    comments,
    createComment,
    updateComment,
    deleteComment,
    applyPositionUpdates,
    applyFullReplacement,
    buildSendPayload,
    markSent,
    revertSent
  };
}
