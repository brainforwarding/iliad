import { describe, expect, it } from "vitest";
import { safeTightenRangeForSelection } from "../../src/editor/tightenSafeRange";

describe("safeTightenRangeForSelection", () => {
  it("expands a mid-word selection to the full paragraph block", () => {
    const doc = [
      "# Title",
      "",
      "Este documento lista proveedores que operan en Europa con soluciones comparables.",
      "",
      "Siguiente parrafo."
    ].join("\n");
    const from = doc.indexOf("mento");
    const to = doc.indexOf("comparables") + "comparables".length;

    expect(safeTightenRangeForSelection(doc, { from, to })).toEqual({
      from: doc.indexOf("Este documento"),
      to: doc.indexOf(" comparables.") + " comparables.".length,
      originalText: "Este documento lista proveedores que operan en Europa con soluciones comparables.",
      selectedFrom: "Este docu".length,
      selectedTo: "Este documento lista proveedores que operan en Europa con soluciones comparables".length
    });
  });

  it("keeps surrounding blank lines outside the replacement range", () => {
    const doc = "Intro\n\nFirst line\nsecond line\n\nOutro";
    const from = doc.indexOf("second");
    const range = safeTightenRangeForSelection(doc, { from, to: from + "second".length });

    expect(range?.originalText).toBe("First line\nsecond line");
    expect(range?.from).toBe(doc.indexOf("First"));
    expect(range?.to).toBe(doc.indexOf("\n\nOutro"));
  });

  it("keeps CRLF blank lines outside a paragraph when selection starts at line start", () => {
    const doc = "Intro\r\n\r\nFirst line\r\nsecond line\r\n\r\nOutro";
    const from = doc.indexOf("First");
    const range = safeTightenRangeForSelection(doc, { from, to: from + "First".length });

    expect(range?.originalText).toBe("First line\r\nsecond line");
    expect(range?.from).toBe(from);
    expect(range?.to).toBe(doc.indexOf("\r\n\r\nOutro"));
  });

  it("expands a table cell selection to the whole table block", () => {
    const doc = ["Before", "", "| A | B |", "| - | - |", "| 1 | 2 |", "", "After"].join("\n");
    const from = doc.indexOf("2 |");
    const range = safeTightenRangeForSelection(doc, { from, to: from + 1 });

    expect(range?.originalText).toBe("| A | B |\n| - | - |\n| 1 | 2 |");
  });

  it("expands a numbered-list selection to one list item, not the whole list", () => {
    const doc = [
      "1. First item stays out",
      "2. TAs can only see their own assigned circles — no visibility into other TAs' or unassigned circles",
      "3. Third item stays out"
    ].join("\n");
    const from = doc.indexOf("assigned circles");
    const range = safeTightenRangeForSelection(doc, { from, to: from + "assigned".length });

    expect(range?.originalText).toBe(
      "2. TAs can only see their own assigned circles — no visibility into other TAs' or unassigned circles"
    );
  });

  it("keeps wrapped continuation lines with the selected list item", () => {
    const doc = ["1. First item", "2. Second item starts", "   and continues here", "3. Third item"].join("\n");
    const from = doc.indexOf("continues");
    const range = safeTightenRangeForSelection(doc, { from, to: from + "continues".length });

    expect(range?.originalText).toBe("2. Second item starts\n   and continues here");
  });

  it("expands a final paragraph without requiring a trailing newline", () => {
    const doc = "Intro\n\nFinal paragraph line one\nline two";
    const from = doc.indexOf("line two");
    const range = safeTightenRangeForSelection(doc, { from, to: from + "line".length });

    expect(range?.originalText).toBe("Final paragraph line one\nline two");
    expect(range?.to).toBe(doc.length);
  });

  it("expands a fenced code selection to the whole fenced block", () => {
    const doc = "Before\n\n```ts\nconst verboseName = 1;\n```\n\nAfter";
    const from = doc.indexOf("verboseName");
    const range = safeTightenRangeForSelection(doc, { from, to: from + "verboseName".length });

    expect(range?.originalText).toBe("```ts\nconst verboseName = 1;\n```");
  });

  it("rejects empty and whitespace-only selections", () => {
    expect(safeTightenRangeForSelection("hello", { from: 2, to: 2 })).toBeNull();
    expect(safeTightenRangeForSelection("hello   world", { from: 5, to: 8 })).toBeNull();
  });
});
