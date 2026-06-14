export interface TextRange {
  from: number;
  to: number;
}

export interface BlockedLineRange {
  from: number;
  to: number;
}

export interface AutocompleteContext {
  prefix: string;
  suffix: string;
  headingPath: string[];
  nearbyHeadings: string[];
}

const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>)]+/gi;
const htmlTagPattern = /<\/?[A-Za-z][^>\n]*>/g;
const markdownLinkPattern = /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function clampOffset(text: string, offset: number) {
  return Math.max(0, Math.min(text.length, Math.floor(offset)));
}

function pushRange(ranges: TextRange[], from: number, to: number) {
  if (to > from) {
    ranges.push({ from, to });
  }
}

export function mergeTextRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length <= 1) {
    return ranges.slice();
  }

  const sorted = ranges
    .filter((range) => range.to > range.from)
    .sort((left, right) => (left.from === right.from ? left.to - right.to : left.from - right.from));
  const merged: TextRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

export function rangeIntersects(a: TextRange, b: TextRange) {
  return a.from < b.to && b.from < a.to;
}

export function positionInRanges(position: number, ranges: readonly TextRange[]) {
  return ranges.some((range) => position >= range.from && position < range.to);
}

export function rangeIntersectsAny(range: TextRange, ranges: readonly TextRange[]) {
  return ranges.some((candidate) => rangeIntersects(range, candidate));
}

export function lineNumberAtOffset(text: string, offset: number) {
  const end = clampOffset(text, offset);
  let line = 1;

  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }

  return line;
}

export function offsetForLineNumber(text: string, lineNumber: number) {
  const targetLine = Math.max(1, Math.floor(lineNumber));

  if (targetLine <= 1) {
    return 0;
  }

  let line = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      line += 1;

      if (line === targetLine) {
        return index + 1;
      }
    }
  }

  return text.length;
}

export function blockedLineRangesToTextRanges(text: string, ranges: readonly BlockedLineRange[] = []): TextRange[] {
  return ranges
    .map((range) => ({
      from: offsetForLineNumber(text, range.from),
      to: offsetForLineNumber(text, range.to + 1)
    }))
    .filter((range) => range.to > range.from);
}

function collectInlineCodeRanges(line: string, lineOffset: number, ranges: TextRange[]) {
  let index = 0;

  while (index < line.length) {
    const opener = line.indexOf("`", index);

    if (opener === -1) {
      return;
    }

    let markerLength = 1;
    while (line[opener + markerLength] === "`") {
      markerLength += 1;
    }

    const marker = "`".repeat(markerLength);
    const closer = line.indexOf(marker, opener + markerLength);

    if (closer === -1) {
      pushRange(ranges, lineOffset + opener, lineOffset + line.length);
      return;
    }

    pushRange(ranges, lineOffset + opener, lineOffset + closer + markerLength);
    index = closer + markerLength;
  }
}

function collectPatternRanges(line: string, lineOffset: number, pattern: RegExp, ranges: TextRange[]) {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line))) {
    pushRange(ranges, lineOffset + match.index, lineOffset + match.index + match[0].length);
  }
}

function collectMarkdownLinkDestinationRanges(line: string, lineOffset: number, ranges: TextRange[]) {
  markdownLinkPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkPattern.exec(line))) {
    const destination = match[1];
    const destinationOffset = match[0].indexOf(destination);

    if (destinationOffset >= 0) {
      pushRange(
        ranges,
        lineOffset + match.index + destinationOffset,
        lineOffset + match.index + destinationOffset + destination.length
      );
    }
  }
}

export function collectMarkdownExcludedRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  let offset = 0;
  let inFence = false;
  let fenceMarker = "";
  let frontMatterOpen = lines[0]?.trim() === "---";

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const lineWithBreakEnd = lineEnd + (lineIndex < lines.length - 1 ? 1 : 0);
    const trimmed = line.trim();

    if (frontMatterOpen) {
      pushRange(ranges, lineStart, lineWithBreakEnd);

      if (lineIndex > 0 && trimmed === "---") {
        frontMatterOpen = false;
      }

      offset = lineWithBreakEnd;
      continue;
    }

    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);

    if (inFence) {
      pushRange(ranges, lineStart, lineWithBreakEnd);

      if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }

      offset = lineWithBreakEnd;
      continue;
    }

    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[2][0].repeat(fenceMatch[2].length);
      pushRange(ranges, lineStart, lineWithBreakEnd);
      offset = lineWithBreakEnd;
      continue;
    }

    collectInlineCodeRanges(line, lineStart, ranges);
    collectMarkdownLinkDestinationRanges(line, lineStart, ranges);
    collectPatternRanges(line, lineStart, urlPattern, ranges);
    collectPatternRanges(line, lineStart, htmlTagPattern, ranges);

    offset = lineWithBreakEnd;
  }

  return mergeTextRanges(ranges);
}

