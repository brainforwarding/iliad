import { useCallback, useState } from "react";
import { appStrings } from "./strings";

export type AppLanguage = "en" | "es";

export const appLanguageStorageKey = "iliad:app-language";

export function normalizeAppLanguage(value: unknown): AppLanguage {
  return value === "es" ? "es" : "en";
}

function defaultAppLanguage(): AppLanguage {
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

export function readAppLanguage(): AppLanguage {
  const storedLanguage = localStorage.getItem(appLanguageStorageKey);

  if (storedLanguage === "en" || storedLanguage === "es") {
    return storedLanguage;
  }

  return defaultAppLanguage();
}

export function persistAppLanguage(language: AppLanguage) {
  localStorage.setItem(appLanguageStorageKey, language);
}

export function useAppLanguage() {
  const [language, setLanguageState] = useState<AppLanguage>(() => readAppLanguage());
  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    persistAppLanguage(nextLanguage);
    setLanguageState(nextLanguage);
  }, []);
  const t = appStrings[language];

  return { language, setLanguage, t };
}
