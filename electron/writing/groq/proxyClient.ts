// Free route: the Iliad AI proxy client (spec §1–§5, app side).
//
// `POST <proxy>/v1/generate` with the anonymous install token and the
// **structured task** (never messages, model or params); the response is the
// same OpenAI-compatible SSE shape as Groq, read by the same content-only
// reader. `POST <proxy>/v1/install` issues or refreshes the token.
//
// No silent fallback: every failure maps to an AgentRuntimeError code (§5).
// Proxy bodies are parsed only for `{ error: { code, resetAt } }` and are never
// included in messages or diagnostics.

import { AgentRuntimeError } from "../errors.js";
import { ILIAD_AI_CLIENT } from "./config.js";
import type { ProxyEndpoint } from "./endpoint.js";
import { isPlausibleInstallToken } from "./installToken.js";
import type { WritingAiTask } from "./prompts/index.js";
import { readChatCompletionStream, type ChatCompletionResult } from "./sse.js";

const MAX_ERROR_BODY_BYTES = 4096;
const INSTALL_TIMEOUT_MS = 10_000;

export interface InstallTokenStoreLike {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ProxyEndpointResolverLike {
  resolve(): Promise<ProxyEndpoint>;
}

export interface IliadAiProxyOptions {
  endpoint: ProxyEndpointResolverLike;
  tokens: InstallTokenStoreLike;
  /** App version, sent as `X-Iliad-Client: iliad-md/<version>` and in `/v1/install`. */
  clientVersion: string;
  fetchImpl?: typeof fetch;
}

export interface ProxyStreamOptions {
  task: WritingAiTask;
  signal: AbortSignal;
  maxOutputChars: number;
  onDelta?: (delta: string, text: string) => void;
}

interface ProxyErrorBody {
  code: string | null;
  resetAt: string | null;
}

export class IliadAiProxyClient {
  private readonly fetchImpl: typeof fetch;
  /** One issuance at a time, shared by concurrent requests. */
  private issuing: Promise<string> | null = null;

