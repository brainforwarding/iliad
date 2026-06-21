import { lstat, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { ensureInsideWorkspace, ensureVisibleWorkspacePath, isIgnoredWorkspaceName, markdownExtensions } from "./pathSafety.js";

export interface MarkdownContentSearchRequest {
  workspaceRoot: string;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  maxReturnedFiles?: number;
  maxReturnedMatches?: number;
  maxMatchesPerFile?: number;
  maxFileBytes?: number;
  maxScannedMarkdownFiles?: number;
  maxVisitedEntries?: number;
  maxDirectoryDepth?: number;
  maxQueryLength?: number;
}

export type MarkdownContentSearchTruncationReason =
  | "files"
  | "matches"
  | "scanned_files"
  | "visited_entries"
  | "directory_depth"
  | "query_length";

export interface MarkdownContentSearchRange {
  /** UTF-16 column offsets within lineText. */
  startColumn: number;
  endColumn: number;
}

export interface MarkdownContentSearchMatch {
  id: string;
  lineNumber: number;
  lineText: string;
  matchedText: string;
  /** UTF-16 CodeMirror-compatible offsets against the raw loaded document. */
  startOffset: number;
  endOffset: number;
  startColumn: number;
  endColumn: number;
  ranges: MarkdownContentSearchRange[];
}

export interface MarkdownContentSearchFileResult {
  filePath: string;
  relativePath: string;
  name: string;
  returnedMatchCount: number;
  matches: MarkdownContentSearchMatch[];
}

export interface MarkdownContentSearchResponse {
  status: "ok" | "invalid_regex";
  query: string;
  files: MarkdownContentSearchFileResult[];
  returnedFiles: number;
  returnedMatches: number;
  scannedMarkdownFiles: number;
  visitedEntries: number;
  skippedOversizedFiles: number;
  skippedUnreadableFiles: number;
  truncated: boolean;
  truncatedReasons: MarkdownContentSearchTruncationReason[];
  invalidRegexMessage?: string;
}

interface SearchLimits {
  maxReturnedFiles: number;
  maxReturnedMatches: number;
  maxMatchesPerFile: number;
  maxFileBytes: number;
  maxScannedMarkdownFiles: number;
  maxVisitedEntries: number;
  maxDirectoryDepth: number;
  maxQueryLength: number;
}

interface LineSpan {
  start: number;
  end: number;
}

interface SearchState {
  root: string;
  query: string;
  matcher: RegExp;
  limits: SearchLimits;
  files: MarkdownContentSearchFileResult[];
  returnedMatches: number;
  scannedMarkdownFiles: number;
  visitedEntries: number;
  skippedOversizedFiles: number;
  skippedUnreadableFiles: number;
  truncatedReasons: Set<MarkdownContentSearchTruncationReason>;
  stopped: boolean;
}

const defaultLimits: SearchLimits = {
  maxReturnedFiles: 100,
  maxReturnedMatches: 500,
  maxMatchesPerFile: 500,
  maxFileBytes: 1024 * 1024,
  maxScannedMarkdownFiles: 5000,
  maxVisitedEntries: 20000,
  maxDirectoryDepth: 25,
  maxQueryLength: 200
};

function clampLimit(value: number | undefined, fallback: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), maximum));
}

function normalizeLimits(request: MarkdownContentSearchRequest): SearchLimits {
  const maxReturnedMatches = clampLimit(
    request.maxReturnedMatches,
    defaultLimits.maxReturnedMatches,
    defaultLimits.maxReturnedMatches
  );

  return {
    maxReturnedFiles: clampLimit(
      request.maxReturnedFiles,
      defaultLimits.maxReturnedFiles,
      defaultLimits.maxReturnedFiles
    ),
    maxReturnedMatches,
    maxMatchesPerFile: clampLimit(request.maxMatchesPerFile, maxReturnedMatches, maxReturnedMatches),
    maxFileBytes: clampLimit(request.maxFileBytes, defaultLimits.maxFileBytes, defaultLimits.maxFileBytes),
    maxScannedMarkdownFiles: clampLimit(
      request.maxScannedMarkdownFiles,
      defaultLimits.maxScannedMarkdownFiles,
      defaultLimits.maxScannedMarkdownFiles
    ),
    maxVisitedEntries: clampLimit(
      request.maxVisitedEntries,
      defaultLimits.maxVisitedEntries,
      defaultLimits.maxVisitedEntries
    ),
    maxDirectoryDepth: clampLimit(
      request.maxDirectoryDepth,
      defaultLimits.maxDirectoryDepth,
      defaultLimits.maxDirectoryDepth
    ),
    maxQueryLength: clampLimit(request.maxQueryLength, defaultLimits.maxQueryLength, defaultLimits.maxQueryLength)
  };
}

