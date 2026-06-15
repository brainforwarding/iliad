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
  writeMarkdownFile,
  type FileTreeNode
} from "../fs/fileOps.js";
import type { WorkspaceInfo } from "../launch/workspace.js";

interface RegisterFileIpcOptions {
  getWindowWorkspace?: (webContentsId: number) => WorkspaceInfo | null;
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

export function registerFileIpc(options: RegisterFileIpcOptions = {}) {
  ipcMain.handle("file:read-markdown", async (_event, workspaceRoot: string, filePath: string): Promise<string> => {
    return readMarkdownFile(workspaceRoot, filePath);
  });

  ipcMain.handle("file:write-markdown", async (_event, workspaceRoot: string, filePath: string, content: string) => {
    return writeMarkdownFile(workspaceRoot, filePath, content);
  });

  ipcMain.handle(
    "file:create-markdown",
    async (_event, workspaceRoot: string, directoryPath: string, requestedName: string): Promise<FileTreeNode> => {
      return createMarkdownFile(workspaceRoot, directoryPath, requestedName);
    }
  );

  ipcMain.handle(
    "folder:create",
    async (_event, workspaceRoot: string, directoryPath: string, requestedName: string): Promise<FileTreeNode> => {
      return createFolder(workspaceRoot, directoryPath, requestedName);
    }
  );

  ipcMain.handle("file:rename", async (_event, workspaceRoot: string, filePath: string, requestedName: string) => {
    return renamePath(workspaceRoot, filePath, requestedName);
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

      return movePath(verifiedWorkspaceRoot, sourcePath, targetDirectoryPath);
    }
  );

  ipcMain.handle("file:duplicate", async (_event, workspaceRoot: string, filePath: string): Promise<FileTreeNode> => {
    return duplicatePath(workspaceRoot, filePath);
  });

  ipcMain.handle("file:trash", async (_event, workspaceRoot: string, filePath: string) => {
    await assertTrashablePath(workspaceRoot, filePath);
    await shell.trashItem(filePath);
  });
}
