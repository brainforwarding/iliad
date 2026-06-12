import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ignoredNames, markdownExtensions } from "../fs/pathSafety.js";
import { estimateTokensFromText } from "./contextManifest.js";
import { hashMarkdown } from "./hash.js";

export interface AgentDocumentToolLimits {
  maxListResults: number;
  maxReadBytes: number;
  maxSearchResults: number;
  maxSearchFiles: number;
  maxContentSearchDepth: number;
  maxPathSearchDepth: number;
  maxPathSearchFiles: number;
  maxContentSearchFiles: number;
  maxDepth: number;
  maxDirectories: number;
  maxFilesystemEntries: number;
  maxExcerptChars: number;
}

export interface ListDocumentsInput {
  directory?: string;
  depth?: number;
  limit?: number;
}

export interface ReadDocumentInput {
  path: string;
}

export interface OpenDocumentInput {
  path: string;
}

export interface OpenDocumentResult {
  relativePath: string;
}

export interface SearchDocumentsInput {
  query: string;
  /** Optional workspace-relative directory scope (the Grep `path` pattern). */
  directory?: string;
  limit?: number;
}

export interface AgentDocumentSummary {
  relativePath: string;
  name: string;
  sizeBytes: number;
  estimatedTokens: number;
}

export interface AgentDocumentToolSkippedCounts {
  ignored: number;
  unsafe: number;
  unreadable: number;
  oversized: number;
  nonMarkdown: number;
  symlink: number;
}

export interface ListDocumentsResult {
  files: AgentDocumentSummary[];
  truncated: boolean;
  skipped: AgentDocumentToolSkippedCounts;
}

export interface ReadDocumentResult {
  relativePath: string;
  hash: string;
  content: string;
  sizeBytes: number;
  estimatedTokens: number;
}

export interface SearchDocumentMatch {
  relativePath: string;
  line: number;
  matchType: "path" | "content";
  excerpt: string;
}

export interface SearchDocumentsResult {
  matches: SearchDocumentMatch[];
  truncated: boolean;
  searchedPaths: number;
  searchedFiles: number;
  skipped: AgentDocumentToolSkippedCounts;
}

export type AgentDocumentToolName = "list_documents" | "read_document" | "search_documents" | "open_document";
export type AgentDocumentToolStatus = "completed" | "failed";

export interface AgentDocumentToolEvent {
  toolName: AgentDocumentToolName;
  status: AgentDocumentToolStatus;
  durationMs: number;
  resultCount: number;
  truncated?: boolean;
  searchedPaths?: number;
  searchedFiles?: number;
  skipped?: AgentDocumentToolSkippedCounts;
  error?: {
    code: AgentDocumentToolErrorCode;
    message: string;
  };
}

export interface CreateAgentDocumentToolsOptions {
  workspaceRoot: string;
  limits?: Partial<AgentDocumentToolLimits>;
  onToolEvent?: (event: AgentDocumentToolEvent) => void;
  /** Invoked after open_document validation succeeds; owns the UI command. */
  onOpenDocument?: (relativePath: string) => void;
}

export interface AgentDocumentTools {
  limits: AgentDocumentToolLimits;
  listDocuments(input?: ListDocumentsInput, signal?: AbortSignal): Promise<ListDocumentsResult>;
  readDocument(input: ReadDocumentInput, signal?: AbortSignal): Promise<ReadDocumentResult>;
  searchDocuments(input: SearchDocumentsInput, signal?: AbortSignal): Promise<SearchDocumentsResult>;
  openDocument(input: OpenDocumentInput, signal?: AbortSignal): Promise<OpenDocumentResult>;
}

export type AgentDocumentToolErrorCode =
  | "invalid_input"
  | "invalid_path"
  | "workspace_unavailable"
  | "not_found"
  | "not_directory"
  | "not_file"
  | "not_markdown"
  | "symlink_path"
  | "oversized"
  | "unreadable";

export class AgentDocumentToolError extends Error {
  readonly code: AgentDocumentToolErrorCode;

  constructor(code: AgentDocumentToolErrorCode, message: string) {
    super(message);
    this.name = "AgentDocumentToolError";
    this.code = code;
  }
}

