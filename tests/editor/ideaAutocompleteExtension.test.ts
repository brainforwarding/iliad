import { afterEach, describe, expect, it } from "vitest";
import {
  applySharedAutocompleteCooldown,
  autocompleteSuggestionKindForTrigger,
  autocompleteCooldownMsForFailure,
  ideaAutocompleteFallbackManualKey,
  hasMeaningfulAutocompleteEdit,
  ideaAutocompleteDebounceMs,
  ideaAutocompleteManualKey,
  isAutocompleteParagraphBoundary,
  resetSharedAutocompleteCooldownForTests,
  sharedAutocompleteCooldownActive
} from "../../src/editor/ideaAutocomplete/extension";

describe("idea autocomplete extension helpers", () => {
  afterEach(() => {
    resetSharedAutocompleteCooldownForTests();
  });

  it("uses a writing-friendly idle delay before requesting completions", () => {
    expect(ideaAutocompleteDebounceMs).toBe(900);
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

  it("uses a manual trigger shortcut separate from Tab acceptance", () => {
    expect(ideaAutocompleteManualKey).toBe("Mod-Enter");
    expect(ideaAutocompleteFallbackManualKey).toBe("Ctrl-Space");
  });

  it("treats typing, paste, and drop as autocomplete intent", () => {
    expect(
      hasMeaningfulAutocompleteEdit([
        { docChanged: true, isUserEvent: (event) => event === "input.type" }
      ])
    ).toBe(true);
    expect(
      hasMeaningfulAutocompleteEdit([
        { docChanged: true, isUserEvent: (event) => event === "input.paste" }
      ])
    ).toBe(true);
    expect(
      hasMeaningfulAutocompleteEdit([
        { docChanged: true, isUserEvent: (event) => event === "input.drop" }
      ])
    ).toBe(true);
  });

  it("does not treat navigation, focus, undo, or programmatic changes as autocomplete intent", () => {
    expect(
      hasMeaningfulAutocompleteEdit([
        { docChanged: false, isUserEvent: (event) => event === "select.pointer" }
      ])
    ).toBe(false);
    expect(
      hasMeaningfulAutocompleteEdit([
        { docChanged: true, isUserEvent: (event) => event === "undo" }
      ])
    ).toBe(false);
    expect(
      hasMeaningfulAutocompleteEdit([
        { docChanged: true, isUserEvent: () => false }
      ])
    ).toBe(false);
  });

  it("chooses paragraph suggestions only for manual triggers at natural boundaries", () => {
    const paragraphEnd = "This paragraph has a complete idea.";
    const blankLine = "This paragraph has a complete idea.\n\n";
    const midSentence = "This paragraph has a complete";

    expect(isAutocompleteParagraphBoundary(paragraphEnd, paragraphEnd.length)).toBe(true);
    expect(isAutocompleteParagraphBoundary(blankLine, blankLine.length)).toBe(true);
    expect(isAutocompleteParagraphBoundary(midSentence, midSentence.length)).toBe(false);
    expect(autocompleteSuggestionKindForTrigger("automatic", paragraphEnd, paragraphEnd.length)).toBe("inline");
    expect(autocompleteSuggestionKindForTrigger("manual", paragraphEnd, paragraphEnd.length)).toBe("paragraph");
    expect(autocompleteSuggestionKindForTrigger("manual", midSentence, midSentence.length)).toBe("inline");
  });
});
