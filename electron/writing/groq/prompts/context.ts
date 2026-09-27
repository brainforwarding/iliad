// Whole-document context for prompt v2 `autocomplete` and `selection` (spec
// 2026-09-27-ai-context-and-preferences.md, Review). Pure: no Node, Electron
// or DOM imports, because the Iliad AI proxy Worker imports the prompt module.
//
// Main builds the context from the renderer's full-document snapshot: the
// outline (headings only) and the document trimmed to the task's byte budget,
// with the cursor marked (completions) or the passage's place marked (edits,
// whose passage is sent separately as the only editable text).

import {
  WRITING_AI_DOCUMENT_START_BYTES,
  WRITING_AI_MAX_OUTLINE_BYTES,
  WRITING_AI_MAX_OUTLINE_HEADINGS,
  WRITING_AI_MAX_OUTLINE_HEADING_CHARS
} from "./limits.js";

/** Where the insertion goes, in a completion's document. Exactly once. */
export const CONTEXT_CURSOR_MARKER = "<<<CURSOR>>>";
/** Where the editable passage sits, in an edit's read-only reference document. Exactly once. */
export const CONTEXT_PASSAGE_MARKER = "<<<PASSAGE>>>";
/** Visible omission marker between kept parts of a trimmed document or outline. */
export const CONTEXT_OMISSION = "[…]";
const OMISSION_JOIN = `\n${CONTEXT_OMISSION}\n`;
/** The outline marks the heading of the cursor's section with this suffix. */
export const OUTLINE_CURSOR_MARK = "  ← cursor";
export const OUTLINE_CURSOR_BEFORE_FIRST_HEADING = "← cursor (before the first heading)";

/** Any `<<<NAME>>>` delimiter the prompts use (or could use). */
const DELIMITER_PATTERN = /<<<([A-Z_]+)>>>/g;

export function containsPromptDelimiter(text: string): boolean {
  DELIMITER_PATTERN.lastIndex = 0;
  return DELIMITER_PATTERN.test(text);
}

export function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/**
 * Document text, outline and preferences are content: a literal `<<<NAME>>>`
 * in them must not open or close a prompt section, so it is shown as
 * `<<NAME>>` (context only — the file is never changed).
 */
export function neutralizePromptDelimiters(text: string): string {
  return text.replace(DELIMITER_PATTERN, "<<$1>>");
}

// ---------------------------------------------------------------------------
// Sizes.

/**
 * UTF-8 bytes `text` takes inside `JSON.stringify` (without the quotes):
 * `"` `\` and the short escapes take 2, other controls 6, lone surrogates 6
 * (well-formed JSON.stringify escapes them), then plain UTF-8.
 */
export function jsonStringUtf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = unitCost(text, index);
    bytes += unit.bytes;
    index += unit.width - 1;
  }
  return bytes;
}

function unitCost(text: string, index: number): { bytes: number; width: number } {
  const code = text.charCodeAt(index);
  if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c || code === 0x0a || code === 0x0d || code === 0x09) {
    return { bytes: 2, width: 1 };
  }
  if (code < 0x20) return { bytes: 6, width: 1 };
  if (code < 0x80) return { bytes: 1, width: 1 };
  if (code < 0x800) return { bytes: 2, width: 1 };
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    return next >= 0xdc00 && next <= 0xdfff ? { bytes: 4, width: 2 } : { bytes: 6, width: 1 };
  }
  if (code >= 0xdc00 && code <= 0xdfff) return { bytes: 6, width: 1 };
  return { bytes: 3, width: 1 };
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Moves `offset` off the middle of a surrogate pair (to the pair's start). */
export function safeBoundary(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(text.length, Math.floor(offset)));
  if (clamped > 0 && clamped < text.length && isLowSurrogate(text.charCodeAt(clamped)) && isHighSurrogate(text.charCodeAt(clamped - 1))) {
    return clamped - 1;
  }
  return clamped;
}

/** A shared allowance of JSON bytes and chars, spent as text is kept. */
interface Budget {
  bytes: number;
  chars: number;
}