// Traversal limits are backstops against pathological trees, sized so real
// workspaces never hit them; output limits (results, list rows, read bytes)
// remain the working budgets. See ADR-0009 amendment and
// specs/2026-06-11-exhaustive-document-discovery.md.
export const defaultAgentDocumentToolLimits: AgentDocumentToolLimits = {
  maxListResults: 500,
  maxReadBytes: 512 * 1024,
  maxSearchResults: 50,
  maxSearchFiles: 500,
  maxContentSearchDepth: 8,
  maxPathSearchDepth: 16,
  maxPathSearchFiles: 20_000,
  maxContentSearchFiles: 500,
  maxDepth: 8,
  maxDirectories: 10_000,
  maxFilesystemEntries: 100_000,
  maxExcerptChars: 240
};

interface ResolvedDocumentPath {
  absolutePath: string;
  relativePath: string;
  stats: Stats;
}

// The walk collects paths only (dirent-typed, no per-entry lstat); sizes are an
// output concern and are stat'ed only for the list rows actually returned.
interface MarkdownFileEntry {
  absolutePath: string;
  relativePath: string;
  name: string;
}

interface MarkdownFileCollection {
  files: MarkdownFileEntry[];
  skipped: AgentDocumentToolSkippedCounts;
  truncated: boolean;
}

interface SearchMatcher {
  normalizedQuery: string;
  compactQuery: string;
  requiredTokens: string[];
  aliasGroups: string[][];
}

interface RankedSearchDocumentMatch extends SearchDocumentMatch {
  rank: number;
}

export function createAgentDocumentTools({
  workspaceRoot,
  limits: configuredLimits,
  onToolEvent,
  onOpenDocument
}: CreateAgentDocumentToolsOptions): AgentDocumentTools {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const limits = normalizeLimits(configuredLimits);

  return {
    limits,
    async listDocuments(input = {}, signal) {
      const startedAt = Date.now();

      try {
        const result = await listDocuments({ workspaceRoot: resolvedWorkspaceRoot, limits, input, signal });
        emitToolEvent(onToolEvent, "list_documents", startedAt, {
          status: "completed",
          resultCount: result.files.length,
          truncated: result.truncated,
          skipped: result.skipped
        });
        return result;
      } catch (error) {
        emitToolEvent(onToolEvent, "list_documents", startedAt, failedToolEvent(error));
        throw error;
      }
    },
    async readDocument(input, signal) {
      const startedAt = Date.now();

      try {
        throwIfWalkAborted(signal);
        const result = await readDocument({ workspaceRoot: resolvedWorkspaceRoot, limits, input });
        emitToolEvent(onToolEvent, "read_document", startedAt, {
          status: "completed",
          resultCount: 1
        });
        return result;
      } catch (error) {
        emitToolEvent(onToolEvent, "read_document", startedAt, failedToolEvent(error));
        throw error;
      }
    },
    async openDocument(input, signal) {
      const startedAt = Date.now();

      try {
        throwIfWalkAborted(signal);
        const result = await openDocument({ workspaceRoot: resolvedWorkspaceRoot, input, onOpenDocument });
        emitToolEvent(onToolEvent, "open_document", startedAt, {
          status: "completed",
          resultCount: 1
        });
        return result;
      } catch (error) {
        emitToolEvent(onToolEvent, "open_document", startedAt, failedToolEvent(error));
        throw error;
      }
    },
    async searchDocuments(input, signal) {
      const startedAt = Date.now();

      try {
        const result = await searchDocuments({ workspaceRoot: resolvedWorkspaceRoot, limits, input, signal });
        emitToolEvent(onToolEvent, "search_documents", startedAt, {
          status: "completed",
          resultCount: result.matches.length,
          truncated: result.truncated,
          searchedPaths: result.searchedPaths,
          searchedFiles: result.searchedFiles,
          skipped: result.skipped
        });
        return result;
      } catch (error) {
        emitToolEvent(onToolEvent, "search_documents", startedAt, failedToolEvent(error));
        throw error;
      }
    }
  };
}

