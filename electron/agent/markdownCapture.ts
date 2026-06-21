import { lstat, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureInsideWorkspace, isIgnoredWorkspaceName, markdownExtensions } from "../fs/pathSafety.js";
import { unifiedDiff } from "./diff.js";
import { hashMarkdown } from "./hash.js";
import type { AgentDraftFileChange } from "./types.js";

export interface MarkdownSnapshotEntry {
  absolutePath: string;
  relativePath: string;
  content: string;
  baseHash: string;
  existed: boolean;
}

export interface MarkdownSnapshot {
  workspaceRoot: string;
  files: Map<string, MarkdownSnapshotEntry>;
}

export interface ActiveMarkdownSnapshotOverride {
  relativePath: string;
  content: string;
  baseHash: string;
}

export interface MarkdownCaptureDiff {
  draftFileChanges: AgentDraftFileChange[];
  deletedRelativePaths: string[];
  unsupportedNotes: string[];
}

type RestoreOperation =
  | {
      kind: "edit";
      relativePath: string;
      absolutePath: string;
      baseContent: string;
    }
  | {
      kind: "create";
      relativePath: string;
      absolutePath: string;
      workspaceRoot: string;
    }
  | {
      kind: "delete";
      relativePath: string;
      absolutePath: string;
      baseContent: string;
    };

export interface MarkdownRestorePlan {
  operations: RestoreOperation[];
}

export interface MarkdownRestoreResult {
  restoredRelativePaths: string[];
  restoredCreateRelativePaths: string[];
}

export async function captureMarkdownWorkspaceSnapshot({
  workspaceRoot,
  activeFile
}: {
  workspaceRoot: string;
  activeFile?: ActiveMarkdownSnapshotOverride;
}): Promise<MarkdownSnapshot> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const files = new Map<string, MarkdownSnapshotEntry>();

  await scanMarkdownFiles(resolvedWorkspaceRoot, resolvedWorkspaceRoot, files);

  if (activeFile) {
    const normalizedPath = normalizeWorkspaceRelativeMarkdownPath(resolvedWorkspaceRoot, activeFile.relativePath);

    if (normalizedPath.ok && !(await isExistingUnsafePath(resolvedWorkspaceRoot, normalizedPath.value))) {
      files.set(normalizedPath.value, {
        absolutePath: path.join(resolvedWorkspaceRoot, normalizedPath.value),
        relativePath: normalizedPath.value,
        content: activeFile.content,
        baseHash: activeFile.baseHash,
        existed: true
      });
    }
  }

  return { workspaceRoot: resolvedWorkspaceRoot, files };
}

export function compareMarkdownSnapshots({
  before,
  after,
  sourceLabel
}: {
  before: MarkdownSnapshot;
  after: MarkdownSnapshot;
  sourceLabel: string;
}): MarkdownCaptureDiff {
  const draftFileChanges: AgentDraftFileChange[] = [];
  const deletedRelativePaths: string[] = [];
  const unsupportedNotes: string[] = [];

  for (const [relativePath, beforeFile] of before.files) {
    const afterFile = after.files.get(relativePath);

    if (!afterFile) {
      draftFileChanges.push({
        kind: "delete_file",
        relativePath,
        baseHash: beforeFile.baseHash,
        baseContent: beforeFile.content,
        summary: `Delete ${relativePath}`,
        unifiedDiff: unifiedDiff(beforeFile.content, "", relativePath)
      });
      continue;
    }

    if (beforeFile.content === afterFile.content) {
      continue;
    }

    draftFileChanges.push({
      kind: "edit_file",
      relativePath,
      baseHash: beforeFile.baseHash,
      baseContent: beforeFile.content,
      replacement: afterFile.content,
      summary: `Edit ${relativePath}`,
      unifiedDiff: unifiedDiff(beforeFile.content, afterFile.content, relativePath)
    });
  }

  for (const [relativePath, afterFile] of after.files) {
    if (before.files.has(relativePath)) {
      continue;
    }

    draftFileChanges.push({
      kind: "create_file",
      relativePath,
      content: afterFile.content,
      summary: `Create ${relativePath}`,
      unifiedDiff: unifiedDiff("", afterFile.content, relativePath)
    });
  }

  return { draftFileChanges, deletedRelativePaths, unsupportedNotes };
}

