import { describe, expect, it } from "vitest";
import { defaultAutocompletePreferences, normalizeAutocompletePreferences, normalizeWritingGuidance, selectWritingGuidance, writingGuidanceStorageKey } from "../../src/editor/ideaAutocomplete/options";

describe("autocomplete preferences and writing memory", () => {
  it("keeps document notes distinct across workspaces and file names", () => {
    expect(writingGuidanceStorageKey("/a", "chapter.md")).not.toBe(writingGuidanceStorageKey("/b", "chapter.md"));
    expect(writingGuidanceStorageKey("/a", "chapter.md")).not.toBe(writingGuidanceStorageKey("/a", "other.md"));
  });
  it("rejects duplicate and malformed shortcut maps", () => {
    expect(normalizeAutocompletePreferences({ shortcuts: { inline: "Mod-Enter", sentence: "Mod-Enter", paragraph: "Alt-Enter" } }).shortcuts).toEqual(defaultAutocompletePreferences.shortcuts);
    expect(normalizeAutocompletePreferences({ shortcuts: { wrong: "Ctrl-Space", fields: "Mod-Enter", here: "Alt-Enter" } }).shortcuts).toEqual(defaultAutocompletePreferences.shortcuts);
    expect(normalizeAutocompletePreferences({ shortcuts: { inline: "Mod-Alt-Enter", sentence: "Mod-Enter", paragraph: "Alt-Enter" } }).shortcuts.inline).toBe("Mod-Alt-Enter");
  });
  it("uses opt-in notes with a bounded selection of relevant facts", () => {
    const notes = normalizeWritingGuidance({ enabled: true, voice: "Close third person, past tense.", facts: Array.from({ length: 8 }, (_, i) => `Detail ${i}`).join("\n") + "\nMara has an injured hand." });
    const selected = selectWritingGuidance(notes, "Mara opened the door.");
    expect(selected).toContain(notes.voice);
    expect(selected).toContain("Mara has an injured hand.");
    expect(selected).not.toContain("Detail 7");
    expect(selectWritingGuidance({ ...notes, enabled: false }, "Mara")).toBe("");
    expect(selectWritingGuidance(normalizeWritingGuidance({ facts: "x".repeat(8000) }), "").length).toBeLessThanOrEqual(1800);
  });
});