async function listDocuments({
  workspaceRoot,
  limits,
  input,
  signal
}: {
  workspaceRoot: string;
  limits: AgentDocumentToolLimits;
  input: ListDocumentsInput;
  signal?: AbortSignal;
}): Promise<ListDocumentsResult> {
  assertPlainObject(input, "list_documents input");
  const limit = optionalBoundedInteger(input.limit, "limit", limits.maxListResults, limits.maxListResults);
  const depth = optionalBoundedInteger(input.depth, "depth", 1, limits.maxDepth);
  const depthClamped = typeof input.depth === "number" && input.depth > limits.maxDepth;
  const start =
    input.directory === undefined
      ? await resolveWorkspaceRoot(workspaceRoot)
      : await resolveDirectory(workspaceRoot, input.directory, "list_documents");
  const collected = await collectMarkdownFiles({ workspaceRoot, start, depth, limits, signal });
  const sortedFiles = collected.files.sort((a, b) => comparePath(a.relativePath, b.relativePath));
  const files: AgentDocumentSummary[] = [];

  // Sizes are stat'ed only for the rows actually returned; the walk itself is
  // stat-free.
  for (const file of sortedFiles.slice(0, limit)) {
    throwIfWalkAborted(signal);
    let stats;

    try {
      stats = await lstat(file.absolutePath);
    } catch {
      collected.skipped.unreadable += 1;
      continue;
    }

    if (!stats.isFile()) {
      collected.skipped.unsafe += 1;
      continue;
    }

    files.push({
      relativePath: file.relativePath,
      name: file.name,
      sizeBytes: stats.size,
      estimatedTokens: estimateTokensFromByteSize(stats.size)
    });
  }

  return {
    files,
    truncated: collected.truncated || depthClamped || sortedFiles.length > limit,
    skipped: collected.skipped
  };
}

async function readDocument({
  workspaceRoot,
  limits,
  input
}: {
  workspaceRoot: string;
  limits: AgentDocumentToolLimits;
  input: ReadDocumentInput;
}): Promise<ReadDocumentResult> {
  assertPlainObject(input, "read_document input");
  if (typeof input.path !== "string") {
    throw new AgentDocumentToolError("invalid_input", "read_document path must be a string.");
  }

  const relativePath = validateWorkspaceRelativePath(input.path, "file");

  if (!isMarkdownPath(relativePath)) {
    throw new AgentDocumentToolError("not_markdown", `Document path must target a Markdown file: ${relativePath}.`);
  }

  const resolved = await resolveFile(workspaceRoot, relativePath);

  if (resolved.stats.size > limits.maxReadBytes) {
    throw new AgentDocumentToolError("oversized", `Document is larger than the ${limits.maxReadBytes} byte read limit.`);
  }

  const content = await readUtf8Document(resolved.absolutePath, limits.maxReadBytes);
  const sizeBytes = Buffer.byteLength(content, "utf8");

  if (sizeBytes > limits.maxReadBytes) {
    throw new AgentDocumentToolError("oversized", `Document is larger than the ${limits.maxReadBytes} byte read limit.`);
  }

  return {
    relativePath,
    hash: hashMarkdown(content),
    content,
    sizeBytes,
    estimatedTokens: estimateTokensFromText(content)
  };
}

// Validation only — no content read. The injected callback owns the UI
// command; this function's success is the receipt's ground truth.
async function openDocument({
  workspaceRoot,
  input,
  onOpenDocument
}: {
  workspaceRoot: string;
  input: OpenDocumentInput;
  onOpenDocument?: (relativePath: string) => void;
}): Promise<OpenDocumentResult> {
  assertPlainObject(input, "open_document input");

  if (typeof input.path !== "string") {
    throw new AgentDocumentToolError("invalid_input", "open_document path must be a string.");
  }

  const relativePath = validateWorkspaceRelativePath(input.path, "file");

  if (!isMarkdownPath(relativePath)) {
    throw new AgentDocumentToolError("not_markdown", `Document path must target a Markdown file: ${relativePath}.`);
  }

  const resolved = await resolveFile(workspaceRoot, relativePath);

  onOpenDocument?.(resolved.relativePath);

  return { relativePath: resolved.relativePath };
}

