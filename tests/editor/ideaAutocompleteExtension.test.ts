import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySharedAutocompleteCooldown,
  consumeAutocompleteSuggestion,
  autocompleteCooldownMsForFailure,
  ideaAutocompleteExtension,
  nextAutocompleteKind,
  resetSharedAutocompleteCooldownForTests,
  sharedAutocompleteCooldownActive
} from "../../src/editor/ideaAutocomplete/extension";

describe("idea autocomplete extension helpers", () => {
  afterEach(() => {
    resetSharedAutocompleteCooldownForTests();
  });

  it("grows a visible suggestion one length per press and stops at the full idea", () => {
    expect(nextAutocompleteKind("sentence")).toBe("paragraph");
    expect(nextAutocompleteKind("paragraph")).toBe("idea");
    expect(nextAutocompleteKind("idea")).toBeNull();
  });

  it("keeps the ghost remainder only for matching typing at the same cursor", () => {
    const suggestion = { requestId: "r", from: 5, insert: " quiet room.", prefix: "A very", suffix: "" };
    expect(consumeAutocompleteSuggestion(suggestion, [{ from: 5, to: 5, insert: " qui" }], 9))
      .toMatchObject({ from: 9, insert: "et room." });
    expect(consumeAutocompleteSuggestion(suggestion, [{ from: 5, to: 5, insert: " loud" }], 10)).toBeNull();
    expect(consumeAutocompleteSuggestion(suggestion, [{ from: 4, to: 5, insert: " q" }], 6)).toBeNull();
    expect(consumeAutocompleteSuggestion(suggestion, [{ from: 5, to: 5, insert: " q" }], 1)).toBeNull();
    expect(consumeAutocompleteSuggestion(suggestion, [{ from: 5, to: 5, insert: " q" }, { from: 0, to: 0, insert: "x" }], 8)).toBeNull();
  });

  it("backs off longer for rate limits than transient provider failures", () => {
    expect(autocompleteCooldownMsForFailure("rate_limited")).toBe(60_000);
    expect(autocompleteCooldownMsForFailure("provider")).toBe(15_000);
    expect(autocompleteCooldownMsForFailure("timeout")).toBe(15_000);
    expect(autocompleteCooldownMsForFailure("no_suggestion")).toBe(0);
  });

  it("keeps rate-limit cooldown shared across editor instances", () => {
    applySharedAutocompleteCooldown("rate_limited", 1_000);

    expect(sharedAutocompleteCooldownActive(60_999)).toBe(true);
    expect(sharedAutocompleteCooldownActive(61_000)).toBe(false);
  });

  it("binds only the length keys, never the ✦ AI menu key", () => {
    const extensions = ideaAutocompleteExtension({
      enabled: true, language: "en", documentTitle: "Draft",
      preferences: { shortcuts: { continue: "Mod-Enter", sentence: "Mod-,", paragraph: "Mod-.", idea: "Mod-/" } },
      requestAutocomplete: async () => ({ ok: false, reason: "disabled" }), cancelAutocomplete: () => undefined
    });
    const keys = EditorState.create({ extensions }).facet(keymap).flat().map((binding) => binding.key);
    expect(keys).toEqual(expect.arrayContaining(["Mod-,", "Mod-.", "Mod-/", "Tab", "Escape"]));
    expect(keys).not.toContain("Mod-Enter");
  });
});
