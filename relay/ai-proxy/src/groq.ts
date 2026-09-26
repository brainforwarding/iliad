// Upstream call to Groq and the response relay (spec §4 pipeline steps 6–7).
//
// - Before the first byte: HTTP errors and network failures are reported so
//   the caller can refund (nothing was billed); a first-byte timeout or a
//   client abort is reported so the caller settles the full reservation.
// - After: a pump re-emits only content and finish_reason, captures usage
//   without forwarding it, caps forwarded output at the task's
//   maxOutputChars (aborting upstream), and enforces idle/total timeouts with
//   in-band error events. Every failure maps to a fixed code; no upstream
//   body, parse error message or request text is ever logged or rethrown.

import { GROQ_CHAT_COMPLETIONS_URL } from "../../../electron/writing/groq/config.js";
import type { UsageTokens } from "./quotaCore.js";
import { ChatCompletionSseParser, contentChunk, doneChunk, errorChunk, finishChunk } from "./sse.js";

export interface UpstreamTimeouts {
  firstByteMs: number;
  idleMs: number;
  totalMs: number;
}

export const DEFAULT_TIMEOUTS: UpstreamTimeouts = { firstByteMs: 10_000, idleMs: 15_000, totalMs: 45_000 };

export type StreamEnding =
  | "done"
  | "eof"
  | "capped"
  | "idle_timeout"
  | "total_timeout"
  | "upstream_error"
  | "client_abort";

export interface StreamOutcome {
  usage: UsageTokens | null;
  ending: StreamEnding;
}

export type UpstreamStart =
  | { kind: "stream"; body: ReadableStream<Uint8Array>; done: Promise<StreamOutcome> }
  /** Nothing was billed: refund count and reservation. */
  | { kind: "failed"; code: "upstream_error" | "upstream_busy"; status: number; retryAfter?: number }
  /** Groq may have started generating: settle at the full reservation. */
  | { kind: "timeout" }
  | { kind: "client_aborted" };

export interface UpstreamOptions {
  apiKey: string;
  body: unknown;
  maxOutputChars: number;
  clientSignal: AbortSignal;
  fetchImpl: typeof fetch;
  now: () => number;
  timeouts: UpstreamTimeouts;
}

export async function startUpstream(options: UpstreamOptions): Promise<UpstreamStart> {
  const upstreamAbort = new AbortController();
  const firstByte = new AbortController();
  const signal = AbortSignal.any([options.clientSignal, upstreamAbort.signal, firstByte.signal]);
  const timer = setTimeout(() => firstByte.abort(), options.timeouts.firstByteMs);

  let response: Response;
  try {
    response = await options.fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify(options.body),
      signal
    });
  } catch {
    if (options.clientSignal.aborted) return { kind: "client_aborted" };
    if (firstByte.signal.aborted) return { kind: "timeout" };
    return { kind: "failed", code: "upstream_error", status: 0 };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) {
      return { kind: "failed", code: "upstream_busy", status: 429, retryAfter: retryAfterSeconds(response.headers.get("retry-after")) };
    }
    return { kind: "failed", code: "upstream_error", status: response.status };
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const done = pump(response.body, writable.getWriter(), options, upstreamAbort);
  return { kind: "stream", body: readable, done };
}

/** `Retry-After` passthrough, capped at 60 s (seconds form only; dates → default). */
export function retryAfterSeconds(header: string | null): number {
  if (header && /^\d{1,6}$/.test(header.trim())) return Math.min(60, Math.max(1, Number(header.trim())));
  return 5;
}

type ReadOutcome = { kind: "chunk"; done: boolean; value?: Uint8Array } | { kind: "timeout" } | { kind: "aborted" };

