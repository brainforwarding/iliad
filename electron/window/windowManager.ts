import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isPathInside, type CliWindowTarget } from "../cli/commands.js";
import { cliOpenRequestedChannel } from "../cli/ipc.js";
import { CliOpenRequestQueue } from "../cli/openRequests.js";
import type { CliWindowStatus } from "../cli/protocol.js";
import type { WorkspaceInfo } from "../launch/workspace.js";
import { workspaceKey } from "../launch/workspace.js";
import { createWindow } from "./createWindow.js";

interface CreateIliadWindowOptions {
  launchWorkspace?: WorkspaceInfo | null;
}

export class IliadWindowManager {
  private readonly launchWorkspacesByWebContentsId = new Map<number, WorkspaceInfo>();
  private readonly currentWorkspacesByWebContentsId = new Map<number, WorkspaceInfo>();
  private readonly sessionIdsByWindowWorkspaceKey = new Map<string, string>();
  private readonly webContentsIdsByWorkspaceKey = new Map<string, number>();
  private readonly windowsByWebContentsId = new Map<number, BrowserWindow>();
  private readonly workspaceKeysByWebContentsId = new Map<number, string>();
  private readonly activeDocumentsByWebContentsId = new Map<number, string>();
  private activeWebContentsIds: number[] = [];
  /** Pending `iliad open` requests, one per window (see electron/cli). */
  readonly cliOpenRequests = new CliOpenRequestQueue({
    notify: (webContentsId) => {
      const window = this.windowsByWebContentsId.get(webContentsId);

      if (window && !window.isDestroyed()) {
        window.webContents.send(cliOpenRequestedChannel);
      }
    }
  });

  createIliadWindow({ launchWorkspace = null }: CreateIliadWindowOptions = {}) {
    if (launchWorkspace) {
      const existingWindow = this.getWindowForWorkspace(launchWorkspace.path);

      if (existingWindow) {
        this.focusWindow(existingWindow);
        return existingWindow;
      }
    }

    const window = createWindow();
    const webContentsId = window.webContents.id;

    this.windowsByWebContentsId.set(webContentsId, window);
    this.markActive(webContentsId);

    if (launchWorkspace) {
      const workspaceWithSession = this.setWindowWorkspace(webContentsId, launchWorkspace);

      if (workspaceWithSession) {
        this.launchWorkspacesByWebContentsId.set(webContentsId, workspaceWithSession);
      }
    }

    window.on("focus", () => {
      this.markActive(webContentsId);
    });

    window.on("closed", () => {
      this.unregisterWindow(webContentsId);
    });

    return window;
  }

  focusMostRecentWindow() {
    const window = this.getMostRecentWindow();

    if (!window) {
      return false;
    }

    this.focusWindow(window);
    return true;
  }

  sendToMostRecentWindow(channel: string, ...args: unknown[]) {
    const window = this.getMostRecentWindow();

    if (!window) {
      return false;
    }

    window.webContents.send(channel, ...args);
    return true;
  }

  focusWindow(window: BrowserWindow) {
    if (window.isMinimized()) {
      window.restore();
    }

    if (!window.isVisible()) {
      window.show();
    }

    window.focus();
    this.markActive(window.webContents.id);
  }

  getLaunchWorkspace(webContentsId: number) {
    return this.launchWorkspacesByWebContentsId.get(webContentsId) ?? null;
  }

  getWindowWorkspace(webContentsId: number) {
    return this.currentWorkspacesByWebContentsId.get(webContentsId) ?? null;
  }

  getMostRecentWorkspace() {
    for (const webContentsId of this.activeWebContentsIds) {
      const workspace = this.currentWorkspacesByWebContentsId.get(webContentsId);
      const window = this.windowsByWebContentsId.get(webContentsId);

      if (workspace && window && !window.isDestroyed()) {
        return workspace;
      }
    }

    return null;
  }

  getWindowForWorkspace(workspacePath: string) {
    const key = workspaceKey(workspacePath);
    const webContentsId = this.webContentsIdsByWorkspaceKey.get(key);
    const window = webContentsId ? this.windowsByWebContentsId.get(webContentsId) : null;

    if (!window || window.isDestroyed()) {
      if (webContentsId) {
        this.unregisterWindow(webContentsId);
      }

      return null;
    }

    return window;
  }

  openWorkspace(workspace: WorkspaceInfo) {
    const existingWindow = this.getWindowForWorkspace(workspace.path);

    if (existingWindow) {
      this.focusWindow(existingWindow);
      return existingWindow;
    }

    return this.createIliadWindow({ launchWorkspace: workspace });
  }

  setWindowWorkspace(webContentsId: number, workspace: WorkspaceInfo) {
    const window = this.windowsByWebContentsId.get(webContentsId);

    if (!window || window.isDestroyed()) {
      return null;
    }

    const previousWorkspaceKey = this.workspaceKeysByWebContentsId.get(webContentsId);

    if (previousWorkspaceKey && this.webContentsIdsByWorkspaceKey.get(previousWorkspaceKey) === webContentsId) {
      this.webContentsIdsByWorkspaceKey.delete(previousWorkspaceKey);
    }

    const nextWorkspaceKey = workspaceKey(workspace.path);

    if (previousWorkspaceKey !== nextWorkspaceKey) {
      this.activeDocumentsByWebContentsId.delete(webContentsId);
    }

    this.workspaceKeysByWebContentsId.set(webContentsId, nextWorkspaceKey);
    this.webContentsIdsByWorkspaceKey.set(nextWorkspaceKey, webContentsId);

    const workspaceWithSession = {
      ...workspace,
      sessionId: workspace.sessionId?.trim() || this.workspaceSessionId(webContentsId, workspace.path)
    };
    this.currentWorkspacesByWebContentsId.set(webContentsId, workspaceWithSession);

    const launchWorkspace = this.launchWorkspacesByWebContentsId.get(webContentsId);

    if (launchWorkspace && workspaceKey(launchWorkspace.path) !== nextWorkspaceKey) {
      this.launchWorkspacesByWebContentsId.delete(webContentsId);
    }

    return workspaceWithSession;
  }

