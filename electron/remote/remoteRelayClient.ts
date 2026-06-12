import type {
  DesktopToRelayMessage,
  RelayToDesktopMessage,
  RemotePairedTelegramChat,
  RemoteResponse,
  TelegramRemotePairingStartResponse,
  TelegramRemoteSettings,
  TelegramRemoteSettingsUpdate
} from "./remoteTypes.js";

export const TELEGRAM_RELAY_URL_MISSING_MESSAGE = "Set up a Telegram relay URL before pairing.";
export const TELEGRAM_RELAY_URL_UNSAFE_MESSAGE = "Set a secure Telegram relay URL before connecting.";
// Placeholder only. Deploy your own relay following relay/telegram/README.md,
// then set your relay URL in the app's remote settings.
export const DEFAULT_TELEGRAM_RELAY_URL = "https://your-relay.example.com";

const pairingStartPath = "api/pairing/start";
const pairingRevokePath = "api/pairing/revoke";
const desktopConnectPath = "api/desktop/connect";
const defaultMaxReconnectAttempts = 5;

type RelayFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<RelayFetchResponse>;

interface RelayFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export interface RelayWebSocketLike {
  readyState?: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  onopen?: (event: unknown) => void;
  onmessage?: (event: { data?: unknown }) => void;
  onclose?: (event: unknown) => void;
  onerror?: (event: unknown) => void;
}

export type RelayWebSocketConstructor = new (url: string) => RelayWebSocketLike;

type TimerHandle = unknown;
type SetTimer = (callback: () => void, delayMs: number) => TimerHandle;
type ClearTimer = (handle: TimerHandle) => void;

export interface TelegramRemoteRelayService {
  settings: () => Promise<TelegramRemoteSettings>;
  updateSettings: (update: TelegramRemoteSettingsUpdate) => Promise<TelegramRemoteSettings>;
  revokePairing: () => Promise<TelegramRemoteSettings>;
  handleRequest: (request: unknown) => Promise<RemoteResponse>;
}

export interface RemoteRelayClientOptions {
  remoteService: TelegramRemoteRelayService;
  getRelayUrl?: () => string | undefined;
  fetch?: RelayFetch;
  WebSocket?: RelayWebSocketConstructor;
  now?: () => Date;
  backoffDelayMs?: (attempt: number) => number;
  maxReconnectAttempts?: number;
  setTimeout?: SetTimer;
  clearTimeout?: ClearTimer;
}

export type TelegramRelayUrlResolution =
  | {
      ok: true;
      apiBaseUrl: string;
      pairingStartUrl: string;
      pairingRevokeUrl: string;
      desktopConnectUrl: string;
    }
  | {
      ok: false;
      reason: "missing" | "unsafe";
      message: string;
    };

interface PendingPairing {
  pairingSessionId: string;
  expiresAt: string;
}

export class RemoteRelayClient {
  private readonly remoteService: TelegramRemoteRelayService;
  private readonly getRelayUrl: () => string | undefined;
  private readonly fetch: RelayFetch | undefined;
  private readonly WebSocket: RelayWebSocketConstructor | undefined;
  private readonly now: () => Date;
  private readonly backoffDelayMs: (attempt: number) => number;
  private readonly maxReconnectAttempts: number;
  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;
  private pendingPairing: PendingPairing | null = null;
  private socket: RelayWebSocketLike | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private reconnectAttempt = 0;
  private connecting = false;
  private disposed = false;

