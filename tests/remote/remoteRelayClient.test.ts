import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TELEGRAM_RELAY_URL,
  RemoteRelayClient,
  TELEGRAM_RELAY_URL_MISSING_MESSAGE,
  TELEGRAM_RELAY_URL_UNSAFE_MESSAGE,
  defaultTelegramRelayUrl,
  resolveTelegramRelayUrl,
  type RemoteRelayClientOptions,
  type RelayWebSocketLike,
  type TelegramRemoteRelayService
} from "../../electron/remote/remoteRelayClient";
import {
  TELEGRAM_REMOTE_REQUEST_VERSION,
  type RemoteResponse,
  type TelegramRemoteSettings,
  type TelegramRemoteSettingsUpdate
} from "../../electron/remote/remoteTypes";

const now = new Date("2026-05-27T12:00:00.000Z");
const future = new Date(now.getTime() + 10 * 60_000).toISOString();
const past = new Date(now.getTime() - 1_000).toISOString();

beforeEach(() => {
  FakeWebSocket.instances = [];
  delete process.env.ILIAD_TELEGRAM_RELAY_URL;
});

describe("RemoteRelayClient", () => {
  it("uses the deployed relay by default and allows an environment override", () => {
    expect(defaultTelegramRelayUrl()).toBe(DEFAULT_TELEGRAM_RELAY_URL);
    const expectedConnectUrl = `${DEFAULT_TELEGRAM_RELAY_URL.replace(/^https:/, "wss:")}/api/desktop/connect`;
    expect(resolveTelegramRelayUrl(defaultTelegramRelayUrl())).toMatchObject({
      ok: true,
      pairingStartUrl: `${DEFAULT_TELEGRAM_RELAY_URL}/api/pairing/start`,
      desktopConnectUrl: expectedConnectUrl
    });

    process.env.ILIAD_TELEGRAM_RELAY_URL = "https://staging-relay.example.com";

    expect(defaultTelegramRelayUrl()).toBe("https://staging-relay.example.com");
  });

  it("stays disconnected when remote chat is disabled or no relay URL is configured", async () => {
    const harness = createHarness({ enabled: false });
    const fetchMock = vi.fn();
    const client = relayClient(harness.service, {
      getRelayUrl: () => "https://relay.example.com",
      fetch: fetchMock as never
    });

    await client.sync();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    harness.setSettings({ enabled: true });
    const missingUrlClient = relayClient(harness.service, {
      getRelayUrl: () => "",
      fetch: fetchMock as never
    });
    await missingUrlClient.sync();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed and non-TLS relay URLs before sending device credentials", async () => {
    const harness = createHarness();
    const fetchMock = vi.fn();

    await expect(
      relayClient(harness.service, {
        getRelayUrl: () => "not a url",
        fetch: fetchMock as never
      }).startPairing()
    ).rejects.toThrow(TELEGRAM_RELAY_URL_UNSAFE_MESSAGE);
    await expect(
      relayClient(harness.service, {
        getRelayUrl: () => "http://relay.example.com",
        fetch: fetchMock as never
      }).startPairing()
    ).rejects.toThrow(TELEGRAM_RELAY_URL_UNSAFE_MESSAGE);
    await expect(
      relayClient(harness.service, {
        getRelayUrl: () => "",
        fetch: fetchMock as never
      }).startPairing()
    ).rejects.toThrow(TELEGRAM_RELAY_URL_MISSING_MESSAGE);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows localhost development URLs", async () => {
    expect(resolveTelegramRelayUrl("http://localhost:8787")).toMatchObject({
      ok: true,
      pairingStartUrl: "http://localhost:8787/api/pairing/start",
      desktopConnectUrl: "ws://localhost:8787/api/desktop/connect"
    });
    expect(resolveTelegramRelayUrl("ws://127.0.0.1:8787")).toMatchObject({
      ok: true,
      pairingStartUrl: "http://127.0.0.1:8787/api/pairing/start",
      desktopConnectUrl: "ws://127.0.0.1:8787/api/desktop/connect"
    });
    expect(resolveTelegramRelayUrl("http://[::1]:8787")).toMatchObject({
      ok: true,
      pairingStartUrl: "http://[::1]:8787/api/pairing/start",
      desktopConnectUrl: "ws://[::1]:8787/api/desktop/connect"
    });
  });

  it("starts pairing with device credentials but returns only renderer-safe token metadata", async () => {
    const harness = createHarness();
    const fetchMock = pairingFetch({
      token: "pair-token",
      pairingSessionId: "pair-session",
      expiresAt: future,
      pairingUrl: "https://t.me/iliad_bot?start=pair-token",
      deviceSecret: "leaked-secret"
    });
    const client = relayClient(harness.service, {
      fetch: fetchMock
    });

    const response = await client.startPairing();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example.com/api/pairing/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          deviceId: "device-1",
          deviceSecret: "secret-1"
        })
      })
    );
    expect(response).toEqual({
      token: "pair-token",
      pairingSessionId: "pair-session",
      expiresAt: future,
      pairingUrl: "https://t.me/iliad_bot?start=pair-token"
    });
    expect(response).not.toHaveProperty("deviceSecret");
  });

  it("authenticates the websocket, handles ping, and routes remote requests through TelegramRemoteService", async () => {
    const harness = createHarness();
    const client = relayClient(harness.service);

    await client.sync();
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("wss://relay.example.com/api/desktop/connect");

    socket.open();
    expect(socket.sent[0]).toEqual({
      type: "desktop_auth",
      deviceId: "device-1",
      deviceSecret: "secret-1"
    });

    socket.receive({ type: "ping" });
    expect(socket.sent[1]).toEqual({ type: "pong" });

    const request = {
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      id: "status-1",
      type: "status",
      chatId: "chat-1",
      createdAt: now.toISOString(),
      deadlineAt: future
    };
    socket.receive({ type: "remote_request", request });

    await waitFor(() => socket.sent.some((message) => message.type === "remote_response"));

    expect(harness.service.handleRequest).toHaveBeenCalledWith(request);
    expect(socket.sent[2]).toEqual({
      type: "remote_response",
      id: "status-1",
      response: expect.objectContaining({
        id: "status-1",
        ok: true
      })
    });
  });

  it("applies pairing_completed only for the pending, unexpired pairing session", async () => {
    const harness = createHarness();
    const client = relayClient(harness.service, {
      fetch: pairingFetch({
        token: "pair-token",
        pairingSessionId: "pair-session",
        expiresAt: future
      })
    });

    await client.sync();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({
      type: "pairing_completed",
      pairingSessionId: "unsolicited",
      chat: pairedChat("wrong-chat"),
      expiresAt: future
    });
    await flush();
    expect(harness.current.pairedChat).toBeNull();

    await client.startPairing();
    socket.receive({
      type: "pairing_completed",
      pairingSessionId: "other-session",
      chat: pairedChat("wrong-chat"),
      expiresAt: future
    });
    await flush();
    expect(harness.current.pairedChat).toBeNull();

    socket.receive({
      type: "pairing_completed",
      pairingSessionId: "pair-session",
      chat: pairedChat("chat-1"),
      expiresAt: future
    });
    await waitFor(() => harness.current.pairedChat?.chatId === "chat-1");

    expect(harness.current.pairedChat).toMatchObject({
      chatId: "chat-1",
      username: "sebastian"
    });
  });

  it("ignores expired pairing_completed messages", async () => {
    const harness = createHarness();
    const client = relayClient(harness.service, {
      fetch: pairingFetch({
        token: "pair-token",
        pairingSessionId: "pair-session",
        expiresAt: past
      })
    });

    await client.sync();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    await client.startPairing();
    socket.receive({
      type: "pairing_completed",
      pairingSessionId: "pair-session",
      chat: pairedChat("chat-1"),
      expiresAt: future
    });
    await flush();

    expect(harness.current.pairedChat).toBeNull();
  });

  it("clears local pairing through the service path when the relay revokes pairing", async () => {
    const harness = createHarness({
      pairedChat: pairedChat("chat-1")
    });
    const client = relayClient(harness.service);

    await client.sync();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "pairing_revoked" });

    await waitFor(() => harness.current.pairedChat === null);

    expect(harness.service.revokePairing).toHaveBeenCalled();
  });

  it("clears local pairing when desktop revoke cannot reach the relay", async () => {
    const harness = createHarness({
      pairedChat: pairedChat("chat-1")
    });
    const client = relayClient(harness.service, {
      fetch: vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "unavailable" })
      }))
    });

    await expect(client.revokePairing()).resolves.toMatchObject({
      pairedChat: null
    });

    expect(harness.current.pairedChat).toBeNull();
    expect(harness.service.revokePairing).toHaveBeenCalled();
    expect(harness.current.lastError?.message).toBe("Telegram relay revoke failed.");
  });

  it("clears local pairing on revoke without sending credentials to unsafe relay URLs", async () => {
    const harness = createHarness({
      pairedChat: pairedChat("chat-1")
    });
    const fetchMock = vi.fn();
    const client = relayClient(harness.service, {
      getRelayUrl: () => "http://relay.example.com",
      fetch: fetchMock as never
    });

    await expect(client.revokePairing()).resolves.toMatchObject({
      pairedChat: null
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.current.pairedChat).toBeNull();
    expect(harness.current.lastError?.message).toBe(TELEGRAM_RELAY_URL_UNSAFE_MESSAGE);
  });
});

