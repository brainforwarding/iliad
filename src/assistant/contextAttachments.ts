import type { FileTreeNode, WorkspaceInfo } from "../types/iliad";

export const manualContextAttachmentLimit = 4;
export const contextFileDragMimeType = "application/x-iliad-context-file";
export const contextFileDragPayloadType = "iliad/context-file";

export type AssistantContextAttachmentSource = "mention_picker" | "file_tree_drop" | "finder_drop";

export interface AssistantContextAttachmentChip {
  id: string;
  relativePath: string;
  label: string;
  source: AssistantContextAttachmentSource;
}

export interface MarkdownContextDocument {
  relativePath: string;
  name: string;
  sizeBytes: number;
  estimatedTokens: number;
}

export interface MarkdownContextDocumentList {
  files: MarkdownContextDocument[];
  truncated: boolean;
}

export interface ActiveMentionToken {
  start: number;
  end: number;
  query: string;
}

export interface ContextFileDragPayload {
  type: typeof contextFileDragPayloadType;
  workspaceSessionId: string;
  relativePath: string;
}

const markdownExtensionPattern = /\.(md|markdown|mdown|mkd)$/i;
const ignoredPathSegments = new Set([".git", ".hg", ".svn", "node_modules"]);
const workspaceSessionIds = new Map<string, string>();

export function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "").trim();
}

export function contextFileBasename(relativePath: string) {
  const parts = normalizeRelativePath(relativePath).split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : relativePath;
}

export function contextFileParentPath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const slashIndex = normalized.lastIndexOf("/");

  return slashIndex > 0 ? normalized.slice(0, slashIndex) : "";
}

export function isVisibleMarkdownContextPath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/").filter(Boolean);

  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || !markdownExtensionPattern.test(normalized)) {
    return false;
  }

  return !parts.some((part) => part.startsWith(".") || ignoredPathSegments.has(part));
}

export function collectMarkdownContextDocuments(nodes: FileTreeNode[]): MarkdownContextDocument[] {
  const documents: MarkdownContextDocument[] = [];

  const visit = (treeNodes: FileTreeNode[]) => {
    for (const node of treeNodes) {
      if (node.kind === "markdown" && isVisibleMarkdownContextPath(node.relativePath)) {
        documents.push({
          relativePath: normalizeRelativePath(node.relativePath),
          name: node.name || contextFileBasename(node.relativePath),
          sizeBytes: 0,
          estimatedTokens: 0
        });
      }

      if (node.children) {
        visit(node.children);
      }
    }
  };

  visit(nodes);

  return documents.sort((a, b) => normalizeRelativePath(a.relativePath).localeCompare(normalizeRelativePath(b.relativePath)));
}

function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeValueForMatch(value: string) {
  return removeDiacritics(value).toLowerCase();
}

function normalizeQueryForMatch(query: string) {
  return normalizeValueForMatch(query).replace(/\s+/g, "-");
}

function matchRank(document: MarkdownContextDocument, query: string) {
  if (!query) {
    return 0;
  }

  const basename = normalizeValueForMatch(contextFileBasename(document.relativePath));
  const relativePath = normalizeValueForMatch(normalizeRelativePath(document.relativePath));

  if (basename.startsWith(query)) {
    return 0;
  }

  if (basename.includes(query)) {
    return 1;
  }

  if (relativePath.startsWith(query)) {
    return 2;
  }

  if (relativePath.includes(query)) {
    return 3;
  }

  return null;
}

