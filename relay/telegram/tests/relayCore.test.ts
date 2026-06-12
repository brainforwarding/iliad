import { beforeEach, describe, expect, it } from "vitest";
import {
  TELEGRAM_REMOTE_REQUEST_VERSION,
  type RelayToDesktopMessage,
  type RemoteRequest,
  type RemoteResponse,
  type TelegramUpdate
} from "../src/protocol.js";
import { DEFAULT_RATE_LIMITS, FixedWindowRateLimiter } from "../src/rateLimit.js";
import {
  InMemoryDesktopSessionRegistry,
  InMemoryRelayStorage,
  RelayCore,
  RelayHttpError,
  type DesktopSession
} from "../src/relayCore.js";
import { TELEGRAM_MESSAGES, type TelegramSender } from "../src/telegram.js";

const deviceId = "device-1";
const deviceSecret = "device-secret-1234567890";
const chatId = "1001";

let nowMs = Date.parse("2026-05-27T12:00:00.000Z");
let storage: InMemoryRelayStorage;
let telegram: FakeTelegramSender;
let sessions: InMemoryDesktopSessionRegistry;
let ids: string[];
let core: RelayCore;

beforeEach(() => {
  nowMs = Date.parse("2026-05-27T12:00:00.000Z");
  storage = new InMemoryRelayStorage();
  telegram = new FakeTelegramSender();
  sessions = new InMemoryDesktopSessionRegistry();
  ids = [];
  core = makeCore();
});

describe("RelayCore pairing", () => {
  it("stores hashes, replaces one pending token, rejects mismatches, and rejects already paired devices", async () => {
    ids.push("token-one", "session-one", "token-two", "session-two");

    const first = await core.startPairing({ deviceId, deviceSecret }, "client");
    expect(first).toMatchObject({
      token: "token-one",
      pairingSessionId: "pair_session-one",
      pairingUrl: "https://t.me/iliad_bot?start=token-one"
    });

    let stored = JSON.stringify(storage.dump());
    expect(stored).not.toContain(deviceSecret);
    expect(stored).not.toContain(first.token);
    expect(stored).toContain("device-secret");
    expect(stored).toContain("pairing-token");

    await expect(core.startPairing({ deviceId, deviceSecret: "wrong-secret-123456789" }, "client")).rejects.toMatchObject({
      status: 401
    });

    const second = await core.startPairing({ deviceId, deviceSecret }, "client");
    expect(second.token).toBe("token-two");
    expect((await storage.getDevice(deviceId))?.pendingPairing?.pairingSessionId).toBe("pair_session-two");

    await core.handleTelegramUpdate(update(`/start ${first.token}`, 1));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.tokenExpired);

    await core.handleTelegramUpdate(update(`/start ${second.token}`, 2));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.paired);
    expect((await storage.getDevice(deviceId))?.pairedChat).toMatchObject({ chatId, username: "sebastian" });
    expect((await storage.getDevice(deviceId))?.pendingPairing).toBeNull();

    await expect(core.startPairing({ deviceId, deviceSecret }, "client")).rejects.toMatchObject({
      status: 409
    });

    stored = JSON.stringify(storage.dump());
    expect(stored).not.toContain(first.token);
    expect(stored).not.toContain(second.token);
    expect(stored).not.toContain(deviceSecret);
  });

  it("completes pairing once and notifies the connected desktop", async () => {
    ids.push("pair-token", "session-id");
    const pairing = await core.startPairing({ deviceId, deviceSecret }, "client");
    const session = new FakeDesktopSession("session-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");

    await core.handleTelegramUpdate(update(`/start ${pairing.token}`, 1));

    expect(session.messages).toEqual([
      {
        type: "pairing_completed",
        pairingSessionId: pairing.pairingSessionId,
        chat: expect.objectContaining({ chatId, username: "sebastian" }),
        expiresAt: pairing.expiresAt
      }
    ]);

    await core.handleTelegramUpdate(update(`/start ${pairing.token}`, 2));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.tokenExpired);
  });

  it("expires pending tokens", async () => {
    ids.push("pair-token", "session-id");
    const pairing = await core.startPairing({ deviceId, deviceSecret }, "client");
    nowMs = Date.parse(pairing.expiresAt) + 1;

    await core.handleTelegramUpdate(update(`/start ${pairing.token}`, 1));

    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.tokenExpired);
    expect((await storage.getDevice(deviceId))?.pendingPairing).toBeNull();
  });
});