/** Keeps text forward from `from` (never past `limit`) while it fits; returns the end. Never splits a pair. */
function takeForward(text: string, from: number, limit: number, budget: Budget, capBytes = Infinity): number {
  let end = from;
  let spent = 0;
  while (end < limit) {
    const unit = unitCost(text, end);
    if (end + unit.width > limit || unit.bytes > budget.bytes || unit.width > budget.chars || spent + unit.bytes > capBytes) break;
    budget.bytes -= unit.bytes;
    budget.chars -= unit.width;
    spent += unit.bytes;
    end += unit.width;
  }
  return end;
}

/** Keeps text backward from `to` (never before `limit`) while it fits; returns the start. Never splits a pair. */
function takeBackward(text: string, to: number, limit: number, budget: Budget, capBytes = Infinity): number {
  let start = to;
  let spent = 0;
  while (start > limit) {
    const pair = start - 2 >= limit && isLowSurrogate(text.charCodeAt(start - 1)) && isHighSurrogate(text.charCodeAt(start - 2));
    const unitStart = pair ? start - 2 : start - 1;
    const unit = unitCost(text, unitStart);
    if (unit.bytes > budget.bytes || unit.width > budget.chars || spent + unit.bytes > capBytes) break;
    budget.bytes -= unit.bytes;
    budget.chars -= unit.width;
    spent += unit.bytes;
    start = unitStart;
  }
  return start;
}

/** Keeps text backward using at most half of the budget; the unused part stays in it. */
function spendHalfBackward(text: string, to: number, limit: number, budget: Budget): number {
  const half: Budget = { bytes: Math.floor(budget.bytes / 2), chars: Math.floor(budget.chars / 2) };
  budget.bytes -= half.bytes;
  budget.chars -= half.chars;
  const start = takeBackward(text, to, limit, half);
  budget.bytes += half.bytes;
  budget.chars += half.chars;
  return start;
}

function refund(budget: Budget, text: string) {
  budget.bytes += jsonStringUtf8Bytes(text);
  budget.chars += text.length;
}

/** How far a cut may move to land on a line boundary instead of mid-line. */
const LINE_SNAP_CHARS = 400;

/** A kept range that ends at a cut ends after a line break when one is near. */
function snapEndToLine(text: string, start: number, end: number, budget: Budget): number {
  const lineBreak = text.lastIndexOf("\n", end - 1);
  if (lineBreak < start || end - (lineBreak + 1) > LINE_SNAP_CHARS || lineBreak + 1 === end) return end;
  refund(budget, text.slice(lineBreak + 1, end));
  return lineBreak + 1;
}

/** A kept range that starts at a cut starts at a line start when one is near. */
function snapStartToLine(text: string, start: number, end: number, budget: Budget): number {
  if (start === 0 || text[start - 1] === "\n") return start;
  const lineBreak = text.indexOf("\n", start);
  if (lineBreak < 0 || lineBreak + 1 > end || lineBreak + 1 - start > LINE_SNAP_CHARS) return start;
  refund(budget, text.slice(start, lineBreak + 1));
  return lineBreak + 1;
}

// ---------------------------------------------------------------------------
// Trimming.

export type TrimDocumentInput = {
  text: string;
  /** Budget for the result inside `JSON.stringify` (UTF-8 bytes, markers included). */
  budgetBytes: number;
  /** The result (markers included) is at most this many chars. */
  maxChars: number;
  /** Of the budget, the document start gets at most this much before the nearest text (default WRITING_AI_DOCUMENT_START_BYTES). */
  startBytes?: number;
} & (
  | {
      /** Completion: the cursor, marked with CONTEXT_CURSOR_MARKER. */
      cursor: number;
      /** The safe local window around the cursor, kept first (default: the cursor alone). */
      localWindow?: { from: number; to: number };
    }
  | {
      /** Edit: the passage, sent separately; its place is marked with CONTEXT_PASSAGE_MARKER. */
      passage: { from: number; to: number };
    }
);

export interface TrimmedDocument {
  text: string;
  /** Some text was left out (omission markers present). */
  trimmed: boolean;
}

