export type AutocompleteDirection = "continue" | "example" | "transition" | "tension";
export type AutocompleteLength = "sentence" | "paragraph" | "idea";
export interface WritingGuidance { enabled: boolean; voice: string; facts: string }
export type AutocompleteShortcutAction = "continue" | AutocompleteLength;
export interface AutocompletePreferences {
  manualOnly: boolean;
  announce: boolean;
  /**
   * `continue` is the AI key: a sentence (press again for longer) with nothing
   * selected, the AI menu over a selection. Each length also has a direct key
   * that asks for that length in one request.
   */
  shortcuts: Record<AutocompleteShortcutAction, string>;
}
export const autocompleteShortcutActions: AutocompleteShortcutAction[] = ["continue", "sentence", "paragraph", "idea"];
export const defaultAutocompletePreferences: AutocompletePreferences = {
  manualOnly: false, announce: false,
  // Three neighbouring keys on an English keyboard: short → long, left → right.
  shortcuts: { continue: "Mod-Enter", sentence: "Mod-,", paragraph: "Mod-.", idea: "Mod-/" }
};
export const autocompleteShortcutChoices = [
  "Mod-Enter", "Mod-Alt-Enter", "Alt-Enter", "Mod-Shift-Enter", "Mod-Shift-Space", "Ctrl-Space",
  "Mod-,", "Mod-.", "Mod-/", "Mod-1", "Mod-2", "Mod-3", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3"
];
export const emptyWritingGuidance: WritingGuidance = { enabled: true, voice: "", facts: "" };

export function normalizeAutocompletePreferences(value: unknown): AutocompletePreferences {
  const saved = value as { manualOnly?: unknown; announce?: unknown; shortcuts?: Record<string, unknown> } | null;
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
  return { manualOnly: saved?.manualOnly === true, announce: saved?.announce === true, shortcuts };
}

export function normalizeWritingGuidance(value: unknown): WritingGuidance {
  const saved = value as Partial<WritingGuidance> | null;
  return { enabled: saved?.enabled !== false,
    voice: typeof saved?.voice === "string" ? saved.voice.slice(0, 400) : "",
    facts: typeof saved?.facts === "string" ? saved.facts.slice(0, 4000) : "" };
}

/** Select a few relevant facts, preserving the author's order and keeping prompts small. */
export function selectWritingGuidance(notes: WritingGuidance | undefined, context: string): string {
  if (!notes?.enabled) return "";
  const terms = new Set(context.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const lines = notes.facts.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const ranked = lines.map((line, index) => ({ line, index,
    score: (line.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((term) => terms.has(term)).length
  })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 6).sort((a, b) => a.index - b.index);
  return [notes.voice.trim(), ...ranked.map(({ line }) => line)].filter(Boolean).join("\n").slice(0, 1800);
}

export function writingGuidanceStorageKey(workspacePath: string, documentPath: string) {
  return `iliad:writing-notes:${JSON.stringify([workspacePath, documentPath])}`;
}

export function shortcutLabel(key: string, mac = /Mac/.test(globalThis.navigator?.platform ?? "")) {
  return key.replace("Mod", mac ? "⌘" : "Ctrl").replace("Alt", mac ? "⌥" : "Alt").replace("Shift", "⇧").replace("Space", "Space").replaceAll("-", "+");
}