describe("RelayCore webhook routing", () => {
  it("rejects groups and dedupes update/message ids", async () => {
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");

    await core.handleTelegramUpdate(update("/status", 99, { chatType: "group", chatId: "-10" }));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.groupRejected);

    await core.handleTelegramUpdate(update("/status", 2));
    await core.handleTelegramUpdate(update("/status", 2));

    expect(remoteRequests(session)).toHaveLength(1);
  });

  it("returns offline for paired chats without an authenticated desktop", async () => {
    await pairDevice();
    telegram.clear();

    await core.handleTelegramUpdate(update("/status", 2));

    expect(telegram.messages).toEqual([{ chatId, text: TELEGRAM_MESSAGES.offline }]);
  });

  it("routes status and ask requests to desktop and only accepts matching response ids", async () => {
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");
    telegram.clear();

    await core.handleTelegramUpdate(update("/status", 2));

    const statusRequest = remoteRequests(session)[0];
    expect(statusRequest).toMatchObject({
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      type: "status",
      chatId
    });

    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: "wrong-wrapper",
      response: statusResponse(statusRequest.id)
    });
    expect(telegram.messages).toHaveLength(0);

    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: statusRequest.id,
      response: statusResponse("wrong-nested")
    });
    expect(telegram.messages).toHaveLength(0);

    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: statusRequest.id,
      response: statusResponse(statusRequest.id)
    });
    expect(telegram.lastText()).toContain("Iliad is online");

    await core.handleTelegramUpdate(update("What did we decide?", 3));
    const askRequest = remoteRequests(session)[1];
    expect(askRequest).toMatchObject({
      type: "ask",
      text: "What did we decide?"
    });
    expect(JSON.stringify(storage.dump())).not.toContain("What did we decide?");

    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: askRequest.id,
      response: answerResponse(askRequest.id, "Use the final rubric.")
    });

    expect(telegram.lastText()).toContain("Use the final rubric.");
    expect(telegram.lastText()).toContain("Sources:");
  });

  it("enforces one active request per device and clears it on timeout", async () => {
    core = makeCore({ setTimeoutFn: () => ({ timer: true }), clearTimeoutFn: () => undefined });
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");
    telegram.clear();

    await core.handleTelegramUpdate(update("First question", 2));
    await core.handleTelegramUpdate(update("Second question", 3));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.busy);

    nowMs += 60_001;
    await core.sweepTimeouts();
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.timeout);

    const firstRequest = remoteRequests(session)[0];
    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: firstRequest.id,
      response: answerResponse(firstRequest.id, "Late answer.")
    });
    expect(telegram.messages.some((message) => message.text.includes("Late answer."))).toBe(false);
  });

  it("drops matching desktop responses that arrive after the active deadline", async () => {
    core = makeCore({ setTimeoutFn: () => ({ timer: true }), clearTimeoutFn: () => undefined });
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");
    telegram.clear();

    await core.handleTelegramUpdate(update("Deadline-sensitive question", 2));
    const request = remoteRequests(session)[0];
    nowMs += 60_001;

    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: request.id,
      response: answerResponse(request.id, "Too late.")
    });

    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.timeout);
    expect(telegram.messages.some((message) => message.text.includes("Too late."))).toBe(false);
    expect((await storage.getDevice(deviceId))?.activeRequest).toBeNull();
  });

  it("unlinks from Telegram, invalidates active requests, and drops late responses", async () => {
    core = makeCore({ setTimeoutFn: () => ({ timer: true }), clearTimeoutFn: () => undefined });
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");
    telegram.clear();

    await core.handleTelegramUpdate(update("Active question", 2));
    const request = remoteRequests(session)[0];
    await core.handleTelegramUpdate(update("/unlink", 3));

    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.unlinked);
    expect(session.messages.at(-1)).toEqual({ type: "pairing_revoked" });
    expect((await storage.getDevice(deviceId))?.activeRequest).toBeNull();

    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: request.id,
      response: answerResponse(request.id, "Post-revoke answer.")
    });
    expect(telegram.messages.some((message) => message.text.includes("Post-revoke answer."))).toBe(false);

    await core.handleTelegramUpdate(update("/status", 4));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.unpaired);
  });

  it("revokes from desktop with device-secret auth and rejects bad secrets without clearing pairing", async () => {
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");

    await expect(core.revokePairing({ deviceId, deviceSecret: "bad-secret-123456789" }, "client")).rejects.toMatchObject({
      status: 401
    });
    expect((await storage.getDevice(deviceId))?.pairedChat).not.toBeNull();

    await expect(core.revokePairing({ deviceId, deviceSecret }, "client")).resolves.toEqual({ ok: true });
    expect((await storage.getDevice(deviceId))?.pairedChat).toBeNull();
    expect(session.messages.at(-1)).toEqual({ type: "pairing_revoked" });
  });
});

