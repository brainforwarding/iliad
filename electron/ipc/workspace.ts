import { BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions, WebContents } from "electron";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { readDirectory, type FileTreeNode } from "../fs/fileOps.js";
import { isIgnoredWorkspaceName, markdownExtensions } from "../fs/pathSafety.js";
import { workspaceMutationMarkerMatches } from "../fs/workspaceMutationMarkers.js";
import { rememberWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory, type WorkspaceInfo } from "../launch/workspace.js";
import type { WorkspaceBaselineService } from "../review/workspaceBaseline.js";

interface WorkspaceIpcOptions {
  getLaunchWorkspace: (webContentsId: number) => WorkspaceInfo | null;
  getWindowWorkspace?: (webContentsId: number) => WorkspaceInfo | null;
  setWindowWorkspace: (webContentsId: number, workspace: WorkspaceInfo) => WorkspaceInfo | null;
  baselineService?: WorkspaceBaselineService;
  /**
   * Runs once a window attaches to a workspace (legacy comment migration);
   * returns the files it wrote so the renderer re-reads them.
   */
  onWorkspaceAttached?: (workspaceRoot: string) => Promise<string[]>;
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
  watcher: FSWatcher | null;
  timer: NodeJS.Timeout | null;
  pendingChange: WorkspaceChangePayload | null;
  restartTimer: NodeJS.Timeout | null;
  restartAttempt: number;
  healthyTimer: NodeJS.Timeout | null;
  closed: boolean;
}

interface WorkspaceChangePayload {
  workspaceRoot: string;
  treeChanged: boolean;
  markdownChanged: boolean;
  changedMarkdownPaths: string[];
  watcherDegraded?: boolean;
}

const latestReadRequestIdsByWebContentsId = new Map<number, number>();
const workspaceWatchersByWebContentsId = new Map<number, WorkspaceWatcherState>();
const workspaceChangeChannel = "workspace:changed";
const workspaceWatchDebounceMs = 250;
const watcherRestartBackoffMs = [500, 1000, 2000, 4000, 8000];
const watcherHealthyAfterMs = 30_000;
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

function normalizeWatchFilename(filename: string | Buffer | null | undefined) {
  if (!filename) {
    return null;
  }

  const value = typeof filename === "string" ? filename : filename.toString("utf8");
  const normalized = path.normalize(value);

  if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
    return null;
  }

  return normalized;
}

export function workspaceWatchEventIsMarkdownChange(
  eventType: string | null | undefined,
  filename?: string | Buffer | null
) {
  if (eventType !== "change" && eventType !== "rename") {
    return false;
  }

  const relativePath = normalizeWatchFilename(filename);
  if (!relativePath) {
    return false;
  }

  const segments = relativePath.split(path.sep);
  if (segments.some(isIgnoredWorkspaceName)) {
    return false;
  }

  return markdownExtensions.has(path.extname(relativePath).toLowerCase());
}

function closeWorkspaceWatcher(webContentsId: number) {
  const current = workspaceWatchersByWebContentsId.get(webContentsId);
  if (!current) {
    return;
  }

  current.closed = true;

  if (current.timer) {
    clearTimeout(current.timer);
  }

  if (current.restartTimer) {
    clearTimeout(current.restartTimer);
  }

  if (current.healthyTimer) {
    clearTimeout(current.healthyTimer);
  }

  current.watcher?.close();
  current.watcher = null;
  workspaceWatchersByWebContentsId.delete(webContentsId);
}

function scheduleWorkspaceChanged(sender: WebContents, state: WorkspaceWatcherState, change: WorkspaceChangePayload) {
  const current = state.pendingChange;
  const changedMarkdownPaths = new Set([
    ...(current?.changedMarkdownPaths ?? []),
    ...change.changedMarkdownPaths
  ]);

  state.pendingChange = {
    workspaceRoot: state.workspaceRoot,
    treeChanged: Boolean(current?.treeChanged || change.treeChanged),
    markdownChanged: Boolean(current?.markdownChanged || change.markdownChanged),
    changedMarkdownPaths: [...changedMarkdownPaths]
  };

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;

    if (sender.isDestroyed()) {
      closeWorkspaceWatcher(sender.id);
      return;
    }

    const payload = state.pendingChange ?? {
      workspaceRoot: state.workspaceRoot,
      treeChanged: true,
      markdownChanged: false,
      changedMarkdownPaths: []
    };
    state.pendingChange = null;
    sender.send(workspaceChangeChannel, payload);
  }, workspaceWatchDebounceMs);
}

function assertWorkspaceCanBeWatched(webContentsId: number, workspace: WorkspaceInfo, options: WorkspaceIpcOptions) {
  const currentWorkspace = options.getWindowWorkspace?.(webContentsId);

  if (currentWorkspace && path.resolve(currentWorkspace.path) !== path.resolve(workspace.path)) {
    throw new Error("Requested workspace is not active in this window.");
  }
}

