import { app, BrowserWindow, dialog, Menu, protocol, session, shell, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { createCliRequestHandler } from "./cli/commands.js";
import { installCliCommand, loginShellPath } from "./cli/installCommand.js";
import { registerCliIpc } from "./cli/ipc.js";
import { startCliServer, type CliServer } from "./cli/server.js";
import { registerAutocompleteIpc } from "./ipc/autocomplete.js";
import { registerAssetIpc, registerAssetProtocol } from "./ipc/assets.js";
import { registerDiagnosticsIpc } from "./ipc/diagnostics.js";
import { registerFileIpc } from "./ipc/files.js";
import { registerReviewIpc } from "./ipc/review.js";
import { registerSearchIpc } from "./ipc/search.js";
import { registerShellIpc } from "./ipc/shell.js";
import { registerTightenIpc } from "./ipc/tighten.js";
import { registerUpdatesIpc, updateCheckRequestedChannel } from "./ipc/updates.js";
import { registerWorkspaceIpc } from "./ipc/workspace.js";
import { registerWritingCorrectorMemoryIpc } from "./ipc/writingCorrectorMemory.js";
import { registerWritingSettingsIpc } from "./ipc/writingSettings.js";
import { legacyCommentsAttachHook } from "./comments/legacyCommentsMigration.js";
import { parseLaunchWorkspacePath } from "./launch/argv.js";
import { canonicalizeWorkspaceDirectory, type WorkspaceInfo } from "./launch/workspace.js";
import { createDiagnosticsLogger } from "./diagnostics/logger.js";
import { WorkspaceBaselineService } from "./review/workspaceBaseline.js";
import { UpdateService } from "./updates/updateService.js";
import { WritingAiService } from "./writing/writingAiService.js";
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
let pendingUpdateCheckRequest = false;
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

app.setName(isDev ? "Iliad MD Dev" : "Iliad MD");

if (isDev) {
  // Keep dev runs from sharing the single-instance lock with the linked CLI app.
  app.setPath("userData", path.join(app.getPath("appData"), "iliad-dev"));
}

if (process.env.ILIAD_USER_DATA) {
  // Separate profile (own single-instance lock and CLI socket); the `iliad`
  // CLI honors the same variable.
  app.setPath("userData", path.resolve(process.env.ILIAD_USER_DATA));
}

let cliServer: CliServer | null = null;

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

function configureAboutPanel() {
  if (process.platform !== "darwin") {
    return;
  }

  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion()
  });
}

function installApplicationMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  configureAboutPanel();

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => {
            if (!windowManager.sendToMostRecentWindow(updateCheckRequestedChannel)) {
              pendingUpdateCheckRequest = true;
              windowManager.createIliadWindow();
            }
          }
        },
        { type: "separator" },
        {
          label: "Install \u2018iliad\u2019 Command\u2026",
          click: () => {
            void installIliadCommandFromMenu();
          }
        },
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

