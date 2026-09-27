/** The Settings panel's tabs, in the order they sit at the bottom of the panel. */
export const settingsTabs = ["general", "typography", "writing"] as const;
export type SettingsTab = (typeof settingsTabs)[number];

export const defaultSettingsTab: SettingsTab = "general";
export const settingsTabStorageKey = "iliad:settings-tab";

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && (settingsTabs as readonly string[]).includes(value);
}

/** The last tab the writer used (a display preference; never written into the workspace). */
export function readSettingsTab(): SettingsTab {
  try {
    const stored = localStorage.getItem(settingsTabStorageKey);
    return isSettingsTab(stored) ? stored : defaultSettingsTab;
  } catch {
    return defaultSettingsTab;
  }
}

export function writeSettingsTab(tab: SettingsTab) {
  try {
    localStorage.setItem(settingsTabStorageKey, tab);
  } catch {
    // Storage can be unavailable; the tab is only a convenience.
  }
}

/** Arrow keys move between tabs (wrapping), Home/End jump to the ends; other keys return null. */
export function settingsTabForKey(current: SettingsTab, key: string): SettingsTab | null {
  const index = settingsTabs.indexOf(current);

  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return settingsTabs[(index + 1) % settingsTabs.length];
    case "ArrowLeft":
    case "ArrowUp":
      return settingsTabs[(index - 1 + settingsTabs.length) % settingsTabs.length];
    case "Home":
      return settingsTabs[0];
    case "End":
      return settingsTabs[settingsTabs.length - 1];
    default:
      return null;
  }
}
