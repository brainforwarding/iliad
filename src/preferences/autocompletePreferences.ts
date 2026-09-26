import { useCallback, useState } from "react";
import { defaultAutocompletePreferences, normalizeAutocompletePreferences, type AutocompletePreferences } from "../editor/ideaAutocomplete/options";

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep session preferences usable if storage is full. */ }
}
const preferencesKey = "iliad:autocomplete-preferences";

/** Autocomplete display preferences: the shortcut keys. */
export function useAutocompletePreferences() {
  const [preferences, setPreferencesState] = useState(() => normalizeAutocompletePreferences(read(preferencesKey)));
  const setPreferences = useCallback((value: AutocompletePreferences) => {
    const normalized = normalizeAutocompletePreferences(value);
    save(preferencesKey, normalized);
    setPreferencesState(normalized);
  }, []);
  return { preferences, setPreferences,
    resetShortcuts: () => setPreferences({ ...preferences, shortcuts: { ...defaultAutocompletePreferences.shortcuts } }) };
}
