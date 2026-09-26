import { describe, expect, it } from "vitest";
import { compactShortcutLabel, defaultAutocompletePreferences, normalizeAutocompletePreferences } from "../../src/editor/ideaAutocomplete/options";

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
    expect(compactShortcutLabel("Mod-Alt-1", true)).toBe("⌘⌥1");
    expect(compactShortcutLabel("Mod-Enter", false)).toBe("Ctrl+Enter");
    expect(compactShortcutLabel("Alt", true)).toBe("⌥");
  });
});
