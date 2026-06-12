import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSettingsStore } from "../../electron/remote/remoteSettingsStore";

const electronMock = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  getPath: vi.fn(() => "/tmp")
}));

vi.mock("electron", () => ({
  app: {
    getPath: electronMock.getPath
  },
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents
  },
  ipcMain: {
    handle: electronMock.handle
  }
}));

describe("Telegram Remote Chat settings IPC", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    electronMock.fromWebContents.mockReset();
    electronMock.handle.mockReset();
    electronMock.getPath.mockReset();
    electronMock.getPath.mockReturnValue("/tmp");
    delete process.env.VITE_DEV_SERVER_URL;
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function tempDirectory(prefix: string) {
    const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(directory);
    return directory;
  }

  function trustedEvent() {
    electronMock.fromWebContents.mockReturnValue({});
    return {
      sender: {},
      senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
    } as never;
  }

  it("enables remote chat through RemoteSettingsStore and binds the current workspace", async () => {
    const { handleUpdateRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const workspaceRoot = await tempDirectory("iliad-remote-ipc-workspace-");
    const settingsStore = new RemoteSettingsStore(userData);
    const resolveWorkspaceRoot = vi.fn(async () => workspaceRoot);

    const response = await handleUpdateRemoteSettingsIpc(
      trustedEvent(),
      { enabled: true, workspaceSessionId: "session-1" },
      remoteSettingsControllerForStore(settingsStore),
      resolveWorkspaceRoot
    );

    expect(resolveWorkspaceRoot).toHaveBeenCalledWith(expect.anything(), "session-1");
    expect(response.enabled).toBe(true);
    expect(response.relayDeviceId).toEqual(expect.any(String));
    expect(response.relayDeviceId).not.toBe("");
    expect(response.boundWorkspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(response).not.toHaveProperty("deviceSecret");
    await expect(new RemoteSettingsStore(userData).snapshot()).resolves.toMatchObject({
      enabled: true,
      relayDeviceId: response.relayDeviceId,
      deviceSecret: expect.any(String),
      boundWorkspaceRoot: path.resolve(workspaceRoot)
    });
  });

  it("revokes a paired Telegram chat without disabling remote settings", async () => {
    const { handleRevokeRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      pairedChat: {
        chatId: "chat-1",
        username: "sebastian",
        displayName: "Sebastian",
        pairedAt: "2026-05-27T12:00:00.000Z"
      }
    });

    const response = await handleRevokeRemoteSettingsIpc(trustedEvent(), remoteSettingsControllerForStore(settingsStore));

    expect(response.enabled).toBe(true);
    expect(response.pairedChat).toBeNull();
    expect(response).not.toHaveProperty("deviceSecret");
  });

  it("clears pairing through the relay client when remote chat is disabled", async () => {
    const { handleUpdateRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      pairedChat: {
        chatId: "chat-1",
        username: "sebastian",
        displayName: "Sebastian",
        pairedAt: "2026-05-27T12:00:00.000Z"
      }
    });
    const relayClient = {
      clearPendingPairing: vi.fn(),
      revokePairing: vi.fn(() => settingsStore.revokePairing()),
      sync: vi.fn()
    };

    const response = await handleUpdateRemoteSettingsIpc(
      trustedEvent(),
      { enabled: false },
      remoteSettingsControllerForStore(settingsStore),
      undefined,
      relayClient
    );

    expect(relayClient.clearPendingPairing).toHaveBeenCalled();
    expect(relayClient.revokePairing).toHaveBeenCalled();
    expect(response.enabled).toBe(false);
    expect(response.pairedChat).toBeNull();
    expect(response).not.toHaveProperty("deviceSecret");
  });

  it("sets the active thread for the bound workspace without relay sync", async () => {
    const { handleUpdateRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const workspaceRoot = await tempDirectory("iliad-remote-ipc-workspace-");
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      relayDeviceId: "device-1",
      deviceSecret: "secret-1",
      boundWorkspaceRoot: workspaceRoot
    });
    const resolveWorkspaceRoot = vi.fn(async () => workspaceRoot);
    const relayClient = { sync: vi.fn(), clearPendingPairing: vi.fn(), revokePairing: vi.fn() };

    const response = await handleUpdateRemoteSettingsIpc(
      trustedEvent(),
      { activeThreadId: "thread:active-1", workspaceSessionId: "session-1" },
      remoteSettingsControllerForStore(settingsStore),
      resolveWorkspaceRoot,
      relayClient
    );

    expect(resolveWorkspaceRoot).toHaveBeenCalledWith(expect.anything(), "session-1");
    expect(response).toMatchObject({
      enabled: true,
      activeThreadId: "thread:active-1",
      activeThreadWorkspaceRoot: path.resolve(workspaceRoot)
    });
    expect(response).not.toHaveProperty("deviceSecret");
    expect(relayClient.sync).not.toHaveBeenCalled();
  });

  it("drops active thread metadata from snapshots when it does not match the bound workspace", async () => {
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const workspaceRoot = await tempDirectory("iliad-remote-ipc-workspace-");
    const otherWorkspaceRoot = await tempDirectory("iliad-remote-ipc-other-workspace-");
    const remoteDirectory = path.join(userData, "remote");
    await mkdir(remoteDirectory, { recursive: true });
    await writeFile(
      path.join(remoteDirectory, "telegram.json"),
      `${JSON.stringify(
        {
          enabled: true,
          relayDeviceId: "device-1",
          deviceSecret: "secret-1",
          boundWorkspaceRoot: workspaceRoot,
          activeThreadId: "thread:stale-1",
          activeThreadWorkspaceRoot: otherWorkspaceRoot,
          updatedAt: "2026-05-28T12:00:00.000Z"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const snapshot = await new RemoteSettingsStore(userData).snapshot();

    expect(snapshot.boundWorkspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(snapshot).not.toHaveProperty("activeThreadId");
    expect(snapshot).not.toHaveProperty("activeThreadWorkspaceRoot");
  });

  it("sanitizes invalid or empty active thread ids", async () => {
    const { handleUpdateRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const workspaceRoot = await tempDirectory("iliad-remote-ipc-workspace-");
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      relayDeviceId: "device-1",
      deviceSecret: "secret-1",
      boundWorkspaceRoot: workspaceRoot,
      activeThreadId: "thread-valid",
      activeThreadWorkspaceRoot: workspaceRoot
    });

    const invalid = await handleUpdateRemoteSettingsIpc(
      trustedEvent(),
      { activeThreadId: "bad thread id", workspaceSessionId: "session-1" },
      remoteSettingsControllerForStore(settingsStore),
      async () => workspaceRoot
    );

    expect(invalid).not.toHaveProperty("activeThreadId");
    expect(invalid).not.toHaveProperty("activeThreadWorkspaceRoot");

    const empty = await handleUpdateRemoteSettingsIpc(
      trustedEvent(),
      { activeThreadId: "", workspaceSessionId: "session-1" },
      remoteSettingsControllerForStore(settingsStore),
      async () => workspaceRoot
    );

    expect(empty).not.toHaveProperty("activeThreadId");
    expect(empty).not.toHaveProperty("activeThreadWorkspaceRoot");
  });

  it("requires a valid workspace session for active-thread updates", async () => {
    const { handleUpdateRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const workspaceRoot = await tempDirectory("iliad-remote-ipc-workspace-");
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      relayDeviceId: "device-1",
      deviceSecret: "secret-1",
      boundWorkspaceRoot: workspaceRoot
    });

    await expect(
      handleUpdateRemoteSettingsIpc(
        trustedEvent(),
        { activeThreadId: "thread-1" },
        remoteSettingsControllerForStore(settingsStore),
        async () => workspaceRoot
      )
    ).rejects.toThrow("current Iliad workspace");
  });

  it("rejects active-thread updates for a workspace other than the bound remote workspace", async () => {
    const { handleUpdateRemoteSettingsIpc, remoteSettingsControllerForStore } = await import("../../electron/ipc/remote");
    const userData = await tempDirectory("iliad-remote-ipc-userdata-");
    const workspaceRoot = await tempDirectory("iliad-remote-ipc-workspace-");
    const otherWorkspaceRoot = await tempDirectory("iliad-remote-ipc-other-workspace-");
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      relayDeviceId: "device-1",
      deviceSecret: "secret-1",
      boundWorkspaceRoot: workspaceRoot
    });
    const relayClient = { sync: vi.fn(), clearPendingPairing: vi.fn(), revokePairing: vi.fn() };

    await expect(
      handleUpdateRemoteSettingsIpc(
        trustedEvent(),
        { activeThreadId: "thread-1", workspaceSessionId: "session-1" },
        remoteSettingsControllerForStore(settingsStore),
        async () => otherWorkspaceRoot,
        relayClient
      )
    ).rejects.toThrow("workspace bound to Telegram Remote Chat");
    expect(relayClient.sync).not.toHaveBeenCalled();
  });

  it("starts pairing through trusted IPC without exposing device secrets", async () => {
    const { handleStartRemotePairingIpc } = await import("../../electron/ipc/remote");
    const relayClient = {
      startPairing: vi.fn(async () => ({
        token: "pair-token",
        pairingSessionId: "pair-session",
        expiresAt: "2026-05-27T12:10:00.000Z",
        pairingUrl: "https://t.me/iliad_bot?start=pair-token",
        deviceSecret: "secret-1"
      }))
    };

    const response = await handleStartRemotePairingIpc(trustedEvent(), relayClient as never);

    expect(relayClient.startPairing).toHaveBeenCalled();
    expect(response).toEqual({
      token: "pair-token",
      pairingSessionId: "pair-session",
      expiresAt: "2026-05-27T12:10:00.000Z",
      pairingUrl: "https://t.me/iliad_bot?start=pair-token"
    });
    expect(response).not.toHaveProperty("deviceSecret");
  });

  it("rejects untrusted settings requests before touching the store", async () => {
    const {
      handleGetRemoteSettingsIpc,
      handleRevokeRemoteSettingsIpc,
      handleStartRemotePairingIpc,
      handleUpdateRemoteSettingsIpc
    } =
      await import("../../electron/ipc/remote");
    const event = {
      sender: {},
      senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
    } as never;
    const settingsStore = {
      settings: vi.fn(),
      updateSettings: vi.fn(),
      revokePairing: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue(null);

    await expect(handleGetRemoteSettingsIpc(event, settingsStore)).rejects.toThrow("untrusted window");
    await expect(handleUpdateRemoteSettingsIpc(event, { enabled: true }, settingsStore)).rejects.toThrow(
      "untrusted window"
    );
    await expect(handleRevokeRemoteSettingsIpc(event, settingsStore)).rejects.toThrow("untrusted window");
    await expect(handleStartRemotePairingIpc(event, { startPairing: vi.fn() })).rejects.toThrow("untrusted window");
    expect(settingsStore.settings).not.toHaveBeenCalled();
    expect(settingsStore.updateSettings).not.toHaveBeenCalled();
    expect(settingsStore.revokePairing).not.toHaveBeenCalled();
  });
});
