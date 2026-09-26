import { ipcMain, shell } from "electron";
import path from "node:path";
import { isCompanionPath } from "../fs/companionFiles.js";
import {
  assertTrashablePath,
  createFolder,
  createMarkdownFile,
  documentGroupPaths,
  duplicatePath,
  existingCompanions,
  movePath,
  plannedRenamePath,
  readMarkdownFile,
  renamePath,
  type FileTreeNode
} from "../fs/fileOps.js";
import { ensureMarkdownFile, toKind } from "../fs/pathSafety.js";
import type { WorkspaceInfo } from "../launch/workspace.js";
import { hashMarkdown } from "../review/hash.js";
import {
  type BaselineRecord,
  type MarkdownWriteExpectation,
  type MarkdownWriteResult,
  readDiskPathState,
  WorkspaceBaselineService
} from "../review/workspaceBaseline.js";

interface RegisterFileIpcOptions {
  getWindowWorkspace?: (webContentsId: number) => WorkspaceInfo | null;
  baselineService?: WorkspaceBaselineService;
}

function assertCurrentWorkspace(
  workspaceRoot: string,
  event: Electron.IpcMainInvokeEvent,
  options: RegisterFileIpcOptions
) {
  const currentWorkspace = options.getWindowWorkspace?.(event.sender.id);

  if (!currentWorkspace) {
    if (options.getWindowWorkspace) {
      throw new Error("No active workspace is available in this window.");
    }

    return workspaceRoot;
  }

  if (path.resolve(currentWorkspace.path) !== path.resolve(workspaceRoot)) {
    throw new Error("Requested workspace is not active in this window.");
  }

  return currentWorkspace.path;
}

export function workspaceRelativePosix(workspaceRoot: string, absolutePath: string) {
  return path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath)).split(path.sep).join("/");
}

export function normalizeWriteExpectation(value: unknown): MarkdownWriteExpectation {
  if (value && typeof value === "object" && "kind" in value) {
    const record = value as Record<string, unknown>;

    if (record.kind === "absent") {
      return { kind: "absent" };
    }

    if (record.kind === "hash" && typeof record.hash === "string" && record.hash) {
      return { kind: "hash", hash: record.hash };
    }
  }

  // Without a trusted disk identity the renderer must not overwrite anything.
  return { kind: "absent" };
}

export function registerFileIpc(options: RegisterFileIpcOptions = {}) {
  const baseline = options.baselineService ?? new WorkspaceBaselineService();

  ipcMain.handle("file:read-markdown", async (_event, workspaceRoot: string, filePath: string): Promise<string> => {
    return readMarkdownFile(workspaceRoot, filePath);
  });

  ipcMain.handle(
    "file:write-markdown",
    async (event, workspaceRoot: string, filePath: string, content: string, expected?: unknown): Promise<MarkdownWriteResult> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
      const relativePath = workspaceRelativePosix(verifiedWorkspaceRoot, filePath);

      return baseline.writeMarkdownIfUnchanged(verifiedWorkspaceRoot, {
        relativePath,
        content,
        expected: normalizeWriteExpectation(expected)
      });
    }
  );

  ipcMain.handle(
    "file:create-markdown",
    async (event, workspaceRoot: string, directoryPath: string, requestedName: string): Promise<FileTreeNode> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

      const created = await baseline.runIliadMutation(verifiedWorkspaceRoot, {
        paths: [],
        operation: () => createMarkdownFile(verifiedWorkspaceRoot, directoryPath, requestedName),
        record: (result) => [
          { op: "set", relativePath: workspaceRelativePosix(verifiedWorkspaceRoot, result.path), content: result.content }
        ]
      });
      const { content: _content, ...node } = created;
      return node;
    }
  );

  ipcMain.handle(
    "folder:create",
    async (event, workspaceRoot: string, directoryPath: string, requestedName: string): Promise<FileTreeNode> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

      return baseline.runIliadMutation(verifiedWorkspaceRoot, {
        paths: [],
        operation: () => createFolder(verifiedWorkspaceRoot, directoryPath, requestedName)
      });
    }
  );

  ipcMain.handle("file:rename", async (event, workspaceRoot: string, filePath: string, requestedName: string) => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
    const fromRelativePath = workspaceRelativePosix(verifiedWorkspaceRoot, filePath);
    const plannedPath = plannedRenamePath(filePath, requestedName);

    return baseline.runIliadMutation(verifiedWorkspaceRoot, {
      paths: groupRelativePaths(verifiedWorkspaceRoot, [filePath, plannedPath]),
      operation: () => renamePath(verifiedWorkspaceRoot, filePath, requestedName),
      record: (result) => moveRecords(verifiedWorkspaceRoot, fromRelativePath, result)
    });
  });

  ipcMain.handle(
    "file:move",
    async (
      event,
      workspaceRoot: string,
      sourcePath: string,
      targetDirectoryPath: string
    ): Promise<FileTreeNode> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
      const fromRelativePath = workspaceRelativePosix(verifiedWorkspaceRoot, sourcePath);
      const plannedPath = path.join(targetDirectoryPath, path.basename(sourcePath));

      return baseline.runIliadMutation(verifiedWorkspaceRoot, {
        paths: groupRelativePaths(verifiedWorkspaceRoot, [sourcePath, plannedPath]),
        operation: () => movePath(verifiedWorkspaceRoot, sourcePath, targetDirectoryPath),
        record: (result) => moveRecords(verifiedWorkspaceRoot, fromRelativePath, result)
      });
    }
  );

  ipcMain.handle("file:duplicate", async (event, workspaceRoot: string, filePath: string): Promise<FileTreeNode> => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

    return baseline.runIliadMutation(verifiedWorkspaceRoot, {
      paths: groupRelativePaths(verifiedWorkspaceRoot, [filePath]),
      operation: () => duplicatePath(verifiedWorkspaceRoot, filePath),
      record: (result) =>
        result.kind === "markdown"
          ? [{ op: "reconcile", relativePath: workspaceRelativePosix(verifiedWorkspaceRoot, result.path) }]
          : []
    });
  });

  ipcMain.handle("file:trash", async (event, workspaceRoot: string, filePath: string): Promise<TrashResult> => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
    const relativePath = workspaceRelativePosix(verifiedWorkspaceRoot, filePath);

    return baseline.runIliadMutation(verifiedWorkspaceRoot, {
      paths: groupRelativePaths(verifiedWorkspaceRoot, [filePath]),
      operation: () => trashWithCompanions(verifiedWorkspaceRoot, filePath, (target) => shell.trashItem(target)),
      record: () => [{ op: "remove", relativePath }]
    });
  });

  ipcMain.handle("file:read-companion", async (event, workspaceRoot: string, filePath: string): Promise<CompanionReadResult> => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
    return readCompanionFile(verifiedWorkspaceRoot, filePath);
  });

  ipcMain.handle(
    "file:remove-companion",
    async (event, workspaceRoot: string, filePath: string, expectedHash: unknown): Promise<MarkdownWriteResult> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
      return removeCompanionFile(baseline, verifiedWorkspaceRoot, filePath, expectedHash);
    }
  );
}

