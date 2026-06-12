import { describe, expect, it } from "vitest";
import { serializeSelectionComments } from "../../src/app/selectionCommentsSerialize";
import type { SelectionComment } from "../../src/types/iliad";

const doc = [
  "# Course map",
  "",
  "the three big ideas every teacher should leave with",
  "",
  "Short video on effective feedback (4 min) and another video here."
].join("\n");

function comment(overrides: Partial<SelectionComment>): SelectionComment {
  return {
    id: "comment-test",
    workspacePath: "/ws",
    documentRelativePath: "course-map.md",
    from: 0,
    to: 0,
    quote: "",
    occurrence: 1,
    prefix: "",
    comment: "note",
    createdAt: new Date(0).toISOString(),
    status: "pending",
    ...overrides
  };
}

function longQuoteComment() {
  const from = doc.indexOf("the three big ideas");
  return comment({
    id: "comment-long",
    from,
    to: from + "the three big ideas every teacher should leave with".length,
    quote: "the three big ideas every teacher should leave with",
    comment: "too long — cut to one idea per session."
  });
}

function repeatedQuoteComment() {
  const from = doc.indexOf("video", doc.indexOf("video") + 1);
  return comment({
    id: "comment-repeated",
    from,
    to: from + "video".length,
    quote: "video",
    occurrence: 2,
    comment: "verify this video actually exists."
  });
}

function orphanComment() {
  return comment({
    id: "comment-orphan",
    from: 0,
    to: 0,
    quote: "old text",
    comment: "restore this.",
    createdAt: new Date(1).toISOString()
  });
}

describe("serializeSelectionComments", () => {
  it("produces the full English payload with orphans last and a neutral closing line", () => {
    const block = serializeSelectionComments({
      comments: [orphanComment(), repeatedQuoteComment(), longQuoteComment()],
      documentText: doc,
      documentName: "course-map.md",
      language: "en",
      userTypedText: false
    });

    expect(block).toBe(
      [
        "Comments on `course-map.md`:",
        "",
        '1. Line 3 · "the three big ideas every teacher should leave with"',
        "   Comment: too long — cut to one idea per session.",
        "",
        '2. Line 5 · "video" (2nd occurrence)',
        '   > Context: "Short video on effective feedback (4 min) and another video here."',
        "   Comment: verify this video actually exists.",
        "",
        "Unanchored (the quoted text no longer appears in the document):",
        "",
        '3. "old text"',
        "   Comment: restore this.",
        "",
        "Each comment references the quoted text at the indicated line."
      ].join("\n")
    );
  });

  it("orders deterministically by position regardless of input order", () => {
    const forward = serializeSelectionComments({
      comments: [longQuoteComment(), repeatedQuoteComment()],
      documentText: doc,
      documentName: "course-map.md",
      language: "en",
      userTypedText: true
    });
    const reversed = serializeSelectionComments({
      comments: [repeatedQuoteComment(), longQuoteComment()],
      documentText: doc,
      documentName: "course-map.md",
      language: "en",
      userTypedText: true
    });

    expect(reversed).toBe(forward);
    expect(forward.indexOf("Line 3")).toBeLessThan(forward.indexOf("Line 5"));
  });

  it("omits the closing instruction when the user typed text", () => {
    const block = serializeSelectionComments({
      comments: [longQuoteComment()],
      documentText: doc,
      documentName: "course-map.md",
      language: "en",
      userTypedText: true
    });

    expect(block).not.toContain("Each comment references");
    expect(block.endsWith("too long — cut to one idea per session.")).toBe(true);
  });

  it("replaces newlines with ⏎ in quotes and truncates to ~80 chars", () => {
    const multiBlockDoc = "# Heading\nparagraph text follows here";
    const multiBlock = comment({
      id: "comment-multiblock",
      from: 0,
      to: multiBlockDoc.length,
      quote: multiBlockDoc,
      comment: "merge these."
    });
    const block = serializeSelectionComments({
      comments: [multiBlock],
      documentText: multiBlockDoc,
      documentName: "doc.md",
      language: "en",
      userTypedText: true
    });

    expect(block).toContain('"# Heading⏎paragraph text follows here"');
    // Multi-block ranges report the first line of the range.
    expect(block).toContain("1. Line 1 ·");

    const longDoc = `${"long words repeated ".repeat(8)}end`;
    const truncated = serializeSelectionComments({
      comments: [comment({ id: "comment-trunc", from: 0, to: longDoc.length, quote: longDoc, comment: "trim." })],
      documentText: longDoc,
      documentName: "doc.md",
      language: "en",
      userTypedText: true
    });
    const quoteMatch = truncated.match(/"([^"\n]+)"/);

    expect(quoteMatch?.[1]).toHaveLength(80);
    expect(quoteMatch?.[1].endsWith("…")).toBe(true);
  });

  it("adds the context line for short quotes even when unique", () => {
    const shortDoc = "An intro line.\nThe word term sits here.";
    const from = shortDoc.indexOf("term");
    const block = serializeSelectionComments({
      comments: [comment({ id: "comment-short", from, to: from + 4, quote: "term", comment: "wrong term." })],
      documentText: shortDoc,
      documentName: "doc.md",
      language: "en",
      userTypedText: true
    });

    expect(block).toContain('1. Line 2 · "term"');
    expect(block).not.toContain("occurrence");
    expect(block).toContain('   > Context: "The word term sits here."');
  });

  it("omits the context line for long unique quotes", () => {
    const block = serializeSelectionComments({
      comments: [longQuoteComment()],
      documentText: doc,
      documentName: "course-map.md",
      language: "en",
      userTypedText: true
    });

    expect(block).not.toContain("Context:");
  });

  it("produces the Spanish payload variant", () => {
    const block = serializeSelectionComments({
      comments: [repeatedQuoteComment(), orphanComment()],
      documentText: doc,
      documentName: "course-map.md",
      language: "es",
      userTypedText: false
    });

    expect(block).toContain("Comentarios sobre `course-map.md`:");
    expect(block).toContain('1. Línea 5 · "video" (2.ª aparición)');
    expect(block).toContain("   > Contexto:");
    expect(block).toContain("   Comentario: verify this video actually exists.");
    expect(block).toContain("Sin ancla (el texto citado ya no aparece en el documento):");
    expect(block).toContain("Cada comentario se refiere al texto citado en la línea indicada.");
  });
});