function emptyResponse(
  status: MarkdownContentSearchResponse["status"],
  query: string,
  truncatedReasons: Set<MarkdownContentSearchTruncationReason>,
  invalidRegexMessage?: string
): MarkdownContentSearchResponse {
  return {
    status,
    query,
    files: [],
    returnedFiles: 0,
    returnedMatches: 0,
    scannedMarkdownFiles: 0,
    visitedEntries: 0,
    skippedOversizedFiles: 0,
    skippedUnreadableFiles: 0,
    truncated: truncatedReasons.size > 0,
    truncatedReasons: [...truncatedReasons],
    invalidRegexMessage
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileMatcher(request: MarkdownContentSearchRequest, query: string) {
  const source = request.regex ? query : escapeRegExp(query);
  // JavaScript word boundaries are intentionally simple here; they match the
  // first-pass UI control without adding custom Unicode word segmentation.
  const boundedSource = request.wholeWord ? `\\b(?:${source})\\b` : source;
  const flags = request.matchCase ? "g" : "gi";

  return new RegExp(boundedSource, flags);
}

function normalizeRelativePath(root: string, filePath: string) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isMarkdownFile(filePath: string) {
  return markdownExtensions.has(path.extname(filePath).toLowerCase());
}

function rankEntry(entry: { name: string; isDirectory: () => boolean }) {
  const isAssetDirectory = entry.isDirectory() && entry.name === "assets";

  if (entry.isDirectory() && !isAssetDirectory) {
    return 0;
  }

  if (isMarkdownFile(entry.name)) {
    return 1;
  }

  if (isAssetDirectory) {
    return 2;
  }

  return 3;
}

function sortEntries<T extends { name: string; isDirectory: () => boolean }>(entries: T[]) {
  return [...entries].sort((left, right) => {
    const rankDifference = rankEntry(left) - rankEntry(right);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function buildLineSpans(text: string) {
  const spans: LineSpan[] = [];
  let lineStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\r") {
      spans.push({ start: lineStart, end: index });

      if (text[index + 1] === "\n") {
        index += 1;
      }

      lineStart = index + 1;
      continue;
    }

    if (character === "\n") {
      spans.push({ start: lineStart, end: index });
      lineStart = index + 1;
    }
  }

  spans.push({ start: lineStart, end: text.length });
  return spans;
}

function lineIndexForOffset(spans: LineSpan[], offset: number, previousIndex: number) {
  let index = Math.max(0, Math.min(previousIndex, spans.length - 1));

  while (index + 1 < spans.length && offset >= spans[index + 1]!.start) {
    index += 1;
  }

  while (index > 0 && offset < spans[index]!.start) {
    index -= 1;
  }

  return index;
}

function matchRangeForLine(startOffset: number, endOffset: number, line: LineSpan): MarkdownContentSearchRange[] {
  const startColumn = Math.max(0, Math.min(startOffset - line.start, line.end - line.start));
  const endColumn = Math.max(startColumn, Math.min(endOffset - line.start, line.end - line.start));

  return endColumn > startColumn ? [{ startColumn, endColumn }] : [];
}

function addTruncation(state: SearchState, reason: MarkdownContentSearchTruncationReason) {
  state.truncatedReasons.add(reason);
}

function stopForTruncation(state: SearchState, reason: MarkdownContentSearchTruncationReason) {
  addTruncation(state, reason);
  state.stopped = true;
}

async function scanFile(state: SearchState, filePath: string, size: number) {
  if (size > state.limits.maxFileBytes) {
    state.skippedOversizedFiles += 1;
    return;
  }

  if (state.scannedMarkdownFiles >= state.limits.maxScannedMarkdownFiles) {
    stopForTruncation(state, "scanned_files");
    return;
  }

  state.scannedMarkdownFiles += 1;

  let text: string;

  try {
    text = await readFile(filePath, "utf8");
  } catch {
    state.skippedUnreadableFiles += 1;
    return;
  }

  if (text.includes("\0")) {
    state.skippedUnreadableFiles += 1;
    return;
  }

  const relativePath = normalizeRelativePath(state.root, filePath);
  const lineSpans = buildLineSpans(text);
  const matches: MarkdownContentSearchMatch[] = [];
  let lineIndex = 0;
  let fileMatchIndex = 0;
  state.matcher.lastIndex = 0;

  while (!state.stopped) {
    const match = state.matcher.exec(text);

    if (!match) {
      break;
    }

    if (match[0].length === 0) {
      if (state.matcher.lastIndex >= text.length) {
        break;
      }

      state.matcher.lastIndex += 1;
      continue;
    }

    if (state.returnedMatches >= state.limits.maxReturnedMatches) {
      stopForTruncation(state, "matches");
      break;
    }

    if (matches.length >= state.limits.maxMatchesPerFile) {
      addTruncation(state, "matches");
      break;
    }

    const startOffset = match.index;
    const matchedText = match[0];
    const endOffset = startOffset + matchedText.length;
    lineIndex = lineIndexForOffset(lineSpans, startOffset, lineIndex);
    const line = lineSpans[lineIndex]!;
    const ranges = matchRangeForLine(startOffset, endOffset, line);
    const startColumn = Math.max(0, Math.min(startOffset - line.start, line.end - line.start));
    const endColumn = Math.max(startColumn, Math.min(endOffset - line.start, line.end - line.start));
    const matchNumber = fileMatchIndex + 1;

    matches.push({
      id: `${relativePath}:${lineIndex + 1}:${startOffset}:${matchNumber}`,
      lineNumber: lineIndex + 1,
      lineText: text.slice(line.start, line.end),
      matchedText,
      startOffset,
      endOffset,
      startColumn,
      endColumn,
      ranges
    });
    fileMatchIndex += 1;
    state.returnedMatches += 1;
  }

  if (matches.length === 0) {
    return;
  }

  if (state.files.length >= state.limits.maxReturnedFiles) {
    stopForTruncation(state, "files");
    state.returnedMatches -= matches.length;
    return;
  }

  state.files.push({
    filePath,
    relativePath,
    name: path.basename(filePath),
    returnedMatchCount: matches.length,
    matches
  });
}

async function visitDirectory(state: SearchState, directoryPath: string, depth: number): Promise<void> {
  if (state.stopped) {
    return;
  }

  ensureInsideWorkspace(state.root, directoryPath);
  ensureVisibleWorkspacePath(state.root, directoryPath);

  if (depth > state.limits.maxDirectoryDepth) {
    addTruncation(state, "directory_depth");
    return;
  }

  let entries: Dirent<string>[];

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    state.skippedUnreadableFiles += 1;
    return;
  }

  for (const entry of sortEntries(entries)) {
    if (state.stopped) {
      return;
    }

    if (isIgnoredWorkspaceName(entry.name)) {
      continue;
    }

    if (state.visitedEntries >= state.limits.maxVisitedEntries) {
      stopForTruncation(state, "visited_entries");
      return;
    }

    state.visitedEntries += 1;
    const entryPath = path.join(directoryPath, entry.name);
    ensureInsideWorkspace(state.root, entryPath);
    ensureVisibleWorkspacePath(state.root, entryPath);

    if (entry.isSymbolicLink()) {
      continue;
    }

    let stats: Awaited<ReturnType<typeof lstat>>;

    try {
      stats = await lstat(entryPath);
    } catch {
      state.skippedUnreadableFiles += 1;
      continue;
    }

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      if (depth + 1 > state.limits.maxDirectoryDepth) {
        addTruncation(state, "directory_depth");
        continue;
      }

      await visitDirectory(state, entryPath, depth + 1);
      continue;
    }

    if (!stats.isFile() || !isMarkdownFile(entryPath)) {
      continue;
    }

    await scanFile(state, entryPath, stats.size);
  }
}

export async function searchMarkdownContent(
  request: MarkdownContentSearchRequest
): Promise<MarkdownContentSearchResponse> {
  const root = path.resolve(request.workspaceRoot);
  const limits = normalizeLimits(request);
  const truncatedReasons = new Set<MarkdownContentSearchTruncationReason>();
  const query = request.query.slice(0, limits.maxQueryLength);

  ensureInsideWorkspace(root, root);
  ensureVisibleWorkspacePath(root, root);

  if (request.query.length > limits.maxQueryLength) {
    truncatedReasons.add("query_length");
  }

  if (!query) {
    return emptyResponse("ok", query, truncatedReasons);
  }

  let matcher: RegExp;

  try {
    matcher = compileMatcher(request, query);
  } catch (error) {
    return emptyResponse(
      "invalid_regex",
      query,
      truncatedReasons,
      error instanceof Error ? error.message : "Invalid regular expression."
    );
  }

  const state: SearchState = {
    root,
    query,
    matcher,
    limits,
    files: [],
    returnedMatches: 0,
    scannedMarkdownFiles: 0,
    visitedEntries: 0,
    skippedOversizedFiles: 0,
    skippedUnreadableFiles: 0,
    truncatedReasons,
    stopped: false
  };

  await visitDirectory(state, root, 0);

  return {
    status: "ok",
    query,
    files: state.files,
    returnedFiles: state.files.length,
    returnedMatches: state.returnedMatches,
    scannedMarkdownFiles: state.scannedMarkdownFiles,
    visitedEntries: state.visitedEntries,
    skippedOversizedFiles: state.skippedOversizedFiles,
    skippedUnreadableFiles: state.skippedUnreadableFiles,
    truncated: state.truncatedReasons.size > 0,
    truncatedReasons: [...state.truncatedReasons]
  };
}
