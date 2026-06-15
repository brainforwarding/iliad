import type { FileTreeNode } from "../types/iliad";
import { findNodeByRelativePath } from "./fileTree";
import { parentDirectoryPath } from "./pathUtils";

export const fileTreeMoveDragMimeType = "application/x-iliad-file-tree-move";
export const fileTreeMoveDragPayloadType = "iliad/file-tree-move";

export interface FileTreeMoveDragPayload {
  type: typeof fileTreeMoveDragPayloadType;
  workspaceSessionId: string;
  relativePath: string;
}

export interface ResolveCreationDirectoryPathInput {
  workspacePath: string;
  selectedTreePath: string | null;
  selectedTreeNode: FileTreeNode | null;
  activeFile: FileTreeNode | null;
}

export type FileTreeMoveDropTarget =
  | { kind: "root" }
  | { kind: "folder"; relativePath: string };

export type FileTreeMoveDropResult =
  | {
      valid: true;
      sourceNode: FileTreeNode;
      targetDirectoryNode: FileTreeNode | null;
      targetDirectoryRelativePath: string;
      destinationRelativePath: string;
    }
  | { valid: false; reason: string };

interface ResolveFileTreeDropTargetInput {
  nodes: FileTreeNode[];
  sourceRelativePath: string | null;
  target: FileTreeMoveDropTarget | null;
  blockedRelativePaths?: Iterable<string>;
  pendingCreateRelativePaths?: Iterable<string>;
}

const ignoredPathSegments = new Set([".git", ".hg", ".svn", "node_modules"]);

export function normalizeFileTreeMoveRelativePath(relativePath: string) {
  const normalizedInput = relativePath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");

  if (!normalizedInput || normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
    return "";
  }

  const segments: string[] = [];

  for (const segment of normalizedInput.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === ".." || segment.startsWith(".") || ignoredPathSegments.has(segment)) {
      return "";
    }

    segments.push(segment);
  }

  return segments.join("/");
}

function relativeKey(relativePath: string) {
  return normalizeFileTreeMoveRelativePath(relativePath).toLowerCase();
}

function relativeParentPath(relativePath: string) {
  const normalized = normalizeFileTreeMoveRelativePath(relativePath);
  const slashIndex = normalized.lastIndexOf("/");

  return slashIndex > 0 ? normalized.slice(0, slashIndex) : "";
}

function relativeBasename(relativePath: string) {
  const normalized = normalizeFileTreeMoveRelativePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);

  return segments[segments.length - 1] ?? "";
}

function isSameOrInsideRelative(parentPath: string, candidatePath: string) {
  const parent = normalizeFileTreeMoveRelativePath(parentPath);
  const candidate = normalizeFileTreeMoveRelativePath(candidatePath);

  return Boolean(parent && (candidate === parent || candidate.startsWith(`${parent}/`)));
}

function iterableKeys(paths?: Iterable<string>) {
  return new Set(Array.from(paths ?? [], relativeKey).filter(Boolean));
}

export function resolveCreationDirectoryPath({
  workspacePath,
  selectedTreePath,
  selectedTreeNode,
  activeFile
}: ResolveCreationDirectoryPathInput) {
  if (selectedTreePath === workspacePath) {
    return workspacePath;
  }

  if (selectedTreeNode?.kind === "directory") {
    return selectedTreeNode.path;
  }

  if (selectedTreeNode) {
    return parentDirectoryPath(selectedTreeNode.path);
  }

  if (activeFile) {
    return parentDirectoryPath(activeFile.path);
  }

  return workspacePath;
}

export function createFileTreeMoveDragPayload(
  workspaceSessionId: string,
  relativePath: string
): FileTreeMoveDragPayload {
  return {
    type: fileTreeMoveDragPayloadType,
    workspaceSessionId,
    relativePath: normalizeFileTreeMoveRelativePath(relativePath)
  };
}

export function readFileTreeMoveDragPayload(rawPayload: string, expectedWorkspaceSessionId: string) {
  try {
    const payload = JSON.parse(rawPayload) as Partial<FileTreeMoveDragPayload>;
    const relativePath =
      typeof payload.relativePath === "string" ? normalizeFileTreeMoveRelativePath(payload.relativePath) : "";

    if (
      payload.type !== fileTreeMoveDragPayloadType ||
      payload.workspaceSessionId !== expectedWorkspaceSessionId ||
      !relativePath
    ) {
      return null;
    }

    return createFileTreeMoveDragPayload(payload.workspaceSessionId, relativePath);
  } catch {
    return null;
  }
}

export function resolveFileTreeDropTarget({
  nodes,
  sourceRelativePath,
  target,
  blockedRelativePaths,
  pendingCreateRelativePaths
}: ResolveFileTreeDropTargetInput): FileTreeMoveDropResult {
  const sourcePath = sourceRelativePath ? normalizeFileTreeMoveRelativePath(sourceRelativePath) : "";

  if (!sourcePath || !target) {
    return { valid: false, reason: "missing-source-or-target" };
  }

  const blockedKeys = iterableKeys(blockedRelativePaths);

  if (blockedKeys.has(sourcePath.toLowerCase())) {
    return { valid: false, reason: "blocked-source" };
  }

  const sourceNode = findNodeByRelativePath(nodes, sourcePath);

  if (!sourceNode) {
    return { valid: false, reason: "missing-source" };
  }

  const targetDirectoryRelativePath =
    target.kind === "root" ? "" : normalizeFileTreeMoveRelativePath(target.relativePath);
  const targetDirectoryNode =
    target.kind === "root" ? null : findNodeByRelativePath(nodes, targetDirectoryRelativePath);

  if (target.kind === "folder" && targetDirectoryNode?.kind !== "directory") {
    return { valid: false, reason: "invalid-target" };
  }

  if (sourceNode.kind === "directory" && targetDirectoryRelativePath) {
    if (targetDirectoryRelativePath === sourcePath || isSameOrInsideRelative(sourcePath, targetDirectoryRelativePath)) {
      return { valid: false, reason: "target-inside-source" };
    }
  }

  if (relativeParentPath(sourcePath) === targetDirectoryRelativePath) {
    return { valid: false, reason: "same-parent" };
  }

  const basename = relativeBasename(sourcePath);
  const destinationRelativePath = targetDirectoryRelativePath
    ? `${targetDirectoryRelativePath}/${basename}`
    : basename;
  const destinationKey = destinationRelativePath.toLowerCase();

  if (iterableKeys(pendingCreateRelativePaths).has(destinationKey)) {
    return { valid: false, reason: "pending-create-collision" };
  }

  if (findNodeByRelativePath(nodes, destinationRelativePath)) {
    return { valid: false, reason: "destination-exists" };
  }

  return {
    valid: true,
    sourceNode,
    targetDirectoryNode,
    targetDirectoryRelativePath,
    destinationRelativePath
  };
}