export function rankMarkdownContextDocuments(
  documents: MarkdownContextDocument[],
  options: {
    query: string;
    activeRelativePath?: string | null;
    limit?: number;
  }
) {
  const query = normalizeQueryForMatch(options.query.trim());
  const activeDirectory = options.activeRelativePath ? contextFileParentPath(options.activeRelativePath) : "";
  const seen = new Set<string>();
  const ranked = documents
    .filter((document) => isVisibleMarkdownContextPath(document.relativePath))
    .map((document) => ({ ...document, relativePath: normalizeRelativePath(document.relativePath) }))
    .filter((document) => {
      const key = document.relativePath.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((document) => {
      const rank = matchRank(document, query);

      if (rank === null) {
        return null;
      }

      return {
        document,
        rank,
        activeDirectoryRank:
          activeDirectory && contextFileParentPath(document.relativePath) === activeDirectory ? 0 : 1,
        pathLength: document.relativePath.length
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }

      if (a.activeDirectoryRank !== b.activeDirectoryRank) {
        return a.activeDirectoryRank - b.activeDirectoryRank;
      }

      if (a.pathLength !== b.pathLength) {
        return a.pathLength - b.pathLength;
      }

      return a.document.relativePath.localeCompare(b.document.relativePath);
    })
    .map((item) => item.document);

  return ranked.slice(0, options.limit ?? 8);
}

function isInsideFencedCode(text: string, index: number) {
  const before = text.slice(0, index);
  const fences = before.match(/^```/gm);

  return Boolean(fences && fences.length % 2 === 1);
}

function isInsideInlineCode(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineBeforeToken = text.slice(lineStart, index).replace(/```/g, "");
  const backticks = lineBeforeToken.match(/`/g);

  return Boolean(backticks && backticks.length % 2 === 1);
}

export function findActiveMentionToken(text: string, caret: number): ActiveMentionToken | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, safeCaret);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret);

  if (!match) {
    return null;
  }

  const query = match[2] ?? "";
  const start = beforeCaret.length - query.length - 1;

  if (isInsideFencedCode(text, start) || isInsideInlineCode(text, start)) {
    return null;
  }

  return {
    start,
    end: safeCaret,
    query
  };
}

export function replaceMentionTokenWithPath(text: string, token: ActiveMentionToken, relativePath: string) {
  const mention = `@${normalizeRelativePath(relativePath)}`;
  const after = text.slice(token.end);
  const leadingSeparator = /^[\s,.;:!?)\]]+/u.exec(after)?.[0] ?? "";
  const insertedSeparator = leadingSeparator || after.length === 0 ? "" : " ";
  const trailingSpace = after.length === 0 ? " " : "";

  return {
    text: `${text.slice(0, token.start)}${mention}${insertedSeparator}${trailingSpace}${after}`,
    caret: token.start + mention.length + insertedSeparator.length + trailingSpace.length + leadingSeparator.length
  };
}

export function contextAttachmentDisplayLabels(paths: string[]) {
  const normalizedPaths = paths.map(normalizeRelativePath);
  const groups = new Map<string, string[]>();
  const labels = new Map<string, string>();

  for (const path of normalizedPaths) {
    const basename = contextFileBasename(path);
    groups.set(basename, [...(groups.get(basename) ?? []), path]);
  }

  for (const [basename, group] of groups) {
    if (group.length === 1) {
      labels.set(group[0], basename);
      continue;
    }

    for (const path of group) {
      const segments = path.split("/").filter(Boolean);
      let label = path;

      for (let suffixLength = 2; suffixLength <= segments.length; suffixLength += 1) {
        const candidate = segments.slice(-suffixLength).join("/");
        const collision = group.some((otherPath) => {
          if (otherPath === path) {
            return false;
          }

          return otherPath.split("/").filter(Boolean).slice(-suffixLength).join("/") === candidate;
        });

        if (!collision) {
          label = candidate;
          break;
        }
      }

      labels.set(path, label);
    }
  }

  return labels;
}

function createWorkspaceSessionNonce() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function explicitWorkspaceSessionId(workspace: WorkspaceInfo) {
  const candidate = (workspace as WorkspaceInfo & { sessionId?: string; workspaceSessionId?: string }).sessionId ??
    (workspace as WorkspaceInfo & { sessionId?: string; workspaceSessionId?: string }).workspaceSessionId;

  if (candidate?.trim()) {
    return candidate;
  }

  return null;
}

export function workspaceContextApiSessionId(workspace: WorkspaceInfo) {
  return explicitWorkspaceSessionId(workspace) ?? workspace.path;
}

export function workspaceContextDragSessionId(workspace: WorkspaceInfo) {
  const explicitSessionId = explicitWorkspaceSessionId(workspace);

  if (explicitSessionId) {
    return explicitSessionId;
  }

  const existing = workspaceSessionIds.get(workspace.path);

  if (existing) {
    return existing;
  }

  const next = createWorkspaceSessionNonce();
  workspaceSessionIds.set(workspace.path, next);
  return next;
}

export function createContextFileDragPayload(workspaceSessionId: string, relativePath: string): ContextFileDragPayload {
  return {
    type: contextFileDragPayloadType,
    workspaceSessionId,
    relativePath: normalizeRelativePath(relativePath)
  };
}

export function readContextFileDragPayload(rawPayload: string, expectedWorkspaceSessionId: string) {
  try {
    const payload = JSON.parse(rawPayload) as Partial<ContextFileDragPayload>;

    if (
      payload.type !== contextFileDragPayloadType ||
      payload.workspaceSessionId !== expectedWorkspaceSessionId ||
      typeof payload.relativePath !== "string" ||
      !isVisibleMarkdownContextPath(payload.relativePath)
    ) {
      return null;
    }

    return createContextFileDragPayload(payload.workspaceSessionId, payload.relativePath);
  } catch {
    return null;
  }
}
