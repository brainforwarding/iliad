import { ipcMain, shell } from "electron";
import path from "node:path";
import {
  assertTrashablePath,
  createFolder,
  createMarkdownFile,
  duplicatePath,
  movePath,
  readMarkdownFile,
  renamePath,
  type FileTreeNode
} from "../fs/fileOps.js";
import { toKind } from "../fs/pathSafety.js";
import type { WorkspaceInfo } from "../launch/workspace.js";
import {
  type BaselineRecord,
  type MarkdownWriteExpectation,
  type MarkdownWriteResult,
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

    return baseline.runIliadMutation(verifiedWorkspaceRoot, {
      paths: [fromRelativePath],
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

      return baseline.runIliadMutation(verifiedWorkspaceRoot, {
        paths: [fromRelativePath],
        operation: () => movePath(verifiedWorkspaceRoot, sourcePath, targetDirectoryPath),
        record: (result) => moveRecords(verifiedWorkspaceRoot, fromRelativePath, result)
      });
    }
  );

  ipcMain.handle("file:duplicate", async (event, workspaceRoot: string, filePath: string): Promise<FileTreeNode> => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

    return baseline.runIliadMutation(verifiedWorkspaceRoot, {
      paths: [],
      operation: () => duplicatePath(verifiedWorkspaceRoot, filePath),
      record: (result) =>
        result.kind === "markdown"
          ? [{ op: "reconcile", relativePath: workspaceRelativePosix(verifiedWorkspaceRoot, result.path) }]
          : []
    });
  });

  ipcMain.handle("file:trash", async (event, workspaceRoot: string, filePath: string) => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);
    const relativePath = workspaceRelativePosix(verifiedWorkspaceRoot, filePath);

    await baseline.runIliadMutation(verifiedWorkspaceRoot, {
      paths: [relativePath],
      operation: async () => {
        await assertTrashablePath(verifiedWorkspaceRoot, filePath);
        await shell.trashItem(filePath);
      },
      record: () => [{ op: "remove", relativePath }]
    });
  });
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
