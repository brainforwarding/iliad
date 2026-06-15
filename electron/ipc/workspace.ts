import { BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions, WebContents } from "electron";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { readDirectory, type FileTreeNode } from "../fs/fileOps.js";
import { rememberWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory, type WorkspaceInfo } from "../launch/workspace.js";

interface WorkspaceIpcOptions {
  getLaunchWorkspace: (webContentsId: number) => WorkspaceInfo | null;
  getWindowWorkspace?: (webContentsId: number) => WorkspaceInfo | null;
  setWindowWorkspace: (webContentsId: number, workspace: WorkspaceInfo) => WorkspaceInfo | null;
}

interface ReadDirectoryRequest {
  workspaceRoot: string;
  requestId?: number;
}

type ReadDirectoryResponse =
  | { status: "ok"; workspace: WorkspaceInfo; tree: FileTreeNode[] }
  | { status: "missing" };

interface WorkspaceWatcherState {
  workspaceRoot: string;
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
}

const latestReadRequestIdsByWebContentsId = new Map<number, number>();
const workspaceWatchersByWebContentsId = new Map<number, WorkspaceWatcherState>();
const workspaceChangeChannel = "workspace:changed";
const workspaceWatchDebounceMs = 250;
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

export function workspaceWatchEventNeedsTreeRefresh(eventType: string | null | undefined) {
  return eventType === "rename";
}

function closeWorkspaceWatcher(webContentsId: number) {
  const current = workspaceWatchersByWebContentsId.get(webContentsId);
  if (!current) {
    return;
  }

  if (current.timer) {
    clearTimeout(current.timer);
  }

  current.watcher.close();
  workspaceWatchersByWebContentsId.delete(webContentsId);
}

function scheduleWorkspaceChanged(sender: WebContents, state: WorkspaceWatcherState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;

    if (sender.isDestroyed()) {
      closeWorkspaceWatcher(sender.id);
      return;
    }

    sender.send(workspaceChangeChannel, { workspaceRoot: state.workspaceRoot });
  }, workspaceWatchDebounceMs);
}

function assertWorkspaceCanBeWatched(webContentsId: number, workspace: WorkspaceInfo, options: WorkspaceIpcOptions) {
  const currentWorkspace = options.getWindowWorkspace?.(webContentsId);

  if (currentWorkspace && path.resolve(currentWorkspace.path) !== path.resolve(workspace.path)) {
    throw new Error("Requested workspace is not active in this window.");
  }
}

function createWorkspaceWatcher(sender: WebContents, workspace: WorkspaceInfo): WorkspaceWatcherState {
  const recursive = process.platform === "darwin" || process.platform === "win32";
  let state: WorkspaceWatcherState;

  const onChange = (eventType: string | null) => {
    if (workspaceWatchEventNeedsTreeRefresh(eventType)) {
      scheduleWorkspaceChanged(sender, state);
    }
  };

  let watcher: FSWatcher;

  try {
    watcher = watch(workspace.path, { recursive }, onChange);
  } catch (error) {
    if (!recursive) {
      throw error;
    }

    watcher = watch(workspace.path, onChange);
  }

  state = {
    workspaceRoot: workspace.path,
    watcher,
    timer: null
  };

  watcher.on("error", (error) => {
    console.warn(`[workspace] File watcher failed for "${workspace.path}".`, error);
    closeWorkspaceWatcher(sender.id);
  });

  return state;
}

export function registerWorkspaceIpc({ getLaunchWorkspace, getWindowWorkspace, setWindowWorkspace }: WorkspaceIpcOptions) {
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

  ipcMain.handle("workspace:watch", async (event, workspaceRoot: string): Promise<{ status: "ok" }> => {
    const workspace = await canonicalizeWorkspaceDirectory(workspaceRoot);
    const webContentsId = event.sender.id;

    assertWorkspaceCanBeWatched(webContentsId, workspace, { getLaunchWorkspace, getWindowWorkspace, setWindowWorkspace });

    const current = workspaceWatchersByWebContentsId.get(webContentsId);
    if (current && path.resolve(current.workspaceRoot) === path.resolve(workspace.path)) {
      return { status: "ok" };
    }

    closeWorkspaceWatcher(webContentsId);
    workspaceWatchersByWebContentsId.set(webContentsId, createWorkspaceWatcher(event.sender, workspace));
    event.sender.once("destroyed", () => closeWorkspaceWatcher(webContentsId));

    return { status: "ok" };
  });

  ipcMain.handle("workspace:unwatch", (event): { status: "ok" } => {
    closeWorkspaceWatcher(event.sender.id);
    return { status: "ok" };
  });
}
