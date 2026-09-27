import { base as baseKeys, shift as shiftKeys } from "w3c-keyname";

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
// Fallback pool when a stored key is missing, invalid or a duplicate (the
// fixed list writers picked from before keys were recorded).
const fallbackShortcuts = [
  "Mod-Enter", "Mod-Alt-Enter", "Alt-Enter", "Mod-Shift-Enter", "Mod-Shift-Space", "Ctrl-Space",
  "Mod-,", "Mod-.", "Mod-/", "Mod-1", "Mod-2", "Mod-3", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3"
];

// Non-character keys a shortcut may use (KeyboardEvent.key names).
const namedKeys = new Set([
  "Enter", "Space", "Backspace", "Delete", "Tab", "Escape", "Home", "End", "PageUp", "PageDown", "Insert",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", ...Array.from({ length: 20 }, (_, index) => `F${index + 1}`)
]);

const isMacPlatform = () => /Mac/.test(globalThis.navigator?.platform ?? "");
const modifierOrder = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof modifierOrder)[number];

/**
 * Splits a CodeMirror key name the way CodeMirror does, so "Mod--" is Mod + "-".
 * `valid` is false for an unknown modifier or a key name no keydown produces.
 */
export function parseShortcut(key: string): { modifiers: Set<Modifier>; key: string; valid: boolean } {
  const parts = key.split(/-(?!$)/);
  const modifiers = new Set<Modifier>();
  let valid = true;
  for (const part of parts.slice(0, -1)) {
    const name = modifierOrder.find((modifier) => modifier.toLowerCase() === part.toLowerCase());
    if (name) modifiers.add(name);
    else valid = false;
  }
  const name = parts[parts.length - 1] ?? "";
  return { modifiers, key: name, valid: valid && ([...name].length === 1 || namedKeys.has(name)) };
}

/** One spelling per shortcut: modifiers in Mod-Ctrl-Alt-Shift order. */
export function canonicalShortcut(key: string) {
  const parsed = parseShortcut(key);
  return [...modifierOrder.filter((modifier) => parsed.modifiers.has(modifier)), parsed.key].join("-");
}

// Keys Iliad already uses: the app menu (electron/main.ts roles on macOS), app
// shortcuts, and editor keys writers rely on. CodeMirror defaults that the
// length keys already override (Mod-/ toggle comment, Mod-Enter blank line,
// Mod-[ indent…) are deliberately not listed.
const takenShortcuts = new Set([
  "Mod-q", "Mod-h", "Mod-Alt-h", "Mod-z", "Mod-Shift-z", "Mod-x", "Mod-c", "Mod-v", "Mod-a",
  "Mod-0", "Mod-=", "Mod-+", "Mod-Shift-=", "Mod--", "Mod-Ctrl-f", "Mod-m",
  "Mod-w", "Mod-o", "Mod-n", "Mod-Ctrl-s", "Mod-Alt-f", "Mod-Shift-m", "Mod-Shift-j", "Alt-ArrowUp", "Alt-ArrowDown",
  "Mod-f", "Mod-g", "Mod-Shift-g", "Mod-y",
  ...["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete"].flatMap((key) =>
    [`Mod-${key}`, `Alt-${key}`, `Mod-Shift-${key}`, `Alt-Shift-${key}`])
].map(canonicalShortcut));

export type ShortcutCheck = "ok" | "taken" | "needs-modifier" | "invalid";

/** Whether a recorded key may be used: it needs ⌘ or ⌃ (or is ⌥↵) and must not be one Iliad already uses. */
export function checkShortcut(key: string): ShortcutCheck {
  const { modifiers, key: name, valid } = parseShortcut(key);
  if (!valid) return "invalid";
  if (name === "Tab" || name === "Escape" || takenShortcuts.has(canonicalShortcut(key))) return "taken";
  return !modifiers.has("Mod") && !modifiers.has("Ctrl") && canonicalShortcut(key) !== "Alt-Enter" ? "needs-modifier" : "ok";
}

