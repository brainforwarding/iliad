export type AutocompleteDirection = "continue" | "example" | "transition" | "tension";
export type AutocompleteLength = "inline" | "sentence" | "paragraph";
export interface WritingGuidance { enabled: boolean; voice: string; facts: string }
export interface AutocompletePreferences {
  manualOnly: boolean;
  announce: boolean;
  shortcuts: Record<AutocompleteLength, string>;
}
export const defaultAutocompletePreferences: AutocompletePreferences = {
  manualOnly: false, announce: false,
  shortcuts: { inline: "Ctrl-Space", sentence: "Mod-Enter", paragraph: "Mod-Shift-Enter" }
};
export const autocompleteShortcutChoices = ["Ctrl-Space", "Mod-Enter", "Mod-Shift-Enter", "Mod-Alt-Enter", "Mod-Shift-Space", "Alt-Enter"];
export const emptyWritingGuidance: WritingGuidance = { enabled: true, voice: "", facts: "" };

export function normalizeAutocompletePreferences(value: unknown): AutocompletePreferences {
  const saved = value as Partial<AutocompletePreferences> | null;
  const shortcuts = { ...defaultAutocompletePreferences.shortcuts };
  const values = (["inline", "sentence", "paragraph"] as const).map((kind) => saved?.shortcuts?.[kind]);
  if (new Set(values).size === 3 && values.every((key) => typeof key === "string" && autocompleteShortcutChoices.includes(key))) {
    for (const kind of ["inline", "sentence", "paragraph"] as const) {
      shortcuts[kind] = saved!.shortcuts![kind];
    }
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