function createWorkspaceWatcher(
  sender: WebContents,
  workspace: WorkspaceInfo,
  baselineService: WorkspaceBaselineService | undefined
): WorkspaceWatcherState {
  const state: WorkspaceWatcherState = {
    workspaceRoot: workspace.path,
    watcher: null,
    timer: null,
    pendingChange: null,
    restartTimer: null,
    restartAttempt: 0,
    healthyTimer: null,
    closed: false
  };

  const onChange = (eventType: string | null, filename?: string | Buffer | null) => {
    const relativePath = normalizeWatchFilename(filename);
    const treeChanged = workspaceWatchEventNeedsTreeRefresh(eventType);
    const markdownChanged = workspaceWatchEventIsMarkdownChange(eventType, filename);

    // The baseline service reconciles disk itself; hints are never dropped,
    // even for Iliad-owned writes, because the service already knows those.
    if (baselineService && (markdownChanged || treeChanged || !relativePath)) {
      baselineService.noteDiskChange(workspace.path, {
        relativePath: relativePath ? relativePath.split(path.sep).join("/") : null,
        eventType: eventType === "change" ? "change" : eventType === "rename" ? "rename" : "unknown"
      });
    }

    if (
      (treeChanged || markdownChanged) &&
      workspaceMutationMarkerMatches(workspace.path, relativePath)
    ) {
      return;
    }

    if (treeChanged || markdownChanged) {
      scheduleWorkspaceChanged(sender, state, {
        workspaceRoot: workspace.path,
        treeChanged,
        markdownChanged,
        changedMarkdownPaths: markdownChanged && relativePath ? [relativePath] : []
      });
    }
  };

  const start = () => {
    const recursive = process.platform === "darwin" || process.platform === "win32";
    let watcher: FSWatcher;

    try {
      watcher = watch(workspace.path, { recursive }, onChange);
    } catch (error) {
      if (!recursive) {
        throw error;
      }

      watcher = watch(workspace.path, onChange);
    }

    watcher.on("error", (error) => {
      console.warn(`[workspace] File watcher failed for "${workspace.path}".`, error);
      scheduleRestart();
    });

    state.watcher = watcher;
    state.healthyTimer = setTimeout(() => {
      state.healthyTimer = null;
      state.restartAttempt = 0;
    }, watcherHealthyAfterMs);
    state.healthyTimer.unref?.();
  };

  const scheduleRestart = () => {
    if (state.closed) {
      return;
    }

    state.watcher?.close();
    state.watcher = null;

    if (state.healthyTimer) {
      clearTimeout(state.healthyTimer);
      state.healthyTimer = null;
    }

    if (state.restartAttempt >= watcherRestartBackoffMs.length) {
      scheduleWorkspaceChanged(sender, state, {
        workspaceRoot: workspace.path,
        treeChanged: true,
        markdownChanged: true,
        changedMarkdownPaths: [],
        watcherDegraded: true
      });
      return;
    }

    const delay = watcherRestartBackoffMs[state.restartAttempt];
    state.restartAttempt += 1;
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;

      if (state.closed || sender.isDestroyed()) {
        return;
      }

      try {
        start();
        baselineService?.noteWatcherRestarted(workspace.path);
        scheduleWorkspaceChanged(sender, state, {
          workspaceRoot: workspace.path,
          treeChanged: true,
          markdownChanged: true,
          changedMarkdownPaths: []
        });
      } catch (error) {
        console.warn(`[workspace] File watcher restart failed for "${workspace.path}".`, error);
        scheduleRestart();
      }
    }, delay);
    state.restartTimer.unref?.();
  };

  start();
  return state;
}

export function registerWorkspaceIpc({
  getLaunchWorkspace,
  getWindowWorkspace,
  setWindowWorkspace,
  baselineService,
  onWorkspaceAttached
}: WorkspaceIpcOptions) {
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

    if (current) {
      baselineService?.detach(current.workspaceRoot, webContentsId);
    }

    closeWorkspaceWatcher(webContentsId);
    workspaceWatchersByWebContentsId.set(webContentsId, createWorkspaceWatcher(event.sender, workspace, baselineService));
    event.sender.once("destroyed", () => {
      closeWorkspaceWatcher(webContentsId);
      baselineService?.detachSubscriber(webContentsId);
    });

    if (baselineService) {
      const sender = event.sender;
      await baselineService.attach(workspace.path, {
        id: sender.id,
        send: (channel, payload) => sender.send(channel, payload),
        isDestroyed: () => sender.isDestroyed()
      });
    }

    if (onWorkspaceAttached) {
      const sender = event.sender;
      void onWorkspaceAttached(workspace.path)
        .then((writtenPaths) => {
          const state = workspaceWatchersByWebContentsId.get(sender.id);

          if (writtenPaths.length === 0 || !state || sender.isDestroyed()) {
            return;
          }

          scheduleWorkspaceChanged(sender, state, {
            workspaceRoot: state.workspaceRoot,
            treeChanged: true,
            markdownChanged: true,
            changedMarkdownPaths: writtenPaths.map((writtenPath) => path.relative(state.workspaceRoot, writtenPath))
          });
        })
        .catch((error: unknown) => {
          console.warn(`[workspace] Attach task failed for "${workspace.path}".`, error);
        });
    }

    return { status: "ok" };
  });

  ipcMain.handle("workspace:unwatch", (event): { status: "ok" } => {
    const current = workspaceWatchersByWebContentsId.get(event.sender.id);

    if (current) {
      baselineService?.detach(current.workspaceRoot, event.sender.id);
    }

    closeWorkspaceWatcher(event.sender.id);
    return { status: "ok" };
  });
}
