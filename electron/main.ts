import { app, BrowserWindow, Menu, protocol, session, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { registerAgentIpc } from "./ipc/agent.js";
import { registerAutocompleteIpc } from "./ipc/autocomplete.js";
import { registerAssetIpc, registerAssetProtocol } from "./ipc/assets.js";
import { registerFileIpc } from "./ipc/files.js";
import { registerRemoteIpc } from "./ipc/remote.js";
import { registerSearchIpc } from "./ipc/search.js";
import { registerSelectionCommentsIpc } from "./ipc/selectionComments.js";
import { registerShellIpc } from "./ipc/shell.js";
import { registerTightenIpc } from "./ipc/tighten.js";
import { registerWorkspaceIpc } from "./ipc/workspace.js";
import { registerWritingCorrectorMemoryIpc } from "./ipc/writingCorrectorMemory.js";
import { parseLaunchWorkspacePath } from "./launch/argv.js";
import { canonicalizeWorkspaceDirectory, type WorkspaceInfo } from "./launch/workspace.js";
import { AgentService } from "./agent/agentService.js";
import { AgentChatHistoryStore } from "./agent/chatHistoryStore.js";
import { RemoteRelayClient } from "./remote/remoteRelayClient.js";
import { TelegramRemoteService } from "./remote/telegramRemoteService.js";
import { installYouTubeEmbedHeaders } from "./window/youtubeEmbedHeaders.js";
import { IliadWindowManager } from "./window/windowManager.js";

interface LaunchRequest {
  argv: string[];
  cwd: string;
}

type LaunchWorkspaceResult =
  | { status: "none" }
  | { status: "valid"; workspace: WorkspaceInfo }
  | { status: "invalid" };

const windowManager = new IliadWindowManager();
const queuedLaunchRequests: LaunchRequest[] = [];
let appReady = false;
let isProcessingLaunchRequests = false;
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

app.setName(isDev ? "Iliad MD Dev" : "Iliad MD");

if (isDev) {
  // Keep dev runs from sharing the single-instance lock with the linked CLI app.
  app.setPath("userData", path.join(app.getPath("appData"), "iliad-dev"));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "iliad-file",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function installApplicationMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function resolveLaunchWorkspace({ argv, cwd }: LaunchRequest): Promise<LaunchWorkspaceResult> {
  const workspacePath = parseLaunchWorkspacePath({
    appRoot: app.getAppPath(),
    argv,
    cwd
  });

  if (!workspacePath) {
    return { status: "none" };
  }

  try {
    return {
      status: "valid",
      workspace: await canonicalizeWorkspaceDirectory(workspacePath)
    };
  } catch (error) {
    console.warn(`[launch] Ignoring invalid workspace path "${workspacePath}".`, error);
    return { status: "invalid" };
  }
}

async function handleLaunchRequest(launchRequest: LaunchRequest) {
  const launchWorkspace = await resolveLaunchWorkspace(launchRequest);

  if (launchWorkspace.status === "valid") {
    windowManager.openWorkspace(launchWorkspace.workspace);
    return;
  }

  if (!windowManager.focusMostRecentWindow()) {
    windowManager.createIliadWindow();
  }
}

async function processQueuedLaunchRequests() {
  if (!appReady || isProcessingLaunchRequests) {
    return;
  }

  isProcessingLaunchRequests = true;

  try {
    while (queuedLaunchRequests.length > 0) {
      const queuedLaunchRequest = queuedLaunchRequests.shift();

      if (queuedLaunchRequest) {
        await handleLaunchRequest(queuedLaunchRequest);
      }
    }
  } finally {
    isProcessingLaunchRequests = false;
  }
}

function queueOrHandleLaunchRequest(launchRequest: LaunchRequest) {
  queuedLaunchRequests.push(launchRequest);

  if (appReady) {
    void processQueuedLaunchRequests();
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine, workingDirectory) => {
    queueOrHandleLaunchRequest({
      argv: commandLine,
      cwd: workingDirectory
    });
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  installApplicationMenu();
  installYouTubeEmbedHeaders(session.defaultSession.webRequest);
  registerAssetProtocol();
  registerWorkspaceIpc({
    getLaunchWorkspace: (webContentsId) => windowManager.getLaunchWorkspace(webContentsId),
    setWindowWorkspace: (webContentsId, workspace) => windowManager.setWindowWorkspace(webContentsId, workspace)
  });
  registerFileIpc();
  registerSearchIpc();
  registerShellIpc();
  registerAssetIpc();
  const userDataPath = app.getPath("userData");
  const chatHistoryStore = new AgentChatHistoryStore(userDataPath);
  const agentService = new AgentService(userDataPath, { chatHistoryStore });
  const remoteService = new TelegramRemoteService({
    userDataPath,
    agentService,
    chatHistoryStore,
    getCurrentWorkspace: () => {
      const workspace = windowManager.getMostRecentWorkspace();
      return workspace ? { root: workspace.path, label: workspace.name } : null;
    }
  });
  const remoteRelayClient = new RemoteRelayClient({ remoteService });
  remoteRelayClient.start();
  registerRemoteIpc({
    remoteService,
    remoteRelayClient,
    resolveWorkspaceRootForSession: (event, workspaceSessionId) => {
      const workspace = windowManager.getWindowWorkspace(event.sender.id);

      if (!workspace || workspace.sessionId !== workspaceSessionId) {
        return null;
      }

      return workspace.path;
    }
  });
  registerAgentIpc({
    service: agentService,
    resolveWorkspaceRootForSession: (event, workspaceSessionId) => {
      const workspace = windowManager.getWindowWorkspace(event.sender.id);

      if (!workspace || workspace.sessionId !== workspaceSessionId) {
        return null;
      }

      return workspace.path;
    }
  });
  registerSelectionCommentsIpc({
    resolveWorkspaceRootForSession: (event, workspaceSessionId) => {
      const workspace = windowManager.getWindowWorkspace(event.sender.id);

      if (!workspace || workspace.sessionId !== workspaceSessionId) {
        return null;
      }

      return workspace.path;
    }
  });
  registerWritingCorrectorMemoryIpc({
    resolveWorkspaceRootForSession: (event, workspaceSessionId) => {
      const workspace = windowManager.getWindowWorkspace(event.sender.id);

      if (!workspace || workspace.sessionId !== workspaceSessionId) {
        return null;
      }

      return workspace.path;
    }
  });
  registerAutocompleteIpc({
    service: agentService,
    resolveWorkspaceRootForSession: (event, workspaceSessionId) => {
      const workspace = windowManager.getWindowWorkspace(event.sender.id);

      if (!workspace || workspace.sessionId !== workspaceSessionId) {
        return null;
      }

      return workspace.path;
    }
  });
  registerTightenIpc({ service: agentService });

  appReady = true;
  queueOrHandleLaunchRequest({
    argv: process.argv,
    cwd: process.cwd()
  });
  await processQueuedLaunchRequests();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createIliadWindow();
      return;
    }

    windowManager.focusMostRecentWindow();
  });

  app.on("before-quit", () => {
    remoteRelayClient.dispose();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
