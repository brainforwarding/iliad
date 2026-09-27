import { useCallback, useState } from "react";

/**
 * Writing preferences (spec 2026-09-27): one free-text box in Settings →
 * Writing, sent with autocomplete and ✦ AI edits (never with naming or the
 * corrector). App data for all folders; never written into Markdown.
 */
export const WRITING_PREFERENCES_STORAGE_KEY = "iliad:writing-preferences";
export const WRITING_PREFERENCES_MAX_CHARS = 1000;
/** The character count shows only from here on (Figma 19: "only near the limit"). */
export const WRITING_PREFERENCES_COUNT_FROM = 900;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The text box value, as typed (not trimmed), held to the limit like `maxLength`. */
export function clampWritingPreferences(value: unknown) {
  return typeof value === "string" ? value.slice(0, WRITING_PREFERENCES_MAX_CHARS) : "";
}

export function readWritingPreferences(storage: StorageLike | null = defaultStorage()) {
  try {
    return clampWritingPreferences(storage?.getItem(WRITING_PREFERENCES_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function saveWritingPreferences(value: string, storage: StorageLike | null = defaultStorage()) {
  const text = clampWritingPreferences(value);

  try {
    if (text.trim()) {
      storage?.setItem(WRITING_PREFERENCES_STORAGE_KEY, text);
    } else {
      storage?.removeItem(WRITING_PREFERENCES_STORAGE_KEY);
    }
  } catch {
    /* Keep the session value usable when storage is unavailable or full. */
  }

  return text;
}

/** What a request carries: trimmed, or undefined (not sent) when empty. */
export function writingPreferencesForRequest(value: string | null | undefined) {
  const text = clampWritingPreferences(value).trim();
  return text ? text : undefined;
}

export function useWritingPreferences() {
  const [writingPreferences, setState] = useState(() => readWritingPreferences());
  const setWritingPreferences = useCallback((value: string) => {
    setState(saveWritingPreferences(value));
  }, []);

  return { writingPreferences, setWritingPreferences };
}
