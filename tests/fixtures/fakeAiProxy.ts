// An in-process fake of the Iliad AI proxy (Groq spec §3–§5), for app tests
// and local QA (`npm run dev:fake-ai-proxy`). It implements the contract the
// app relies on — `/v1/install` issuance and refresh, `/v1/generate` with the
// structured task validated by the shared `prompts/` parser, OpenAI-compatible
// SSE, `{ error: { code, resetAt } }` refusals — but none of the Worker's
// accounting. It never logs request bodies.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { parseWritingAiTask, type WritingAiTask } from "../../electron/writing/groq/prompts/index";

export interface FakeReply {
  deltas: string[];
  finishReason?: string | null;
  /** Emitted as an in-band `{"error":{"code":…}}` event after the deltas. */
  inBandError?: string;
  /** Delay between SSE frames. */
  delayMs?: number;
}

export interface FakeAiProxyOptions {
  /** Per-install daily requests (the Worker's `INSTALL_DAILY_REQUESTS`). */
  installDailyRequests?: number;
  /** Per-network new installs (`IP_DAILY_NEW_INSTALLS`). */
  installsPerDay?: number;
  reply?: (task: WritingAiTask) => FakeReply;
  now?: () => number;
}

export interface FakeAiProxyRequest {
  path: string;
  method: string;
  authorization: string | null;
  client: string | null;
  contentType: string | null;
  /** Parsed body (tests only; never logged). */
  body: unknown;
}

interface TokenRecord {
  sub: string;
  expired: boolean;
}

export interface FakeAiProxy {
  url: string;
  requests: FakeAiProxyRequest[];
  /** Mutable knobs the tests (or the QA runner) flip at will. */
  state: {
    installDailyRequests: number;
    installsPerDay: number;
    globalCapReached: boolean;
    freeTierEnabled: boolean;
    minClientVersion: string | null;
    /** Next /v1/generate answers with this HTTP refusal (then clears). */
    nextGenerateError: { status: number; code: string } | null;
    /** Every /v1/generate answers 401 with this code. */
    alwaysUnauthorized: "invalid_token" | "token_expired" | null;
    reply: (task: WritingAiTask) => FakeReply;
  };
  tokens: Map<string, TokenRecord>;
  /** Counts of /v1/generate admitted per `sub`. */
  usage: Map<string, number>;
  /** Streams whose client disconnected before the end. */
  closedEarly: number;
  expireAllTokens(): void;
  resetAt(): string;
  close(): Promise<void>;
}

export function nextUtcMidnightIso(now: number) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

export function defaultFakeReply(task: WritingAiTask): FakeReply {
  if (task.task === "autocomplete") {
    const words = task.language === "es"
      ? ["una ", "línea ", "tranquila ", "desde ", "el ", "proxy ", "de ", "prueba."]
      : ["a ", "quiet ", "line ", "from ", "the ", "fake ", "proxy."];
    return { deltas: words, finishReason: "stop", delayMs: 15 };
  }
  const selected = task.text.slice(task.selection.from, task.selection.to);
  const tightened = selected.replace(/\b(really|very|realmente|muy|just|simplemente) /gi, "").trim();
  const rewrite = tightened !== selected.trim() ? tightened : `${selected.trim()} (fake proxy)`;
  return { deltas: [rewrite], finishReason: "stop" };
}

function compareVersions(a: string, b: string) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((pa[index] ?? 0) !== (pb[index] ?? 0)) return (pa[index] ?? 0) - (pb[index] ?? 0);
  }
  return 0;
}