export function normalizeAutocompletePreferences(value: unknown): AutocompletePreferences {
  // Older stored values may also carry `manualOnly` and `announce`; they are ignored.
  const saved = value as { shortcuts?: Record<string, unknown> } | null;
  const valid = (key: unknown): key is string => typeof key === "string" && checkShortcut(key) === "ok";
  const used = new Set<string>();
  const take = (...candidates: unknown[]) => {
    const key = candidates.find((candidate): candidate is string => valid(candidate) && !used.has(canonicalShortcut(candidate))) ??
      fallbackShortcuts.find((choice) => !used.has(choice))!;
    used.add(canonicalShortcut(key));
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

export interface ShortcutKeyEvent {
  key: string;
  keyCode: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

const modifierKeys = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "OS", "Fn", "AltGraph", "Hyper", "Super"]);

/** The modifiers currently held, as a key-name prefix ("Mod-Alt"), for the chip while recording. */
export function heldModifiers(event: ShortcutKeyEvent, mac = isMacPlatform()) {
  const held = new Set<Modifier>();
  if (mac ? event.metaKey : event.ctrlKey) held.add("Mod");
  if (mac && event.ctrlKey) held.add("Ctrl");
  if (event.altKey) held.add("Alt");
  if (event.shiftKey) held.add("Shift");
  return modifierOrder.filter((modifier) => held.has(modifier)).join("-");
}

/**
 * The CodeMirror key name for a keydown, spelled the way CodeMirror's keymap
 * (`runHandlers` + `w3c-keyname`) will match it later, or null for a
 * modifier-only, dead or composing key.
 */
export function shortcutFromKeyEvent(event: ShortcutKeyEvent, mac = isMacPlatform()): string | null {
  if (event.isComposing || modifierKeys.has(event.key) || ["Dead", "Process", "Unidentified"].includes(event.key)) return null;
  const cmdShift = mac && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey;
  let name = (!cmdShift && event.key) || shiftKeys[event.keyCode] || "";
  if (!name) return null;
  if (name === " ") name = "Space";
  if (!parseShortcut(name).valid) return null;
  const isChar = [...name].length === 1;
  let shift = event.shiftKey && !isChar;
  // ⌥ (and ⇧ with ⌘) change the typed character on macOS (⌥1 → ¡); CodeMirror
  // then falls back to the unshifted key plus Shift, so record that.
  if (isChar && (event.altKey || (event.shiftKey && (event.metaKey || event.ctrlKey))) && baseKeys[event.keyCode]) {
    name = baseKeys[event.keyCode];
    shift = event.shiftKey;
  }
  if (isChar && !event.shiftKey && /^[A-Z]$/.test(name)) name = name.toLowerCase();
  // Fields are read one by one: a DOM KeyboardEvent's are prototype getters, lost by a spread.
  const modifiers = heldModifiers({ key: event.key, keyCode: event.keyCode, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: shift }, mac);
  return modifiers ? `${modifiers}-${name}` : name;
}

const macSymbols: Record<Modifier, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
const otherNames: Record<Modifier, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
const macKeyNames: Record<string, string> = {
  Enter: "↵", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backspace: "⌫", Delete: "⌦", Escape: "Esc"
};

function keyLabel(name: string, mac: boolean) {
  if (mac && macKeyNames[name]) return macKeyNames[name];
  return [...name].length === 1 ? name.toUpperCase() : name;
}

/** A compact key label for key chips: "⌘↵", "⌥⌘1" on macOS; "Ctrl+Enter" elsewhere. */
export function compactShortcutLabel(key: string, mac = isMacPlatform()) {
  if (modifierOrder.includes(key as Modifier)) return mac ? macSymbols[key as Modifier] : otherNames[key as Modifier];
  const { modifiers, key: name } = parseShortcut(key);
  if (mac) {
    // macOS order: ⌃⌥⇧⌘.
    const symbols = (["Ctrl", "Alt", "Shift", "Mod"] as const).filter((modifier) => modifiers.has(modifier)).map((modifier) => macSymbols[modifier]);
    return symbols.join("") + keyLabel(name, mac);
  }
  const names = modifierOrder.filter((modifier) => modifiers.has(modifier)).map((modifier) => otherNames[modifier]);
  return [...new Set(names), keyLabel(name, mac)].join("+");
}
