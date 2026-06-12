import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
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
  private activeWebContentsIds: number[] = [];

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