async function searchDocuments({
  workspaceRoot,
  limits,
  input,
  signal
}: {
  workspaceRoot: string;
  limits: AgentDocumentToolLimits;
  input: SearchDocumentsInput;
  signal?: AbortSignal;
}): Promise<SearchDocumentsResult> {
  assertPlainObject(input, "search_documents input");
  if (typeof input.query !== "string") {
    throw new AgentDocumentToolError("invalid_input", "search_documents query must be a string.");
  }

  const limit = optionalBoundedInteger(input.limit, "limit", limits.maxSearchResults, limits.maxSearchResults);
  const query = normalizeQuery(input.query);
  const skipped = emptySkippedCounts();

  if (!query) {
    return {
      matches: [],
      truncated: false,
      searchedPaths: 0,
      searchedFiles: 0,
      skipped
    };
  }

  const matcher = searchMatcher(query);

  if (!matcher.normalizedQuery) {
    return {
      matches: [],
      truncated: false,
      searchedPaths: 0,
      searchedFiles: 0,
      skipped
    };
  }

  const start =
    input.directory === undefined
      ? await resolveWorkspaceRoot(workspaceRoot)
      : await resolveDirectory(workspaceRoot, input.directory, "search_documents");
  const collected = await collectMarkdownFiles({
    workspaceRoot,
    start,
    depth: Math.max(limits.maxPathSearchDepth, limits.maxContentSearchDepth),
    limits,
    signal
  });
  const sortedFiles = collected.files.sort((a, b) => comparePath(a.relativePath, b.relativePath));
  const pathCandidateFiles = sortedFiles.slice(0, limits.maxPathSearchFiles);
  // Depth limits are scope-relative: scoping into a deep directory must not
  // consume the content-search depth budget.
  const scopeDepth = start.relativePath ? start.relativePath.split("/").length : 0;
  const depthFilteredFiles = sortedFiles.filter(
    (file) => documentDirectoryDepth(file.relativePath) - scopeDepth <= limits.maxContentSearchDepth
  );
  const matches: RankedSearchDocumentMatch[] = [];
  const searchedPaths = pathCandidateFiles.length;
  let searchedFiles = 0;
  let truncated =
    collected.truncated ||
    sortedFiles.length > limits.maxPathSearchFiles ||
    depthFilteredFiles.length > limits.maxContentSearchFiles;

  addSkippedCounts(skipped, collected.skipped);

  const rankByPath = new Map<string, number>();

  for (const file of pathCandidateFiles) {
    const pathRank = pathMatchRank(file.relativePath, matcher);

    if (pathRank === null) {
      continue;
    }

    rankByPath.set(file.relativePath, pathRank);
    matches.push({
      relativePath: file.relativePath,
      line: 0,
      matchType: "path",
      excerpt: boundedExcerpt(file.relativePath, limits.maxExcerptChars),
      rank: pathRank
    });
  }

  // Content slots go to path-relevant candidates first (rank 0 < 1 < 2, stable
  // within a rank), then to the remaining depth-filtered files in path order —
  // an alphabetical slice would starve late-sorted files, the original bug.
  const contentCandidateFiles = [
    ...depthFilteredFiles
      .filter((file) => rankByPath.has(file.relativePath))
      .sort((a, b) => (rankByPath.get(a.relativePath) ?? 0) - (rankByPath.get(b.relativePath) ?? 0)),
    ...depthFilteredFiles.filter((file) => !rankByPath.has(file.relativePath))
  ].slice(0, limits.maxContentSearchFiles);

  for (const file of contentCandidateFiles) {
    throwIfWalkAborted(signal);
    const content = await readSearchCandidate(file, limits, skipped);

    if (content === null) {
      continue;
    }

    searchedFiles += 1;

    const lines = content.split(/\r\n|\n|\r/);

    for (const [index, line] of lines.entries()) {
      if (!matchesSearch(line, matcher)) {
        continue;
      }

      matches.push({
        relativePath: file.relativePath,
        line: index + 1,
        matchType: "content",
        excerpt: boundedExcerpt(line, limits.maxExcerptChars),
        rank: 10
      });
    }
  }

  matches.sort(compareSearchMatches);

  if (matches.length > limit) {
    truncated = true;
  }

  return {
    matches: matches.slice(0, limit).map(({ rank: _rank, ...match }) => match),
    truncated,
    searchedPaths,
    searchedFiles,
    skipped
  };
}

