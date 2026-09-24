import type { AgentReviewHunk } from "./types.js";

interface LineSegment {
  text: string;
  lineBreak: string;
}

function splitLineSegments(value: string): LineSegment[] {
  const segments: LineSegment[] = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char !== "\n" && char !== "\r") {
      continue;
    }

    let lineBreak = char;
    if (char === "\r" && value[index + 1] === "\n") {
      lineBreak = "\r\n";
      index += 1;
    }

    segments.push({
      text: value.slice(start, index + 1 - lineBreak.length),
      lineBreak
    });
    start = index + 1;
  }

  if (start < value.length) {
    segments.push({ text: value.slice(start), lineBreak: "" });
  }

  return segments;
}

function joinLineSegments(segments: LineSegment[]) {
  return segments.map((segment) => `${segment.text}${segment.lineBreak}`).join("");
}

function segmentKey(segment: LineSegment) {
  return `${segment.text}\u0000${segment.lineBreak}`;
}

function lcsMatrix(a: LineSegment[], b: LineSegment[]) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      matrix[i][j] =
        segmentKey(a[i]) === segmentKey(b[j])
          ? matrix[i + 1][j + 1] + 1
          : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }

  return matrix;
}

function hunkSegments(lines: string[], lineBreaks: string[] | undefined): LineSegment[] {
  return lines.map((text, index) => ({
    text,
    lineBreak: lineBreaks?.[index] ?? ""
  }));
}

export function buildLineReviewHunks(baseContent: string, replacement: string, fileId: string): AgentReviewHunk[] {
  const oldSegments = splitLineSegments(baseContent);
  const newSegments = splitLineSegments(replacement);
  const matrix = lcsMatrix(oldSegments, newSegments);
  const hunks: AgentReviewHunk[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldSegments.length || newIndex < newSegments.length) {
    if (
      oldIndex < oldSegments.length &&
      newIndex < newSegments.length &&
      segmentKey(oldSegments[oldIndex]) === segmentKey(newSegments[newIndex])
    ) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    const startOldIndex = oldIndex;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    const oldLineBreaks: string[] = [];
    const newLineBreaks: string[] = [];

    while (
      oldIndex < oldSegments.length ||
      newIndex < newSegments.length
    ) {
      if (
        oldIndex < oldSegments.length &&
        newIndex < newSegments.length &&
        segmentKey(oldSegments[oldIndex]) === segmentKey(newSegments[newIndex])
      ) {
        break;
      }

      if (
        newIndex < newSegments.length &&
        (oldIndex === oldSegments.length || matrix[oldIndex][newIndex + 1] >= matrix[oldIndex + 1][newIndex])
      ) {
        newLines.push(newSegments[newIndex].text);
        newLineBreaks.push(newSegments[newIndex].lineBreak);
        newIndex += 1;
      } else if (oldIndex < oldSegments.length) {
        oldLines.push(oldSegments[oldIndex].text);
        oldLineBreaks.push(oldSegments[oldIndex].lineBreak);
        oldIndex += 1;
      }
    }

    const oldStartLine = startOldIndex + 1;
    const anchorLine =
      oldLines.length > 0
        ? startOldIndex + oldLines.length
        : Math.max(0, Math.min(startOldIndex, oldSegments.length));

    appendReviewHunks(hunks, fileId, {
      anchorLine,
      oldStartLine,
      oldLines,
      newLines,
      oldLineBreaks,
      newLineBreaks
    });
  }

  return hunks;
}

type ReviewHunkDraft = Omit<AgentReviewHunk, "id" | "status">;

function hasOnlyWhitespaceLines(lines: string[]) {
  return lines.length > 0 && lines.every((line) => line.trim().length === 0);
}

function hasNonWhitespaceLine(lines: string[]) {
  return lines.some((line) => line.trim().length > 0);
}

function pushReviewHunk(hunks: AgentReviewHunk[], fileId: string, draft: ReviewHunkDraft) {
  hunks.push({
    id: `${fileId}-hunk-${hunks.length + 1}`,
    status: "pending",
    ...draft
  });
}

function appendReviewHunks(hunks: AgentReviewHunk[], fileId: string, draft: ReviewHunkDraft) {
  if (hasOnlyWhitespaceLines(draft.oldLines) && hasNonWhitespaceLine(draft.newLines)) {
    pushReviewHunk(hunks, fileId, {
      anchorLine: Math.max(0, draft.oldStartLine - 1),
      oldStartLine: draft.oldStartLine,
      oldLines: [],
      newLines: draft.newLines,
      oldLineBreaks: [],
      newLineBreaks: draft.newLineBreaks
    });
    pushReviewHunk(hunks, fileId, {
      anchorLine: draft.anchorLine,
      oldStartLine: draft.oldStartLine,
      oldLines: draft.oldLines,
      newLines: [],
      oldLineBreaks: draft.oldLineBreaks,
      newLineBreaks: []
    });
    return;
  }

  if (hasOnlyWhitespaceLines(draft.newLines) && hasNonWhitespaceLine(draft.oldLines)) {
    pushReviewHunk(hunks, fileId, {
      anchorLine: draft.anchorLine,
      oldStartLine: draft.oldStartLine,
      oldLines: draft.oldLines,
      newLines: [],
      oldLineBreaks: draft.oldLineBreaks,
      newLineBreaks: []
    });
    pushReviewHunk(hunks, fileId, {
      anchorLine: Math.max(0, draft.oldStartLine - 1),
      oldStartLine: draft.oldStartLine,
      oldLines: [],
      newLines: draft.newLines,
      oldLineBreaks: [],
      newLineBreaks: draft.newLineBreaks
    });
    return;
  }

  pushReviewHunk(hunks, fileId, draft);
}

export function reconstructContent(baseContent: string, hunks: AgentReviewHunk[]): string {
  const baseSegments = splitLineSegments(baseContent);
  const orderedHunks = [...hunks].sort((a, b) => a.oldStartLine - b.oldStartLine);
  const output: LineSegment[] = [];
  let baseIndex = 0;

  for (const hunk of orderedHunks) {
    const hunkStartIndex = Math.max(0, hunk.oldStartLine - 1);

    while (baseIndex < hunkStartIndex && baseIndex < baseSegments.length) {
      output.push(baseSegments[baseIndex]);
      baseIndex += 1;
    }

    if (hunk.status === "accepted") {
      output.push(...hunkSegments(hunk.newLines, hunk.newLineBreaks));
    } else {
      output.push(...baseSegments.slice(baseIndex, baseIndex + hunk.oldLines.length));
    }

    baseIndex += hunk.oldLines.length;
  }

  output.push(...baseSegments.slice(baseIndex));
  return joinLineSegments(output);
}
