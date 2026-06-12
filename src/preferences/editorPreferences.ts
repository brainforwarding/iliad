import { useCallback, useEffect, useState, type SetStateAction } from "react";

export type EditorFontPreset = "serif" | "sans" | "mono";

export const defaultEditorFontSize = 17;
export const minimumEditorFontSize = 14;
export const maximumEditorFontSize = 24;
export const defaultEditorFontPreset: EditorFontPreset = "serif";
export const editorFontPresets: EditorFontPreset[] = ["serif", "sans", "mono"];

const editorFontSizeStorageKey = "iliad:editor-font-size";
const editorFontPresetStorageKey = "iliad:editor-font-preset";

export function clampEditorFontSize(value: number) {
  return Math.min(maximumEditorFontSize, Math.max(minimumEditorFontSize, value));
}

export function readEditorFontSize() {
  const storedValue = localStorage.getItem(editorFontSizeStorageKey);

  if (!storedValue) {
    return defaultEditorFontSize;
  }

  const parsed = Number(storedValue);

  return Number.isFinite(parsed) ? clampEditorFontSize(parsed) : defaultEditorFontSize;
}

export function readEditorFontPreset(): EditorFontPreset {
  const preset = localStorage.getItem(editorFontPresetStorageKey);

  if (preset === "serif" || preset === "sans" || preset === "mono") {
    return preset;
  }

  return defaultEditorFontPreset;
}

export function useEditorPreferences() {
  const [editorFontSize, setEditorFontSizeState] = useState(() => readEditorFontSize());
  const [editorFontPreset, setEditorFontPreset] = useState<EditorFontPreset>(() => readEditorFontPreset());

  useEffect(() => {
    localStorage.setItem(editorFontSizeStorageKey, String(editorFontSize));
  }, [editorFontSize]);

  useEffect(() => {
    localStorage.setItem(editorFontPresetStorageKey, editorFontPreset);
  }, [editorFontPreset]);

  const setEditorFontSize = useCallback((nextValue: SetStateAction<number>) => {
    setEditorFontSizeState((currentValue) => {
      const value = typeof nextValue === "function" ? nextValue(currentValue) : nextValue;

      return clampEditorFontSize(value);
    });
  }, []);

  const resetEditorPreferences = useCallback(() => {
    setEditorFontSizeState(defaultEditorFontSize);
    setEditorFontPreset(defaultEditorFontPreset);
  }, []);

  return {
    editorFontSize,
    editorFontPreset,
    resetEditorPreferences,
    setEditorFontPreset,
    setEditorFontSize
  };
}
