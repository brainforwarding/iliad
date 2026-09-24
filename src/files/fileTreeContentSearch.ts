import type {
  MarkdownContentSearchFileResult,
  MarkdownContentSearchMatch,
  MarkdownContentSearchRequest,
  MarkdownContentSearchResponse
} from "../types/iliad";

export const contentSearchPreviewLimit = 8;

export type FileTreeSearchScope = "names" | "text";

export interface FileTreeContentSearchProvider {
  markLatestRequest: (requestId: number) => void;
  search: (
    requestId: number,
    request: Omit<MarkdownContentSearchRequest, "workspaceRoot">
  ) => Promise<{ response: MarkdownContentSearchResponse; usedSavedTextFallback: boolean }>;
  onOpenMatch: (match: FileTreeContentMatchTarget) => Promise<void> | void;
}

export interface FileTreeContentMatchTarget {
  filePath: string;
  relativePath: string;
  startOffset: number;
  endOffset: number;
  startColumn: number;
  endColumn: number;
  lineNumber: number;
  matchedText: string;
}

export interface FileTreeContentFolderNode {
  kind: "folder";
  id: string;
  name: string;
  relativePath: string;
  matchCount: number;
  children: FileTreeContentTreeNode[];
}

export interface FileTreeContentFileNode {
  kind: "file";
  id: string;
  file: MarkdownContentSearchFileResult;
  displayName: string;
  matchCount: number;
}

export type FileTreeContentTreeNode = FileTreeContentFolderNode | FileTreeContentFileNode;

export interface FileTreeContentPreviewRow {
  kind: "match";
  id: string;
  file: MarkdownContentSearchFileResult;
  match: MarkdownContentSearchMatch;
  matchNumberInFile: number;
}

export interface FileTreeContentMoreRow {
  kind: "more";
  id: string;
  count: number;
}

export type FileTreeContentFileChildRow = FileTreeContentPreviewRow | FileTreeContentMoreRow;

export interface FileTreeContentFlatMatch {
  rowId: string;
  file: MarkdownContentSearchFileResult;
  match: MarkdownContentSearchMatch;
  matchNumberInFile: number;
}

export interface FileTreeContentSnippetPart {
  text: string;
  highlighted: boolean;
}

export interface FileTreeContentSearchKeyInput {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

interface MutableFolder {
  kind: "folder";
  id: string;
  name: string;
  relativePath: string;
  matchCount: number;
  children: FileTreeContentTreeNode[];
  folderByPath: Map<string, MutableFolder>;
  fileByPath: Map<string, FileTreeContentFileNode>;
}

function markdownDisplayName(name: string) {
  return name.replace(/\.(md|markdown|mdown|mkd)$/i, "");
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/");
}

function folderId(relativePath: string) {
  return `content-folder:${relativePath}`;
}

function fileId(relativePath: string) {
  return `content-file:${relativePath}`;
}

export function validateContentSearchRegex(query: string, regex: boolean, wholeWord: boolean) {
  if (!query || !regex) {
    return { valid: true as const };
  }

  try {
    const source = wholeWord ? `\\b(?:${query})\\b` : query;
    new RegExp(source, "g");
    return { valid: true as const };
  } catch (error) {
    return {
      valid: false as const,
      message: error instanceof Error ? error.message : "Invalid regular expression."
    };
  }
}

export function isLatestContentSearchRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

export function markLatestContentSearchRequestId(currentLatestRequestId: number, requestId: number) {
  return Math.max(currentLatestRequestId, requestId);
}

export function contentSearchRequestKey(input: FileTreeContentSearchKeyInput) {
  return JSON.stringify([input.query, input.matchCase, input.wholeWord, input.regex]);
}

export function contentSearchResponseMatchesCurrent(responseKey: string | null, currentKey: string) {
  return responseKey === currentKey;
}

function createRootFolder(): MutableFolder {
  return {
    kind: "folder",
    id: "content-folder:",
    name: "",
    relativePath: "",
    matchCount: 0,
    children: [],
    folderByPath: new Map(),
    fileByPath: new Map()
  };
}

function ensureFolder(parent: MutableFolder, name: string, relativePath: string) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const existing = parent.folderByPath.get(normalizedPath);

  if (existing) {
    return existing;
  }

  const folder: MutableFolder = {
    kind: "folder",
    id: folderId(normalizedPath),
    name,
    relativePath: normalizedPath,
    matchCount: 0,
    children: [],
    folderByPath: new Map(),
    fileByPath: new Map()
  };

  parent.folderByPath.set(normalizedPath, folder);
  parent.children.push(folder);
  return folder;
}

function addFile(parent: MutableFolder, file: MarkdownContentSearchFileResult) {
  const relativePath = normalizeRelativePath(file.relativePath);
  const existing = parent.fileByPath.get(relativePath);

  if (existing) {
    return existing;
  }

  const fileNode: FileTreeContentFileNode = {
    kind: "file",
    id: fileId(relativePath),
    file: { ...file, relativePath },
    displayName: markdownDisplayName(file.name),
    matchCount: file.returnedMatchCount
  };

  parent.fileByPath.set(relativePath, fileNode);
  parent.children.push(fileNode);
  return fileNode;
}

export function buildFileTreeContentResultTree(files: MarkdownContentSearchFileResult[]) {
  const root = createRootFolder();

  for (const file of files) {
    if (file.matches.length === 0) {
      continue;
    }

    const normalizedPath = normalizeRelativePath(file.relativePath);
    const segments = normalizedPath.split("/").filter(Boolean);
    let parent = root;
    let folderPath = "";

    for (const segment of segments.slice(0, -1)) {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      parent = ensureFolder(parent, segment, folderPath);
      parent.matchCount += file.returnedMatchCount;
    }

    addFile(parent, { ...file, relativePath: normalizedPath });
    root.matchCount += file.returnedMatchCount;
  }

  return root.children;
}

