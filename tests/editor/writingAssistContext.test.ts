import { describe, expect, it } from "vitest";
import {
  buildAutocompleteContext,
  collectMarkdownExcludedRanges,
  isRangeWritableProse,
  wordRangeAt
} from "../../src/editor/writingAssistContext";

describe("writing assist Markdown context", () => {
  it("excludes front matter, fenced code, inline code, urls, and link destinations", () => {
    const doc = [
      "---",
      "title: teh note",
      "---",
      "",
      "Normal teh prose with `teh code` and [label teh](https://example.com/teh).",
      "",
      "```",
      "teh code",
      "```"
    ].join("\n");
    const ranges = collectMarkdownExcludedRanges(doc);
    const normal = doc.indexOf("Normal");
    const frontMatter = doc.indexOf("title");
    const inlineCode = doc.indexOf("`teh code`") + 1;
    const linkDestination = doc.indexOf("https://example.com");
    const fencedCode = doc.lastIndexOf("teh code");

    expect(isRangeWritableProse(doc, { from: normal, to: normal + 6 }, ranges)).toBe(true);
    expect(isRangeWritableProse(doc, { from: frontMatter, to: frontMatter + 5 }, ranges)).toBe(false);
    expect(isRangeWritableProse(doc, { from: inlineCode, to: inlineCode + 3 }, ranges)).toBe(false);
    expect(isRangeWritableProse(doc, { from: linkDestination, to: linkDestination + 8 }, ranges)).toBe(false);
    expect(isRangeWritableProse(doc, { from: fencedCode, to: fencedCode + 3 }, ranges)).toBe(false);
  });

  it("extracts autocomplete context only in prose", () => {
    const doc = "# Plan\n\nThis paragraph has enough context to continue the current";
    const cursor = doc.length;
    const context = buildAutocompleteContext(doc, cursor);

    expect(context?.prefix).toContain("This paragraph");
    expect(context?.headingPath).toEqual(["Plan"]);
    expect(buildAutocompleteContext("```ts\nconst value = 1", 6)).toBeNull();
  });

  it("can use the previous block for explicit paragraph continuation on a blank line", () => {
    const doc = "# Plan\n\nThis paragraph has enough context to continue.\n\n";
    const autoContext = buildAutocompleteContext(doc, doc.length);
    const manualContext = buildAutocompleteContext(doc, doc.length, {
      includePreviousBlockOnEmptyPrefix: true
    });

    expect(autoContext).toBeNull();
    expect(manualContext?.prefix).toContain("This paragraph has enough context");
  });

  it("uses a bounded section window around the cursor, not only the current paragraph", () => {
    const doc = [
      "# Section",
      "",
      "The first paragraph establishes the local voice and topic.",
      "",
      "The second paragraph continues the argument before the cursor.",
      "",
      "The current paragraph has enough context to continue the current",
      "",
      "The next paragraph should also be visible as suffix context.",
      "",
      "# Next Section",
      "",
      "This later section should not be included."
    ].join("\n");
    const cursor = doc.indexOf(" current", doc.indexOf("continue the")) + " current".length;
    const context = buildAutocompleteContext(doc, cursor);

    expect(context?.prefix).toContain("The first paragraph establishes");
    expect(context?.prefix).toContain("The second paragraph continues");
    expect(context?.prefix).toContain("The current paragraph has enough context");
    expect(context?.suffix).toContain("The next paragraph should also be visible");
    expect(context?.suffix).not.toContain("This later section should not be included");
  });

  it("respects explicit prefix and suffix caps", () => {
    const before = "a".repeat(120);
    const after = "b".repeat(120);
    const doc = `${before}CURSOR${after}`;
    const cursor = before.length;
    const context = buildAutocompleteContext(doc, cursor, {
      maxPrefixChars: 40,
      maxSuffixChars: 50
    });

    expect(context?.prefix.length).toBe(40);
    expect(context?.suffix.length).toBe(50);
  });

  it("can borrow previous block context for short new-paragraph starts", () => {
    const doc = [
      "Esta actividad permite practicar cómo delegar tareas a la IA con claridad.",
      "",
      "Además"
    ].join("\n");
    const context = buildAutocompleteContext(doc, doc.length, {
      includePreviousBlockOnShortPrefix: true
    });
    const shortDoc = "Texto previo suficiente para contexto.\n\nY";
    const tooShort = buildAutocompleteContext(shortDoc, shortDoc.length, {
      includePreviousBlockOnShortPrefix: true
    });

    expect(context?.prefix).toContain("Esta actividad permite practicar");
    expect(context?.prefix).toContain("Además");
    expect(tooShort).toBeNull();
  });

  it("detects the current word range at cursor boundaries", () => {
    const doc = "alpha beta";

    expect(wordRangeAt(doc, doc.indexOf("beta"))).toEqual({
      from: doc.indexOf("beta"),
      to: doc.length
    });
    expect(wordRangeAt(doc, doc.length)).toEqual({
      from: doc.indexOf("beta"),
      to: doc.length
    });
  });
});
