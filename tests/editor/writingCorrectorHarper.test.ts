import { describe, expect, it } from "vitest";
import {
  detectWritingIssues,
  harperSpanToTextRange,
  scalarOffsetToCodeUnitOffset
} from "../../src/editor/writingCorrector/harper";

describe("Harper writing corrector", () => {
  it("converts Harper scalar spans to CodeMirror UTF-16 offsets", () => {
    const text = "A 😀 clener";

    expect(scalarOffsetToCodeUnitOffset(text, 4)).toBe(5);
    expect(harperSpanToTextRange(text, { start: 4, end: 10 })).toEqual({ from: 5, to: 11 });
    expect(text.slice(5, 11)).toBe("clener");
  });

  it("uses Harper for spelling and grammar issues", async () => {
    const issues = await detectWritingIssues("I dont think we are ready. We has a clener plan.", {
      language: "en",
      cursor: null
    });

    expect(issues.find((issue) => issue.originalText === "dont")).toMatchObject({
      source: "harper",
      category: "spelling"
    });
    expect(issues.find((issue) => issue.originalText === "has")?.suggestions).toContainEqual({
      label: "have",
      replacement: "have"
    });
    expect(issues.find((issue) => issue.originalText === "clener")).toMatchObject({
      source: "harper",
      category: "spelling"
    });
  });

  it("syncs custom dictionary words into Harper", async () => {
    const issues = await detectWritingIssues("A clener plan can still be intentional.", {
      language: "en",
      cursor: null,
      customWords: new Set(["clener"])
    });

    expect(issues.find((issue) => issue.originalText === "clener")).toBeUndefined();
  });
});
