import { ipcMain, shell } from "electron";
import {
  assertTrashablePath,
  createFolder,
  createMarkdownFile,
  duplicatePath,
  readMarkdownFile,
  renamePath,
  writeMarkdownFile,
  type FileTreeNode
} from "../fs/fileOps.js";

export function registerFileIpc() {
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

  ipcMain.handle("file:duplicate", async (_event, workspaceRoot: string, filePath: string): Promise<FileTreeNode> => {
    return duplicatePath(workspaceRoot, filePath);
  });

  ipcMain.handle("file:trash", async (_event, workspaceRoot: string, filePath: string) => {
    await assertTrashablePath(workspaceRoot, filePath);
    await shell.trashItem(filePath);
  });
}