export async function validateMarkdownCaptureRestore({
  snapshot,
  drafts,
  deletedRelativePaths = []
}: {
  snapshot: MarkdownSnapshot;
  drafts: AgentDraftFileChange[];
  deletedRelativePaths?: string[];
}): Promise<MarkdownRestorePlan> {
  const operations: RestoreOperation[] = [];
  const seenPaths = new Set<string>();

  for (const draft of drafts) {
    const normalizedPath = normalizeWorkspaceRelativeMarkdownPath(snapshot.workspaceRoot, draft.relativePath);

    if (!normalizedPath.ok) {
      throw new Error(normalizedPath.error);
    }

    const relativePath = normalizedPath.value;
    if (seenPaths.has(relativePath)) {
      continue;
    }
    seenPaths.add(relativePath);

    const absolutePath = path.join(snapshot.workspaceRoot, relativePath);
    const current = await readCurrentMarkdownContent(snapshot.workspaceRoot, absolutePath);

    if (current.status === "unsafe") {
      throw new Error(`External changes touched ${relativePath}, but the current path is no longer a regular Markdown file.`);
    }

    if (draft.kind === "edit_file") {
      if (current.status === "missing") {
        throw new Error(`External changes touched ${relativePath}, but it is missing before restore.`);
      }

      if (current.content === draft.baseContent) {
        continue;
      }

      if (current.content !== draft.replacement) {
        throw new Error(`External changes touched ${relativePath}, but it changed again before Iliad could restore it.`);
      }

      operations.push({
        kind: "edit",
        relativePath,
        absolutePath,
        baseContent: draft.baseContent
      });
      continue;
    }

    if (draft.kind === "create_file") {
      if (current.status === "missing") {
        continue;
      }

      if (current.content !== draft.content) {
        throw new Error(`External changes created ${relativePath}, but it changed before Iliad could remove it for review.`);
      }

      operations.push({
        kind: "create",
        relativePath,
        absolutePath,
        workspaceRoot: snapshot.workspaceRoot
      });
      continue;
    }

    if (current.status === "readable") {
      if (current.content === draft.baseContent) {
        continue;
      }

      throw new Error(`External changes removed ${relativePath}, but it changed again before Iliad could restore it.`);
    }

    operations.push({
      kind: "delete",
      relativePath,
      absolutePath,
      baseContent: draft.baseContent
    });
  }

  for (const rawRelativePath of deletedRelativePaths) {
    const normalizedPath = normalizeWorkspaceRelativeMarkdownPath(snapshot.workspaceRoot, rawRelativePath);

    if (!normalizedPath.ok) {
      throw new Error(normalizedPath.error);
    }

    const relativePath = normalizedPath.value;
    if (seenPaths.has(relativePath)) {
      continue;
    }
    seenPaths.add(relativePath);

    const beforeFile = snapshot.files.get(relativePath);
    if (!beforeFile) {
      continue;
    }

    const current = await readCurrentMarkdownContent(snapshot.workspaceRoot, beforeFile.absolutePath);

    if (current.status === "unsafe") {
      throw new Error(`External changes removed ${relativePath}, but the current path is no longer safe to restore.`);
    }

    if (current.status === "readable") {
      if (current.content === beforeFile.content) {
        continue;
      }

      throw new Error(`External changes removed ${relativePath}, but it changed again before Iliad could restore it.`);
    }

    operations.push({
      kind: "delete",
      relativePath,
      absolutePath: beforeFile.absolutePath,
      baseContent: beforeFile.content
    });
  }

  return { operations };
}