  constructor(private readonly options: IliadAiProxyOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Streams one task through the proxy. A missing/corrupt token is issued
   * first; a 401 `invalid_token` re-issues once and a 401 `token_expired`
   * refreshes once, then the request is retried once (never a loop).
   */
  async stream(options: ProxyStreamOptions): Promise<ChatCompletionResult> {
    options.signal.throwIfAborted();
    const endpoint = await this.options.endpoint.resolve();
    if (!endpoint.ok) {
      throw new AgentRuntimeError({
        code: "free_unavailable",
        userMessage: "Free AI is paused right now.",
        detail: endpoint.reason,
        retryable: false
      });
    }

    let token = (await this.options.tokens.read()) ?? (await this.issue(endpoint.baseUrl, null, options.signal));
    let retried = false;

    while (true) {
      const response = await this.fetchImpl(`${endpoint.baseUrl}/v1/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Iliad-Client": this.clientHeader()
        },
        body: JSON.stringify(options.task),
        signal: options.signal
      });

      if (response.ok) {
        if (!response.body) {
          throw new AgentRuntimeError({
            code: "malformed_provider_response",
            userMessage: "Free AI returned an unreadable response. Try again.",
            detail: "missing_body",
            retryable: true
          });
        }
        return readChatCompletionStream(response.body, {
          signal: options.signal,
          maxOutputChars: options.maxOutputChars,
          onDelta: options.onDelta,
          mapInBandError: proxyInBandError
        });
      }

      const error = await readProxyError(response);

      if (response.status === 401 && !retried && (error.code === "invalid_token" || error.code === "token_expired")) {
        retried = true;
        const expired = error.code === "token_expired" ? token : null;
        await this.options.tokens.clear().catch(() => undefined);
        token = await this.issue(endpoint.baseUrl, expired, options.signal);
        continue;
      }

      throw proxyHttpError(response.status, error);
    }
  }

  private clientHeader() {
    return `${ILIAD_AI_CLIENT}/${this.options.clientVersion}`;
  }

  /**
   * The shared issuance is bounded only by its own timeout, never by the
   * request that happened to start it: canceling that request must not fail
   * the others waiting on the same token. Each caller waits abort-aware.
   */
  private issue(baseUrl: string, expiredToken: string | null, signal: AbortSignal): Promise<string> {
    if (!this.issuing) {
      this.issuing = this.requestToken(baseUrl, expiredToken).finally(() => {
        this.issuing = null;
      });
    }
    return untilAborted(this.issuing, signal);
  }

  private async requestToken(baseUrl: string, expiredToken: string | null): Promise<string> {
    const response = await this.fetchImpl(`${baseUrl}/v1/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Iliad-Client": this.clientHeader() },
      body: JSON.stringify({
        client: ILIAD_AI_CLIENT,
        version: this.options.clientVersion,
        ...(expiredToken ? { refresh: expiredToken } : {})
      }),
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS)
    });

    if (!response.ok) {
      const error = await readProxyError(response);
      // A 401 from /v1/install is not retried again (one re-issue per request).
      throw proxyHttpError(response.status, error);
    }

    const body = await readBoundedJson(response, MAX_ERROR_BODY_BYTES);
    const token = body && typeof body === "object" ? (body as { token?: unknown }).token : undefined;
    if (!isPlausibleInstallToken(token)) {
      throw new AgentRuntimeError({
        code: "malformed_provider_response",
        userMessage: "Free AI returned an unreadable response. Try again.",
        detail: "install_token",
        retryable: true
      });
    }
    await this.options.tokens.write(token);
    return token;
  }
}

/** Awaits a shared promise, rejecting with the caller's abort reason if it is canceled first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** §5: proxy HTTP refusals → app error codes. `resetAt` only on the "out" codes. */
export function proxyHttpError(status: number, error: ProxyErrorBody): AgentRuntimeError {
  const resetAt = error.resetAt ?? undefined;
  switch (error.code) {
    case "quota_exhausted":
    case "install_limited":
      return new AgentRuntimeError({
        code: "free_quota_exhausted",
        userMessage: "Today's free AI has run out.",
        // Details never contain quota/limit/rate/auth words (tighten's detail regex).
        detail: error.code === "install_limited" ? "free_out_issue" : "free_out",
        providerStatus: status,
        retryable: false,
        ...(resetAt ? { resetAt } : {})
      });
    case "global_cap":
      return new AgentRuntimeError({
        code: "free_global_cap",
        userMessage: "Today's free AI has run out.",
        detail: "free_out_global",
        providerStatus: status,
        retryable: false,
        ...(resetAt ? { resetAt } : {})
      });
    case "free_tier_disabled":
      return new AgentRuntimeError({
        code: "free_unavailable",
        userMessage: "Free AI is paused right now.",
        detail: "free_paused",
        providerStatus: status,
        retryable: false
      });
    case "client_outdated":
      return new AgentRuntimeError({
        code: "client_outdated",
        userMessage: "Update Iliad to keep using free AI.",
        detail: "client_outdated",
        providerStatus: status,
        retryable: false
      });
    case "upstream_busy":
    // The Worker's per-network burst limiter (429, Retry-After: 60): a short
    // wait, never "free AI ran out" (Phase 2 contract notes).
    case "rate_limited":
      return new AgentRuntimeError({
        code: "rate_limited",
        userMessage: "Free AI is busy. Try again shortly.",
        detail: "proxy_busy",
        providerStatus: status,
        retryable: true
      });
    case "upstream_timeout":
      return new AgentRuntimeError({
        code: "request_timeout",
        userMessage: "Free AI took too long. Try again.",
        detail: "proxy_timeout",
        providerStatus: status,
        retryable: true
      });
    case "bad_request":
    case "too_large":
      // An app bug: diagnostics log the code; the writer sees a generic failure.
      return new AgentRuntimeError({
        code: "provider_unavailable",
        userMessage: "Free AI couldn't take this request.",
        detail: "proxy_bad_request",
        providerStatus: status,
        retryable: false
      });
    default:
      // invalid_token / token_expired after the one retry, upstream_error, unknown.
      return new AgentRuntimeError({
        code: status === 426 ? "client_outdated" : "provider_unavailable",
        userMessage: "Free AI is unavailable right now. Try again.",
        detail: error.code === "invalid_token" || error.code === "token_expired" ? "proxy_token" : "proxy_error",
        providerStatus: status,
        retryable: status >= 500
      });
  }
}

/** In-band `data: {"error":{"code":…}}` from the proxy mid-stream. */
export function proxyInBandError(code: string | null): AgentRuntimeError {
  if (code === "upstream_timeout") {
    return new AgentRuntimeError({
      code: "request_timeout",
      userMessage: "Free AI took too long. Try again.",
      detail: "proxy_timeout",
      retryable: true
    });
  }
  return new AgentRuntimeError({
    code: "provider_unavailable",
    userMessage: "The AI stopped before it finished. Try again.",
    detail: "stream_error",
    retryable: true
  });
}

async function readProxyError(response: Response): Promise<ProxyErrorBody> {
  const body = await readBoundedJson(response, MAX_ERROR_BODY_BYTES);
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (!error || typeof error !== "object") return { code: null, resetAt: null };
  const { code, resetAt } = error as { code?: unknown; resetAt?: unknown };
  return {
    code: typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code) ? code : null,
    resetAt: isIsoTimestamp(resetAt) ? new Date(resetAt).toISOString() : null
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

/** Reads at most `maxBytes` and parses JSON; anything else → null. Never throws, never quotes. */
async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
