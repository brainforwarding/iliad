// Iliad AI proxy: the free route for built-in writing AI.
// Spec: specs/2026-09-25-groq-ai-free-tier.md §3 (install identity), §4
// (Worker), §5 (error contract).
//
// The app sends a structured task (never messages, prompts, models or
// params); the Worker validates it with the shared, versioned prompt module,
// reserves the worst-case cost in the day's quota Durable Object, calls Groq
// with its own key and relays content only. No request text is logged or
// stored; errors are fixed codes. No CORS headers: desktop only.

import {
  buildWritingAiPrompt,
  groqChatCompletionBody,
  isPromptVersion,
  parseWritingAiTask,
  promptUtf8Bytes
} from "../../../electron/writing/groq/prompts/index.js";
import type { AiProxyEnv, ExecutionContextLike } from "./cloudflareTypes.js";
import { compareSemver, parseClientHeader, parseConfig, parseSemver, type ProxyConfig } from "./config.js";
import { base64UrlEncode, constantTimeEqual, randomBytes } from "./crypto.js";
import { DAY_MS, errorResponse, isUtcDay, jsonResponse, resetAtForDay, utcDay, type ProxyErrorCode } from "./errors.js";
import { DEFAULT_TIMEOUTS, startUpstream, type UpstreamTimeouts } from "./groq.js";
import { structuredLog, type Logger } from "./log.js";
import { canonicalizeIp, networkKeys, rateLimitKey, type CanonicalNetwork } from "./network.js";
import { QuotaClient, QuotaDayObject } from "./quotaObject.js";
import { bearerToken, issueToken, newSubject, verifyToken } from "./tokens.js";

export { QuotaDayObject };

/** Request bodies above this are refused (`too_large`); field limits are the real bound. */
export const MAX_BODY_BYTES = 64 * 1024;

export interface WorkerDeps {
  /** Upstream fetch (Groq). */
  fetch: typeof fetch;
  now: () => number;
  log: Logger;
  timeouts: UpstreamTimeouts;
}

const defaultDeps = (): WorkerDeps => ({
  fetch: (input, init) => fetch(input, init),
  now: Date.now,
  log: structuredLog,
  timeouts: DEFAULT_TIMEOUTS
});

export default {
  fetch(request: Request, env: AiProxyEnv, ctx: ExecutionContextLike): Promise<Response> {
    return handleRequest(request, env, ctx, defaultDeps());
  }
};

export async function handleRequest(
  request: Request,
  env: AiProxyEnv,
  ctx: ExecutionContextLike,
  deps: WorkerDeps
): Promise<Response> {
  try {
    return await route(request, env, ctx, deps);
  } catch {
    // Never rethrow: an uncaught error's message could quote input.
    deps.log({ code: "internal_error" });
    return errorResponse("internal_error");
  }
}

async function route(request: Request, env: AiProxyEnv, ctx: ExecutionContextLike, deps: WorkerDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const routes: Record<string, { method: string; handler: () => Promise<Response> }> = {
    "/healthz": { method: "GET", handler: async () => jsonResponse({ ok: true }) },
    "/v1/install": { method: "POST", handler: () => withConfig(env, deps, (config) => install(request, config, env, deps)) },
    "/v1/generate": { method: "POST", handler: () => withConfig(env, deps, (config) => generate(request, config, env, ctx, deps)) },
    "/v1/admin/stats": { method: "GET", handler: () => withConfig(env, deps, (config) => adminStats(request, config, env, deps), true) }
  };
  const target = Object.prototype.hasOwnProperty.call(routes, pathname) ? routes[pathname] : undefined;
  if (!target) return errorResponse("not_found");
  if (request.method !== target.method) return errorResponse("method_not_allowed", { allow: target.method });
  return target.handler();
}

async function withConfig(
  env: AiProxyEnv,
  deps: WorkerDeps,
  handler: (config: ProxyConfig) => Promise<Response>,
  admin = false
): Promise<Response> {
  const parsed = parseConfig(env);
  if (!parsed.ok || !env.QUOTA) {
    deps.log({ code: "invalid_config" });
    return errorResponse("free_tier_disabled");
  }
  // The kill switch applies at once (not part of the day's snapshot); admin stats stay readable.
  if (!admin && !parsed.config.freeTierEnabled) return errorResponse("free_tier_disabled");
  return handler(parsed.config);
}

function quotaClient(env: AiProxyEnv, config: ProxyConfig): QuotaClient {
  return new QuotaClient(env.QUOTA!, config.locationHint);
}

// ---------------------------------------------------------------------------
// POST /v1/install

const INSTALL_FIELDS = new Set(["client", "version", "refresh"]);

