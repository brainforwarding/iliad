import { describe, expect, it } from "vitest";
import {
  checkShortcut,
  compactShortcutLabel,
  defaultAutocompletePreferences,
  normalizeAutocompletePreferences,
  shortcutFromKeyEvent,
  type ShortcutKeyEvent
} from "../../src/editor/ideaAutocomplete/options";
import { recordShortcutKeyDown } from "../../src/editor/ideaAutocomplete/shortcutRecording";

describe("autocomplete preferences", () => {
  it("loads old stored preferences with manualOnly and announce without error", () => {
    const stored = JSON.parse(JSON.stringify({
      manualOnly: true, announce: true,
      shortcuts: { continue: "Mod-Alt-Enter", sentence: "Mod-1", paragraph: "Mod-2", idea: "Mod-3" }
    }));
    const loaded = normalizeAutocompletePreferences(stored);
    expect(loaded).toEqual({ shortcuts: { continue: "Mod-Alt-Enter", sentence: "Mod-1", paragraph: "Mod-2", idea: "Mod-3" } });
    expect(loaded).not.toHaveProperty("manualOnly");
    expect(loaded).not.toHaveProperty("announce");
    expect(normalizeAutocompletePreferences({ manualOnly: false, announce: false })).toEqual(defaultAutocompletePreferences);
    expect(normalizeAutocompletePreferences("not an object")).toEqual(defaultAutocompletePreferences);
  });

  it("defaults to the AI key plus three neighbouring length keys", () => {
    expect(defaultAutocompletePreferences.shortcuts).toEqual({ continue: "Mod-Enter", sentence: "Mod-,", paragraph: "Mod-.", idea: "Mod-/" });
    expect(normalizeAutocompletePreferences(null).shortcuts).toEqual(defaultAutocompletePreferences.shortcuts);
  });

  it("migrates older key maps to the AI key and keeps every key distinct", () => {
    // Original per-length map: its sentence key was the main manual key.
    expect(normalizeAutocompletePreferences({ shortcuts: { inline: "Ctrl-Space", sentence: "Mod-Alt-Enter", paragraph: "Mod-Shift-Enter" } }).shortcuts)
      .toEqual({ ...defaultAutocompletePreferences.shortcuts, continue: "Mod-Alt-Enter" });
    // Single-key map from the first one-key version.
    expect(normalizeAutocompletePreferences({ shortcuts: { continue: "Alt-Enter" } }).shortcuts.continue).toBe("Alt-Enter");
    expect(normalizeAutocompletePreferences({ shortcuts: { continue: "Mod-q", sentence: "Alt-Enter" } }).shortcuts.continue).toBe("Alt-Enter");
    // Custom length keys survive; a duplicate falls back to a free default.
    const custom = normalizeAutocompletePreferences({ shortcuts: { continue: "Mod-Enter", sentence: "Mod-1", paragraph: "Mod-2", idea: "Mod-2" } }).shortcuts;
    expect(custom).toMatchObject({ sentence: "Mod-1", paragraph: "Mod-2", idea: "Mod-/" });
    // The AI key may take a default length key; that length then gets another free key.
    const taken = normalizeAutocompletePreferences({ shortcuts: { continue: "Mod-,", sentence: "Mod-,", paragraph: "Mod-.", idea: "Mod-/" } }).shortcuts;
    expect(new Set(Object.values(taken)).size).toBe(4);
    expect(taken.continue).toBe("Mod-,");
  });

  it("shows compact key chips in the menu", () => {
    expect(compactShortcutLabel("Mod-Enter", true)).toBe("⌘↵");
    expect(compactShortcutLabel("Mod-,", true)).toBe("⌘,");
    expect(compactShortcutLabel("Mod-Alt-1", true)).toBe("⌥⌘1");
    expect(compactShortcutLabel("Mod-Enter", false)).toBe("Ctrl+Enter");
    expect(compactShortcutLabel("Alt", true)).toBe("⌥");
  });

  it("labels any recorded key, including a minus key and macOS modifier order", () => {
    expect(compactShortcutLabel("Mod--", true)).toBe("⌘-");
    expect(compactShortcutLabel("Mod-ñ", true)).toBe("⌘Ñ");
    expect(compactShortcutLabel("Mod-Ctrl-Alt-Shift-k", true)).toBe("⌃⌥⇧⌘K");
    expect(compactShortcutLabel("Ctrl-Space", true)).toBe("⌃Space");
    expect(compactShortcutLabel("Mod-Shift-Enter", false)).toBe("Ctrl+Shift+Enter");
    expect(compactShortcutLabel("Mod-Alt-…", true)).toBe("⌥⌘…");
  });

  it("keeps any valid recorded key and drops taken, bare or duplicate ones", () => {
    const custom = { continue: "Mod-k", sentence: "Mod-ñ", paragraph: "Mod-Alt-1", idea: "Ctrl-Space" };
    expect(normalizeAutocompletePreferences({ shortcuts: custom }).shortcuts).toEqual(custom);
    expect(normalizeAutocompletePreferences({ shortcuts: { ...custom, idea: "Mod-c" } }).shortcuts.idea).toBe("Mod-/");
    expect(normalizeAutocompletePreferences({ shortcuts: { ...custom, idea: "k" } }).shortcuts.idea).toBe("Mod-/");
    // Same shortcut spelled with another modifier order is a duplicate.
    // Malformed stored values (unknown modifier or key name) fall back too.
    expect(normalizeAutocompletePreferences({ shortcuts: { ...custom, idea: "Mod-nope-k" } }).shortcuts.idea).toBe("Mod-/");
    expect(normalizeAutocompletePreferences({ shortcuts: { ...custom, idea: "Mod-foo" } }).shortcuts.idea).toBe("Mod-/");
    const dup = normalizeAutocompletePreferences({ shortcuts: { ...custom, sentence: "Mod-Shift-Enter", idea: "Shift-Mod-Enter" } }).shortcuts;
    expect(dup.idea).toBe("Mod-/");
  });
});

