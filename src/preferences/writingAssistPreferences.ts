import { useCallback, useEffect, useState, type SetStateAction } from "react";

const correctorEnabledStorageKey = "iliad:writing-assist-corrector-enabled";
const autocompleteEnabledStorageKey = "iliad:writing-assist-autocomplete-enabled";
const autocompleteApiFallbackEnabledStorageKey = "iliad:writing-assist-autocomplete-api-fallback-enabled";
const externalChangesTrackingEnabledStorageKey = "iliad:writing-assist-external-changes-tracking-enabled";

function readBooleanPreference(key: string, fallback: boolean) {
  const storedValue = localStorage.getItem(key);

  if (storedValue === "true") {
    return true;
  }

  if (storedValue === "false") {
    return false;
  }

  return fallback;
}

function useStoredBooleanPreference(key: string, fallback: boolean) {
  const [value, setValueState] = useState(() => readBooleanPreference(key, fallback));

  useEffect(() => {
    localStorage.setItem(key, value ? "true" : "false");
  }, [key, value]);

  const setValue = useCallback((nextValue: SetStateAction<boolean>) => {
    setValueState((currentValue) => (typeof nextValue === "function" ? nextValue(currentValue) : nextValue));
  }, []);

  return [value, setValue] as const;
}

export function useWritingAssistPreferences() {
  const [correctorEnabled, setCorrectorEnabled] = useStoredBooleanPreference(correctorEnabledStorageKey, false);
  const [autocompleteEnabled, setAutocompleteEnabled] = useStoredBooleanPreference(autocompleteEnabledStorageKey, false);
  const [autocompleteApiFallbackEnabled, setAutocompleteApiFallbackEnabled] = useStoredBooleanPreference(
    autocompleteApiFallbackEnabledStorageKey,
    false
  );
  const [externalChangesTrackingEnabled, setExternalChangesTrackingEnabled] = useStoredBooleanPreference(
    externalChangesTrackingEnabledStorageKey,
    true
  );

  return {
    correctorEnabled,
    autocompleteEnabled,
    autocompleteApiFallbackEnabled,
    externalChangesTrackingEnabled,
    setCorrectorEnabled,
    setAutocompleteEnabled,
    setAutocompleteApiFallbackEnabled,
    setExternalChangesTrackingEnabled
  };
}
