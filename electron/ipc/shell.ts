import { ipcMain, shell } from "electron";
import { ensureInsideWorkspace, validateExternalUrl } from "../fs/pathSafety.js";

export function registerShellIpc() {
  ipcMain.handle("shell:open-url", async (_event, rawUrl: string) => {
    await shell.openExternal(validateExternalUrl(rawUrl));
  });

  ipcMain.handle("file:open-external", async (_event, workspaceRoot: string, filePath: string) => {
    ensureInsideWorkspace(workspaceRoot, filePath);

    return shell.openPath(filePath);
  });

  ipcMain.handle("file:reveal", async (_event, workspaceRoot: string, filePath: string) => {
    ensureInsideWorkspace(workspaceRoot, filePath);

    shell.showItemInFolder(filePath);
  });
}
