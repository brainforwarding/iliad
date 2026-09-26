// Groq chat-completions client for both routes (spec §1, §2 `client.ts`, §5,
// §6): own key (Mac → Groq direct, `Authorization: Bearer <key>`) and free
// (Mac → Iliad AI proxy → Groq, structured task; see proxyClient.ts). Both use
// the same prompts, the same content-only SSE reader and the same output cap.
//
// Never includes provider bodies in errors or diagnostics: they can echo
// document text or credentials.

import { AgentRuntimeError } from "../errors.js";
import { GROQ_API_KEY_MAX_CHARS, GROQ_CHAT_COMPLETIONS_URL, GROQ_MODELS_URL } from "./config.js";
import { buildWritingAiPrompt, groqChatCompletionBody, type WritingAiPrompt, type WritingAiTask } from "./prompts/index.js";
import type { IliadAiProxyClient } from "./proxyClient.js";
import { readChatCompletionStream, type ChatCompletionResult } from "./sse.js";

export type GroqRoute =
  | { kind: "own-key"; apiKey: string }
  | { kind: "free"; proxy: Pick<IliadAiProxyClient, "stream"> };

export interface GroqStreamResult extends ChatCompletionResult {
  /** Milliseconds from the request to the first visible content delta. */
  firstDeltaMs: number | null;
  durationMs: number;
}

interface StreamCommon {
  signal: AbortSignal;
  onDelta?: (delta: string, text: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** One writing task on a route: builds the prompt from `prompts/`, streams, returns the aggregate. */
export async function streamGroqText(options: StreamCommon & { route: GroqRoute; task: WritingAiTask }): Promise<GroqStreamResult> {
  const prompt = buildWritingAiPrompt(options.task);
  if (options.route.kind === "own-key") {
    return streamGroqPrompt({ ...options, apiKey: options.route.apiKey, prompt });
  }

  // Free route: the proxy builds the same prompt from the structured task;
  // the app still caps what it reads at the task's maxOutputChars.
  const now = options.now ?? Date.now;
  const startedAt = now();
  let firstDeltaMs: number | null = null;
  const result = await options.route.proxy.stream({
    task: options.task,
    signal: options.signal,
    maxOutputChars: prompt.maxOutputChars,
    onDelta: (delta, text) => {
      if (firstDeltaMs === null) firstDeltaMs = now() - startedAt;
      options.onDelta?.(delta, text);
    }
  });
  return { ...result, firstDeltaMs, durationMs: now() - startedAt };
}

/** A prebuilt prompt on the own-key route (the benchmark uses it to vary budgets). */
export async function streamGroqPrompt(options: StreamCommon & { apiKey: string; prompt: WritingAiPrompt }): Promise<GroqStreamResult> {
  return streamGroqChatCompletion({
    ...options,
    body: groqChatCompletionBody(options.prompt),
    maxOutputChars: options.prompt.maxOutputChars
  });
}

/**
 * Low-level: POST an OpenAI-compatible chat-completions body to Groq with the
 * writer's key and read the SSE stream (content only). The caller owns the
 * body; app code goes through `streamGroqText` so params stay pinned.
 */
export async function streamGroqChatCompletion(
  options: StreamCommon & { apiKey: string; body: Record<string, unknown>; maxOutputChars: number }
): Promise<GroqStreamResult> {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = now();
  options.signal.throwIfAborted();

  const response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(options.body),
    signal: options.signal
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw groqHttpError(response.status);
  }

  if (!response.body) {
    throw new AgentRuntimeError({
      code: "malformed_provider_response",
      userMessage: "Groq returned an unreadable response. Try again.",
      detail: "missing_body",
      retryable: true
    });
  }

  let firstDeltaMs: number | null = null;
  const result = await readChatCompletionStream(response.body, {
    signal: options.signal,
    maxOutputChars: options.maxOutputChars,
    onDelta: (delta, text) => {
      if (firstDeltaMs === null) firstDeltaMs = now() - startedAt;
      options.onDelta?.(delta, text);
    }
  });

  return { ...result, firstDeltaMs, durationMs: now() - startedAt };
}

/** Own-key HTTP failures (spec §5): 401/403 → invalid key, 429 → rate limited. */
export function groqHttpError(status: number): AgentRuntimeError {
  const code = status === 401 || status === 403
    ? "invalid_api_key"
    : status === 429
      ? "rate_limited"
      : status === 404
        ? "model_not_found"
        : "provider_unavailable";
  return new AgentRuntimeError({
    code,
    userMessage: code === "invalid_api_key"
      ? "Groq rejected your key. Check it in Writing assists."
      : code === "rate_limited"
        ? "Your Groq key hit its rate limit. Try again shortly."
        : "Groq is unavailable right now. Try again.",
    providerStatus: status,
    retryable: status === 429 || status >= 500
  });
}

export type GroqKeyValidation =
  | { ok: true }
  | { ok: false; reason: "rejected" | "unreachable" | "invalid_shape" };

/** Shape check before any network call: no whitespace, at most 512 chars. */
export function isPlausibleGroqKey(key: string): boolean {
  return key.length > 0 && key.length <= GROQ_API_KEY_MAX_CHARS && !/\s/.test(key);
}

/**
 * Validates a key before it is saved (owner decision): `GET /models` uses no
 * tokens. Only a 200 is "ok"; 401/403 → rejected; anything else → unreachable.
 */
export async function validateGroqApiKey(
  key: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<GroqKeyValidation> {
  if (!isPlausibleGroqKey(key)) return { ok: false, reason: "invalid_shape" };
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    const response = await (options.fetchImpl ?? fetch)(GROQ_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 200) return { ok: true };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "rejected" };
    return { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
