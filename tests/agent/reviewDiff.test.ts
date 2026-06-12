import { describe, expect, it } from "vitest";
import {
  buildLineReviewHunks,
  hasMutableReviewHunks,
  reconstructContent
} from "../../electron/agent/reviewDiff";
import type { AgentReviewHunk, AgentReviewHunkStatus } from "../../electron/agent/types";

function withStatus(hunks: AgentReviewHunk[], status: AgentReviewHunkStatus) {
  return hunks.map((hunk) => ({ ...hunk, status }));
}

describe("review diff hunks", () => {
  it("reconstructs pending, accepted, and mixed line hunks", () => {
    const base = "title\r\n\r\nalpha\r\nbeta\r\nsame\r\nrepeat\r\nrepeat\r\nend";
    const replacement = "preface\r\ntitle\r\n\r\nalpha changed\r\nsame\r\nrepeat\r\nrepeat\r\nend\r\n";
    const hunks = buildLineReviewHunks(base, replacement, "file-1");

    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks.map((hunk) => hunk.id)).toEqual(hunks.map((_, index) => `file-1-hunk-${index + 1}`));
    expect(reconstructContent(base, hunks)).toBe(base);
    expect(reconstructContent(base, withStatus(hunks, "accepted"))).toBe(replacement);

    const mixed = hunks.map((hunk, index) => ({
      ...hunk,
      status: index === 0 ? ("accepted" as const) : ("rejected" as const)
    }));
    expect(reconstructContent(base, mixed).startsWith("preface\r\n")).toBe(true);
  });

  it("handles trailing-newline, blank-line, and insertion anchors", () => {
    expect(reconstructContent("no trailing", buildLineReviewHunks("no trailing", "no trailing changed", "file-2"))).toBe(
      "no trailing"
    );
    expect(reconstructContent("blank\n\n", buildLineReviewHunks("blank\n\n", "blank\nextra\n\n", "file-3"))).toBe(
      "blank\n\n"
    );

    const startInsert = buildLineReviewHunks("body\n", "start\nbody\n", "file-4")[0];
    const endInsert = buildLineReviewHunks("body\n", "body\nend\n", "file-5").at(-1);

    expect(startInsert.oldLines).toHaveLength(0);
    expect(startInsert.anchorLine).toBe(0);
    expect(endInsert?.oldLines).toHaveLength(0);
    expect(endInsert?.anchorLine).toBe(1);
  });

  it("treats stale hunks as mutable after partial acceptance", () => {
    const hunks = buildLineReviewHunks("one\ntwo\n", "ONE\ntwo\nthree\n", "file-6");

    expect(hasMutableReviewHunks({ hunks: withStatus(hunks, "accepted") })).toBe(false);
    expect(
      hasMutableReviewHunks({
        hunks: hunks.map((hunk, index) => ({
          ...hunk,
          status: index === 0 ? ("accepted" as const) : ("stale" as const)
        }))
      })
    ).toBe(true);
  });
});
