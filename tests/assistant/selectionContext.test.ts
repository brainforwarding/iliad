import { describe, expect, it } from "vitest";
import { lineRangeOf, selectionRangesEqual } from "../../src/assistant/selectionContext";

describe("selection context helpers", () => {
  it("computes 1-based line ranges, including CRLF and EOF selections", () => {
    const text = "uno\ndos tres\ncuatro";
    expect(lineRangeOf(text, 0, 3)).toEqual({ lineStart: 1, lineEnd: 1 });
    expect(lineRangeOf(text, 4, 12)).toEqual({ lineStart: 2, lineEnd: 2 });
    expect(lineRangeOf(text, 0, text.length)).toEqual({ lineStart: 1, lineEnd: 3 });
    expect(lineRangeOf("a\r\nb", 3, 4)).toEqual({ lineStart: 2, lineEnd: 2 });
  });

  it("compares ranges by value", () => {
    expect(selectionRangesEqual({ from: 1, to: 2 }, { from: 1, to: 2 })).toBe(true);
    expect(selectionRangesEqual({ from: 1, to: 2 }, { from: 1, to: 3 })).toBe(false);
    expect(selectionRangesEqual(null, null)).toBe(true);
    expect(selectionRangesEqual(null, { from: 1, to: 2 })).toBe(false);
  });
});