export async function restoreMarkdownCapture(plan: MarkdownRestorePlan): Promise<MarkdownRestoreResult> {
  const restoredRelativePaths: string[] = [];
  const restoredCreateRelativePaths: string[] = [];

  for (const operation of plan.operations) {
    if (operation.kind === "create") {
      await rm(operation.absolutePath, { force: true });
      await removeEmptyAncestors(path.dirname(operation.absolutePath), operation.workspaceRoot);
      restoredCreateRelativePaths.push(operation.relativePath);
      continue;
    }

    await mkdir(path.dirname(operation.absolutePath), { recursive: true });
    await writeFile(operation.absolutePath, operation.baseContent, "utf8");
    restoredRelativePaths.push(operation.relativePath);
  }

  return { restoredRelativePaths, restoredCreateRelativePaths };
}

async function removeEmptyAncestors(directoryPath: string, workspaceRoot: string) {
  let currentPath = path.resolve(directoryPath);
  const root = path.resolve(workspaceRoot);

  while (currentPath !== root && !path.relative(root, currentPath).startsWith("..")) {
    try {
      await rmdir(currentPath);
    } catch {
      return;
    }

    currentPath = path.dirname(currentPath);
  }
}

async function scanMarkdownFiles(
  workspaceRoot: string,
  directoryPath: string,
  files: Map<string, MarkdownSnapshotEntry>
) {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (isIgnoredWorkspaceName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    let stats;

    try {
      stats = await lstat(absolutePath);
    } catch {
      continue;
    }

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      await scanMarkdownFiles(workspaceRoot, absolutePath, files);
      continue;
    }

    if (!stats.isFile() || !markdownExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const relativePath = normalizeWorkspaceRelativeMarkdownPath(workspaceRoot, path.relative(workspaceRoot, absolutePath));

    if (!relativePath.ok) {
      continue;
    }

    try {
      const content = await readFile(absolutePath, "utf8");
      files.set(relativePath.value, {
        absolutePath,
        relativePath: relativePath.value,
        content,
        baseHash: hashMarkdown(content),
        existed: true
      });
    } catch {
      continue;
    }
  }
}

async function readCurrentMarkdownContent(workspaceRoot: string, absolutePath: string) {
  try {
    ensureInsideWorkspace(workspaceRoot, absolutePath);
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink() || !stats.isFile()) {
      return { status: "unsafe" as const };
    }

    return { status: "readable" as const, content: await readFile(absolutePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" as const };
    }

    return { status: "unsafe" as const };
  }
}

async function isExistingUnsafePath(workspaceRoot: string, relativePath: string) {
  const absolutePath = path.join(workspaceRoot, relativePath);

  try {
    ensureInsideWorkspace(workspaceRoot, absolutePath);
    const stats = await lstat(absolutePath);
    return stats.isSymbolicLink() || !stats.isFile();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

function normalizeWorkspaceRelativeMarkdownPath(workspaceRoot: string, rawPath: string) {
  const trimmedPath = rawPath.trim();
  let relativePath = trimmedPath;

  if (!trimmedPath) {
    return failure("Markdown path must be a non-empty relative path.");
  }

  if (path.isAbsolute(trimmedPath)) {
    try {
      ensureInsideWorkspace(workspaceRoot, trimmedPath);
      relativePath = path.relative(workspaceRoot, trimmedPath);
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Markdown path is outside the workspace.");
    }
  }

  if (relativePath.includes("\\")) {
    return failure(`Markdown path must use workspace-relative POSIX separators: ${rawPath}.`);
  }

  const normalized = path.posix.normalize(relativePath);

  if (
    normalized !== relativePath ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    return failure(`Markdown path must stay inside the workspace: ${rawPath}.`);
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return failure(`Markdown path cannot target hidden or unsafe paths: ${rawPath}.`);
  }

  if (!markdownExtensions.has(path.extname(normalized).toLowerCase())) {
    return failure(`Markdown path must target a Markdown file: ${rawPath}.`);
  }

  return { ok: true as const, value: normalized };
}

function failure(error: string) {
  return { ok: false as const, error };
}