async function pump(
  upstream: ReadableStream<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  options: UpstreamOptions,
  upstreamAbort: AbortController
): Promise<StreamOutcome> {
  const parser = new ChatCompletionSseParser();
  const reader = upstream.getReader();
  const deadline = options.now() + options.timeouts.totalMs;
  let usage: UsageTokens | null = null;
  let forwarded = 0;
  let ending: StreamEnding = "eof";

  const write = async (chunk: Uint8Array): Promise<void> => {
    const outcome = await race(writer.write(chunk).then(() => "ok" as const), deadline - options.now(), options.clientSignal);
    if (outcome === "timeout") throw new PumpStop("total_timeout");
    if (outcome === "aborted" || outcome === "failed") throw new PumpStop("client_abort");
  };

  try {
    loop: while (true) {
      const remaining = deadline - options.now();
      if (remaining <= 0) {
        ending = "total_timeout";
        break;
      }
      const read = await readWithin(reader, Math.min(options.timeouts.idleMs, remaining), options.clientSignal);
      if (read.kind === "timeout") {
        ending = options.now() >= deadline ? "total_timeout" : "idle_timeout";
        break;
      }
      if (read.kind === "aborted") {
        ending = "client_abort";
        break;
      }

      let events;
      try {
        events = read.done ? parser.end() : parser.push(read.value ?? new Uint8Array());
      } catch {
        ending = "upstream_error";
        break;
      }

      for (const event of events) {
        switch (event.type) {
          case "delta": {
            const room = options.maxOutputChars - forwarded;
            if (event.content.length > room) {
              if (room > 0) await write(contentChunk(event.content.slice(0, room)));
              forwarded = options.maxOutputChars;
              await write(finishChunk("length"));
              await write(doneChunk());
              ending = "capped";
              break loop;
            }
            forwarded += event.content.length;
            await write(contentChunk(event.content));
            break;
          }
          case "finish":
            if (/^[a-z_]{1,32}$/.test(event.reason)) await write(finishChunk(event.reason));
            break;
          case "usage":
            usage = { promptTokens: event.usage.promptTokens, completionTokens: event.usage.completionTokens };
            break;
          case "error":
            ending = "upstream_error";
            break loop;
          case "done":
            await write(doneChunk());
            ending = "done";
            break loop;
        }
      }

      if (read.done) {
        ending = "eof";
        break;
      }
    }
  } catch (error) {
    ending = error instanceof PumpStop ? error.ending : "upstream_error";
  }

  if (ending !== "done" && ending !== "eof") upstreamAbort.abort();
  await reader.cancel().catch(() => undefined);

  if (ending === "idle_timeout" || ending === "total_timeout") {
    void writer.write(errorChunk("upstream_timeout")).catch(() => undefined);
  } else if (ending === "upstream_error") {
    void writer.write(errorChunk("upstream_error")).catch(() => undefined);
  }
  // Close (never abort: an errored body surfaces as an uncaught rejection in
  // the runtime) without waiting on a stalled or departed client.
  const closing = writer.close();
  closing.catch(() => undefined);
  await race(closing, 1_000, new AbortController().signal);

  return { usage, ending };
}

class PumpStop extends Error {
  constructor(readonly ending: StreamEnding) {
    super(ending);
  }
}

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
  signal: AbortSignal
): Promise<ReadOutcome> {
  const read = reader.read().then(
    (result) => ({ kind: "chunk", done: result.done, value: result.value }) as const,
    () => ({ kind: "chunk", done: true }) as const
  );
  const outcome = await race(read, ms, signal);
  if (outcome === "timeout") return { kind: "timeout" };
  if (outcome === "aborted") return { kind: "aborted" };
  if (outcome === "failed") return { kind: "chunk", done: true };
  return outcome;
}

/** Resolves with the promise's value, "timeout", "aborted" (signal) or "failed" (rejection). */
function race<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T | "timeout" | "aborted" | "failed"> {
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish("timeout"), Math.max(0, ms));
    const onAbort = () => finish("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    function finish(value: T | "timeout" | "aborted" | "failed") {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }
    promise.then(finish, () => finish("failed"));
  });
}
