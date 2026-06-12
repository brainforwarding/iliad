import { BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions, WebContents } from "electron";
import { readDirectory, type FileTreeNode } from "../fs/fileOps.js";
import { rememberWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory, type WorkspaceInfo } from "../launch/workspace.js";

interface WorkspaceIpcOptions {
  getLaunchWorkspace: (webContentsId: number) => WorkspaceInfo | null;
  setWindowWorkspace: (webContentsId: number, workspace: WorkspaceInfo) => WorkspaceInfo | null;
}

interface ReadDirectoryRequest {
  workspaceRoot: string;
  requestId?: number;
}

type ReadDirectoryResponse =
  | { status: "ok"; workspace: WorkspaceInfo; tree: FileTreeNode[] }
  | { status: "missing" };

const latestReadRequestIdsByWebContentsId = new Map<number, number>();
const openDialogTitles = {
  en: "Open Folder",
  es: "Abrir carpeta"
} as const;

function normalizeDialogLanguage(language: unknown): keyof typeof openDialogTitles {
  return language === "es" ? "es" : "en";
}

function windowFromSender(sender: WebContents) {
  return BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getFocusedWindow();
}

function normalizeReadDirectoryRequest(request: string | ReadDirectoryRequest): ReadDirectoryRequest {
  if (typeof request === "string") {
    return { workspaceRoot: request };
  }

  return request;
}

function isMissingPathError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function registerWorkspaceIpc({ getLaunchWorkspace, setWindowWorkspace }: WorkspaceIpcOptions) {
  ipcMain.handle("workspace:get-launch-workspace", (event): WorkspaceInfo | null => {
    return getLaunchWorkspace(event.sender.id);
  });

  ipcMain.handle("workspace:open-dialog", async (event, language: unknown): Promise<WorkspaceInfo | null> => {
    const dialogOptions: OpenDialogOptions = {
      properties: ["openDirectory"],
      title: openDialogTitles[normalizeDialogLanguage(language)]
    };
    const parentWindow = windowFromSender(event.sender);
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const workspace = await canonicalizeWorkspaceDirectory(result.filePaths[0]);
    rememberWorkspace(workspace.path);
    return setWindowWorkspace(event.sender.id, workspace) ?? workspace;
  });

  ipcMain.handle("workspace:read-directory", async (event, request: string | ReadDirectoryRequest): Promise<ReadDirectoryResponse> => {
    const { workspaceRoot, requestId } = normalizeReadDirectoryRequest(request);
    const webContentsId = event.sender.id;

    if (requestId !== undefined) {
      latestReadRequestIdsByWebContentsId.set(webContentsId, requestId);
    }

    let workspace: WorkspaceInfo;
    let tree: FileTreeNode[];

    try {
      workspace = await canonicalizeWorkspaceDirectory(workspaceRoot);
      tree = await readDirectory(workspace.path);
    } catch (error) {
      if (isMissingPathError(error)) {
        return { status: "missing" };
      }

      throw error;
    }

    if (requestId === undefined || latestReadRequestIdsByWebContentsId.get(webContentsId) === requestId) {
      rememberWorkspace(workspace.path);
      workspace = setWindowWorkspace(webContentsId, workspace) ?? workspace;
    }

    return { status: "ok", workspace, tree };
  });
}