  /** The renderer reports the document it shows (absolute path) or null. */
  setActiveDocument(webContentsId: number, documentPath: string | null) {
    const workspace = this.currentWorkspacesByWebContentsId.get(webContentsId);

    if (!documentPath || !workspace || !isPathInside(workspace.path, path.resolve(documentPath))) {
      this.activeDocumentsByWebContentsId.delete(webContentsId);
      return;
    }

    this.activeDocumentsByWebContentsId.set(webContentsId, path.resolve(documentPath));
  }

  getActiveDocument(webContentsId: number) {
    return this.activeDocumentsByWebContentsId.get(webContentsId) ?? null;
  }

  /** Windows for `iliad status`, most recently used first; that one is "focused". */
  listWindowStatus(): CliWindowStatus[] {
    const liveIds = [
      ...this.activeWebContentsIds,
      ...[...this.windowsByWebContentsId.keys()].filter((id) => !this.activeWebContentsIds.includes(id))
    ].filter((id) => {
      const window = this.windowsByWebContentsId.get(id);
      return Boolean(window && !window.isDestroyed());
    });

    return liveIds.map((webContentsId, index) => {
      const workspace = this.currentWorkspacesByWebContentsId.get(webContentsId)?.path ?? null;
      const document = this.activeDocumentsByWebContentsId.get(webContentsId) ?? null;

      return {
        workspace,
        document,
        relativePath: workspace && document ? path.relative(workspace, document).split(path.sep).join("/") : null,
        focused: index === 0
      };
    });
  }

  /** The open window whose workspace contains the file (longest root wins). */
  findWindowForPath(absolutePath: string): CliWindowTarget | null {
    let best: CliWindowTarget | null = null;

    for (const [webContentsId, workspace] of this.currentWorkspacesByWebContentsId) {
      const window = this.windowsByWebContentsId.get(webContentsId);

      if (!window || window.isDestroyed() || !isPathInside(workspace.path, absolutePath)) {
        continue;
      }

      if (!best || workspace.path.length > best.workspaceRoot.length) {
        best = { webContentsId, workspaceRoot: workspace.path };
      }
    }

    return best;
  }

  focusWindowById(webContentsId: number) {
    const window = this.windowsByWebContentsId.get(webContentsId);

    if (window && !window.isDestroyed()) {
      this.focusWindow(window);
    }
  }

  /** Hands the renderer its queued `iliad open` once it shows a workspace containing the file. */
  takeCliOpenRequest(webContentsId: number) {
    const workspace = this.currentWorkspacesByWebContentsId.get(webContentsId);

    if (!workspace) {
      return null;
    }

    return this.cliOpenRequests.take(webContentsId, (request) => isPathInside(workspace.path, request.path));
  }

  private getMostRecentWindow() {
    for (const webContentsId of this.activeWebContentsIds) {
      const window = this.windowsByWebContentsId.get(webContentsId);

      if (window && !window.isDestroyed()) {
        return window;
      }
    }

    return null;
  }

  private markActive(webContentsId: number) {
    this.activeWebContentsIds = [
      webContentsId,
      ...this.activeWebContentsIds.filter((activeWebContentsId) => activeWebContentsId !== webContentsId)
    ];
  }

  private unregisterWindow(webContentsId: number) {
    this.windowsByWebContentsId.delete(webContentsId);
    this.launchWorkspacesByWebContentsId.delete(webContentsId);
    this.currentWorkspacesByWebContentsId.delete(webContentsId);
    this.activeDocumentsByWebContentsId.delete(webContentsId);
    this.cliOpenRequests.dropWindow(webContentsId);
    this.activeWebContentsIds = this.activeWebContentsIds.filter(
      (activeWebContentsId) => activeWebContentsId !== webContentsId
    );

    const workspaceKeyForWindow = this.workspaceKeysByWebContentsId.get(webContentsId);
    this.workspaceKeysByWebContentsId.delete(webContentsId);

    if (workspaceKeyForWindow && this.webContentsIdsByWorkspaceKey.get(workspaceKeyForWindow) === webContentsId) {
      this.webContentsIdsByWorkspaceKey.delete(workspaceKeyForWindow);
    }

    for (const key of this.sessionIdsByWindowWorkspaceKey.keys()) {
      if (key.startsWith(`${webContentsId}:`)) {
        this.sessionIdsByWindowWorkspaceKey.delete(key);
      }
    }
  }

  private workspaceSessionId(webContentsId: number, workspacePath: string) {
    const key = `${webContentsId}:${workspaceKey(workspacePath)}`;
    const existing = this.sessionIdsByWindowWorkspaceKey.get(key);

    if (existing) {
      return existing;
    }

    const next = randomUUID();
    this.sessionIdsByWindowWorkspaceKey.set(key, next);
    return next;
  }
}
