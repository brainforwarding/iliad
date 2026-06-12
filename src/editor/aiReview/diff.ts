import type { AgentEditFileProposal, AgentReviewHunk } from "../../types/iliad";

interface LineSegment {
  text: string;
  lineBreak: string;
}

export interface DisplayReviewHunk extends AgentReviewHunk {
  displayOldStartLine: number;
  displayOldEndLine: number;
  displayAnchorLine: number;
}

export interface DisplayReviewState {
  stale: boolean;
  hunks: DisplayReviewHunk[];
  changedLineRanges: Array<{ from: number; to: number }>;
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

function hunkSegments(lines: string[], lineBreaks: string[] | undefined): LineSegment[] {
  return lines.map((text, index) => ({
    text,
    lineBreak: lineBreaks?.[index] ?? ""
  }));
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

export function reviewHunksForDisplay(currentContent: string, file: AgentEditFileProposal): DisplayReviewState {
  const hunks = file.hunks ?? [];
  const expected = reconstructContent(file.baseContent, hunks);

  if (currentContent !== expected) {
    return {
      stale: true,
      hunks: [],
      changedLineRanges: []
    };
  }

  const displayHunks: DisplayReviewHunk[] = [];
  const changedLineRanges: Array<{ from: number; to: number }> = [];
  let baseLine = 1;
  let displayLine = 1;

  for (const hunk of [...hunks].sort((a, b) => a.oldStartLine - b.oldStartLine)) {
    const equalLineCount = Math.max(0, hunk.oldStartLine - baseLine);
    baseLine += equalLineCount;
    displayLine += equalLineCount;

    if (hunk.status === "accepted") {
      displayLine += hunk.newLines.length;
      baseLine += hunk.oldLines.length;
      continue;
    }

    const oldLineCount = hunk.oldLines.length;

    if (hunk.status === "pending" || hunk.status === "stale") {
      const displayOldStartLine = displayLine;
      const displayOldEndLine = oldLineCount > 0 ? displayLine + oldLineCount - 1 : displayLine - 1;
      const displayAnchorLine = oldLineCount > 0 ? displayOldEndLine : displayLine - 1;

      displayHunks.push({
        ...hunk,
        displayOldStartLine,
        displayOldEndLine,
        displayAnchorLine
      });

      if (oldLineCount > 0) {
        changedLineRanges.push({ from: displayOldStartLine, to: displayOldEndLine });
      } else {
        changedLineRanges.push({ from: Math.max(1, displayLine), to: Math.max(1, displayLine) });
      }
    }

    displayLine += oldLineCount;
    baseLine += oldLineCount;
  }

  return {
    stale: false,
    hunks: displayHunks,
    changedLineRanges
  };
}