async function collectMarkdownFiles({
  workspaceRoot,
  start,
  depth,
  limits,
  signal
}: {
  workspaceRoot: string;
  start: ResolvedDocumentPath;
  depth: number;
  limits: AgentDocumentToolLimits;
  signal?: AbortSignal;
}): Promise<MarkdownFileCollection> {
  const files: MarkdownFileEntry[] = [];
  const skipped = emptySkippedCounts();
  let truncated = false;
  let directoriesVisited = 0;
  let filesystemEntriesVisited = 0;

  const visitDirectory = async (directoryPath: string, directoryRelativePath: string, remainingDepth: number): Promise<void> => {
    throwIfWalkAborted(signal);

    if (directoriesVisited >= limits.maxDirectories) {
      truncated = true;
      return;
    }

    directoriesVisited += 1;

    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      skipped.unreadable += 1;
      return;
    }

    entries.sort((a, b) => comparePath(a.name, b.name));

    for (const entry of entries) {
      if (filesystemEntriesVisited >= limits.maxFilesystemEntries) {
        truncated = true;
        return;
      }

      filesystemEntriesVisited += 1;

      if (isIgnoredName(entry.name)) {
        skipped.ignored += 1;
        continue;
      }

      const relativePath = joinRelativePath(directoryRelativePath, entry.name);

      if (!isSafeTraversalPath(relativePath)) {
        skipped.unsafe += 1;
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);

      // Dirent type info covers all filtering — no per-entry lstat. Reads
      // still go through O_NOFOLLOW open and the content pass's own checks.
      if (entry.isSymbolicLink()) {
        skipped.symlink += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (remainingDepth > 0) {
          await visitDirectory(absolutePath, relativePath, remainingDepth - 1);
        } else {
          truncated = true;
        }
        continue;
      }

      if (!entry.isFile()) {
        skipped.unsafe += 1;
        continue;
      }

      if (!isMarkdownPath(relativePath)) {
        skipped.nonMarkdown += 1;
        continue;
      }

      if (files.length >= limits.maxPathSearchFiles) {
        truncated = true;
        return;
      }

      files.push({
        absolutePath,
        relativePath,
        name: path.posix.basename(relativePath)
      });
    }
  };

  await visitDirectory(start.absolutePath, start.relativePath, depth);

  return { files, skipped, truncated };
}

async function resolveWorkspaceRoot(workspaceRoot: string): Promise<ResolvedDocumentPath> {
  let stats;

  try {
    stats = await lstat(workspaceRoot);
  } catch {
    throw new AgentDocumentToolError("workspace_unavailable", "Workspace root is not available.");
  }

  if (stats.isSymbolicLink()) {
    throw new AgentDocumentToolError("symlink_path", "Workspace root cannot be a symlink.");
  }

  if (!stats.isDirectory()) {
    throw new AgentDocumentToolError("not_directory", "Workspace root must be a directory.");
  }

  return {
    absolutePath: workspaceRoot,
    relativePath: "",
    stats
  };
}

async function resolveDirectory(
  workspaceRoot: string,
  rawPath: string,
  toolLabel: "list_documents" | "search_documents"
): Promise<ResolvedDocumentPath> {
  if (typeof rawPath !== "string") {
    throw new AgentDocumentToolError("invalid_input", `${toolLabel} directory must be a string.`);
  }

  const relativePath = validateWorkspaceRelativePath(rawPath, "directory");
  const resolved = await resolveExistingWorkspacePath(workspaceRoot, relativePath);

  if (!resolved.stats.isDirectory()) {
    throw new AgentDocumentToolError("not_directory", `Document directory is not a directory: ${relativePath}.`);
  }

  return resolved;
}

async function resolveFile(workspaceRoot: string, relativePath: string): Promise<ResolvedDocumentPath> {
  const resolved = await resolveExistingWorkspacePath(workspaceRoot, relativePath);

  if (resolved.stats.isDirectory()) {
    throw new AgentDocumentToolError("not_file", `Document path is a directory: ${relativePath}.`);
  }

  if (!resolved.stats.isFile()) {
    throw new AgentDocumentToolError("not_file", `Document path is not a regular file: ${relativePath}.`);
  }

  return resolved;
}

async function resolveExistingWorkspacePath(workspaceRoot: string, relativePath: string): Promise<ResolvedDocumentPath> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const segments = relativePath.split("/");
  let currentPath = root.absolutePath;
  let currentRelativePath = "";
  let currentStats = root.stats;

  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    currentRelativePath = joinRelativePath(currentRelativePath, segment);

    assertInsideWorkspace(workspaceRoot, currentPath);

    try {
      currentStats = await lstat(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AgentDocumentToolError("not_found", `Document path does not exist: ${relativePath}.`);
      }

      throw new AgentDocumentToolError("unreadable", `Document path cannot be inspected: ${relativePath}.`);
    }

    if (currentStats.isSymbolicLink()) {
      throw new AgentDocumentToolError("symlink_path", `Document path cannot include symlinks: ${relativePath}.`);
    }

    if (index < segments.length - 1 && !currentStats.isDirectory()) {
      throw new AgentDocumentToolError("invalid_path", `Document path ancestor is not a directory: ${relativePath}.`);
    }
  }

  return {
    absolutePath: currentPath,
    relativePath: currentRelativePath,
    stats: currentStats
  };
}