export async function startFakeAiProxy(options: FakeAiProxyOptions = {}, port = 0): Promise<FakeAiProxy> {
  const now = options.now ?? Date.now;
  const requests: FakeAiProxyRequest[] = [];
  const tokens = new Map<string, TokenRecord>();
  const usage = new Map<string, number>();
  let installsIssued = 0;

  const proxy: FakeAiProxy = {
    url: "",
    requests,
    tokens,
    usage,
    closedEarly: 0,
    state: {
      installDailyRequests: options.installDailyRequests ?? 50,
      installsPerDay: options.installsPerDay ?? 5,
      globalCapReached: false,
      freeTierEnabled: true,
      minClientVersion: null,
      nextGenerateError: null,
      alwaysUnauthorized: null,
      reply: options.reply ?? defaultFakeReply
    },
    expireAllTokens() {
      for (const record of tokens.values()) record.expired = true;
    },
    resetAt: () => nextUtcMidnightIso(now()),
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    })
  };

  const json = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const refuse = (response: http.ServerResponse, status: number, code: string, extra: Record<string, unknown> = {}) =>
    json(response, status, { error: { code, ...extra } });

  const issue = (sub?: string) => {
    const token = `v1.fake.${randomBytes(12).toString("base64url")}.sig`;
    tokens.set(token, { sub: sub ?? `inst_${randomBytes(16).toString("hex")}`, expired: false });
    return token;
  };

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: unknown = null;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      } catch {
        body = undefined;
      }
      const path = (request.url ?? "/").split("?")[0];
      const client = typeof request.headers["x-iliad-client"] === "string" ? request.headers["x-iliad-client"] : null;
      requests.push({
        path,
        method: request.method ?? "",
        authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : null,
        client,
        contentType: typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : null,
        body
      });

      if (path === "/healthz" && request.method === "GET") return json(response, 200, { ok: true });
      if (path !== "/v1/install" && path !== "/v1/generate") return refuse(response, 404, "not_found");
      if (request.method !== "POST") return refuse(response, 405, "method_not_allowed");
      if (!String(request.headers["content-type"] ?? "").startsWith("application/json") || body === undefined) {
        return refuse(response, 400, "bad_request");
      }
      if (!proxy.state.freeTierEnabled) return refuse(response, 503, "free_tier_disabled");
      const version = client?.startsWith("iliad-md/") ? client.slice("iliad-md/".length) : "0.0.0";
      if (proxy.state.minClientVersion && compareVersions(version, proxy.state.minClientVersion) < 0) {
        return refuse(response, 426, "client_outdated");
      }

      if (path === "/v1/install") {
        const refresh = body && typeof body === "object" ? (body as { refresh?: unknown }).refresh : undefined;
        const previous = typeof refresh === "string" ? tokens.get(refresh) : undefined;
        if (previous?.expired) {
          // Refresh within the window: same `sub`, not counted against issuance.
          return json(response, 200, { token: issue(previous.sub) });
        }
        if (installsIssued >= proxy.state.installsPerDay) {
          return refuse(response, 429, "install_limited", { resetAt: proxy.resetAt() });
        }
        installsIssued += 1;
        return json(response, 200, { token: issue() });
      }

      // /v1/generate
      const auth = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
      const record = tokens.get(auth.replace(/^Bearer /, ""));
      if (proxy.state.alwaysUnauthorized) return refuse(response, 401, proxy.state.alwaysUnauthorized);
      if (!record) return refuse(response, 401, "invalid_token");
      if (record.expired) return refuse(response, 401, "token_expired");

      const parsed = parseWritingAiTask(body);
      if (!parsed.ok) return parsed.field === "v" ? refuse(response, 426, "client_outdated") : refuse(response, 400, "bad_request");

      if (proxy.state.nextGenerateError) {
        const { status, code } = proxy.state.nextGenerateError;
        proxy.state.nextGenerateError = null;
        return refuse(response, status, code, status === 429 ? { resetAt: proxy.resetAt() } : {});
      }
      if (proxy.state.globalCapReached) return refuse(response, 429, "global_cap", { resetAt: proxy.resetAt() });
      const used = usage.get(record.sub) ?? 0;
      if (used >= proxy.state.installDailyRequests) {
        return refuse(response, 429, "quota_exhausted", { scope: "install", resetAt: proxy.resetAt() });
      }
      usage.set(record.sub, used + 1);

      const reply = proxy.state.reply(parsed.task);
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      let finished = false;
      response.on("close", () => {
        if (!finished) proxy.closedEarly += 1;
      });
      const frames = [
        ...reply.deltas.map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`),
        ...(reply.inBandError ? [`data: ${JSON.stringify({ error: { code: reply.inBandError } })}\n\n`] : []),
        ...(reply.finishReason !== null && !reply.inBandError
          ? [`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reply.finishReason ?? "stop" }] })}\n\n`]
          : []),
        "data: [DONE]\n\n"
      ];
      const delay = reply.delayMs ?? 0;
      let index = 0;
      const writeNext = () => {
        if (response.destroyed) return;
        if (index >= frames.length) {
          finished = true;
          response.end();
          return;
        }
        response.write(frames[index]);
        index += 1;
        if (delay > 0) setTimeout(writeNext, delay);
        else writeNext();
      };
      writeNext();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  proxy.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return proxy;
}