async function install(request: Request, config: ProxyConfig, env: AiProxyEnv, deps: WorkerDeps): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return refuse(deps, body.code);
  const value = body.value;
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !INSTALL_FIELDS.has(key))) return refuse(deps, "bad_request");
  if (value.client !== "iliad-md" || typeof value.version !== "string") return refuse(deps, "bad_request");
  if (value.refresh !== undefined && typeof value.refresh !== "string") return refuse(deps, "bad_request");
  const version = parseSemver(value.version);
  if (!version) return refuse(deps, "bad_request");
  if (compareSemver(version, config.minClientVersion) < 0) return refuse(deps, "client_outdated");

  const network = canonicalizeIp(request.headers.get("cf-connecting-ip"));
  if (!network) return refuse(deps, "bad_request");

  const now = deps.now();
  const day = utcDay(now);
  if (!(await withinRateLimit(env.INSTALL_RATE_LIMITER, network, day, config))) return refuse(deps, "rate_limited", { retryAfter: 60 });

  // Refresh: a validly signed token that expired less than TOKEN_REFRESH_DAYS
  // ago (or has not expired yet) keeps its `sub` and is not counted.
  let sub: string | null = null;
  if (typeof value.refresh === "string") {
    const verified = await verifyToken(config.signingKeys, value.refresh, now);
    const claims = verified.ok ? verified.claims : verified.reason === "expired" ? verified.claims : null;
    if (claims && !config.denySubjects.has(claims.sub) && now < claims.exp * 1000 + config.tokenRefreshDays * DAY_MS) {
      sub = claims.sub;
    }
  }

  const keys = await networkKeys(network, day, config.ipHashKey);
  const result = await quotaClient(env, config)
    .call(day, "install", { day, net: keys.net, net48: keys.net48, refresh: sub !== null, policy: config.policy })
    .catch(() => null);
  if (!result) {
    deps.log({ code: "quota_unreachable" });
    return errorResponse("upstream_error");
  }
  if (!result.ok) return refuse(deps, "install_limited", { resetAt: resetAtForDay(day) });

  const token = await issueToken(config.signingKeys, { sub: sub ?? newSubject(), nowMs: now, ttlDays: config.tokenTtlDays });
  return jsonResponse({ token });
}

// ---------------------------------------------------------------------------
// POST /v1/generate