/**
 * Trims a document to its budget, deterministically (spec Review): the safe
 * local window (completions) first, then the document start, then the text
 * nearest the cursor/passage, outward; `[…]` marks every gap; cuts land on
 * line starts when one is near and never split a surrogate pair. A local
 * window that does not fit on its own falls back to a cursor-centred slice.
 * Delimiters inside the text are neutralized. Returns null when not even the
 * marker fits.
 */
export function trimDocumentForContext(input: TrimDocumentInput): TrimmedDocument | null {
  const { text } = input;
  let before: string;
  let after: string;
  let windowBefore: number;
  let windowAfter: number;
  let marker: string;

  if ("passage" in input) {
    const from = safeBoundary(text, Math.min(input.passage.from, input.passage.to));
    const to = safeBoundary(text, Math.max(input.passage.from, input.passage.to));
    before = neutralizePromptDelimiters(text.slice(0, from));
    after = neutralizePromptDelimiters(text.slice(to));
    windowBefore = 0;
    windowAfter = 0;
    marker = CONTEXT_PASSAGE_MARKER;
  } else {
    const cursor = safeBoundary(text, input.cursor);
    const windowFrom = safeBoundary(text, Math.min(cursor, input.localWindow?.from ?? cursor));
    const windowTo = safeBoundary(text, Math.max(cursor, input.localWindow?.to ?? cursor));
    before = neutralizePromptDelimiters(text.slice(0, cursor));
    after = neutralizePromptDelimiters(text.slice(cursor));
    // Offsets measured on the neutralized pieces (neutralizing only shortens).
    windowBefore = before.length - neutralizePromptDelimiters(text.slice(0, windowFrom)).length;
    windowAfter = neutralizePromptDelimiters(text.slice(cursor, windowTo)).length;
    marker = CONTEXT_CURSOR_MARKER;
  }

  const budget: Budget = { bytes: Math.floor(input.budgetBytes), chars: Math.floor(input.maxChars) };
  budget.bytes -= jsonStringUtf8Bytes(marker);
  budget.chars -= marker.length;
  if (budget.bytes < 0 || budget.chars < 0) return null;

  if (jsonStringUtf8Bytes(before) + jsonStringUtf8Bytes(after) <= budget.bytes && before.length + after.length <= budget.chars) {
    return { text: `${before}${marker}${after}`, trimmed: false };
  }

  // Room for the (at most two) omission markers.
  budget.bytes -= 2 * jsonStringUtf8Bytes(OMISSION_JOIN);
  budget.chars -= 2 * OMISSION_JOIN.length;
  if (budget.bytes < 0 || budget.chars < 0) return null;

  const windowStart = safeBoundary(before, before.length - windowBefore);
  const windowEnd = safeBoundary(after, windowAfter);
  const windowBytes = jsonStringUtf8Bytes(before.slice(windowStart)) + jsonStringUtf8Bytes(after.slice(0, windowEnd));
  const windowChars = before.length - windowStart + windowEnd;

  if (windowBytes > budget.bytes || windowChars > budget.chars) {
    // Oversized section: a slice centred on the cursor (half before, the
    // rest after, leftovers back before).
    let start = spendHalfBackward(before, before.length, 0, budget);
    const end = takeForward(after, 0, after.length, budget);
    start = takeBackward(before, start, 0, budget);
    return assemble(before, after, marker, 0, start, end);
  }

  budget.bytes -= windowBytes;
  budget.chars -= windowChars;

  // The document start, up to its share.
  let startEnd = takeForward(before, 0, windowStart, budget, input.startBytes ?? WRITING_AI_DOCUMENT_START_BYTES);
  if (startEnd < windowStart) startEnd = snapEndToLine(before, 0, startEnd, budget);

  // Then the nearest text, outward: half before, the rest after, leftovers back before.
  let lo = spendHalfBackward(before, windowStart, startEnd, budget);
  let hi = takeForward(after, windowEnd, after.length, budget);
  lo = takeBackward(before, lo, startEnd, budget);
  // Anything still left extends the document start toward the nearest text.
  if (startEnd < lo) {
    startEnd = takeForward(before, startEnd, lo, budget);
    if (startEnd < lo) startEnd = snapEndToLine(before, 0, startEnd, budget);
  }

  if (lo > startEnd) lo = snapStartToLine(before, lo, windowStart, budget);
  if (hi < after.length) hi = snapEndToLine(after, windowEnd, hi, budget);
  return assemble(before, after, marker, startEnd, lo, hi);
}

