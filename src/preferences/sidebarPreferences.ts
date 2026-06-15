import { useCallback, useEffect, useState, type SetStateAction } from "react";

export const minimumSidebarWidth = 220;
export const defaultSidebarWidth = 276;
export const maximumPreferredSidebarWidth = 560;
export const sidebarWidthStorageKey = "iliad:sidebar-width";

export function clampSidebarWidth(value: number, maximumWidth = maximumPreferredSidebarWidth) {
  const finiteValue = Number.isFinite(value) ? value : defaultSidebarWidth;
  const finiteMaximumWidth = Number.isFinite(maximumWidth) ? maximumWidth : maximumPreferredSidebarWidth;
  const effectiveMaximum = Math.round(Math.max(minimumSidebarWidth, finiteMaximumWidth));

  return Math.min(effectiveMaximum, Math.max(minimumSidebarWidth, Math.round(finiteValue)));
}

export function readSidebarWidth() {
  const storedValue = localStorage.getItem(sidebarWidthStorageKey);

  if (!storedValue) {
    return defaultSidebarWidth;
  }

  const parsed = Number(storedValue);

  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : defaultSidebarWidth;
}

export function useSidebarWidth() {
  const [sidebarWidth, setSidebarWidthState] = useState(() => readSidebarWidth());

  useEffect(() => {
    localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  const setSidebarWidth = useCallback((nextValue: SetStateAction<number>) => {
    setSidebarWidthState((currentValue) => {
      const value = typeof nextValue === "function" ? nextValue(currentValue) : nextValue;

      return clampSidebarWidth(value);
    });
  }, []);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidthState(defaultSidebarWidth);
  }, []);

  return {
    sidebarWidth,
    resetSidebarWidth,
    setSidebarWidth
  };
}
