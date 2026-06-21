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
import { trackWorkspaceMutation } from "../fs/workspaceMutationMarkers.js";
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

  ipcMain.handle("file:write-markdown", async (event, workspaceRoot: string, filePath: string, content: string) => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

    return trackWorkspaceMutation(verifiedWorkspaceRoot, [filePath], () =>
      writeMarkdownFile(verifiedWorkspaceRoot, filePath, content)
    );
  });

  ipcMain.handle(
    "file:create-markdown",
    async (event, workspaceRoot: string, directoryPath: string, requestedName: string): Promise<FileTreeNode> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

      return trackWorkspaceMutation(verifiedWorkspaceRoot, undefined, () =>
        createMarkdownFile(verifiedWorkspaceRoot, directoryPath, requestedName)
      );
    }
  );

  ipcMain.handle(
    "folder:create",
    async (event, workspaceRoot: string, directoryPath: string, requestedName: string): Promise<FileTreeNode> => {
      const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

      return trackWorkspaceMutation(verifiedWorkspaceRoot, undefined, () =>
        createFolder(verifiedWorkspaceRoot, directoryPath, requestedName)
      );
    }
  );

  ipcMain.handle("file:rename", async (event, workspaceRoot: string, filePath: string, requestedName: string) => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

    return trackWorkspaceMutation(verifiedWorkspaceRoot, undefined, () =>
      renamePath(verifiedWorkspaceRoot, filePath, requestedName)
    );
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

      return trackWorkspaceMutation(verifiedWorkspaceRoot, undefined, () =>
        movePath(verifiedWorkspaceRoot, sourcePath, targetDirectoryPath)
      );
    }
  );

  ipcMain.handle("file:duplicate", async (event, workspaceRoot: string, filePath: string): Promise<FileTreeNode> => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

    return trackWorkspaceMutation(verifiedWorkspaceRoot, undefined, () =>
      duplicatePath(verifiedWorkspaceRoot, filePath)
    );
  });

  ipcMain.handle("file:trash", async (event, workspaceRoot: string, filePath: string) => {
    const verifiedWorkspaceRoot = assertCurrentWorkspace(workspaceRoot, event, options);

    await trackWorkspaceMutation(verifiedWorkspaceRoot, undefined, async () => {
      await assertTrashablePath(verifiedWorkspaceRoot, filePath);
      await shell.trashItem(filePath);
    });
  });
}
