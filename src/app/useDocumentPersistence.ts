import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTreeNode, MarkdownWriteConflictReason, WorkspaceInfo } from "../types/iliad";
import { createAutosaveFence } from "./autosaveFence";

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

/** A conflicted buffer may resume autosave only when disk hashes to its `savedText`. */
export async function conflictMayResume(diskText: string, savedText: string) {
  return (await hashDocumentText(diskText)) === (await hashDocumentText(savedText));
}

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
  const fenceRef = useRef(createAutosaveFence());
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

  const performSave = useCallback(async (nextText?: string) => {
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

  // Every save is tracked so the autosave fence can wait for one in flight.
  const saveCurrentDocument = useCallback(
    (nextText?: string) => fenceRef.current.trackSave(performSave(nextText)),
    [performSave]
  );

  const flushSave = useCallback(async () => {
    // A flush during the fence (navigation while the document is being
    // auto-renamed) waits for it, then saves to wherever the document is now.
    while (fenceRef.current.isHeld()) {
      await fenceRef.current.whenReleased();
    }

    cancelPendingSave();

    await saveCurrentDocument();
  }, [cancelPendingSave, saveCurrentDocument]);

  const scheduleAutosave = useCallback(
    (value: string) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      // While the fence is held typing only marks the buffer dirty; leaving
      // the fence re-arms autosave with the latest text.
      if (fenceRef.current.isHeld()) {
        return;
      }

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;

        if (fenceRef.current.isHeld()) {
          return;
        }

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
   * touching the buffer (restore, keep, or the outside tool reverted the
   * file). Autosave resumes only if disk again equals `savedText` — the
   * identity the next compare-and-swap write will assert; otherwise the
   * buffer stays in conflict (spec V5).
   */
  const resumeAfterConflict = useCallback(async () => {
    if (saveStatusRef.current !== "conflict") {
      return;
    }

    const current = stateRef.current;

    if (!current.workspace || !current.activeFile || current.activeFile.kind !== "markdown") {
      return;
    }

    let diskText: string;

    try {
      diskText = await window.iliad.readMarkdown(current.workspace.path, current.activeFile.path);
    } catch {
      return;
    }

    const latest = stateRef.current;

    if (saveStatusRef.current !== "conflict" || latest.activeFile?.path !== current.activeFile.path) {
      return;
    }

    if (!(await conflictMayResume(diskText, latest.savedText))) {
      return;
    }

    const dirty = latest.documentText !== latest.savedText;
    setSaveStatus(dirty ? "unsaved" : "saved");

    if (dirty) {
      scheduleAutosave(latest.documentText);
    }
  }, [scheduleAutosave, setSaveStatus]);

  /**
   * Runs `operation` with autosave paused (the autosave fence): the timer is
   * disarmed, a save in flight is awaited, and afterwards autosave re-arms if
   * the writer typed meanwhile — saving to the active file as it is then.
   */
  const runWithAutosavePaused = useCallback(
    <T,>(operation: () => Promise<T>) =>
      fenceRef.current.run(operation, {
        disarm: cancelPendingSave,
        rearm: () => {
          const latest = stateRef.current;

          if (saveStatusRef.current === "conflict" || latest.documentText === latest.savedText) {
            return;
          }

          setSaveStatus("unsaved");
          scheduleAutosave(latest.documentText);
        }
      }),
    [cancelPendingSave, scheduleAutosave, setSaveStatus]
  );

  /** Saved and quiet: no unsaved text, no autosave armed, no save in flight, not fenced. */
  const isDocumentSettled = useCallback(() => {
    const latest = stateRef.current;

    return (
      saveStatusRef.current === "saved" &&
      latest.documentText === latest.savedText &&
      saveTimer.current === null &&
      !fenceRef.current.hasSaveInFlight() &&
      !fenceRef.current.isHeld()
    );
  }, []);

  /**
   * The active document moved on disk (auto-rename inside the fence): the
   * ref follows immediately so a save re-armed by the fence targets the new
   * path even before React re-renders.
   */
  const noteActiveFileRelocated = useCallback((node: FileTreeNode) => {
    stateRef.current = { ...stateRef.current, activeFile: node };
  }, []);

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
    isDocumentSettled,
    loadDocument,
    noteActiveFileRelocated,
    resumeAfterConflict,
    runWithAutosavePaused,
    saveCurrentDocument,
    setDocumentText,
    setLastSavedAt,
    setSavedText,
    setSaveStatus
  };
}