export interface TrashResult {
  /** Companions that stayed in place after their document went to the Trash. */
  companionFailures: Array<{ path: string; reason: string }>;
}

export type CompanionReadResult = { status: "present"; content: string; hash: string } | { status: "absent" };

/** Trashes a file; for a document, then its existing companions, reporting (not undoing) failures (spec V13). */
export async function trashWithCompanions(
  workspaceRoot: string,
  filePath: string,
  trashItem: (absolutePath: string) => Promise<void>
): Promise<TrashResult> {
  await assertTrashablePath(workspaceRoot, filePath);
  const companions = toKind(filePath, false) === "markdown" ? await existingCompanions(filePath) : [];
  await trashItem(filePath);
  const companionFailures: TrashResult["companionFailures"] = [];

  for (const companion of companions) {
    try {
      await trashItem(companion.path);
    } catch (error) {
      companionFailures.push({ path: companion.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { companionFailures };
}

function assertCompanionPath(workspaceRoot: string, filePath: string) {
  if (typeof filePath !== "string" || !isCompanionPath(filePath)) {
    throw new Error("Only comments files can be used here.");
  }

  ensureMarkdownFile(workspaceRoot, filePath);
}

export async function readCompanionFile(workspaceRoot: string, filePath: string): Promise<CompanionReadResult> {
  assertCompanionPath(workspaceRoot, filePath);
  // Same path checks as the guarded write: no symlinks, regular files only.
  const current = await readDiskPathState(workspaceRoot, workspaceRelativePosix(workspaceRoot, filePath));

  if (current.status === "unsafe") {
    throw new Error("This comments file is not a regular file inside the workspace.");
  }

  return current.status === "present"
    ? { status: "present", content: current.content, hash: hashMarkdown(current.content) }
    : { status: "absent" };
}

/** `file:remove-companion` (spec V21): the guarded remove, limited to companion paths. */
export async function removeCompanionFile(
  baseline: WorkspaceBaselineService,
  workspaceRoot: string,
  filePath: string,
  expectedHash: unknown
): Promise<MarkdownWriteResult> {
  assertCompanionPath(workspaceRoot, filePath);

  if (typeof expectedHash !== "string" || !expectedHash) {
    return { status: "conflict", reason: "disk_changed" };
  }

  return baseline.removeMarkdownIfUnchanged(workspaceRoot, {
    relativePath: workspaceRelativePosix(workspaceRoot, filePath),
    expected: { kind: "hash", hash: expectedHash }
  });
}

/** Workspace-relative paths of each file's whole group (document + companion names), for mutation markers. */
function groupRelativePaths(workspaceRoot: string, filePaths: Array<string | null>) {
  const paths = new Set<string>();

  for (const filePath of filePaths) {
    if (!filePath) {
      continue;
    }

    for (const groupPath of documentGroupPaths(filePath)) {
      const relativePath = workspaceRelativePosix(workspaceRoot, groupPath);

      if (relativePath && !relativePath.startsWith("..")) {
        paths.add(relativePath);
      }
    }
  }

  return [...paths];
}

function moveRecords(workspaceRoot: string, fromRelativePath: string, result: FileTreeNode): BaselineRecord[] {
  const toRelativePath = workspaceRelativePosix(workspaceRoot, result.path);

  if (fromRelativePath === toRelativePath) {
    return [];
  }

  const directory = result.kind === "directory";

  if (!directory && toKind(result.path, false) !== "markdown" && toKind(fromRelativePath, false) !== "markdown") {
    return [];
  }

  return [{ op: "move", fromRelativePath, toRelativePath, directory }];
}
