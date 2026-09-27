import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  clampHunkIndex,
  hunkNavigationAvailable,
  hunkNavigationKey,
  hunkScrollPosition,
  nextHunkIndex,
  previousHunkIndex
} from "../../src/editor/aiReview/navigation";

describe("outside review hunk navigation", () => {
  it("starts at the first hunk going down and the last going up", () => {
    expect(nextHunkIndex(null, 3)).toBe(0);
    expect(previousHunkIndex(null, 3)).toBe(2);
  });

  it("steps and wraps around both ends", () => {
    expect(nextHunkIndex(0, 3)).toBe(1);
    expect(nextHunkIndex(2, 3)).toBe(0);
    expect(previousHunkIndex(1, 3)).toBe(0);
    expect(previousHunkIndex(0, 3)).toBe(2);
    expect(nextHunkIndex(0, 1)).toBe(0);
    expect(previousHunkIndex(0, 1)).toBe(0);
  });

  it("clamps a remembered index when hunks are resolved", () => {
    expect(clampHunkIndex(2, 2)).toBe(1);
    expect(clampHunkIndex(1, 3)).toBe(1);
    expect(clampHunkIndex(-1, 3)).toBe(0);
    expect(clampHunkIndex(0, 0)).toBeNull();
    expect(clampHunkIndex(null, 3)).toBeNull();
    // Stepping from an index past the end continues from the clamped hunk.
    expect(nextHunkIndex(5, 3)).toBe(0);
    expect(previousHunkIndex(5, 3)).toBe(1);
  });

  it("has nowhere to go without hunks", () => {
    expect(nextHunkIndex(null, 0)).toBeNull();
    expect(previousHunkIndex(0, 0)).toBeNull();
  });

  it("is unavailable for stale or empty reviews", () => {
    expect(hunkNavigationAvailable({ stale: false, hunkCount: 2 })).toBe(true);
    expect(hunkNavigationAvailable({ stale: true, hunkCount: 2 })).toBe(false);
    expect(hunkNavigationAvailable({ stale: false, hunkCount: 0 })).toBe(false);
  });

  it("scrolls to the first removed line, or where an insertion is anchored", () => {
    const doc = Text.of(["one", "two", "three"]);

    expect(hunkScrollPosition(doc, { oldLines: ["two"], displayOldStartLine: 2, displayAnchorLine: 2 })).toBe(doc.line(2).from);
    expect(hunkScrollPosition(doc, { oldLines: [], displayOldStartLine: 3, displayAnchorLine: 2 })).toBe(doc.line(2).to);
    expect(hunkScrollPosition(doc, { oldLines: [], displayOldStartLine: 1, displayAnchorLine: 0 })).toBe(0);
    expect(hunkScrollPosition(doc, { oldLines: ["x"], displayOldStartLine: 9, displayAnchorLine: 9 })).toBe(doc.line(3).from);
  });

  it("keys the cursor to the reviewed snapshot so a new outside revision resets it", () => {
    const shown = hunkNavigationKey({ documentPath: "/ws/doc.md", fileId: "external-file-1", reviewedContentHash: "disk-1" });

    // Same file, same reviewed content (e.g. after a chunk Keep): the cursor stays.
    expect(hunkNavigationKey({ documentPath: "/ws/doc.md", fileId: "external-file-1", reviewedContentHash: "disk-1" })).toBe(shown);
    // The stable file id survives revisions; the reviewed content does not.
    expect(hunkNavigationKey({ documentPath: "/ws/doc.md", fileId: "external-file-1", reviewedContentHash: "disk-2" })).not.toBe(shown);
    expect(hunkNavigationKey({ documentPath: "/ws/other.md", fileId: "external-file-1", reviewedContentHash: "disk-1" })).not.toBe(shown);
    expect(hunkNavigationKey({ documentPath: "/ws/doc.md", fileId: "external-file-2", reviewedContentHash: "disk-1" })).not.toBe(shown);
  });
});