function validateWorkspaceRelativePath(rawPath: string, target: "file" | "directory") {
  if (!rawPath) {
    throw new AgentDocumentToolError(
      "invalid_path",
      target === "directory" ? "Document directory must be omitted for the workspace root." : "Document path is required."
    );
  }

  if (/[\u0000-\u001F\u007F]/u.test(rawPath)) {
    throw new AgentDocumentToolError("invalid_path", "Document paths cannot contain NUL or control characters.");
  }

  if (rawPath.includes("\\")) {
    throw new AgentDocumentToolError("invalid_path", "Document paths must use POSIX slash separators.");
  }

  if (/^[A-Za-z]:/.test(rawPath)) {
    throw new AgentDocumentToolError("invalid_path", "Document paths must be workspace-relative, not Windows drive paths.");
  }

  if (path.posix.isAbsolute(rawPath)) {
    throw new AgentDocumentToolError("invalid_path", "Document paths must be workspace-relative.");
  }

  if (target === "file" && rawPath.endsWith("/")) {
    throw new AgentDocumentToolError("invalid_path", "Document file paths cannot end with a slash.");
  }

  const normalized = path.posix.normalize(rawPath);

  if (normalized !== rawPath) {
    throw new AgentDocumentToolError("invalid_path", "Document paths must already be normalized POSIX relative paths.");
  }

  const segments = rawPath.split("/");

  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new AgentDocumentToolError("invalid_path", "Document paths cannot contain empty, current, or parent segments.");
    }

    if (segment.startsWith(".")) {
      throw new AgentDocumentToolError("invalid_path", "Hidden document paths are not available.");
    }

    if (ignoredNames.has(segment)) {
      throw new AgentDocumentToolError("invalid_path", `Ignored document paths are not available: ${segment}.`);
    }
  }

  return rawPath;
}

async function readSearchCandidate(
  file: MarkdownFileEntry,
  limits: AgentDocumentToolLimits,
  skipped: AgentDocumentToolSkippedCounts
) {
  let stats;

  try {
    stats = await lstat(file.absolutePath);
  } catch {
    skipped.unreadable += 1;
    return null;
  }

  if (stats.isSymbolicLink()) {
    skipped.symlink += 1;
    return null;
  }

  if (!stats.isFile()) {
    skipped.unsafe += 1;
    return null;
  }

  if (stats.size > limits.maxReadBytes) {
    skipped.oversized += 1;
    return null;
  }

  try {
    const content = await readFile(file.absolutePath, "utf8");

    if (Buffer.byteLength(content, "utf8") > limits.maxReadBytes) {
      skipped.oversized += 1;
      return null;
    }

    return content;
  } catch {
    skipped.unreadable += 1;
    return null;
  }
}

async function readUtf8Document(absolutePath: string, maxReadBytes: number) {
  const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
  let handle;

  try {
    handle = await open(absolutePath, flags);
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new AgentDocumentToolError("not_file", "Document path is not a regular file.");
    }

    if (stats.size > maxReadBytes) {
      throw new AgentDocumentToolError("oversized", `Document is larger than the ${maxReadBytes} byte read limit.`);
    }

    return await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    if (error instanceof AgentDocumentToolError) {
      throw error;
    }

    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new AgentDocumentToolError("symlink_path", "Document path cannot include symlinks.");
    }

    throw new AgentDocumentToolError("unreadable", "Document could not be read.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function normalizeLimits(configuredLimits: Partial<AgentDocumentToolLimits> | undefined): AgentDocumentToolLimits {
  const maxSearchFiles = limitOption(configuredLimits?.maxSearchFiles, "maxSearchFiles");

  return {
    maxListResults: limitOption(configuredLimits?.maxListResults, "maxListResults"),
    maxReadBytes: limitOption(configuredLimits?.maxReadBytes, "maxReadBytes"),
    maxSearchResults: limitOption(configuredLimits?.maxSearchResults, "maxSearchResults"),
    maxSearchFiles,
    maxContentSearchDepth:
      configuredLimits?.maxContentSearchDepth === undefined
        ? defaultAgentDocumentToolLimits.maxContentSearchDepth
        : limitOption(configuredLimits.maxContentSearchDepth, "maxContentSearchDepth"),
    maxPathSearchDepth:
      configuredLimits?.maxPathSearchDepth === undefined
        ? defaultAgentDocumentToolLimits.maxPathSearchDepth
        : limitOption(configuredLimits.maxPathSearchDepth, "maxPathSearchDepth"),
    maxPathSearchFiles:
      configuredLimits?.maxPathSearchFiles === undefined
        ? defaultAgentDocumentToolLimits.maxPathSearchFiles
        : limitOption(configuredLimits.maxPathSearchFiles, "maxPathSearchFiles"),
    maxContentSearchFiles:
      configuredLimits?.maxContentSearchFiles === undefined
        ? maxSearchFiles
        : limitOption(configuredLimits.maxContentSearchFiles, "maxContentSearchFiles"),
    maxDepth: limitOption(configuredLimits?.maxDepth, "maxDepth"),
    maxDirectories: limitOption(configuredLimits?.maxDirectories, "maxDirectories"),
    maxFilesystemEntries: limitOption(configuredLimits?.maxFilesystemEntries, "maxFilesystemEntries"),
    maxExcerptChars: limitOption(configuredLimits?.maxExcerptChars, "maxExcerptChars")
  };
}

