import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { companionPathsFor, isCompanionPath } from "../files/companionFiles";
import { findNode } from "../files/fileTree";
import type { OpenNodeResult } from "../files/fileActions";
import { migrateLegacyWritingNotes } from "../notes/legacyWritingNotes";
import type { FileTreeNode, WorkspaceChangeEvent, WorkspaceInfo } from "../types/iliad";

interface UseWritingNotesOptions {
  activeFile: FileTreeNode | null;
  workspace: WorkspaceInfo | null;
  lastWorkspaceChange: WorkspaceChangeEvent | null;
  tree: FileTreeNode[];
  openNode: (node: FileTreeNode) => Promise<OpenNodeResult>;
  refreshTree: (workspacePath: string) => Promise<FileTreeNode[]>;
  onError: (message: string) => void;
  messages: { openNotesFailed: string };
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "").trim();
}

/**
 * Writing notes for the open document live in `stem.notes.md` next to it
 * (spec V20). The whole file is guidance for autocomplete. It is read when
 * the document opens and whenever the file changes; "Open notes" creates an
 * empty file if needed and opens it in the editor.
 */
export function useWritingNotes({
  activeFile,
  workspace,
  lastWorkspaceChange,
  tree,
  openNode,
  refreshTree,
  onError,
  messages
}: UseWritingNotesOptions) {
  const workspacePath = workspace?.path ?? null;
  const target = useMemo(() => {
    if (!workspacePath || activeFile?.kind !== "markdown" || isCompanionPath(activeFile.relativePath)) {
      return null;
    }

    const notesPath = companionPathsFor(activeFile.path)?.notes;
    const notesRelativePath = companionPathsFor(normalizeRelativePath(activeFile.relativePath))?.notes;

    return notesPath && notesRelativePath
      ? {
          workspacePath,
          documentRelativePath: normalizeRelativePath(activeFile.relativePath),
          notesPath,
          notesRelativePath
        }
      : null;
  }, [activeFile?.kind, activeFile?.path, activeFile?.relativePath, workspacePath]);
  const [notes, setNotes] = useState<{ path: string; text: string } | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const readSeqRef = useRef(0);

  const readNotes = useCallback(async () => {
    const current = targetRef.current;
    const seq = ++readSeqRef.current;

    if (!current) {
      setNotes(null);
      return;
    }

    try {
      const result = await window.iliad.companions.read(current.workspacePath, current.notesPath);

      if (seq === readSeqRef.current && targetRef.current === current) {
        setNotes({ path: current.notesPath, text: result.status === "present" ? result.content : "" });
      }
    } catch (error) {
      console.warn("notes: read failed", error);
    }
  }, []);

  // Document open: migrate legacy localStorage notes once, then read.
  useEffect(() => {
    const current = target;

    if (!current) {
      setNotes(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const migrated = await migrateLegacyWritingNotes({
          storage: window.localStorage,
          workspacePath: current.workspacePath,
          documentRelativePath: current.documentRelativePath,
          writeIfAbsent: (content) =>
            window.iliad.writeMarkdown(current.workspacePath, current.notesPath, content, { kind: "absent" })
        });

        if (migrated === "written") {
          void refreshTree(current.workspacePath).catch(() => undefined);
        }
      } catch (error) {
        console.warn("notes: migration failed", error);
      }

      if (!cancelled) {
        await readNotes();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [readNotes, refreshTree, target]);

  // Outside changes to the notes file (or a degraded watcher): re-read.
  useEffect(() => {
    const current = targetRef.current;

    if (!current || !lastWorkspaceChange || lastWorkspaceChange.workspaceRoot !== current.workspacePath) {
      return;
    }

    const paths = lastWorkspaceChange.changedMarkdownPaths ?? [];
    const touches =
      lastWorkspaceChange.watcherDegraded ||
      (lastWorkspaceChange.markdownChanged && paths.length === 0) ||
      paths.some((changed) => normalizeRelativePath(changed).toLowerCase() === current.notesRelativePath.toLowerCase());

    if (touches) {
      void readNotes();
    }
  }, [lastWorkspaceChange, readNotes]);

  // The notes file appeared or disappeared in the tree (created, trashed, edited in Iliad and saved).
  const notesPresent = useMemo(
    () => (target ? Boolean(findNode(tree, target.notesPath)) : null),
    [target, tree]
  );
  const notesPresentRef = useRef<{ path: string | null; present: boolean | null }>({ path: null, present: null });

  useEffect(() => {
    const previous = notesPresentRef.current;
    const path = target?.notesPath ?? null;
    notesPresentRef.current = { path, present: notesPresent };

    if (path && previous.path === path && previous.present !== null && previous.present !== notesPresent) {
      void readNotes();
    }
  }, [notesPresent, readNotes, target?.notesPath]);

  const openNotes = useCallback(async () => {
    const current = targetRef.current;

    if (!current) {
      return;
    }

    try {
      // Exclusive create: an existing notes file is never touched.
      const created = await window.iliad.writeMarkdown(current.workspacePath, current.notesPath, "", { kind: "absent" });

      if (created.status === "conflict" && created.reason !== "disk_changed") {
        throw new Error(messages.openNotesFailed);
      }

      const nextTree = await refreshTree(current.workspacePath);
      const node = findNode(nextTree, current.notesPath);

      if (!node) {
        throw new Error(messages.openNotesFailed);
      }

      await openNode(node);
    } catch (error) {
      onError(error instanceof Error ? error.message : messages.openNotesFailed);
    }
  }, [messages.openNotesFailed, onError, openNode, refreshTree]);

  const notesText = notes && target && notes.path === target.notesPath ? notes.text : "";

  return {
    /** The notes file text for the open document ("" when there is none). */
    notesText,
    /** False when the open file cannot have notes (no document, or it is itself a companion). */
    notesAvailable: Boolean(target),
    openNotes
  };
}
