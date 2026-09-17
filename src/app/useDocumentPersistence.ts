import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTreeNode, MarkdownWriteConflictReason, WorkspaceInfo } from "../types/iliad";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error" | "conflict";

interface UseDocumentPersistenceOptions {
  activeFile: FileTreeNode | null;
  messages: {
    saveDocumentFallback: string;
  };
  onError: (message: string) => void;
  workspace: WorkspaceInfo | null;
}

/**
 * Thrown by save paths when main refused the write because the file on disk
 * no longer matches what the editor last loaded or saved. Navigation and file
 * actions treat it like any other save failure and stop.
 */
export class DocumentConflictError extends Error {
  constructor(readonly reason: MarkdownWriteConflictReason) {
    super("The document changed outside Iliad.");
    this.name = "DocumentConflictError";
  }
}

const autosaveDelayMs = 900;

function formatSaveTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function documentCloseRequiresChoice(saveStatus: SaveStatus) {
  return saveStatus === "unsaved" || saveStatus === "error" || saveStatus === "conflict";
}

export async function hashDocumentText(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useDocumentPersistence({ activeFile, messages, onError, workspace }: UseDocumentPersistenceOptions) {
  const [documentText, setDocumentTextState] = useState("");
  const [savedText, setSavedTextState] = useState("");
  const [saveStatus, setSaveStatusState] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusRef = useRef<SaveStatus>("saved");
  const stateRef = useRef({ workspace, activeFile, documentText, savedText });

  // The refs are updated synchronously by the setters below, not only after
  // the next render: callbacks that run between a state change and its render
  // (review pushes, autosave timers) must see the latest text and status.
  const setDocumentText = useCallback((value: string) => {
    stateRef.current = { ...stateRef.current, documentText: value };
    setDocumentTextState(value);
  }, []);
  const setSavedText = useCallback((value: string) => {
    stateRef.current = { ...stateRef.current, savedText: value };
    setSavedTextState(value);
  }, []);
  const setSaveStatus = useCallback((value: SaveStatus) => {
    saveStatusRef.current = value;
    setSaveStatusState(value);
  }, []);

  useEffect(() => {
    stateRef.current = { ...stateRef.current, workspace, activeFile };
  }, [workspace, activeFile]);

  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const saveCurrentDocument = useCallback(async (nextText?: string) => {
    const current = stateRef.current;

    if (!current.workspace || !current.activeFile || current.activeFile.kind !== "markdown") {
      return;
    }

    const textToSave = nextText ?? current.documentText;

    if (textToSave === current.savedText) {
      if (saveStatusRef.current !== "conflict") {
        setSaveStatus("saved");
      }
      return;
    }

    try {
      setSaveStatus("saving");
      // The expected hash is the renderer's trusted identity of what is on
      // disk: the text it last loaded or saved. Main refuses the write when the
      // file no longer matches, instead of letting the last writer win.
      const expected = { kind: "hash" as const, hash: await hashDocumentText(current.savedText) };
      const result = await window.iliad.writeMarkdown(
        current.workspace.path,
        current.activeFile.path,
        textToSave,
        expected
      );

      if (result.status === "conflict") {
        setSaveStatus("conflict");
        throw new DocumentConflictError(result.reason);
      }

      setSavedText(textToSave);

      if (
        stateRef.current.activeFile?.path === current.activeFile.path &&
        stateRef.current.documentText === textToSave
      ) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("unsaved");
      }

      setLastSavedAt(formatSaveTime(new Date()));
    } catch (saveError) {
      if (saveError instanceof DocumentConflictError) {
        throw saveError;
      }

      setSaveStatus("error");
      onError(saveError instanceof Error ? saveError.message : messages.saveDocumentFallback);
      throw saveError;
    }
  }, [messages.saveDocumentFallback, onError, setSaveStatus, setSavedText]);

  const flushSave = useCallback(async () => {
    cancelPendingSave();

    await saveCurrentDocument();
  }, [cancelPendingSave, saveCurrentDocument]);

  const scheduleAutosave = useCallback(
    (value: string) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        saveCurrentDocument(value).catch(() => {
          // Errors are already reflected in saveStatus; the timer must not reject.
        });
      }, autosaveDelayMs);
    },
    [saveCurrentDocument]
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setDocumentText(value);

      // In conflict mode the buffer keeps the writer's text and autosave stays
      // disarmed until the conflict is resolved through the review actions.
      if (saveStatusRef.current === "conflict") {
        return;
      }

      setSaveStatus(value === stateRef.current.savedText ? "saved" : "unsaved");
      scheduleAutosave(value);
    },
    [scheduleAutosave, setDocumentText, setSaveStatus]
  );

  /**
   * Called after the outside change for the active file was resolved without
   * touching the buffer (restore, or the outside tool reverted the file). Disk
   * matches `savedText` again, so the writer's edits can save normally.
   */
  const resumeAfterConflict = useCallback(() => {
    if (saveStatusRef.current !== "conflict") {
      return;
    }

    const current = stateRef.current;
    const dirty = current.documentText !== current.savedText;
    setSaveStatus(dirty ? "unsaved" : "saved");

    if (dirty) {
      scheduleAutosave(current.documentText);
    }
  }, [scheduleAutosave, setSaveStatus]);

  const loadDocument = useCallback((text: string) => {
    cancelPendingSave();
    setDocumentText(text);
    setSavedText(text);
    setSaveStatus("saved");
    setLastSavedAt(null);
  }, [cancelPendingSave, setDocumentText, setSaveStatus, setSavedText]);

  const clearDocument = useCallback(() => {
    cancelPendingSave();
    setDocumentText("");
    setSavedText("");
    setSaveStatus("saved");
    setLastSavedAt(null);
  }, [cancelPendingSave, setDocumentText, setSaveStatus, setSavedText]);

  useEffect(() => {
    const onBeforeUnload = () => {
      void flushSave().catch(() => undefined);
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flushSave]);

  return {
    documentText,
    savedText,
    saveStatus,
    lastSavedAt,
    stateRef,
    clearDocument,
    cancelPendingSave,
    flushSave,
    handleEditorChange,
    loadDocument,
    resumeAfterConflict,
    saveCurrentDocument,
    setDocumentText,
    setLastSavedAt,
    setSavedText,
    setSaveStatus
  };
}