async function installIliadCommandFromMenu() {
  const parentWindow = BrowserWindow.getFocusedWindow();
  const show = (options: Electron.MessageBoxOptions) =>
    parentWindow ? dialog.showMessageBox(parentWindow, options) : dialog.showMessageBox(options);

  if (!app.isPackaged) {
    await show({
      type: "info",
      message: "Install \u2018iliad\u2019 Command",
      detail: "This installs the command for the installed app. In a development checkout, run `npm link` in the checkout instead."
    });
    return;
  }

  try {
    const result = await installCliCommand({
      wrapperPath: path.join(process.resourcesPath, "bin", "iliad"),
      pathValue: await loginShellPath()
    });
    const pathWarning = result.onPath
      ? ""
      : `\n\n${result.directory} is not on your PATH. Add it to your shell profile, for example:\nexport PATH="${result.directory}:$PATH"`;

    await show({
      type: "info",
      message: "The \u2018iliad\u2019 command is installed",
      detail: `Installed at ${result.linkPath}.${pathWarning}\n\nTry \u2018iliad status\u2019 in a terminal, and \u2018iliad skill install\u2019 to add the Iliad skill for Claude Code.`
    });
  } catch (error) {
    await show({
      type: "error",
      message: "Could not install the \u2018iliad\u2019 command",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function startCliSocket(logWarning: (details: Record<string, string>) => void) {
  const handler = createCliRequestHandler({
    host: {
      listWindowStatus: () => windowManager.listWindowStatus(),
      findWindowForPath: (absolutePath) => windowManager.findWindowForPath(absolutePath),
      openWorkspaceWindow: (workspace) => {
        const window = windowManager.openWorkspace(workspace);
        return { webContentsId: window.webContents.id, workspaceRoot: workspace.path };
      },
      focusWindow: (webContentsId) => windowManager.focusWindowById(webContentsId),
      requestOpenDocument: (webContentsId, request) => windowManager.cliOpenRequests.request(webContentsId, request)
    }
  });

  try {
    cliServer = await startCliServer({
      socketPath: path.join(app.getPath("userData"), "iliad.sock"),
      handler
    });
  } catch (error) {
    console.warn("[cli] Could not start the iliad command socket.", error);
    logWarning({ message: error instanceof Error ? error.message : String(error) });
  }
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
  const userDataPath = app.getPath("userData");
  const diagnosticsLogger = createDiagnosticsLogger(userDataPath);
  const baselineService = new WorkspaceBaselineService({
    trashItem: (absolutePath) => shell.trashItem(absolutePath),
    onLog: (event, details) => diagnosticsLogger.info({ area: "review", event, details })
  });
  const resolveWorkspaceRootForSession = (event: { sender: { id: number } }, workspaceSessionId: string) => {
    const workspace = windowManager.getWindowWorkspace(event.sender.id);

    if (!workspace || workspace.sessionId !== workspaceSessionId) {
      return null;
    }

    return workspace.path;
  };
  registerWorkspaceIpc({
    getLaunchWorkspace: (webContentsId) => windowManager.getLaunchWorkspace(webContentsId),
    getWindowWorkspace: (webContentsId) => windowManager.getWindowWorkspace(webContentsId),
    setWindowWorkspace: (webContentsId, workspace) => windowManager.setWindowWorkspace(webContentsId, workspace),
    baselineService,
    onWorkspaceAttached: legacyCommentsAttachHook(userDataPath, baselineService)
  });
  registerFileIpc({
    getWindowWorkspace: (webContentsId) => windowManager.getWindowWorkspace(webContentsId),
    baselineService
  });
  registerSearchIpc();
  registerShellIpc();
  registerAssetIpc({
    getWindowWorkspace: (webContentsId) => windowManager.getWindowWorkspace(webContentsId),
    resolveWorkspaceRootForSession
  });
  registerDiagnosticsIpc({ logger: diagnosticsLogger });
  registerReviewIpc({ baselineService, resolveWorkspaceRootForSession, diagnostics: diagnosticsLogger });
  const writingAiService = new WritingAiService(userDataPath, { diagnostics: diagnosticsLogger });
  registerWritingSettingsIpc({ service: writingAiService });
  registerWritingCorrectorMemoryIpc({ resolveWorkspaceRootForSession });
  registerAutocompleteIpc({ service: writingAiService, resolveWorkspaceRootForSession });
  registerTightenIpc({ service: writingAiService });
  registerCliIpc({
    setActiveDocument: (webContentsId, documentPath) => windowManager.setActiveDocument(webContentsId, documentPath),
    takeOpenRequest: (webContentsId) => windowManager.takeCliOpenRequest(webContentsId),
    completeOpenRequest: (webContentsId, requestId, result) =>
      windowManager.cliOpenRequests.complete(webContentsId, requestId, result)
  });
  await startCliSocket((details) => diagnosticsLogger.info({ area: "app", event: "cli_socket_failed", details }));
  registerUpdatesIpc({
    service: new UpdateService({ currentVersion: app.getVersion() }),
    consumePendingCheckRequest: () => {
      const pending = pendingUpdateCheckRequest;
      pendingUpdateCheckRequest = false;
      return pending;
    }
  });

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
    writingAiService.dispose();
    baselineService.dispose();
    void cliServer?.close();
    cliServer = null;
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
