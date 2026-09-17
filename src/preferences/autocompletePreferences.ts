import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultAutocompletePreferences, emptyWritingGuidance, normalizeAutocompletePreferences, normalizeWritingGuidance,
  writingGuidanceStorageKey, type AutocompletePreferences, type WritingGuidance } from "../editor/ideaAutocomplete/options";

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep session preferences usable if storage is full. */ }
}
const preferencesKey = "iliad:autocomplete-preferences";

export function useAutocompletePreferences(workspacePath?: string, documentPath?: string) {
  const [preferences, setPreferencesState] = useState(() => normalizeAutocompletePreferences(read(preferencesKey)));
  const key = workspacePath && documentPath ? writingGuidanceStorageKey(workspacePath, documentPath) : "";
  const [notesState, setNotesState] = useState<{ key: string; value: WritingGuidance }>({ key: "", value: emptyWritingGuidance });
  // Resolve on the render that changes documents: never lend another document its notes.
  const guidance = useMemo(() => notesState.key === key ? notesState.value : normalizeWritingGuidance(key ? read(key) : null), [notesState, key]);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  useEffect(() => {
    if (!snoozedUntil) return;
    const timer = window.setTimeout(() => setSnoozedUntil(0), Math.max(0, snoozedUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [snoozedUntil]);
  const setPreferences = useCallback((value: AutocompletePreferences) => {
    const normalized = normalizeAutocompletePreferences(value);
    save(preferencesKey, normalized);
    setPreferencesState(normalized);
  }, []);
  const setGuidance = (value: WritingGuidance) => {
    if (!key) return;
    const normalized = normalizeWritingGuidance(value);
    save(key, normalized);
    setNotesState({ key, value: normalized });
  };
  return { preferences, setPreferences, guidance, setGuidance, snoozedUntil,
    toggleSnooze: () => setSnoozedUntil((until) => until > Date.now() ? 0 : Date.now() + 10 * 60_000),
    resetShortcuts: () => setPreferences({ ...preferences, shortcuts: { ...defaultAutocompletePreferences.shortcuts } }) };
}