describe("recording a shortcut", () => {
  const key = (event: Partial<ShortcutKeyEvent> & { key: string }): ShortcutKeyEvent =>
    ({ keyCode: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...event });

  it("records keys the way CodeMirror will match them", () => {
    // Spanish keyboard: ⌘ñ is the character the layout produces.
    expect(shortcutFromKeyEvent(key({ key: "ñ", keyCode: 192, metaKey: true }), true)).toBe("Mod-ñ");
    expect(shortcutFromKeyEvent(key({ key: "-", keyCode: 189, metaKey: true }), true)).toBe("Mod--");
    // ⌥ changes the character on macOS (⌥1 → ¡): record the base key.
    expect(shortcutFromKeyEvent(key({ key: "¡", keyCode: 49, metaKey: true, altKey: true }), true)).toBe("Mod-Alt-1");
    // ⇧⌘7 on a Spanish keyboard (where / is ⇧7).
    expect(shortcutFromKeyEvent(key({ key: "/", keyCode: 55, metaKey: true, shiftKey: true }), true)).toBe("Mod-Shift-7");
    // Caps Lock does not change the stored letter.
    expect(shortcutFromKeyEvent(key({ key: "K", keyCode: 75, metaKey: true }), true)).toBe("Mod-k");
    expect(shortcutFromKeyEvent(key({ key: "Enter", keyCode: 13, metaKey: true, shiftKey: true }), true)).toBe("Mod-Shift-Enter");
    expect(shortcutFromKeyEvent(key({ key: " ", keyCode: 32, ctrlKey: true }), true)).toBe("Ctrl-Space");
    expect(shortcutFromKeyEvent(key({ key: "k", keyCode: 75, ctrlKey: true }), false)).toBe("Mod-k");
    // Modifiers alone, dead keys and composition are not a shortcut yet.
    expect(shortcutFromKeyEvent(key({ key: "Meta", keyCode: 91, metaKey: true }), true)).toBeNull();
    expect(shortcutFromKeyEvent(key({ key: "Dead", keyCode: 69, altKey: true }), true)).toBeNull();
    expect(shortcutFromKeyEvent(key({ key: "k", keyCode: 75, metaKey: true, isComposing: true }), true)).toBeNull();
    expect(shortcutFromKeyEvent(key({ key: "Unidentified", keyCode: 75, metaKey: true }), true)).toBeNull();
    expect(shortcutFromKeyEvent(key({ key: "AudioVolumeUp", keyCode: 175, metaKey: true }), true)).toBeNull();
  });

  it("reads modifiers from a real KeyboardEvent, whose fields are prototype getters", () => {
    class FakeKeyboardEvent {
      get key() { return "ñ"; }
      get keyCode() { return 186; }
      get metaKey() { return true; }
      get ctrlKey() { return false; }
      get altKey() { return false; }
      get shiftKey() { return false; }
    }
    expect(shortcutFromKeyEvent(new FakeKeyboardEvent(), true)).toBe("Mod-ñ");
  });

  it("needs ⌘ or ⌃ and refuses keys Iliad already uses", () => {
    expect(checkShortcut("Mod-ñ")).toBe("ok");
    expect(checkShortcut("Ctrl-Space")).toBe("ok");
    expect(checkShortcut("Alt-Enter")).toBe("ok");
    expect(checkShortcut("Alt-e")).toBe("needs-modifier");
    expect(checkShortcut("k")).toBe("needs-modifier");
    for (const taken of ["Mod-c", "Mod-v", "Mod-z", "Shift-Mod-z", "Mod-q", "Mod-w", "Mod--", "Mod-f", "Mod-Shift-m", "Alt-ArrowUp", "Mod-ArrowLeft", "Ctrl-Tab"]) {
      expect(checkShortcut(taken)).toBe("taken");
    }
    // ⌘[ / ⌘] are Back/Forward document history.
    for (const taken of ["Mod-[", "Mod-]"]) {
      expect(checkShortcut(taken)).toBe("taken");
    }
    // ⌘N (new document) and ⌃⌘S (View → Toggle Sidebar), in any modifier order.
    for (const taken of ["Mod-n", "Mod-Ctrl-s", "Ctrl-Mod-s"]) {
      expect(checkShortcut(taken)).toBe("taken");
    }
    const stored = normalizeAutocompletePreferences({ shortcuts: { continue: "Mod-n", sentence: "Ctrl-Mod-s", paragraph: "Mod-.", idea: "Mod-/" } }).shortcuts;
    expect(Object.values(stored)).not.toContain("Mod-n");
    expect(Object.values(stored)).not.toContain("Ctrl-Mod-s");
    // CodeMirror defaults the length keys already override stay available.
    expect(checkShortcut("Mod-/")).toBe("ok");
  });

  const shortcuts = defaultAutocompletePreferences.shortcuts;
  const cmd = (k: string, keyCode: number) => key({ key: k, keyCode, metaKey: true });

  it("saves a free key and ends recording", () => {
    const step = recordShortcutKeyDown({ action: "idea", held: "" }, cmd("ñ", 192), shortcuts, true);
    expect(step).toEqual({ handled: true, recording: null, shortcuts: { ...shortcuts, idea: "Mod-ñ" } });
  });

  it("keeps waiting on a taken key or a key without ⌘/⌃", () => {
    expect(recordShortcutKeyDown({ action: "idea", held: "" }, cmd("-", 189), shortcuts, true).recording)
      .toEqual({ action: "idea", held: "", problem: { kind: "taken", key: "Mod--" } });
    expect(recordShortcutKeyDown({ action: "idea", held: "" }, key({ key: "a", keyCode: 65 }), shortcuts, true).recording?.problem)
      .toEqual({ kind: "modifier", key: "a" });
  });

  it("offers a swap for a key another row uses; Enter swaps, Esc cancels", () => {
    const conflict = recordShortcutKeyDown({ action: "idea", held: "" }, cmd(".", 190), shortcuts, true);
    expect(conflict.recording?.problem).toEqual({ kind: "conflict", key: "Mod-.", other: "paragraph" });
    const swap = recordShortcutKeyDown(conflict.recording!, key({ key: "Enter", keyCode: 13 }), shortcuts, true);
    expect(swap.recording).toBeNull();
    expect(swap.shortcuts).toEqual({ ...shortcuts, idea: "Mod-.", paragraph: "Mod-/" });
    const cancel = recordShortcutKeyDown(conflict.recording!, key({ key: "Escape", keyCode: 27 }), shortcuts, true);
    expect(cancel).toEqual({ handled: true, recording: null });
  });

  it("shows held modifiers, lets Tab move focus and ignores key repeat", () => {
    expect(recordShortcutKeyDown({ action: "idea", held: "" }, key({ key: "Meta", keyCode: 91, metaKey: true }), shortcuts, true).recording?.held).toBe("Mod");
    expect(recordShortcutKeyDown({ action: "idea", held: "" }, key({ key: "Tab", keyCode: 9 }), shortcuts, true).handled).toBe(false);
    expect(recordShortcutKeyDown({ action: "idea", held: "" }, key({ key: "Tab", keyCode: 9, shiftKey: true }), shortcuts, true).handled).toBe(false);
    expect(recordShortcutKeyDown({ action: "idea", held: "Mod" }, key({ key: "Escape", keyCode: 27, metaKey: true }), shortcuts, true))
      .toEqual({ handled: true, recording: null });
    expect(recordShortcutKeyDown({ action: "idea", held: "" }, { ...cmd("ñ", 192), repeat: true }, shortcuts, true))
      .toEqual({ handled: true, recording: { action: "idea", held: "" } });
  });
});
