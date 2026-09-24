import { useCallback, useEffect, useState } from "react";
import { defaultAutocompletePreferences, normalizeAutocompletePreferences, type AutocompletePreferences } from "../editor/ideaAutocomplete/options";

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep session preferences usable if storage is full. */ }
}
const preferencesKey = "iliad:autocomplete-preferences";

/** Autocomplete display preferences and the session snooze. Writing notes live in `stem.notes.md` (useWritingNotes). */
export function useAutocompletePreferences() {
  const [preferences, setPreferencesState] = useState(() => normalizeAutocompletePreferences(read(preferencesKey)));
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
  return { preferences, setPreferences, snoozedUntil,
    toggleSnooze: () => setSnoozedUntil((until) => until > Date.now() ? 0 : Date.now() + 10 * 60_000),
    resetShortcuts: () => setPreferences({ ...preferences, shortcuts: { ...defaultAutocompletePreferences.shortcuts } }) };
}