  constructor(options: RemoteRelayClientOptions) {
    this.remoteService = options.remoteService;
    this.getRelayUrl = options.getRelayUrl ?? defaultTelegramRelayUrl;
    this.fetch = options.fetch ?? ((globalThis as { fetch?: RelayFetch }).fetch?.bind(globalThis) as RelayFetch | undefined);
    this.WebSocket =
      options.WebSocket ?? (globalThis as unknown as { WebSocket?: RelayWebSocketConstructor }).WebSocket;
    this.now = options.now ?? (() => new Date());
    this.backoffDelayMs = options.backoffDelayMs ?? defaultBackoffDelayMs;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? defaultMaxReconnectAttempts;
    this.setTimer = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start() {
    void this.sync();
  }

  dispose() {
    this.disposed = true;
    this.clearReconnectTimer();
    this.closeSocket();
  }

  clearPendingPairing() {
    this.pendingPairing = null;
  }

  async sync() {
    this.reconnectAttempt = 0;
    await this.refreshConnection();
  }

  async startPairing(): Promise<TelegramRemotePairingStartResponse> {
    const settings = await this.remoteService.settings();

    if (!settings.enabled || !settings.relayDeviceId || !settings.deviceSecret) {
      throw new Error("Enable Telegram Remote Chat before pairing.");
    }

    const relayUrl = relayUrlOrThrow(this.getRelayUrl(), "pairing");
    const payload = await this.postJson(relayUrl.pairingStartUrl, {
      deviceId: settings.relayDeviceId,
      deviceSecret: settings.deviceSecret
    });
    const pairing = normalizePairingStartResponse(payload);

    this.pendingPairing = {
      pairingSessionId: pairing.pairingSessionId,
      expiresAt: pairing.expiresAt
    };
    await this.remoteService.updateSettings({ lastError: null });
    await this.sync();

    return pairing;
  }

  async revokePairing(): Promise<TelegramRemoteSettings> {
    this.pendingPairing = null;
    const settings = await this.remoteService.settings();
    const relayUrl = resolveTelegramRelayUrl(this.getRelayUrl());

    if (!relayUrl.ok) {
      if (relayUrl.reason === "unsafe") {
        await this.recordError(TELEGRAM_RELAY_URL_UNSAFE_MESSAGE);
      }
    } else if (settings.relayDeviceId && settings.deviceSecret) {
      try {
        await this.postJson(relayUrl.pairingRevokeUrl, {
          deviceId: settings.relayDeviceId,
          deviceSecret: settings.deviceSecret
        });
      } catch {
        await this.recordError("Telegram relay revoke failed.");
      }
    }

    const updated = await this.remoteService.revokePairing();
    await this.sync();
    return updated;
  }

  private async refreshConnection() {
    if (this.disposed) {
      return;
    }

    const settings = await this.remoteService.settings();

    if (!settings.enabled) {
      this.pendingPairing = null;
      this.closeSocket();
      return;
    }

    const relayUrl = resolveTelegramRelayUrl(this.getRelayUrl());

    if (!relayUrl.ok) {
      this.closeSocket();

      if (relayUrl.reason === "unsafe") {
        await this.recordError(relayUrl.message);
      }

      return;
    }

    if (!settings.relayDeviceId || !settings.deviceSecret) {
      this.closeSocket();
      return;
    }

    if (this.socket && isSocketConnectingOrOpen(this.socket)) {
      return;
    }

    this.connect(relayUrl.desktopConnectUrl, settings);
  }

  private connect(url: string, settings: TelegramRemoteSettings) {
    if (!this.WebSocket) {
      void this.recordError("Telegram relay WebSocket support is unavailable in this build.");
      return;
    }

    this.clearReconnectTimer();
    this.connecting = true;

    const socket = new this.WebSocket(url);
    this.socket = socket;

    bindSocketEvent(socket, "open", () => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      this.connecting = false;
      this.reconnectAttempt = 0;
      this.sendSocketMessage(socket, {
        type: "desktop_auth",
        deviceId: settings.relayDeviceId,
        deviceSecret: settings.deviceSecret
      });
      void this.remoteService.updateSettings({
        lastConnectedAt: this.now().toISOString(),
        lastError: null
      });
    });
    bindSocketEvent(socket, "message", (event) => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      void this.handleSocketMessage(socket, event);
    });
    bindSocketEvent(socket, "error", () => {
      if (this.socket === socket && !this.disposed) {
        void this.recordError("Telegram relay connection failed.");
      }
    });
    bindSocketEvent(socket, "close", () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.connecting = false;
      this.scheduleReconnect();
    });
  }

  private async handleSocketMessage(socket: RelayWebSocketLike, event: unknown) {
    const message = parseSocketMessage(event);

    if (!message) {
      return;
    }

    if (message.type === "ping") {
      this.sendSocketMessage(socket, { type: "pong" });
      return;
    }

    if (message.type === "remote_request") {
      await this.handleRemoteRequest(socket, message.request);
      return;
    }

    if (message.type === "pairing_completed") {
      await this.handlePairingCompleted(message);
      return;
    }

    if (message.type === "pairing_revoked") {
      this.pendingPairing = null;
      await this.remoteService.revokePairing();
    }
  }

  private async handleRemoteRequest(socket: RelayWebSocketLike, request: unknown) {
    const response = await this.remoteService.handleRequest(request);
    this.sendSocketMessage(socket, {
      type: "remote_response",
      id: response.id,
      response
    });
  }

  private async handlePairingCompleted(message: Extract<RelayToDesktopMessage, { type: "pairing_completed" }>) {
    const pending = this.pendingPairing;

    if (!pending || message.pairingSessionId !== pending.pairingSessionId) {
      return;
    }

    const nowMs = this.now().getTime();
    const pendingExpiresAtMs = Date.parse(pending.expiresAt);
    const messageExpiresAtMs = Date.parse(message.expiresAt);

    if (
      !Number.isFinite(pendingExpiresAtMs) ||
      pendingExpiresAtMs <= nowMs ||
      !Number.isFinite(messageExpiresAtMs) ||
      messageExpiresAtMs <= nowMs
    ) {
      this.pendingPairing = null;
      return;
    }

    const chat = normalizePairedChat(message.chat);

    if (!chat) {
      return;
    }

    this.pendingPairing = null;
    await this.remoteService.updateSettings({
      pairedChat: chat,
      lastError: null
    });
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectAttempt >= this.maxReconnectAttempts) {
      return;
    }

    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      void this.refreshConnection();
    }, this.backoffDelayMs(attempt));
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connecting = false;

    if (socket) {
      try {
        socket.close(1000, "Iliad Telegram Remote Chat disconnected");
      } catch {
        // Ignore close failures from partially constructed test sockets.
      }
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async postJson(url: string, body: Record<string, string>) {
    if (!this.fetch) {
      throw new Error("Telegram relay HTTP support is unavailable in this build.");
    }

    let response: RelayFetchResponse;

    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch {
      await this.recordError("Telegram relay request failed.");
      throw new Error("Telegram relay request failed.");
    }

    if (!response.ok) {
      await this.recordError("Telegram relay request failed.");
      throw new Error(`Telegram relay request failed (${response.status}).`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error("Telegram relay returned an invalid response.");
    }
  }

  private sendSocketMessage(socket: RelayWebSocketLike, message: DesktopToRelayMessage) {
    if (this.socket !== socket || !isSocketOpen(socket)) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private async recordError(message: string) {
    try {
      await this.remoteService.updateSettings({
        lastError: {
          message,
          at: this.now().toISOString()
        }
      });
    } catch {
      // Last-error persistence must not make relay cleanup fail.
    }
  }
}

export function defaultTelegramRelayUrl() {
  return process.env.ILIAD_TELEGRAM_RELAY_URL?.trim() || DEFAULT_TELEGRAM_RELAY_URL;
}

export function resolveTelegramRelayUrl(rawUrl: string | undefined | null): TelegramRelayUrlResolution {
  const raw = typeof rawUrl === "string" ? rawUrl.trim() : "";

  if (!raw) {
    return {
      ok: false,
      reason: "missing",
      message: TELEGRAM_RELAY_URL_MISSING_MESSAGE
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return unsafeRelayUrl();
  }

  if (!["https:", "wss:", "http:", "ws:"].includes(parsed.protocol)) {
    return unsafeRelayUrl();
  }

  const isTls = parsed.protocol === "https:" || parsed.protocol === "wss:";

  if (!isTls && !isLocalDevelopmentHost(parsed.hostname)) {
    return unsafeRelayUrl();
  }

  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  const apiBase = new URL(parsed.href);
  apiBase.protocol = parsed.protocol === "wss:" ? "https:" : parsed.protocol === "ws:" ? "http:" : parsed.protocol;
  const wsBase = new URL(parsed.href);
  wsBase.protocol = parsed.protocol === "https:" ? "wss:" : parsed.protocol === "http:" ? "ws:" : parsed.protocol;

  return {
    ok: true,
    apiBaseUrl: withTrailingSlash(apiBase).toString(),
    pairingStartUrl: endpointUrl(apiBase, pairingStartPath),
    pairingRevokeUrl: endpointUrl(apiBase, pairingRevokePath),
    desktopConnectUrl: endpointUrl(wsBase, desktopConnectPath)
  };
}

function relayUrlOrThrow(rawUrl: string | undefined, action: "pairing") {
  const relayUrl = resolveTelegramRelayUrl(rawUrl);

  if (relayUrl.ok) {
    return relayUrl;
  }

  if (relayUrl.reason === "missing" && action === "pairing") {
    throw new Error(TELEGRAM_RELAY_URL_MISSING_MESSAGE);
  }

  throw new Error(TELEGRAM_RELAY_URL_UNSAFE_MESSAGE);
}

function unsafeRelayUrl(): TelegramRelayUrlResolution {
  return {
    ok: false,
    reason: "unsafe",
    message: TELEGRAM_RELAY_URL_UNSAFE_MESSAGE
  };
}

function endpointUrl(base: URL, relativePath: string) {
  return new URL(relativePath, withTrailingSlash(base)).toString();
}

function withTrailingSlash(url: URL) {
  const next = new URL(url.href);

  if (!next.pathname.endsWith("/")) {
    next.pathname = `${next.pathname}/`;
  }

  return next;
}

function isLocalDevelopmentHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function defaultBackoffDelayMs(attempt: number) {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
}

function bindSocketEvent(socket: RelayWebSocketLike, type: string, listener: (event: unknown) => void) {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener);
    return;
  }

  if (type === "open") {
    socket.onopen = listener;
    return;
  }

  if (type === "message") {
    socket.onmessage = listener as (event: { data?: unknown }) => void;
    return;
  }

  if (type === "close") {
    socket.onclose = listener;
    return;
  }

  if (type === "error") {
    socket.onerror = listener;
  }
}

function parseSocketMessage(event: unknown): RelayToDesktopMessage | null {
  const data = isRecord(event) ? event.data : undefined;
  const text = socketDataText(data);

  if (!text) {
    return null;
  }

  try {
    const message = JSON.parse(text) as unknown;
    return isRecord(message) && typeof message.type === "string" ? (message as RelayToDesktopMessage) : null;
  } catch {
    return null;
  }
}

function socketDataText(data: unknown) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  return null;
}