function isWordCharacter(char: string | undefined) {
  return Boolean(char && /[\p{L}\p{N}'-]/u.test(char));
}

export function wordRangeAt(text: string, offset: number): TextRange | null {
  const position = clampOffset(text, offset);

  if (!isWordCharacter(text[position]) && !isWordCharacter(text[position - 1])) {
    return null;
  }

  let from = isWordCharacter(text[position]) ? position : position - 1;
  let to = from + 1;

  while (from > 0 && isWordCharacter(text[from - 1])) {
    from -= 1;
  }

  while (to < text.length && isWordCharacter(text[to])) {
    to += 1;
  }

  return { from, to };
}

export function isRangeWritableProse(
  text: string,
  range: TextRange,
  excludedRanges = collectMarkdownExcludedRanges(text),
  blockedLineRanges: readonly BlockedLineRange[] = []
) {
  if (range.to <= range.from) {
    return false;
  }

  if (rangeIntersectsAny(range, excludedRanges)) {
    return false;
  }

  const blockedRanges = blockedLineRangesToTextRanges(text, blockedLineRanges);
  return !rangeIntersectsAny(range, blockedRanges);
}

export function extractHeadingPath(text: string, cursor: number) {
  const beforeCursor = text.slice(0, clampOffset(text, cursor));
  const lines = beforeCursor.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const headings: string[] = [];

  for (const line of lines) {
    const match = headingPattern.exec(line);

    if (!match) {
      continue;
    }

    const level = match[1].length;
    headings.length = Math.max(0, level - 1);
    headings[level - 1] = match[2].trim();
  }

  return headings.filter(Boolean);
}

function paragraphStart(text: string, cursor: number) {
  const position = clampOffset(text, cursor);
  const previousBreak = text.lastIndexOf("\n\n", Math.max(0, position - 1));
  const previousHeading = text.lastIndexOf("\n#", Math.max(0, position - 1));
  const start = Math.max(previousBreak >= 0 ? previousBreak + 2 : 0, previousHeading >= 0 ? previousHeading + 1 : 0);

  return start;
}

function previousHeadingBoundary(text: string, cursor: number) {
  const position = clampOffset(text, cursor);
  const beforeCursor = text.slice(0, position);
  const matches = Array.from(beforeCursor.matchAll(/^#{1,6}\s+.+$/gm));
  const last = matches.at(-1);

  return last?.index ?? 0;
}

function nextHeadingBoundary(text: string, cursor: number) {
  const position = clampOffset(text, cursor);
  const afterCursor = text.slice(position);
  const match = /^#{1,6}\s+.+$/m.exec(afterCursor);

  return match?.index !== undefined ? position + match.index : text.length;
}

export function buildAutocompleteContext(
  text: string,
  cursor: number,
  options: {
    minPrefixChars?: number;
    maxPrefixChars?: number;
    maxSuffixChars?: number;
    blockedLineRanges?: readonly BlockedLineRange[];
    includePreviousBlockOnEmptyPrefix?: boolean;
    includePreviousBlockOnShortPrefix?: boolean;
    minShortPrefixChars?: number;
  } = {}
): AutocompleteContext | null {
  const position = clampOffset(text, cursor);
  const excludedRanges = collectMarkdownExcludedRanges(text);
  const cursorProbeRange = {
    from: Math.max(0, position - 1),
    to: Math.min(text.length, position + 1)
  };
  const blockedRanges = blockedLineRangesToTextRanges(text, options.blockedLineRanges);

  if (positionInRanges(position, excludedRanges) || rangeIntersectsAny(cursorProbeRange, blockedRanges)) {
    return null;
  }

  const maxPrefixChars = options.maxPrefixChars ?? 2500;
  const maxSuffixChars = options.maxSuffixChars ?? 1200;
  const localStart = paragraphStart(text, position);
  const localPrefix = text.slice(localStart, position);
  const localPrefixChars = localPrefix.trim().length;
  const minPrefixChars = options.minPrefixChars ?? 20;
  const minShortPrefixChars = options.minShortPrefixChars ?? 4;
  const hasEnoughLocalIntent =
    localPrefixChars >= minPrefixChars ||
    (options.includePreviousBlockOnEmptyPrefix && localPrefixChars === 0) ||
    (options.includePreviousBlockOnShortPrefix && localPrefixChars >= minShortPrefixChars);

  if (!hasEnoughLocalIntent) {
    return null;
  }

  const sectionStart = previousHeadingBoundary(text, position);
  const sectionEnd = nextHeadingBoundary(text, position);
  let prefixStart = Math.max(sectionStart, position - maxPrefixChars);
  const suffixEnd = Math.min(sectionEnd, position + maxSuffixChars);
  let prefix = text.slice(prefixStart, position);
  const suffix = text.slice(position, suffixEnd);

  if (
    prefix.trim().length < minPrefixChars &&
    (options.includePreviousBlockOnEmptyPrefix || options.includePreviousBlockOnShortPrefix) &&
    localStart > 0
  ) {
    const canUsePreviousBlock =
      (options.includePreviousBlockOnEmptyPrefix && localPrefixChars === 0) ||
      (options.includePreviousBlockOnShortPrefix && localPrefixChars >= minShortPrefixChars);

    if (canUsePreviousBlock) {
      const previousPosition = Math.max(0, localStart - 2);
      const previousStart = paragraphStart(text, previousPosition);
      prefixStart = Math.max(previousStart, position - maxPrefixChars);
      prefix = text.slice(prefixStart, position);
    }
  }

  if (prefix.trim().length < minPrefixChars) {
    return null;
  }

  return {
    prefix,
    suffix,
    headingPath: extractHeadingPath(text, position),
    nearbyHeadings: extractHeadingPath(text, suffixEnd)
  };
}