function limitOption(value: number | undefined, name: keyof AgentDocumentToolLimits) {
  const defaultValue = defaultAgentDocumentToolLimits[name];

  if (value === undefined) {
    return defaultValue;
  }

  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
    throw new AgentDocumentToolError("invalid_input", `${name} must be a non-negative integer.`);
  }

  return value;
}

function optionalBoundedInteger(value: number | undefined, name: string, defaultValue: number, maxValue: number) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
    throw new AgentDocumentToolError("invalid_input", `${name} must be a non-negative integer.`);
  }

  return value > 0 ? Math.min(value, maxValue) : 0;
}

function assertPlainObject(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentDocumentToolError("invalid_input", `${label} must be an object.`);
  }
}

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function searchMatcher(query: string): SearchMatcher {
  const normalizedQuery = normalizeSearchText(query);
  const words = normalizedQuery.split(" ").filter(Boolean);
  const requiredTokens: string[] = [];
  const aliasGroups: string[][] = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];

    if (isSessionWord(word) && isSearchNumber(next)) {
      aliasGroups.push(uniqueStrings([`${word} ${next}`, `sesion ${next}`, `session ${next}`, `s${next}`]));
      index += 1;
      continue;
    }

    if (isCourseWord(word) && isSearchNumber(next)) {
      aliasGroups.push(uniqueStrings([`${word} ${next}`, `curso ${next}`, `course ${next}`, `curso${next}`, `course${next}`]));
      index += 1;
      continue;
    }

    requiredTokens.push(word);
  }

  return {
    normalizedQuery,
    compactQuery: compactSearchText(normalizedQuery),
    requiredTokens,
    aliasGroups
  };
}

function pathMatchRank(relativePath: string, matcher: SearchMatcher) {
  const haystack = pathSearchHaystack(relativePath);

  if (!matchesNormalizedHaystack(haystack, matcher)) {
    return null;
  }

  const stem = normalizeSearchText(relativePath.replace(/\.[^/.]+$/u, ""));

  if (
    stem.includes(matcher.normalizedQuery) ||
    compactSearchText(stem).includes(matcher.compactQuery) ||
    normalizeSearchText(path.posix.basename(relativePath, path.posix.extname(relativePath))).includes(matcher.normalizedQuery)
  ) {
    return 0;
  }

  return matcher.aliasGroups.length > 0 ? 2 : 1;
}

function matchesSearch(value: string, matcher: SearchMatcher) {
  return matchesNormalizedHaystack(contentSearchHaystack(value), matcher);
}

function matchesNormalizedHaystack(haystack: string, matcher: SearchMatcher) {
  return (
    matcher.requiredTokens.every((term) => haystack.includes(term)) &&
    matcher.aliasGroups.every((aliases) => aliases.some((alias) => haystack.includes(alias)))
  );
}

function pathSearchHaystack(relativePath: string) {
  const normalized = normalizeSearchText(relativePath);
  const segments = relativePath
    .split("/")
    .flatMap((segment) => [segment, path.posix.basename(segment, path.posix.extname(segment))])
    .map(normalizeSearchText)
    .filter(Boolean);
  const values = [normalized, compactSearchText(normalized), ...segments, ...segments.map(compactSearchText)];
  return uniqueStrings(values).join(" ");
}