describe("RelayCore rate limits and auth", () => {
  it("rate limits asks, status, unpaired spam, pairing starts, bad revoke auth, bad websocket auth, and duplicate webhooks", async () => {
    const limiter = new FixedWindowRateLimiter({
      ...DEFAULT_RATE_LIMITS,
      ask: { limit: 1, windowMs: 60_000 },
      status: { limit: 1, windowMs: 60_000 },
      unpaired: { limit: 1, windowMs: 60_000 },
      pairingStart: { limit: 1, windowMs: 60_000 },
      badRevokeAuth: { limit: 1, windowMs: 60_000 },
      badWebSocketAuth: { limit: 1, windowMs: 60_000 },
      duplicateWebhook: { limit: 1, windowMs: 60_000 }
    });
    core = makeCore({ rateLimiter: limiter });

    ids.push("pair-token", "pair-session", "request-one", "request-two", "request-three");
    await core.startPairing({ deviceId, deviceSecret }, "pair-source");
    await expect(core.startPairing({ deviceId, deviceSecret }, "pair-source")).rejects.toMatchObject({ status: 429 });

    await core.handleTelegramUpdate(update("/start pair-token", 1));
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");
    telegram.clear();

    await core.handleTelegramUpdate(update("/status", 2));
    const status = remoteRequests(session)[0];
    await core.handleDesktopMessage(deviceId, { type: "remote_response", id: status.id, response: statusResponse(status.id) });
    await core.handleTelegramUpdate(update("/status", 3));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.rateLimited);

    await core.handleTelegramUpdate(update("First ask", 4));
    const ask = remoteRequests(session)[1];
    await core.handleDesktopMessage(deviceId, { type: "remote_response", id: ask.id, response: answerResponse(ask.id, "Answer.") });
    await core.handleTelegramUpdate(update("Second ask", 5));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.rateLimited);

    await core.handleTelegramUpdate(update("/status", 6, { chatId: "unpaired" }));
    await core.handleTelegramUpdate(update("/status", 7, { chatId: "unpaired" }));
    expect(telegram.lastText()).toBe(TELEGRAM_MESSAGES.rateLimited);

    await expect(core.revokePairing({ deviceId, deviceSecret: "wrong-secret-123456" }, "revoke-source")).rejects.toMatchObject({
      status: 401
    });
    await expect(core.revokePairing({ deviceId, deviceSecret: "wrong-secret-123456" }, "revoke-source")).rejects.toMatchObject({
      status: 429
    });

    await expect(
      core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret: "wrong-secret-123456" }, new FakeDesktopSession("bad"), "ws")
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret: "wrong-secret-123456" }, new FakeDesktopSession("bad2"), "ws")
    ).rejects.toMatchObject({ status: 429 });

    await core.handleTelegramUpdate(update("/help", 8));
    await core.handleTelegramUpdate(update("/help", 8));
    expect(limiter.snapshot().some((bucket) => bucket.key.startsWith("duplicateWebhook:"))).toBe(true);
  });

  it("rejects desktop websocket auth for bad secrets and accepts good credentials", async () => {
    ids.push("pair-token", "pair-session");
    await core.startPairing({ deviceId, deviceSecret }, "client");

    await expect(
      core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret: "bad-secret-123456789" }, new FakeDesktopSession("bad"), "ws")
    ).rejects.toBeInstanceOf(RelayHttpError);

    const good = new FakeDesktopSession("good");
    await expect(core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, good, "ws")).resolves.toEqual({
      ok: true,
      deviceId
    });
  });
});