export function contentSearchFileRows(
  file: MarkdownContentSearchFileResult,
  previewLimit = contentSearchPreviewLimit
): FileTreeContentFileChildRow[] {
  const visibleMatches = file.matches.slice(0, previewLimit);
  const rows: FileTreeContentFileChildRow[] = visibleMatches.map((match, index) => ({
    kind: "match",
    id: `${file.relativePath}:${match.id}`,
    file,
    match,
    matchNumberInFile: index + 1
  }));
  const remaining = file.returnedMatchCount - visibleMatches.length;

  if (remaining > 0) {
    rows.push({
      kind: "more",
      id: `${file.relativePath}:more`,
      count: remaining
    });
  }

  return rows;
}

export function flattenContentSearchPreviewRows(
  nodes: FileTreeContentTreeNode[],
  expandedIds: ReadonlySet<string>,
  previewLimit = contentSearchPreviewLimit
): FileTreeContentFlatMatch[] {
  const rows: FileTreeContentFlatMatch[] = [];

  const visit = (treeNodes: FileTreeContentTreeNode[]) => {
    for (const node of treeNodes) {
      if (node.kind === "folder") {
        if (expandedIds.has(node.id)) {
          visit(node.children);
        }
        continue;
      }

      if (!expandedIds.has(node.id)) {
        continue;
      }

      for (const row of contentSearchFileRows(node.file, previewLimit)) {
        if (row.kind !== "match") {
          continue;
        }

        rows.push({
          rowId: row.id,
          file: row.file,
          match: row.match,
          matchNumberInFile: row.matchNumberInFile
        });
      }
    }
  };

  visit(nodes);
  return rows;
}

export function expandedContentSearchIds(nodes: FileTreeContentTreeNode[]) {
  const ids = new Set<string>();

  const visit = (treeNodes: FileTreeContentTreeNode[]) => {
    for (const node of treeNodes) {
      ids.add(node.id);

      if (node.kind === "folder") {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return ids;
}

export function clampContentSearchActiveIndex(index: number, matchCount: number) {
  if (matchCount === 0) {
    return -1;
  }

  if (index < 0) {
    return 0;
  }

  return Math.min(index, matchCount - 1);
}

export function moveContentSearchActiveIndex(index: number, matchCount: number, direction: 1 | -1) {
  if (matchCount === 0) {
    return -1;
  }

  if (index < 0) {
    return direction > 0 ? 0 : matchCount - 1;
  }

  return (index + direction + matchCount) % matchCount;
}

export function contentSearchSnippetParts(
  lineText: string,
  ranges: MarkdownContentSearchMatch["ranges"]
): FileTreeContentSnippetPart[] {
  if (ranges.length === 0) {
    return [{ text: lineText, highlighted: false }];
  }

  const parts: FileTreeContentSnippetPart[] = [];
  let offset = 0;

  const sortedRanges = [...ranges]
    .map((range) => ({
      startColumn: Math.max(0, Math.min(range.startColumn, lineText.length)),
      endColumn: Math.max(0, Math.min(range.endColumn, lineText.length))
    }))
    .filter((range) => range.endColumn > range.startColumn)
    .sort((left, right) => left.startColumn - right.startColumn || left.endColumn - right.endColumn);

  for (const range of sortedRanges) {
    if (range.startColumn > offset) {
      parts.push({ text: lineText.slice(offset, range.startColumn), highlighted: false });
    }

    parts.push({ text: lineText.slice(range.startColumn, range.endColumn), highlighted: true });
    offset = Math.max(offset, range.endColumn);
  }

  if (offset < lineText.length) {
    parts.push({ text: lineText.slice(offset), highlighted: false });
  }

  return parts.length > 0 ? parts : [{ text: lineText, highlighted: false }];
}

export function contentSearchPreviewSnippet(
  lineText: string,
  ranges: MarkdownContentSearchMatch["ranges"],
  options: { contextBefore?: number; contextAfter?: number } = {}
) {
  const contextBefore = options.contextBefore ?? 12;
  const contextAfter = options.contextAfter ?? 34;
  const sortedRanges = [...ranges]
    .map((range) => ({
      startColumn: Math.max(0, Math.min(range.startColumn, lineText.length)),
      endColumn: Math.max(0, Math.min(range.endColumn, lineText.length))
    }))
    .filter((range) => range.endColumn > range.startColumn)
    .sort((left, right) => left.startColumn - right.startColumn || left.endColumn - right.endColumn);

  if (sortedRanges.length === 0) {
    const snippetText = lineText.length > contextBefore + contextAfter
      ? `${lineText.slice(0, contextBefore + contextAfter)}...`
      : lineText;

    return { lineText: snippetText, ranges: [] };
  }

  const firstRange = sortedRanges[0]!;
  const snippetStart = Math.max(0, firstRange.startColumn - contextBefore);
  const snippetEnd = Math.min(lineText.length, firstRange.endColumn + contextAfter);
  const leadingEllipsis = snippetStart > 0 ? "..." : "";
  const trailingEllipsis = snippetEnd < lineText.length ? "..." : "";
  const snippetText = `${leadingEllipsis}${lineText.slice(snippetStart, snippetEnd)}${trailingEllipsis}`;
  const shiftedRanges = sortedRanges
    .filter((range) => range.endColumn > snippetStart && range.startColumn < snippetEnd)
    .map((range) => ({
      startColumn: Math.max(range.startColumn, snippetStart) - snippetStart + leadingEllipsis.length,
      endColumn: Math.min(range.endColumn, snippetEnd) - snippetStart + leadingEllipsis.length
    }));

  return { lineText: snippetText, ranges: shiftedRanges };
}
