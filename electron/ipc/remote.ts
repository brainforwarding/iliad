import { app, BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { isInsideAllowedWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory } from "../launch/workspace.js";
import { RemoteSettingsStore } from "../remote/remoteSettingsStore.js";
import { TelegramRemoteService } from "../remote/telegramRemoteService.js";
import type {
  TelegramRemotePairingStartResponse,
  TelegramRemoteSettings,
  TelegramRemoteSettingsUpdate
} from "../remote/remoteTypes.js";

type RemoteIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
type WorkspaceSessionResolver = (
  event: RemoteIpcEvent,
  workspaceSessionId: string
) => Promise<string | null> | string | null;

interface RegisterRemoteIpcOptions {
  remoteService?: RemoteSettingsControllerLike;
  remoteRelayClient?: RemoteRelayControllerLike;
  resolveWorkspaceRootForSession?: WorkspaceSessionResolver;
}

interface RemoteSettingsUpdateRequest {
  enabled?: unknown;
  activeThreadId?: unknown;
  workspaceSessionId?: unknown;
}

interface RemoteSettingsControllerLike {
  settings: () => Promise<TelegramRemoteSettings>;
  updateSettings: (update: TelegramRemoteSettingsUpdate) => Promise<TelegramRemoteSettings>;
  revokePairing: () => Promise<TelegramRemoteSettings>;
}

type PublicTelegramRemoteSettings = Omit<TelegramRemoteSettings, "deviceSecret">;

interface RemoteRelayControllerLike {
  startPairing: () => Promise<TelegramRemotePairingStartResponse>;
  revokePairing?: () => Promise<TelegramRemoteSettings>;
  sync?: () => void | Promise<void>;
  clearPendingPairing?: () => void;
}

export function registerRemoteIpc({
  remoteService,
  remoteRelayClient,
  resolveWorkspaceRootForSession
}: RegisterRemoteIpcOptions = {}) {
  const settingsController =
    remoteService ??
    new TelegramRemoteService({
      userDataPath: app.getPath("userData"),
      getCurrentWorkspace: () => null
    });

  ipcMain.handle("remote:get-settings", (event) => handleGetRemoteSettingsIpc(event, settingsController));
  ipcMain.handle("remote:start-pairing", (event) => handleStartRemotePairingIpc(event, remoteRelayClient));
  ipcMain.handle("remote:update-settings", (event, request: unknown) =>
    handleUpdateRemoteSettingsIpc(event, request, settingsController, resolveWorkspaceRootForSession, remoteRelayClient)
  );
  ipcMain.handle("remote:revoke-settings", (event) =>
    handleRevokeRemoteSettingsIpc(event, settingsController, remoteRelayClient)
  );
}

export async function handleGetRemoteSettingsIpc(
  event: RemoteIpcEvent,
  settingsController: RemoteSettingsControllerLike
) {
  assertTrustedRemoteIpcSender(event, "get");
  return presentRemoteSettings(await settingsController.settings());
}

export async function handleUpdateRemoteSettingsIpc(
  event: RemoteIpcEvent,
  request: unknown,
  settingsController: RemoteSettingsControllerLike,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver,
  remoteRelayClient?: Pick<RemoteRelayControllerLike, "sync" | "clearPendingPairing" | "revokePairing">
) {
  assertTrustedRemoteIpcSender(event, "update");
  const normalized = normalizeRemoteSettingsUpdateRequest(request);

  if (normalized.enabled === undefined && !normalized.hasActiveThreadId) {
    return presentRemoteSettings(await settingsController.settings());
  }

  const update: TelegramRemoteSettingsUpdate = {};

  if (normalized.enabled !== undefined) {
    update.enabled = normalized.enabled;
  }

  if (normalized.enabled) {
    const workspaceRoot = await resolveWorkspaceRoot(
      event,
      normalized.workspaceSessionId,
      resolveWorkspaceRootForSession
    );

    if (!workspaceRoot) {
      throw new Error("Telegram Remote Chat can only be enabled for the current workspace.");
    }

    update.boundWorkspaceRoot = workspaceRoot;
  }

  if (normalized.hasActiveThreadId) {
    const settings = await settingsController.settings();
    const workspaceRoot = await resolveWorkspaceRoot(
      event,
      normalized.workspaceSessionId,
      resolveWorkspaceRootForSession
    );
    const effectiveEnabled = normalized.enabled ?? settings.enabled;
    const effectiveBoundWorkspaceRoot = update.boundWorkspaceRoot ?? settings.boundWorkspaceRoot;

    if (!workspaceRoot) {
      throw new Error("Select a current Iliad workspace before choosing the remote chat.");
    }

    if (!effectiveEnabled || !effectiveBoundWorkspaceRoot) {
      throw new Error("Telegram Remote Chat must be enabled for this workspace before choosing the remote chat.");
    }

    if (path.resolve(effectiveBoundWorkspaceRoot) !== path.resolve(workspaceRoot)) {
      throw new Error("The selected remote chat must belong to the workspace bound to Telegram Remote Chat.");
    }

    update.activeThreadId = normalized.activeThreadId;
    update.activeThreadWorkspaceRoot = workspaceRoot;
  }

  await settingsController.updateSettings(update);

  if (normalized.enabled === false) {
    remoteRelayClient?.clearPendingPairing?.();
    const settings = remoteRelayClient?.revokePairing
      ? await remoteRelayClient.revokePairing()
      : await settingsController.revokePairing();
    await remoteRelayClient?.sync?.();
    return presentRemoteSettings(settings);
  }

  if (normalized.enabled !== undefined) {
    await remoteRelayClient?.sync?.();
  }

  return presentRemoteSettings(await settingsController.settings());
}

export async function handleRevokeRemoteSettingsIpc(
  event: RemoteIpcEvent,
  settingsController: RemoteSettingsControllerLike,
  remoteRelayClient?: Pick<RemoteRelayControllerLike, "revokePairing" | "clearPendingPairing" | "sync">
) {
  assertTrustedRemoteIpcSender(event, "revoke");
  remoteRelayClient?.clearPendingPairing?.();
  const settings = remoteRelayClient?.revokePairing
    ? await remoteRelayClient.revokePairing()
    : await settingsController.revokePairing();
  await remoteRelayClient?.sync?.();
  return presentRemoteSettings(settings);
}

export async function handleStartRemotePairingIpc(
  event: RemoteIpcEvent,
  remoteRelayClient?: Pick<RemoteRelayControllerLike, "startPairing">
) {
  assertTrustedRemoteIpcSender(event, "pairing");

  if (!remoteRelayClient?.startPairing) {
    throw new Error("Telegram Remote Chat pairing is unavailable in this build.");
  }

  return presentRemotePairing(await remoteRelayClient.startPairing());
}

export function remoteSettingsControllerForStore(settingsStore: RemoteSettingsStore): RemoteSettingsControllerLike {
  return {
    settings: () => settingsStore.snapshot(),
    updateSettings: (update) => settingsStore.update(update),
    revokePairing: () => settingsStore.revokePairing()
  };
}

function presentRemoteSettings(settings: TelegramRemoteSettings): PublicTelegramRemoteSettings {
  const { deviceSecret: _deviceSecret, ...publicSettings } = settings;
  return publicSettings;
}

function presentRemotePairing(pairing: TelegramRemotePairingStartResponse): TelegramRemotePairingStartResponse {
  return {
    token: pairing.token,
    pairingSessionId: pairing.pairingSessionId,
    expiresAt: pairing.expiresAt,
    ...(pairing.pairingUrl ? { pairingUrl: pairing.pairingUrl } : {})
  };
}

export function isTrustedRemoteIpcSender(event: RemoteIpcEvent) {
  if (!BrowserWindow.fromWebContents(event.sender)) {
    return false;
  }

  return isTrustedRemoteSenderFrameUrl(event.senderFrame?.url ?? "", process.env.VITE_DEV_SERVER_URL);
}

export function isTrustedRemoteSenderFrameUrl(frameUrl: string, devServerUrl: string | undefined) {
  const parsedFrameUrl = parseUrl(frameUrl);

  if (!parsedFrameUrl) {
    return false;
  }

  if (!devServerUrl) {
    return parsedFrameUrl.protocol === "file:";
  }

  const parsedDevServerUrl = parseUrl(devServerUrl);
  return Boolean(parsedDevServerUrl && parsedFrameUrl.origin === parsedDevServerUrl.origin);
}

function normalizeRemoteSettingsUpdateRequest(request: unknown) {
  const source = isPlainObject(request) ? (request as RemoteSettingsUpdateRequest) : {};
  const workspaceSessionId = typeof source.workspaceSessionId === "string" ? source.workspaceSessionId.trim() : "";
  const hasActiveThreadId = Object.prototype.hasOwnProperty.call(source, "activeThreadId");
  const activeThreadId = typeof source.activeThreadId === "string" ? source.activeThreadId.trim() : "";

  return {
    ...(typeof source.enabled === "boolean" ? { enabled: source.enabled } : {}),
    ...(hasActiveThreadId ? { activeThreadId, hasActiveThreadId: true as const } : { hasActiveThreadId: false as const }),
    ...(workspaceSessionId ? { workspaceSessionId } : {})
  };
}

function assertTrustedRemoteIpcSender(event: RemoteIpcEvent, action: string) {
  if (!isTrustedRemoteIpcSender(event)) {
    throw new Error(`The Telegram Remote Chat settings ${action} request came from an untrusted window.`);
  }
}

async function resolveWorkspaceRoot(
  event: RemoteIpcEvent,
  workspaceSessionId: string | undefined,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver
) {
  if (!workspaceSessionId) {
    return null;
  }

  const workspaceRoot = await resolveWorkspaceRootForSession(event, workspaceSessionId);

  return typeof workspaceRoot === "string" && workspaceRoot.trim() ? path.resolve(workspaceRoot) : null;
}

async function defaultWorkspaceSessionResolver(_event: RemoteIpcEvent, workspaceSessionId: string) {
  if (!path.isAbsolute(workspaceSessionId)) {
    return null;
  }

  try {
    const workspace = await canonicalizeWorkspaceDirectory(workspaceSessionId);
    return isInsideAllowedWorkspace(workspace.path) ? workspace.path : null;
  } catch {
    return null;
  }
}

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