async function generate(
  request: Request,
  config: ProxyConfig,
  env: AiProxyEnv,
  ctx: ExecutionContextLike,
  deps: WorkerDeps
): Promise<Response> {
  // 1. Client version.
  const clientVersion = parseClientHeader(request.headers.get("x-iliad-client"));
  if (!clientVersion) return refuse(deps, "bad_request");
  if (compareSemver(clientVersion, config.minClientVersion) < 0) return refuse(deps, "client_outdated");

  // 2. Token, then the deny list.
  const now = deps.now();
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return refuse(deps, "invalid_token");
  const verified = await verifyToken(config.signingKeys, token, now);
  if (!verified.ok) return refuse(deps, verified.reason === "expired" ? "token_expired" : "invalid_token");
  if (config.denySubjects.has(verified.claims.sub)) return refuse(deps, "invalid_token");

  const network = canonicalizeIp(request.headers.get("cf-connecting-ip"));
  if (!network) return refuse(deps, "bad_request");
  const day = utcDay(now);
  if (!(await withinRateLimit(env.GENERATE_RATE_LIMITER, network, day, config))) return refuse(deps, "rate_limited", { retryAfter: 60 });

  // 3. Validate the structured task and build the upstream request ourselves.
  const body = await readJsonBody(request);
  if (!body.ok) return refuse(deps, body.code);
  if (!isPlainRecord(body.value) || typeof body.value.v !== "number") return refuse(deps, "bad_request");
  const v = body.value.v;
  if (!isPromptVersion(v) || !config.supportedPromptVersions.has(v)) return refuse(deps, "client_outdated");
  const parsed = parseWritingAiTask(body.value);
  if (!parsed.ok) return refuse(deps, parsed.field === "v" ? "client_outdated" : "bad_request");
  const prompt = buildWritingAiPrompt(parsed.task);
  const upstreamBody = groqChatCompletionBody(prompt);

  // 4. Upper bound: UTF-8 bytes + template overhead in, max_completion_tokens out.
  const inTokens = promptUtf8Bytes(prompt) + config.promptOverheadTokens;
  const outTokens = prompt.maxCompletionTokens;

  // 5. Reserve atomically in the day's DO.
  const keys = await networkKeys(network, day, config.ipHashKey);
  const quota = quotaClient(env, config);
  const id = base64UrlEncode(randomBytes(12));
  const reserved = await quota
    .call(day, "reserve", {
      day, id, subject: verified.claims.sub, netkey: keys.net, inTokens, outTokens, policy: config.policy, nowMs: now
    })
    .catch(() => null);
  if (!reserved) {
    deps.log({ code: "quota_unreachable" });
    return errorResponse("upstream_error");
  }
  if (!reserved.ok) {
    return refuse(deps, reserved.code, {
      resetAt: resetAtForDay(day),
      ...(reserved.code === "quota_exhausted" ? { scope: reserved.scope } : {})
    });
  }

  // Keep the Worker alive until the reservation is settled, even if the client leaves.
  let resolveSettled!: (value: unknown) => void;
  ctx.waitUntil(new Promise((resolve) => (resolveSettled = resolve)));
  const settle = (usage: { promptTokens: number; completionTokens: number } | null) =>
    quota.call(day, "settle", { day, id, usage, policy: config.policy }).then(
      () => undefined,
      () => deps.log({ code: "settle_failed" })
    );

  // 6. Upstream.
  let start;
  try {
    start = await startUpstream({
      apiKey: config.groqApiKey,
      body: upstreamBody,
      maxOutputChars: prompt.maxOutputChars,
      clientSignal: request.signal,
      fetchImpl: deps.fetch,
      now: deps.now,
      timeouts: deps.timeouts
    });
  } catch {
    // Unknown failure: we cannot prove nothing was billed, so charge in full.
    resolveSettled(settle(null));
    return refuse(deps, "upstream_error");
  }

  switch (start.kind) {
    case "failed": {
      resolveSettled(
        quota.call(day, "refund", { day, id, reason: `upstream_${start.status || "network"}` }).catch(() => deps.log({ code: "settle_failed" }))
      );
      if (start.status === 401 || start.status === 403) deps.log({ code: "upstream_status", status: start.status });
      return refuse(deps, start.code, start.code === "upstream_busy" ? { retryAfter: start.retryAfter } : {});
    }
    case "timeout":
      resolveSettled(settle(null));
      return refuse(deps, "upstream_timeout");
    case "client_aborted":
      resolveSettled(settle(null));
      return refuse(deps, "upstream_error");
    case "stream":
      // 7–8. Relay; settle from the pump's outcome (usage → actual, else full).
      resolveSettled(
        start.done.then(
          (outcome) => settle(outcome.usage),
          () => settle(null)
        )
      );
      return new Response(start.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
  }
}

// ---------------------------------------------------------------------------
// GET /v1/admin/stats?day=YYYY-MM-DD (aggregates only)

async function adminStats(request: Request, config: ProxyConfig, env: AiProxyEnv, deps: WorkerDeps): Promise<Response> {
  if (!config.adminToken) return errorResponse("not_found");
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization")?.trim() ?? "")?.[1] ?? "";
  if (!constantTimeEqual(token, config.adminToken)) return errorResponse("invalid_token");

  const today = utcDay(deps.now());
  const day = new URL(request.url).searchParams.get("day") ?? today;
  // Only days whose storage can still exist (≤ 48 h); never create a DO for an arbitrary day.
  const oldest = utcDay(deps.now() - 2 * DAY_MS);
  if (!isUtcDay(day) || day > today || day < oldest) return errorResponse("bad_request");

  const stats = await quotaClient(env, config).call(day, "stats", { day }).catch(() => undefined);
  if (stats === undefined) return errorResponse("upstream_error");
  return jsonResponse({
    day,
    freeTierEnabled: config.freeTierEnabled,
    stats: stats ?? { empty: true }
  });
}

// ---------------------------------------------------------------------------
// Helpers

function refuse(deps: WorkerDeps, code: ProxyErrorCode, extras: Parameters<typeof errorResponse>[1] = {}): Response {
  deps.log({ code, status: undefined });
  return errorResponse(code, extras);
}

async function withinRateLimit(
  limiter: AiProxyEnv["INSTALL_RATE_LIMITER"],
  network: CanonicalNetwork,
  day: string,
  config: ProxyConfig
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: await rateLimitKey(network, day, config.ipHashKey) });
    return success;
  } catch {
    // The burst limiter is a coarse extra layer; the DO quotas are the real bound.
    return true;
  }
}

type BodyResult = { ok: true; value: unknown } | { ok: false; code: "bad_request" | "too_large" };

/** JSON body with `application/json`, ≤ 64 KB checked on Content-Length and while reading. */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(?:;\s*charset=utf-8\s*)?$/i.test(contentType.trim())) return { ok: false, code: "bad_request" };
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared.trim())) return { ok: false, code: "bad_request" };
    if (Number(declared) > maxBytes) return { ok: false, code: "too_large" };
  }
  if (!request.body) return { ok: false, code: "bad_request" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, code: "bad_request" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // V8's JSON.parse and fatal TextDecoder errors quote input: swallow them.
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, code: "bad_request" };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