function contentSearchHaystack(value: string) {
  const normalized = normalizeSearchText(value);
  return `${normalized} ${compactSearchText(normalized)}`;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function compactSearchText(value: string) {
  return value.replace(/\s+/gu, "");
}

function isSessionWord(value: string | undefined) {
  return value === "sesion" || value === "session";
}

function isCourseWord(value: string | undefined) {
  return value === "curso" || value === "course";
}

function isSearchNumber(value: string | undefined) {
  return typeof value === "string" && /^[0-9]+$/u.test(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function documentDirectoryDepth(relativePath: string) {
  return Math.max(0, relativePath.split("/").length - 1);
}

function boundedExcerpt(value: string, maxChars: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxChars ? compacted.slice(0, maxChars) : compacted;
}

function compareSearchMatches(a: SearchDocumentMatch, b: SearchDocumentMatch) {
  const rank = searchMatchRank(a) - searchMatchRank(b);

  if (rank !== 0) {
    return rank;
  }

  const typeRank = matchTypeRank(a.matchType) - matchTypeRank(b.matchType);

  if (typeRank !== 0) {
    return typeRank;
  }

  const pathRank = comparePath(a.relativePath, b.relativePath);

  if (pathRank !== 0) {
    return pathRank;
  }

  return a.line - b.line;
}

function matchTypeRank(matchType: SearchDocumentMatch["matchType"]) {
  return matchType === "path" ? 0 : 1;
}

function searchMatchRank(match: SearchDocumentMatch) {
  return "rank" in match && typeof match.rank === "number" ? match.rank : matchTypeRank(match.matchType);
}

function failedToolEvent(error: unknown): Omit<AgentDocumentToolEvent, "toolName" | "durationMs"> {
  const sanitized = sanitizeToolError(error);

  return {
    status: "failed",
    resultCount: 0,
    error: sanitized
  };
}

function emitToolEvent(
  onToolEvent: CreateAgentDocumentToolsOptions["onToolEvent"],
  toolName: AgentDocumentToolName,
  startedAt: number,
  event: Omit<AgentDocumentToolEvent, "toolName" | "durationMs">
) {
  onToolEvent?.({
    toolName,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...event
  });
}

function sanitizeToolError(error: unknown): { code: AgentDocumentToolErrorCode; message: string } {
  if (error instanceof AgentDocumentToolError) {
    return {
      code: error.code,
      message: eventErrorMessage(error.code)
    };
  }

  return {
    code: "unreadable",
    message: "Document tool failed."
  };
}

function eventErrorMessage(code: AgentDocumentToolErrorCode) {
  switch (code) {
    case "invalid_input":
      return "Document tool input is invalid.";
    case "invalid_path":
      return "Document path is invalid.";
    case "workspace_unavailable":
      return "Workspace root is not available.";
    case "not_found":
      return "Document path does not exist.";
    case "not_directory":
      return "Document path is not a directory.";
    case "not_file":
      return "Document path is not a regular file.";
    case "not_markdown":
      return "Document path is not a Markdown file.";
    case "symlink_path":
      return "Document path includes a symlink.";
    case "oversized":
      return "Document is larger than the configured read limit.";
    case "unreadable":
      return "Document path cannot be read.";
  }
}

function emptySkippedCounts(): AgentDocumentToolSkippedCounts {
  return {
    ignored: 0,
    unsafe: 0,
    unreadable: 0,
    oversized: 0,
    nonMarkdown: 0,
    symlink: 0
  };
}

function addSkippedCounts(target: AgentDocumentToolSkippedCounts, source: AgentDocumentToolSkippedCounts) {
  target.ignored += source.ignored;
  target.unsafe += source.unsafe;
  target.unreadable += source.unreadable;
  target.oversized += source.oversized;
  target.nonMarkdown += source.nonMarkdown;
  target.symlink += source.symlink;
}

function isIgnoredName(name: string) {
  return name.startsWith(".") || ignoredNames.has(name);
}

function isMarkdownPath(relativePath: string) {
  return markdownExtensions.has(path.posix.extname(relativePath).toLowerCase());
}

function estimateTokensFromByteSize(sizeBytes: number) {
  return sizeBytes <= 0 ? 0 : Math.max(1, Math.ceil(sizeBytes / 4));
}

function isSafeTraversalPath(relativePath: string) {
  try {
    validateWorkspaceRelativePath(relativePath, "file");
    return true;
  } catch {
    return false;
  }
}

function joinRelativePath(base: string, name: string) {
  return base ? `${base}/${name}` : name;
}

// Aborts propagate as plain errors (not tool errors) so the run-cancel path
// handles them; mirrors documentContext's throwIfAborted contract.
function throwIfWalkAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Request canceled.");
  }
}

function comparePath(a: string, b: string) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function assertInsideWorkspace(workspaceRoot: string, absolutePath: string) {
  const relative = path.relative(workspaceRoot, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AgentDocumentToolError("invalid_path", "Document path resolved outside the workspace.");
  }
}
