import type { Text } from "@codemirror/state";
import type { DisplayReviewHunk } from "./diff";

/**
 * Previous/next navigation over an outside review's unresolved hunks (spec
 * 2026-09-27 premium pass, stage 5). Pure helpers so the rules are testable
 * without a DOM. Navigation only scrolls and highlights; it never keeps or
 * restores anything.
 */

/** Navigation needs a live (non-stale) review with at least one unresolved hunk. */
export function hunkNavigationAvailable(input: { stale: boolean; hunkCount: number }) {
  return !input.stale && input.hunkCount > 0;
}

/**
 * Keeps a remembered index inside the current hunk list. After a hunk is kept
 * or restored the list shrinks; the active hunk becomes the one that now sits
 * where the acted one was (or the new last one).
 */
export function clampHunkIndex(index: number | null, hunkCount: number): number | null {
  if (index === null || hunkCount <= 0) {
    return null;
  }

  return Math.min(Math.max(0, index), hunkCount - 1);
}

/** Next hunk: the first one when nothing is active yet; wraps from the last to the first. */
export function nextHunkIndex(current: number | null, hunkCount: number): number | null {
  if (hunkCount <= 0) {
    return null;
  }

  const clamped = clampHunkIndex(current, hunkCount);
  return clamped === null ? 0 : (clamped + 1) % hunkCount;
}

/** Previous hunk: the last one when nothing is active yet; wraps from the first to the last. */
export function previousHunkIndex(current: number | null, hunkCount: number): number | null {
  if (hunkCount <= 0) {
    return null;
  }

  const clamped = clampHunkIndex(current, hunkCount);
  return clamped === null ? hunkCount - 1 : (clamped - 1 + hunkCount) % hunkCount;
}

/**
 * The document position to bring into view for a hunk: the start of its first
 * removed line, or (pure insertions) the end of the line the added block
 * follows — the top of the document when it is inserted before line 1.
 */
export function hunkScrollPosition(doc: Text, hunk: Pick<DisplayReviewHunk, "oldLines" | "displayOldStartLine" | "displayAnchorLine">) {
  const clampLine = (line: number) => Math.min(Math.max(1, line), doc.lines);

  if (hunk.oldLines.length > 0) {
    return doc.line(clampLine(hunk.displayOldStartLine)).from;
  }

  if (hunk.displayAnchorLine <= 0) {
    return 0;
  }

  return doc.line(clampLine(hunk.displayAnchorLine)).to;
}
