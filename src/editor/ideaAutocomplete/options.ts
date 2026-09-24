export type AutocompleteDirection = "continue" | "example" | "transition" | "tension";
export type AutocompleteLength = "sentence" | "paragraph" | "idea";
/** The text of the document's `stem.notes.md` companion (spec V20). */
export type WritingGuidance = string;
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

const guidanceLimit = 1800;

/**
 * Guidance for one request from the whole notes file: short notes go as they
 * are; longer ones keep the lines most relevant to the text around the
 * cursor, in the writer's order, within a small budget.
 */
export function selectWritingGuidance(notes: WritingGuidance | undefined, context: string): string {
  const lines = (notes ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const whole = lines.join("\n");

  if (whole.length <= 1200) {
    return whole;
  }

  const terms = new Set(context.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const ranked = lines.map((line, index) => ({ line, index,
    score: (line.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((term) => terms.has(term)).length
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const kept: typeof ranked = [];
  let length = 0;

  for (const candidate of ranked) {
    if (kept.length >= 10 || length + candidate.line.length + 1 > guidanceLimit) {
      continue;
    }

    kept.push(candidate);
    length += candidate.line.length + 1;
  }

  if (kept.length === 0) {
    return whole.slice(0, guidanceLimit);
  }

  return kept.sort((a, b) => a.index - b.index).map(({ line }) => line).join("\n").slice(0, guidanceLimit);
}

/** The localStorage key of a document's notes before notes became a file (read only to migrate). */
export function writingGuidanceStorageKey(workspacePath: string, documentPath: string) {
  return `iliad:writing-notes:${JSON.stringify([workspacePath, documentPath])}`;
}

export function shortcutLabel(key: string, mac = /Mac/.test(globalThis.navigator?.platform ?? "")) {
  return key.replace("Mod", mac ? "⌘" : "Ctrl").replace("Alt", mac ? "⌥" : "Alt").replace("Shift", "⇧").replace("Space", "Space").replaceAll("-", "+");
}
