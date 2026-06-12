import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRelayRequest } from "../src/worker.js";
import { InMemoryRelayStorage, RelayCore } from "../src/relayCore.js";
import type { TelegramSender } from "../src/telegram.js";

describe("worker routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serves healthz and rejects invalid webhook secrets", async () => {
    const core = testCore();

    const health = await handleRelayRequest(new Request("https://relay.test/healthz"), env(), core);
    expect(await health.json()).toEqual({ ok: true });

    const rejected = await handleRelayRequest(
      new Request("https://relay.test/telegram/webhook/bad", { method: "POST", body: "{}" }),
      env(),
      core
    );
    expect(rejected.status).toBe(404);
  });

  it("acks valid webhook envelopes through waitUntil", async () => {
    const sender = new FakeTelegramSender();
    const core = testCore(sender);
    const waited: Promise<unknown>[] = [];
    const response = await handleRelayRequest(
      new Request("https://relay.test/telegram/webhook/good-secret", {
        method: "POST",
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 10,
            text: "/help",
            chat: { id: 111, type: "private" }
          }
        })
      }),
      env(),
      core,
      { waitUntil: (promise) => waited.push(promise) }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.text).toContain("/status");
  });

  it("closes desktop websocket connections that never authenticate", async () => {
    vi.useFakeTimers();
    const pair = new FakeWebSocketPair();
    vi.stubGlobal("WebSocketPair", vi.fn(() => pair));
    vi.stubGlobal("Response", FakeUpgradeResponse);

    const response = await handleRelayRequest(
      new Request("https://relay.test/api/desktop/connect", {
        headers: { upgrade: "websocket" }
      }),
      env(),
      testCore()
    );

    expect(response.status).toBe(101);

    await vi.advanceTimersByTimeAsync(10_001);

    expect(pair.server.closes).toContainEqual({ code: 4001, reason: "auth_timeout" });
  });
});

class FakeTelegramSender implements TelegramSender {
  readonly messages: Array<{ chatId: string; text: string }> = [];

  async sendMessage(chatId: string, text: string): Promise<void> {
    this.messages.push({ chatId, text });
  }
}

function testCore(sender = new FakeTelegramSender()) {
  return new RelayCore({
    storage: new InMemoryRelayStorage(),
    telegram: sender,
    randomToken: (bytes) => `token-${bytes}`
  });
}

function env() {
  return {
    TELEGRAM_WEBHOOK_SECRET: "good-secret"
  };
}

class FakeUpgradeResponse {
  readonly status: number;
  readonly webSocket?: FakeWebSocket;

  constructor(_body: unknown, init: { status?: number; webSocket?: FakeWebSocket } = {}) {
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
}

class FakeWebSocketPair {
  readonly client = new FakeWebSocket();
  readonly server = new FakeWebSocket();
  readonly 0 = this.client;
  readonly 1 = this.server;
}

class FakeWebSocket {
  readonly listeners = new Map<string, Array<(event?: unknown) => void>>();
  readonly sent: unknown[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];

  accept(): void {
    // Cloudflare server sockets require accept before use.
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message) as unknown);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
}