function normalizePairingStartResponse(payload: unknown): TelegramRemotePairingStartResponse {
  const source = isRecord(payload) ? payload : {};
  const token = stringValue(source.token);
  const pairingSessionId = stringValue(source.pairingSessionId);
  const expiresAt = stringValue(source.expiresAt);

  if (!token || !pairingSessionId || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("Telegram relay returned an invalid pairing response.");
  }

  return {
    token,
    pairingSessionId,
    expiresAt,
    ...(typeof source.pairingUrl === "string" && source.pairingUrl.trim()
      ? { pairingUrl: source.pairingUrl.trim() }
      : {})
  };
}

function normalizePairedChat(input: unknown): RemotePairedTelegramChat | null {
  const source = isRecord(input) ? input : {};
  const chatId = stringValue(source.chatId);

  if (!chatId) {
    return null;
  }

  const pairedAt = stringValue(source.pairedAt) || new Date().toISOString();

  return {
    chatId,
    ...(stringValue(source.username) ? { username: stringValue(source.username) } : {}),
    ...(stringValue(source.displayName) ? { displayName: stringValue(source.displayName) } : {}),
    pairedAt
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isSocketConnectingOrOpen(socket: RelayWebSocketLike) {
  return socket.readyState === undefined || socket.readyState === 0 || socket.readyState === 1;
}

function isSocketOpen(socket: RelayWebSocketLike) {
  return socket.readyState === undefined || socket.readyState === 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
