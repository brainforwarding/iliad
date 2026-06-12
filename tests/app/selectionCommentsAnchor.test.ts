import { describe, expect, it } from "vitest";
import {
  captureSelectionAnchor,
  isAnchoredSelectionComment,
  reanchorSelectionComments
} from "../../src/app/selectionCommentsAnchor";
import type { SelectionComment } from "../../src/types/iliad";

function comment(overrides: Partial<SelectionComment>): SelectionComment {
  return {
    id: "comment-test",
    workspacePath: "/ws",
    documentRelativePath: "doc.md",
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

describe("captureSelectionAnchor", () => {
  it("captures quote, occurrence ordinal, and ~30 chars of prefix", () => {
    const doc = "alpha video beta video gamma";
    const from = doc.indexOf("video", doc.indexOf("video") + 1);
    const anchor = captureSelectionAnchor(doc, from, from + "video".length);

    expect(anchor.quote).toBe("video");
    expect(anchor.occurrence).toBe(2);
    expect(anchor.prefix).toBe("alpha video beta ");
  });

  it("limits the prefix to 30 characters", () => {
    const doc = `${"x".repeat(60)}quote`;
    const anchor = captureSelectionAnchor(doc, 60, 65);

    expect(anchor.prefix).toBe("x".repeat(30));
  });
});

describe("reanchorSelectionComments", () => {
  it("re-anchors a unique exact quote", () => {
    const doc = "one two three four";
    const [anchored] = reanchorSelectionComments(
      [comment({ quote: "three", occurrence: 1, prefix: "stale " })],
      doc,
      "doc.md"
    );

    expect(anchored.from).toBe(doc.indexOf("three"));
    expect(anchored.to).toBe(doc.indexOf("three") + 5);
    expect(isAnchoredSelectionComment(anchored)).toBe(true);
  });

  it("uses the occurrence ordinal when the quote repeats", () => {
    const doc = "video intro, then video outro";
    const second = doc.indexOf("video", 1);
    const [anchored] = reanchorSelectionComments(
      [comment({ quote: "video", occurrence: 2, prefix: "" })],
      doc,
      "doc.md"
    );

    expect(anchored.from).toBe(second);
    expect(anchored.to).toBe(second + 5);
  });

  it("prefers a unique prefix match over the occurrence ordinal", () => {
    const doc = "first video here, second video there";
    const second = doc.indexOf("video", doc.indexOf("video") + 1);
    const [anchored] = reanchorSelectionComments(
      [comment({ quote: "video", occurrence: 1, prefix: "second " })],
      doc,
      "doc.md"
    );

    expect(anchored.from).toBe(second);
  });

  it("flags missing quotes as sin ancla instead of guessing", () => {
    const [orphan] = reanchorSelectionComments([comment({ quote: "vanished", occurrence: 1 })], "other text", "doc.md");

    expect(orphan.from).toBe(orphan.to);
    expect(isAnchoredSelectionComment(orphan)).toBe(false);
    expect(orphan.status).toBe("pending");
  });

  it("orphans ambiguous matches beyond the stored occurrence count", () => {
    const doc = "video video";
    const [orphan] = reanchorSelectionComments(
      [comment({ quote: "video", occurrence: 5, prefix: "no-match " })],
      doc,
      "doc.md"
    );

    expect(isAnchoredSelectionComment(orphan)).toBe(false);
  });

  it("treats a renamed document as sin ancla (v1 rename behavior)", () => {
    const doc = "the quote is still here";
    const [orphan] = reanchorSelectionComments(
      [comment({ documentRelativePath: "old-name.md", quote: "quote", occurrence: 1 })],
      doc,
      "new-name.md"
    );

    expect(isAnchoredSelectionComment(orphan)).toBe(false);
  });
});
