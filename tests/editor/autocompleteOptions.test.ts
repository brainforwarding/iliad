import { describe, expect, it } from "vitest";
import { defaultAutocompletePreferences, normalizeAutocompletePreferences, selectWritingGuidance, writingGuidanceStorageKey } from "../../src/editor/ideaAutocomplete/options";

describe("autocomplete preferences and writing memory", () => {
  it("keeps document notes distinct across workspaces and file names", () => {
    expect(writingGuidanceStorageKey("/a", "chapter.md")).not.toBe(writingGuidanceStorageKey("/b", "chapter.md"));
    expect(writingGuidanceStorageKey("/a", "chapter.md")).not.toBe(writingGuidanceStorageKey("/a", "other.md"));
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

  it("uses short notes whole and ranks long notes by relevance within a budget", () => {
    const short = "Close third person, past tense.\n\nMara has an injured hand.\n";
    expect(selectWritingGuidance(short, "anything")).toBe("Close third person, past tense.\nMara has an injured hand.");

    const long = [
      "Close third person, past tense.",
      ...Array.from({ length: 40 }, (_, i) => `Detail ${i} ${"filler ".repeat(12)}`),
      "Mara has an injured hand."
    ].join("\n");
    const selected = selectWritingGuidance(long, "Mara opened the door.");
    expect(selected).toContain("Mara has an injured hand.");
    expect(selected.length).toBeLessThanOrEqual(1800);
    expect(selected).not.toContain("Detail 39");
    expect(selectWritingGuidance("", "Mara")).toBe("");
    expect(selectWritingGuidance(undefined, "Mara")).toBe("");
    expect(selectWritingGuidance("x".repeat(8000), "").length).toBeLessThanOrEqual(1800);
  });
});
