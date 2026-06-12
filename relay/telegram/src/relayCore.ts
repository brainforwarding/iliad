import { hashCredential, randomBase64Url, verifyCredential } from "./crypto.js";
import {
  TELEGRAM_PAIRING_TOKEN_TTL_MS,
  TELEGRAM_REMOTE_REQUEST_TIMEOUT_MS,
  TELEGRAM_REMOTE_REQUEST_VERSION,
  isDesktopAuthMessage,
  isDesktopRelayMessage,
  type DesktopToRelayMessage,
  type PairingRevokeRequest,
  type PairingStartRequest,
  type PairingStartResponse,
  type RelayToDesktopMessage,
  type RemoteRequest,
  type RemoteResponse,
  type TelegramMessage,
  type TelegramUpdate
} from "./protocol.js";
import { FixedWindowRateLimiter, type RateLimitName } from "./rateLimit.js";
import {
  TELEGRAM_MESSAGES,
  chatIdForMessage,
  chatMetadataForMessage,
  chunkTelegramText,
  dedupeKeyForUpdate,
  formatRemoteResponse,
  isPrivateMessage,
  parseTelegramAction,
  updateMessage,
  type TelegramSender
} from "./telegram.js";

export interface StoredPendingPairing {
  tokenHash: string;
  pairingSessionId: string;
  expiresAt: string;
  createdAt: string;
}

export interface StoredActiveRequest {
  id: string;
  chatId: string;
  type: RemoteRequest["type"];
  createdAt: string;
  deadlineAt: string;
}

export interface StoredPairedTelegramChat {
  chatId: string;
  username?: string;
  displayName?: string;
  pairedAt: string;
}

export interface StoredDevice {
  deviceId: string;
  secretHash: string;
  pairedChat: StoredPairedTelegramChat | null;
  pendingPairing: StoredPendingPairing | null;
  activeRequest: StoredActiveRequest | null;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface DedupeRecord {
  key: string;
  expiresAt: string;
}

export interface RelayStorage {
  getDevice(deviceId: string): Promise<StoredDevice | null>;
  putDevice(device: StoredDevice): Promise<void>;
  listDevices(): Promise<StoredDevice[]>;
  getDedupe(key: string): Promise<DedupeRecord | null>;
  putDedupe(record: DedupeRecord): Promise<void>;
  deleteExpiredDedupe?(now: Date): Promise<void>;
}

export interface DesktopSession {
  id: string;
  send(message: RelayToDesktopMessage): void | Promise<void>;
  close?(code?: number, reason?: string): void;
}

export interface DesktopSessionRegistry {
  get(deviceId: string): DesktopSession | undefined;
  set(deviceId: string, session: DesktopSession): void;
  delete(deviceId: string, sessionId?: string): void;
}

export interface RelayCoreOptions {
  storage: RelayStorage;
  telegram: TelegramSender;
  now?: () => Date;
  randomToken?: (byteLength: number) => string | Promise<string>;
  sessions?: DesktopSessionRegistry;
  rateLimiter?: FixedWindowRateLimiter;
  botUsername?: string;
  requestTimeoutMs?: number;
  pairingTokenTtlMs?: number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "relay_error"
  ) {
    super(message);
  }
}

export class InMemoryRelayStorage implements RelayStorage {
  private readonly devices = new Map<string, StoredDevice>();
  private readonly dedupe = new Map<string, DedupeRecord>();

  async getDevice(deviceId: string): Promise<StoredDevice | null> {
    return clone(this.devices.get(deviceId) ?? null);
  }

  async putDevice(device: StoredDevice): Promise<void> {
    this.devices.set(device.deviceId, clone(device));
  }

  async listDevices(): Promise<StoredDevice[]> {
    return clone(Array.from(this.devices.values()));
  }

  async getDedupe(key: string): Promise<DedupeRecord | null> {
    return clone(this.dedupe.get(key) ?? null);
  }

  async putDedupe(record: DedupeRecord): Promise<void> {
    this.dedupe.set(record.key, clone(record));
  }

  async deleteExpiredDedupe(now: Date): Promise<void> {
    for (const [key, record] of this.dedupe.entries()) {
      if (Date.parse(record.expiresAt) <= now.getTime()) {
        this.dedupe.delete(key);
      }
    }
  }

  dump() {
    return clone({
      devices: Array.from(this.devices.values()),
      dedupe: Array.from(this.dedupe.values())
    });
  }
}

export class InMemoryDesktopSessionRegistry implements DesktopSessionRegistry {
  private readonly sessions = new Map<string, DesktopSession>();

