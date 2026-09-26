export type AutocompleteDirection = "continue" | "example" | "transition" | "tension";
export type AutocompleteLength = "sentence" | "paragraph" | "idea";
export type AutocompleteShortcutAction = "continue" | AutocompleteLength;
export interface AutocompletePreferences {
  /**
   * `continue` opens the ✦ AI menu over a selection (it does nothing without
   * one; the stored name predates that). Each length has a key that asks for
   * that length in one request; these are the only ways to get a suggestion.
   */
  shortcuts: Record<AutocompleteShortcutAction, string>;
}
export const autocompleteShortcutActions: AutocompleteShortcutAction[] = ["continue", "sentence", "paragraph", "idea"];
export const defaultAutocompletePreferences: AutocompletePreferences = {
  // Three neighbouring keys on an English keyboard: short → long, left → right.
  shortcuts: { continue: "Mod-Enter", sentence: "Mod-,", paragraph: "Mod-.", idea: "Mod-/" }
};
export const autocompleteShortcutChoices = [
  "Mod-Enter", "Mod-Alt-Enter", "Alt-Enter", "Mod-Shift-Enter", "Mod-Shift-Space", "Ctrl-Space",
  "Mod-,", "Mod-.", "Mod-/", "Mod-1", "Mod-2", "Mod-3", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3"
];

export function normalizeAutocompletePreferences(value: unknown): AutocompletePreferences {
  // Older stored values may also carry `manualOnly` and `announce`; they are ignored.
  const saved = value as { shortcuts?: Record<string, unknown> } | null;
  const valid = (key: unknown): key is string => typeof key === "string" && autocompleteShortcutChoices.includes(key);
  const used = new Set<string>();
  const take = (...candidates: unknown[]) => {
    const key = candidates.find((candidate): candidate is string => valid(candidate) && !used.has(candidate)) ??
      autocompleteShortcutChoices.find((choice) => !used.has(choice))!;
    used.add(key);
    return key;
  };
  const defaults = defaultAutocompletePreferences.shortcuts;
  const current = saved?.shortcuts;
  // Before the direct length keys existed, `sentence` held the main manual key
  // (and `continue` briefly held the only key); both migrate to the AI key.
  const legacy = current && !("idea" in current);
  const shortcuts = { continue: take(current?.continue, legacy ? current?.sentence : undefined, defaults.continue) } as AutocompletePreferences["shortcuts"];
  for (const kind of ["sentence", "paragraph", "idea"] as const) {
    shortcuts[kind] = take(legacy ? undefined : current?.[kind], defaults[kind]);
  }
  return { shortcuts };
}

/** A compact key label for key chips: "⌘↵", "⌥⌘1" on macOS; "Ctrl+Enter" elsewhere. */
export function compactShortcutLabel(key: string, mac = /Mac/.test(globalThis.navigator?.platform ?? "")) {
  const parts = key.split("-").map((part) => {
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    if (part === "Ctrl") return mac ? "⌃" : "Ctrl";
    if (part === "Enter") return mac ? "↵" : "Enter";
    return part;
  });
  return parts.join(mac ? "" : "+");
}

export function shortcutLabel(key: string, mac = /Mac/.test(globalThis.navigator?.platform ?? "")) {
  return key.replace("Mod", mac ? "⌘" : "Ctrl").replace("Alt", mac ? "⌥" : "Alt").replace("Shift", "⇧").replace("Space", "Space").replaceAll("-", "+");
}