class FakeWebSocket implements RelayWebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen?: (event: unknown) => void;
  onmessage?: (event: { data?: unknown }) => void;
  onclose?: (event: unknown) => void;
  onerror?: (event: unknown) => void;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as unknown);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function relayClient(service: TelegramRemoteRelayService, options: Partial<RemoteRelayClientOptions> = {}) {
  return new RemoteRelayClient({
    remoteService: service,
    getRelayUrl: () => "https://relay.example.com",
    WebSocket: FakeWebSocket,
    now: () => now,
    backoffDelayMs: () => 1,
    ...options
  });
}

function pairingFetch(payload: Record<string, unknown>): RemoteRelayClientOptions["fetch"] {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload
  }));
}

function createHarness(overrides: Partial<TelegramRemoteSettings> = {}) {
  let current: TelegramRemoteSettings = {
    enabled: true,
    relayDeviceId: "device-1",
    deviceSecret: "secret-1",
    pairedChat: null,
    boundWorkspaceRoot: "/workspace",
    updatedAt: now.toISOString(),
    ...overrides
  };

  const service: TelegramRemoteRelayService = {
    settings: vi.fn(async () => current),
    updateSettings: vi.fn(async (update: TelegramRemoteSettingsUpdate) => {
      current = {
        ...current,
        ...update,
        pairedChat: update.pairedChat !== undefined ? update.pairedChat : current.pairedChat,
        updatedAt: now.toISOString()
      };
      return current;
    }),
    revokePairing: vi.fn(async () => {
      current = {
        ...current,
        pairedChat: null,
        updatedAt: now.toISOString()
      };
      return current;
    }),
    handleRequest: vi.fn(async (request: unknown) => statusResponse(requestId(request)))
  };

  return {
    service,
    get current() {
      return current;
    },
    setSettings(update: Partial<TelegramRemoteSettings>) {
      current = { ...current, ...update };
    }
  };
}

function statusResponse(id: string): RemoteResponse {
  return {
    version: TELEGRAM_REMOTE_REQUEST_VERSION,
    id,
    ok: true,
    type: "status",
    desktopOnline: true,
    workspaceLabel: "Workspace",
    remoteChatEnabled: true
  };
}

function requestId(request: unknown) {
  return typeof request === "object" &&
    request !== null &&
    !Array.isArray(request) &&
    typeof (request as { id?: unknown }).id === "string"
    ? (request as { id: string }).id
    : "remote-request";
}

function pairedChat(chatId: string) {
  return {
    chatId,
    username: "sebastian",
    displayName: "Sebastian",
    pairedAt: now.toISOString()
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) {
      return;
    }

    await flush();
  }

  throw new Error("Timed out waiting for condition.");
}
