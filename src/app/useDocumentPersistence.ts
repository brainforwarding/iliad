import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTreeNode, WorkspaceInfo } from "../types/iliad";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

interface UseDocumentPersistenceOptions {
  activeFile: FileTreeNode | null;
  messages: {
    saveDocumentFallback: string;
  };
  onError: (message: string) => void;
  workspace: WorkspaceInfo | null;
}

function formatSaveTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function documentCloseRequiresChoice(saveStatus: SaveStatus) {
  return saveStatus === "unsaved" || saveStatus === "error";
}

export function useDocumentPersistence({ activeFile, messages, onError, workspace }: UseDocumentPersistenceOptions) {
  const [documentText, setDocumentText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ workspace, activeFile, documentText, savedText });

  useEffect(() => {
    stateRef.current = { workspace, activeFile, documentText, savedText };
  }, [workspace, activeFile, documentText, savedText]);

  const saveCurrentDocument = useCallback(async (nextText?: string) => {
    const current = stateRef.current;

    if (!current.workspace || !current.activeFile || current.activeFile.kind !== "markdown") {
      return;
    }

    const textToSave = nextText ?? current.documentText;

    if (textToSave === current.savedText) {
      setSaveStatus("saved");
      return;
    }

    try {
      setSaveStatus("saving");
      await window.iliad.writeMarkdown(current.workspace.path, current.activeFile.path, textToSave);
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
      setSaveStatus("error");
      onError(saveError instanceof Error ? saveError.message : messages.saveDocumentFallback);
      throw saveError;
    }
  }, [messages.saveDocumentFallback, onError]);

  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const flushSave = useCallback(async () => {
    cancelPendingSave();

    await saveCurrentDocument();
  }, [cancelPendingSave, saveCurrentDocument]);

  const handleEditorChange = useCallback(
    (value: string) => {
      setDocumentText(value);
      setSaveStatus(value === stateRef.current.savedText ? "saved" : "unsaved");

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void saveCurrentDocument(value);
      }, 900);
    },
    [saveCurrentDocument]
  );

  const loadDocument = useCallback((text: string) => {
    setDocumentText(text);
    setSavedText(text);
    setSaveStatus("saved");
    setLastSavedAt(null);
  }, []);

  const clearDocument = useCallback(() => {
    cancelPendingSave();
    stateRef.current = {
      ...stateRef.current,
      documentText: "",
      savedText: ""
    };
    setDocumentText("");
    setSavedText("");
    setSaveStatus("saved");
    setLastSavedAt(null);
  }, [cancelPendingSave]);

  useEffect(() => {
    const onBeforeUnload = () => {
      void flushSave();
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
    saveCurrentDocument,
    setDocumentText,
    setLastSavedAt,
    setSavedText,
    setSaveStatus
  };
}