function assemble(before: string, after: string, marker: string, startEnd: number, lo: number, hi: number): TrimmedDocument {
  const head = lo > startEnd ? `${before.slice(0, startEnd)}${startEnd > 0 ? OMISSION_JOIN : `${CONTEXT_OMISSION}\n`}${before.slice(lo)}` : before;
  const tail = hi < after.length ? `${after.slice(0, hi)}${OMISSION_JOIN}` : after;
  return { text: `${head}${marker}${tail}`, trimmed: lo > startEnd || hi < after.length };
}

// ---------------------------------------------------------------------------
// Outline.

export interface OutlineHeading {
  level: number;
  text: string;
  /** Offset of the heading line's start in the document. */
  offset: number;
}

/**
 * ATX headings outside front matter and fenced code (the same Markdown
 * exclusions the renderer uses for context).
 */
export function collectOutlineHeadings(text: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  let frontMatter = lines.length > 1 && lines[0].replace(/\r$/, "").trim() === "---";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    const lineStart = offset;
    offset += lines[index].length + 1;

    if (frontMatter) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) frontMatter = false;
      continue;
    }

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
      continue;
    }
    if (fenceMatch && !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }

    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!heading) continue;
    const title = (heading[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "").trim();
    if (!title) continue;
    headings.push({ level: heading[1].length, text: title, offset: lineStart });
  }

  return headings;
}

export interface OutlineOptions {
  maxHeadings?: number;
  maxBytes?: number;
}

/**
 * The document's outline for a completion: one `## Heading` line per ATX
 * heading, the cursor's section marked. Capped in count and UTF-8 bytes:
 * headings farthest from the cursor go first, gaps shown as `[…]`. Empty
 * when the document has no headings.
 */
export function buildDocumentOutline(text: string, cursor: number, options: OutlineOptions = {}): string {
  const maxHeadings = Math.max(1, options.maxHeadings ?? WRITING_AI_MAX_OUTLINE_HEADINGS);
  const maxBytes = options.maxBytes ?? WRITING_AI_MAX_OUTLINE_BYTES;
  const headings = collectOutlineHeadings(text);
  if (!headings.length) return "";

  let current = -1;
  for (let index = 0; index < headings.length && headings[index].offset <= cursor; index += 1) current = index;
  const lines = headings.map((heading, index) => {
    const title = neutralizePromptDelimiters(heading.text.slice(0, safeBoundary(heading.text, WRITING_AI_MAX_OUTLINE_HEADING_CHARS)));
    return `${"#".repeat(heading.level)} ${title}${index === current ? OUTLINE_CURSOR_MARK : ""}`;
  });

  const anchor = Math.max(0, current);
  let start = Math.max(0, Math.min(anchor - Math.floor((maxHeadings - 1) / 2), lines.length - maxHeadings));
  let end = Math.min(lines.length, start + maxHeadings);
  const render = () =>
    [
      ...(current < 0 ? [OUTLINE_CURSOR_BEFORE_FIRST_HEADING] : []),
      ...(start > 0 ? [CONTEXT_OMISSION] : []),
      ...lines.slice(start, end),
      ...(end < lines.length ? [CONTEXT_OMISSION] : [])
    ].join("\n");

  let outline = render();
  while (utf8Bytes(outline) > maxBytes && end - start > 1) {
    // Drop the heading farthest from the cursor's.
    if (anchor - start >= end - 1 - anchor) start += 1;
    else end -= 1;
    outline = render();
  }
  return utf8Bytes(outline) <= maxBytes ? outline : "";
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (isHighSurrogate(code) && index + 1 < text.length && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
