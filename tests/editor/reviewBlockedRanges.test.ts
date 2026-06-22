import { describe, expect, it } from "vitest";
import { markdownLineCount, reviewBlockedLineRanges } from "../../src/editor/aiReview/blockedRanges";

describe("review blocked line ranges", () => {
  it("counts Markdown lines across common newline forms", () => {
    expect(markdownLineCount("")).toBe(1);
    expect(markdownLineCount("one\ntwo")).toBe(2);
    expect(markdownLineCount("one\r\ntwo\rthree")).toBe(3);
  });

  it("blocks the full document for create and delete reviews", () => {
    expect(
      reviewBlockedLineRanges({
        mode: "create_file",
        currentContent: "# Title\n\nBody"
      })
    ).toEqual([{ from: 1, to: 3 }]);

    expect(
      reviewBlockedLineRanges({
        mode: "delete_file",
        currentContent: "# Title\n\nBody"
      })
    ).toEqual([{ from: 1, to: 3 }]);
  });

  it("uses display hunk ranges for edit reviews and tighten ranges outside review", () => {
    expect(
      reviewBlockedLineRanges({
        mode: "edit_file",
        currentContent: "Body",
        editChangedLineRanges: [{ from: 2, to: 4 }],
        tightenChangedLineRanges: [{ from: 6, to: 6 }]
      })
    ).toEqual([{ from: 2, to: 4 }]);

    expect(
      reviewBlockedLineRanges({
        mode: null,
        currentContent: "Body",
        tightenChangedLineRanges: [{ from: 6, to: 6 }]
      })
    ).toEqual([{ from: 6, to: 6 }]);
  });
});
