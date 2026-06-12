import {
  type DurableObjectStateLike,
  type ExecutionContextLike,
  type ResponseInitWithWebSocket,
  type TelegramRelayEnv
} from "./cloudflareTypes.js";
import {
  InMemoryDesktopSessionRegistry,
  RelayCore,
  RelayHttpError,
  type DesktopSession,
  type DedupeRecord,
  type RelayStorage,
  type StoredDevice
} from "./relayCore.js";
import type { TelegramSender } from "./telegram.js";

const DURABLE_OBJECT_NAME = "telegram-v1";

export class TelegramRelayDurableObject {
  private readonly core: RelayCore;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: TelegramRelayEnv
  ) {
    this.core = new RelayCore({
      storage: new DurableRelayStorage(state),
      telegram: new TelegramApiSender(env),
      botUsername: env.TELEGRAM_BOT_USERNAME,
      sessions: new InMemoryDesktopSessionRegistry()
    });
  }

  fetch(request: Request): Promise<Response> {
    return handleRelayRequest(request, this.env, this.core, this.state);
  }
}

export default {
  async fetch(request: Request, env: TelegramRelayEnv, ctx: ExecutionContextLike): Promise<Response> {
    if (!env.TELEGRAM_RELAY) {
      return jsonResponse({ error: "Durable Object binding TELEGRAM_RELAY is not configured." }, 500);
    }

    const id = env.TELEGRAM_RELAY.idFromName(DURABLE_OBJECT_NAME);
    return env.TELEGRAM_RELAY.get(id).fetch(request);
  }
};

export async function handleRelayRequest(
  request: Request,
  env: TelegramRelayEnv,
  core: RelayCore,
  ctx?: ExecutionContextLike
): Promise<Response> {
  const url = new URL(request.url);
  const sourceKey = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";

  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      return jsonResponse({ ok: true });
    }

    const webhookPrefix = "/telegram/webhook/";

    if (request.method === "POST" && url.pathname.startsWith(webhookPrefix)) {
      const secret = decodeURIComponent(url.pathname.slice(webhookPrefix.length));

      if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("not found", { status: 404 });
      }

      const update = await request.json();
      const task = core.handleTelegramUpdate(update).catch(() => undefined);

      if (ctx?.waitUntil) {
        ctx.waitUntil(task);
      } else {
        await task;
      }

      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/api/pairing/start") {
      return jsonResponse(await core.startPairing(await request.json(), sourceKey));
    }

    if (request.method === "POST" && url.pathname === "/api/pairing/revoke") {
      return jsonResponse(await core.revokePairing(await request.json(), sourceKey));
    }

    if (request.method === "GET" && url.pathname === "/api/desktop/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonResponse({ error: "WebSocket upgrade required." }, 426);
      }

      return connectDesktopWebSocket(core, sourceKey);
    }

    return jsonResponse({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof RelayHttpError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }

    return jsonResponse({ error: "Bad request." }, 400);
  }
}

class TelegramApiSender implements TelegramSender {
  constructor(private readonly env: TelegramRelayEnv) {}

  async sendMessage(chatId: string, text: string): Promise<void> {
    const token = this.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      throw new Error("Telegram sendMessage failed.");
    }
  }
}

class DurableRelayStorage implements RelayStorage {
  constructor(private readonly state: DurableObjectStateLike) {}

  async getDevice(deviceId: string): Promise<StoredDevice | null> {
    return (await this.state.storage.get<StoredDevice>(deviceKey(deviceId))) ?? null;
  }

  async putDevice(device: StoredDevice): Promise<void> {
    await this.state.storage.put(deviceKey(device.deviceId), device);
  }

  async listDevices(): Promise<StoredDevice[]> {
    return Array.from((await this.state.storage.list<StoredDevice>({ prefix: "device:" })).values());
  }

  async getDedupe(key: string): Promise<DedupeRecord | null> {
    return (await this.state.storage.get<DedupeRecord>(dedupeKey(key))) ?? null;
  }

  async putDedupe(record: DedupeRecord): Promise<void> {
    await this.state.storage.put(dedupeKey(record.key), record);
  }

  async deleteExpiredDedupe(now: Date): Promise<void> {
    const records = await this.state.storage.list<DedupeRecord>({ prefix: "dedupe:" });

    for (const [key, record] of records.entries()) {
      if (Date.parse(record.expiresAt) <= now.getTime()) {
        await this.state.storage.delete(key);
      }
    }
  }
}

class WorkerDesktopSession implements DesktopSession {
  readonly id: string;

  constructor(private readonly socket: WebSocket) {
    this.id = `ws_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}

function connectDesktopWebSocket(core: RelayCore, sourceKey: string): Response {
  if (typeof WebSocketPair !== "function") {
    return jsonResponse({ error: "WebSocketPair is unavailable in this runtime." }, 501);
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  const session = new WorkerDesktopSession(server);
  let deviceId: string | null = null;
  let lastPongAt = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let authTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (!deviceId) {
      stop();
      session.close(4001, "auth_timeout");
    }
  }, 10_000);

  (server as WebSocket & { accept(): void }).accept();

  server.addEventListener("message", (event) => {
    void (async () => {
      const payload = parseSocketMessage(event.data);

      if (!deviceId) {
        try {
          const auth = await core.authenticateDesktopSession(payload, session, sourceKey);
          deviceId = auth.deviceId;
          lastPongAt = Date.now();
          if (authTimeout) {
            clearTimeout(authTimeout);
            authTimeout = null;
          }
        } catch {
          session.close(4001, "unauthorized");
        }
        return;
      }

      if (isPongMessage(payload)) {
        lastPongAt = Date.now();
      }

      await core.handleDesktopMessage(deviceId, payload);
    })();
  });

  const stop = () => {
    if (authTimeout) {
      clearTimeout(authTimeout);
      authTimeout = null;
    }

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (deviceId) {
      core.disconnectDesktop(deviceId, session.id);
    }
  };

  server.addEventListener("close", stop);
  server.addEventListener("error", stop);

  heartbeat = setInterval(() => {
    try {
      if (Date.now() - lastPongAt > 75_000) {
        stop();
        session.close(1001, "heartbeat_timeout");
        return;
      }

      session.send({ type: "ping" });
    } catch {
      stop();
      session.close(1011, "heartbeat_failed");
    }
  }, 30_000);

  return new Response(null, {
    status: 101,
    webSocket: client
  } as ResponseInitWithWebSocket);
}

function parseSocketMessage(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isPongMessage(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pong";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function deviceKey(deviceId: string): string {
  return `device:${deviceId}`;
}

function dedupeKey(key: string): string {
  return `dedupe:${key}`;
}