  get(deviceId: string): DesktopSession | undefined {
    return this.sessions.get(deviceId);
  }

  set(deviceId: string, session: DesktopSession): void {
    const previous = this.sessions.get(deviceId);

    if (previous && previous.id !== session.id) {
      previous.close?.(4000, "replaced");
    }

    this.sessions.set(deviceId, session);
  }

  delete(deviceId: string, sessionId?: string): void {
    const current = this.sessions.get(deviceId);

    if (!current || (sessionId && current.id !== sessionId)) {
      return;
    }

    this.sessions.delete(deviceId);
  }
}

export class RelayCore {
  private readonly storage: RelayStorage;
  private readonly telegram: TelegramSender;
  private readonly now: () => Date;
  private readonly randomToken: (byteLength: number) => string | Promise<string>;
  private readonly sessions: DesktopSessionRegistry;
  private readonly rateLimiter: FixedWindowRateLimiter;
  private readonly botUsername?: string;
  private readonly requestTimeoutMs: number;
  private readonly pairingTokenTtlMs: number;
  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly timeoutHandles = new Map<string, unknown>();

  constructor(options: RelayCoreOptions) {
    this.storage = options.storage;
    this.telegram = options.telegram;
    this.now = options.now ?? (() => new Date());
    this.randomToken = options.randomToken ?? ((byteLength) => randomBase64Url(byteLength));
    this.sessions = options.sessions ?? new InMemoryDesktopSessionRegistry();
    this.rateLimiter = options.rateLimiter ?? new FixedWindowRateLimiter();
    this.botUsername = normalizeBotUsername(options.botUsername);
    this.requestTimeoutMs = options.requestTimeoutMs ?? TELEGRAM_REMOTE_REQUEST_TIMEOUT_MS;
    this.pairingTokenTtlMs = options.pairingTokenTtlMs ?? TELEGRAM_PAIRING_TOKEN_TTL_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  async startPairing(input: unknown, sourceKey = "unknown"): Promise<PairingStartResponse> {
    const body = normalizePairingRequest(input);
    const now = this.now();

    this.assertRateLimit("pairingStart", `${sourceKey}:${body.deviceId}`, now);

    let device = await this.storage.getDevice(body.deviceId);

    if (device) {
      await this.cleanupExpiredDeviceState(device, now, false);

      if (!(await verifyCredential(body.deviceSecret, device.secretHash, "device-secret"))) {
        throw new RelayHttpError(401, "Invalid device credentials.", "invalid_device_secret");
      }

      if (device.pairedChat) {
        throw new RelayHttpError(409, "This device is already paired.", "already_paired");
      }
    } else {
      device = {
        deviceId: body.deviceId,
        secretHash: await hashCredential(body.deviceSecret, { namespace: "device-secret" }),
        pairedChat: null,
        pendingPairing: null,
        activeRequest: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
    }

    const token = await this.randomToken(32);
    const pairingSessionId = `pair_${await this.randomToken(18)}`;
    const expiresAt = new Date(now.getTime() + this.pairingTokenTtlMs).toISOString();

    device.pendingPairing = {
      tokenHash: await hashCredential(token, { namespace: "pairing-token" }),
      pairingSessionId,
      expiresAt,
      createdAt: now.toISOString()
    };
    device.updatedAt = now.toISOString();

    await this.storage.putDevice(device);

    return {
      token,
      pairingSessionId,
      expiresAt,
      ...(this.botUsername ? { pairingUrl: `https://t.me/${this.botUsername}?start=${encodeURIComponent(token)}` } : {})
    };
  }

  async revokePairing(input: unknown, sourceKey = "unknown"): Promise<{ ok: true }> {
    const body = normalizePairingRequest(input);
    const device = await this.storage.getDevice(body.deviceId);

    if (!device || !(await verifyCredential(body.deviceSecret, device.secretHash, "device-secret"))) {
      this.assertRateLimit("badRevokeAuth", `${sourceKey}:${body.deviceId}`, this.now());
      throw new RelayHttpError(401, "Invalid device credentials.", "invalid_device_secret");
    }

    await this.clearPairing(device, "desktop");
    return { ok: true };
  }

  async authenticateDesktopSession(input: unknown, session: DesktopSession, sourceKey = "unknown"): Promise<{ ok: true; deviceId: string }> {
    if (!isDesktopAuthMessage(input)) {
      this.assertRateLimit("badWebSocketAuth", `${sourceKey}:malformed`, this.now());
      throw new RelayHttpError(401, "Desktop authentication is required.", "desktop_auth_required");
    }

    const body = normalizePairingRequest(input);
    const device = await this.storage.getDevice(body.deviceId);

    if (!device || !(await verifyCredential(body.deviceSecret, device.secretHash, "device-secret"))) {
      this.assertRateLimit("badWebSocketAuth", `${sourceKey}:${body.deviceId}`, this.now());
      throw new RelayHttpError(401, "Invalid device credentials.", "invalid_device_secret");
    }

    this.sessions.set(body.deviceId, session);
    return { ok: true, deviceId: body.deviceId };
  }

  disconnectDesktop(deviceId: string, sessionId?: string): void {
    this.sessions.delete(deviceId, sessionId);
  }

  async handleDesktopMessage(deviceId: string, input: unknown): Promise<{ accepted: boolean }> {
    if (!isDesktopRelayMessage(input)) {
      return { accepted: false };
    }

    if (input.type === "desktop_auth" || input.type === "pong") {
      return { accepted: true };
    }

    return this.handleRemoteResponse(deviceId, input);
  }

  async handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
    const message = updateMessage(update);

    if (!message) {
      return;
    }

    const duplicate = await this.isDuplicate(update);

    if (duplicate) {
      this.rateLimiter.consume("duplicateWebhook", duplicate, this.now().getTime());
      return;
    }

    if (!isPrivateMessage(message)) {
      await this.telegram.sendMessage(chatIdForMessage(message), TELEGRAM_MESSAGES.groupRejected);
      return;
    }

    const action = parseTelegramAction(message);

    if (action.type === "help") {
      await this.telegram.sendMessage(chatIdForMessage(message), TELEGRAM_MESSAGES.help);
      return;
    }

    if (action.type === "pair") {
      await this.completePairing(message, action.token);
      return;
    }

    if (action.type === "unlink") {
      await this.unlinkChat(message);
      return;
    }

    if (action.type === "status") {
      await this.routeTelegramRequest(message, { type: "status" });
      return;
    }

    if (!action.text.trim()) {
      await this.telegram.sendMessage(chatIdForMessage(message), TELEGRAM_MESSAGES.askUsage);
      return;
    }

    await this.routeTelegramRequest(message, { type: "ask", text: action.text.trim() });
  }

  async sweepTimeouts(): Promise<void> {
    const devices = await this.storage.listDevices();
    const now = this.now();

    for (const device of devices) {
      await this.cleanupExpiredDeviceState(device, now, true);
    }
  }

  private async completePairing(message: TelegramMessage, token: string): Promise<void> {
    const now = this.now();
    const devices = await this.storage.listDevices();

    for (const device of devices) {
      await this.cleanupExpiredDeviceState(device, now, false);
      const pending = device.pendingPairing;

      if (!pending || Date.parse(pending.expiresAt) <= now.getTime()) {
        continue;
      }

      if (!(await verifyCredential(token, pending.tokenHash, "pairing-token"))) {
        continue;
      }

      if (device.pairedChat) {
        await this.telegram.sendMessage(chatIdForMessage(message), TELEGRAM_MESSAGES.tokenExpired);
        return;
      }

      const chat = chatMetadataForMessage(message, now.toISOString());
      device.pairedChat = chat;
      device.pendingPairing = null;
      device.updatedAt = now.toISOString();
      await this.storage.putDevice(device);

      await this.telegram.sendMessage(chat.chatId, TELEGRAM_MESSAGES.paired);
      await this.sessions.get(device.deviceId)?.send({
        type: "pairing_completed",
        pairingSessionId: pending.pairingSessionId,
        chat,
        expiresAt: pending.expiresAt
      });
      return;
    }

    await this.telegram.sendMessage(chatIdForMessage(message), TELEGRAM_MESSAGES.tokenExpired);
  }

  private async unlinkChat(message: TelegramMessage): Promise<void> {
    const device = await this.findDeviceByChatId(chatIdForMessage(message));

    if (!device) {
      await this.applyUnpairedRateLimit(message);
      return;
    }

    await this.clearPairing(device, "telegram");
    await this.telegram.sendMessage(chatIdForMessage(message), TELEGRAM_MESSAGES.unlinked);
  }

  private async routeTelegramRequest(
    message: TelegramMessage,
    requestInput: { type: "status" } | { type: "ask"; text: string }
  ): Promise<void> {
    const chatId = chatIdForMessage(message);
    const device = await this.findDeviceByChatId(chatId);

    if (!device) {
      await this.applyUnpairedRateLimit(message);
      return;
    }

    const now = this.now();
    const rateName: RateLimitName = requestInput.type === "ask" ? "ask" : "status";
    const rate = this.rateLimiter.consume(rateName, `${device.deviceId}:${chatId}`, now.getTime());

    if (!rate.allowed) {
      await this.telegram.sendMessage(chatId, TELEGRAM_MESSAGES.rateLimited);
      return;
    }

    await this.cleanupExpiredDeviceState(device, now, true);

    if (device.activeRequest) {
      await this.telegram.sendMessage(chatId, TELEGRAM_MESSAGES.busy);
      return;
    }

    const session = this.sessions.get(device.deviceId);

    if (!session) {
      await this.telegram.sendMessage(chatId, TELEGRAM_MESSAGES.offline);
      return;
    }

    const id = `req_${await this.randomToken(18)}`;
    const createdAt = now.toISOString();
    const deadlineAt = new Date(now.getTime() + this.requestTimeoutMs).toISOString();
    const request: RemoteRequest =
      requestInput.type === "status"
        ? {
            version: TELEGRAM_REMOTE_REQUEST_VERSION,
            id,
            type: "status",
            chatId,
            createdAt,
            deadlineAt
          }
        : {
            version: TELEGRAM_REMOTE_REQUEST_VERSION,
            id,
            type: "ask",
            chatId,
            createdAt,
            deadlineAt,
            text: requestInput.text
          };

    device.activeRequest = {
      id,
      chatId,
      type: request.type,
      createdAt,
      deadlineAt
    };
    device.updatedAt = createdAt;
    await this.storage.putDevice(device);

    try {
      await session.send({ type: "remote_request", request });
      this.scheduleTimeout(device.deviceId, id, deadlineAt);
    } catch {
      this.clearTimeout(device.deviceId, id);
      device.activeRequest = null;
      device.updatedAt = this.now().toISOString();
      await this.storage.putDevice(device);
      this.sessions.delete(device.deviceId, session.id);
      await this.telegram.sendMessage(chatId, TELEGRAM_MESSAGES.offline);
    }
  }

  private async handleRemoteResponse(
    deviceId: string,
    input: Extract<DesktopToRelayMessage, { type: "remote_response" }>
  ): Promise<{ accepted: boolean }> {
    const device = await this.storage.getDevice(deviceId);
    const active = device?.activeRequest;

    if (!device || !active || input.id !== active.id || input.response.id !== active.id) {
      return { accepted: false };
    }

    if (isExpiredDeadline(active.deadlineAt, this.now())) {
      this.clearTimeout(deviceId, active.id);
      device.activeRequest = null;
      device.updatedAt = this.now().toISOString();
      await this.storage.putDevice(device);

      if (device.pairedChat?.chatId === active.chatId) {
        await this.telegram.sendMessage(active.chatId, TELEGRAM_MESSAGES.timeout);
      }

      return { accepted: false };
    }

    this.clearTimeout(deviceId, active.id);
    device.activeRequest = null;
    device.updatedAt = this.now().toISOString();
    await this.storage.putDevice(device);

    if (!device.pairedChat || device.pairedChat.chatId !== active.chatId) {
      return { accepted: false };
    }

    for (const chunk of formatRemoteResponse(input.response)) {
      await this.telegram.sendMessage(active.chatId, chunk);
    }

    return { accepted: true };
  }

  private async clearPairing(device: StoredDevice, _source: "desktop" | "telegram"): Promise<void> {
    this.clearAnyTimeout(device);
    device.pairedChat = null;
    device.pendingPairing = null;
    device.activeRequest = null;
    device.revokedAt = this.now().toISOString();
    device.updatedAt = device.revokedAt;
    await this.storage.putDevice(device);
    await this.sessions.get(device.deviceId)?.send({ type: "pairing_revoked" });
  }

  private async findDeviceByChatId(chatId: string): Promise<StoredDevice | null> {
    const devices = await this.storage.listDevices();

    for (const device of devices) {
      if (device.pairedChat?.chatId === chatId) {
        return device;
      }
    }

    return null;
  }

  private async isDuplicate(update: TelegramUpdate): Promise<string | null> {
    const key = dedupeKeyForUpdate(update);

    if (!key) {
      return null;
    }

    const now = this.now();
    await this.storage.deleteExpiredDedupe?.(now);
    const existing = await this.storage.getDedupe(key);

    if (existing && Date.parse(existing.expiresAt) > now.getTime()) {
      return key;
    }

    await this.storage.putDedupe({
      key,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    });
    return null;
  }

  private async applyUnpairedRateLimit(message: TelegramMessage): Promise<void> {
    const chatId = chatIdForMessage(message);
    const rate = this.rateLimiter.consume("unpaired", chatId, this.now().getTime());
    await this.telegram.sendMessage(chatId, rate.allowed ? TELEGRAM_MESSAGES.unpaired : TELEGRAM_MESSAGES.rateLimited);
  }

  private async cleanupExpiredDeviceState(device: StoredDevice, now: Date, sendTimeoutMessage: boolean): Promise<void> {
    let changed = false;

    if (device.pendingPairing && Date.parse(device.pendingPairing.expiresAt) <= now.getTime()) {
      device.pendingPairing = null;
      changed = true;
    }

    if (device.activeRequest && Date.parse(device.activeRequest.deadlineAt) <= now.getTime()) {
      const expired = device.activeRequest;
      this.clearTimeout(device.deviceId, expired.id);
      device.activeRequest = null;
      changed = true;

      if (sendTimeoutMessage && device.pairedChat?.chatId === expired.chatId) {
        await this.telegram.sendMessage(expired.chatId, TELEGRAM_MESSAGES.timeout);
      }
    }

    if (changed) {
      device.updatedAt = now.toISOString();
      await this.storage.putDevice(device);
    }
  }

  private scheduleTimeout(deviceId: string, requestId: string, deadlineAt: string): void {
    this.clearTimeout(deviceId, requestId);
    const delayMs = Math.max(0, Date.parse(deadlineAt) - this.now().getTime());
    const key = activeTimeoutKey(deviceId, requestId);
    const handle = this.setTimeoutFn(() => {
      void this.timeoutActiveRequest(deviceId, requestId);
    }, delayMs);
    this.timeoutHandles.set(key, handle);
  }

  private async timeoutActiveRequest(deviceId: string, requestId: string): Promise<void> {
    this.timeoutHandles.delete(activeTimeoutKey(deviceId, requestId));
    const device = await this.storage.getDevice(deviceId);

    if (!device?.activeRequest || device.activeRequest.id !== requestId) {
      return;
    }

    const chatId = device.activeRequest.chatId;
    device.activeRequest = null;
    device.updatedAt = this.now().toISOString();
    await this.storage.putDevice(device);

    if (device.pairedChat?.chatId === chatId) {
      await this.telegram.sendMessage(chatId, TELEGRAM_MESSAGES.timeout);
    }
  }

  private clearAnyTimeout(device: StoredDevice): void {
    if (device.activeRequest) {
      this.clearTimeout(device.deviceId, device.activeRequest.id);
    }
  }

  private clearTimeout(deviceId: string, requestId: string): void {
    const key = activeTimeoutKey(deviceId, requestId);
    const handle = this.timeoutHandles.get(key);

    if (handle) {
      this.clearTimeoutFn(handle);
      this.timeoutHandles.delete(key);
    }
  }

  private assertRateLimit(name: RateLimitName, key: string, now: Date): void {
    const rate = this.rateLimiter.consume(name, key, now.getTime());

    if (!rate.allowed) {
      throw new RelayHttpError(429, "Too many requests. Try again shortly.", "rate_limited");
    }
  }
}

function normalizePairingRequest(input: unknown): PairingStartRequest & PairingRevokeRequest {
  if (!input || typeof input !== "object") {
    throw new RelayHttpError(400, "Expected a JSON object.", "bad_request");
  }

  const candidate = input as Partial<PairingStartRequest>;
  const deviceId = typeof candidate.deviceId === "string" ? candidate.deviceId.trim() : "";
  const deviceSecret = typeof candidate.deviceSecret === "string" ? candidate.deviceSecret.trim() : "";

  if (deviceId.length < 3 || deviceId.length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(deviceId)) {
    throw new RelayHttpError(400, "Invalid device id.", "invalid_device_id");
  }

  if (deviceSecret.length < 16 || deviceSecret.length > 512) {
    throw new RelayHttpError(400, "Invalid device secret.", "invalid_device_secret");
  }

  return { deviceId, deviceSecret };
}

function normalizeBotUsername(username: string | undefined): string | undefined {
  const normalized = username?.trim().replace(/^@/u, "");
  return normalized || undefined;
}

function activeTimeoutKey(deviceId: string, requestId: string): string {
  return `${deviceId}:${requestId}`;
}

function isExpiredDeadline(deadlineAt: string, now: Date): boolean {
  const deadlineMs = Date.parse(deadlineAt);
  return !Number.isFinite(deadlineMs) || deadlineMs <= now.getTime();
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