describe("RelayCore storage privacy", () => {
  it("does not persist raw prompts, answers, workspace labels, workspace paths, provider payloads, context manifests, tokens, or secrets", async () => {
    await pairDevice();
    const session = new FakeDesktopSession("desktop-1");
    await core.authenticateDesktopSession({ type: "desktop_auth", deviceId, deviceSecret }, session, "client");

    const rawPrompt = "Summarize secret workspace content";
    await core.handleTelegramUpdate(update(rawPrompt, 2));
    const request = remoteRequests(session)[0];
    const rawAnswer = "Provider answer with Markdown content";
    await core.handleDesktopMessage(deviceId, {
      type: "remote_response",
      id: request.id,
      response: {
        ...answerResponse(request.id, rawAnswer),
        manifestId: "manifest-raw-id"
      }
    });

    const persisted = JSON.stringify(storage.dump());
    expect(persisted).not.toContain(rawPrompt);
    expect(persisted).not.toContain(rawAnswer);
    expect(persisted).not.toContain("Course Notes");
    expect(persisted).not.toContain("/Users/sebastian/workspace");
    expect(persisted).not.toContain("provider payload");
    expect(persisted).not.toContain("manifest-raw-id");
    expect(persisted).not.toContain(deviceSecret);
  });
});

class FakeTelegramSender implements TelegramSender {
  readonly messages: Array<{ chatId: string; text: string }> = [];

  async sendMessage(targetChatId: string, text: string): Promise<void> {
    this.messages.push({ chatId: targetChatId, text });
  }

  lastText(): string | undefined {
    return this.messages.at(-1)?.text;
  }

  clear(): void {
    this.messages.length = 0;
  }
}

class FakeDesktopSession implements DesktopSession {
  readonly messages: RelayToDesktopMessage[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];

  constructor(readonly id: string) {}

  send(message: RelayToDesktopMessage): void {
    this.messages.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
}

function makeCore(overrides: Partial<ConstructorParameters<typeof RelayCore>[0]> = {}) {
  return new RelayCore({
    storage,
    telegram,
    sessions,
    now: () => new Date(nowMs),
    botUsername: "iliad_bot",
    randomToken: () => ids.shift() ?? `id-${ids.length}`,
    ...overrides
  });
}

async function pairDevice() {
  ids.push("pair-token", "pair-session");
  const pairing = await core.startPairing({ deviceId, deviceSecret }, "client");
  await core.handleTelegramUpdate(update(`/start ${pairing.token}`, 1));
  telegram.clear();
  return pairing;
}

function update(text: string, updateId: number, options: { chatType?: string; chatId?: string } = {}): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      date: Math.floor(nowMs / 1000),
      text,
      chat: {
        id: options.chatId ?? chatId,
        type: options.chatType ?? "private",
        username: "sebastian"
      },
      from: {
        id: 42,
        first_name: "Sebastian",
        username: "sebastian"
      }
    }
  };
}

function remoteRequests(session: FakeDesktopSession): RemoteRequest[] {
  return session.messages.filter((message): message is Extract<RelayToDesktopMessage, { type: "remote_request" }> => {
    return message.type === "remote_request";
  }).map((message) => message.request);
}

function statusResponse(id: string): RemoteResponse {
  return {
    version: TELEGRAM_REMOTE_REQUEST_VERSION,
    id,
    ok: true,
    type: "status",
    desktopOnline: true,
    workspaceLabel: "Course Notes",
    remoteChatEnabled: true
  };
}

function answerResponse(id: string, text: string): RemoteResponse {
  return {
    version: TELEGRAM_REMOTE_REQUEST_VERSION,
    id,
    ok: true,
    type: "answer",
    text,
    sources: [{ relativePath: "notes/workshop.md", line: 7 }]
  };
}
