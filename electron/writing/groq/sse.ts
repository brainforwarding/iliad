// The one OpenAI-compatible chat-completions SSE reader, used by both routes
// (own key → Groq, free → Iliad AI proxy, which re-emits the same shape).
// Spec: specs/2026-09-25-groq-ai-free-tier.md §2 (`sse.ts`).
//
// Reads ONLY `choices[0].delta.content`. `delta.reasoning`, `reasoning_content`,
// `channel`, tool calls and every other field are ignored, so gpt-oss analysis
// text can never reach a suggestion. Parse errors never quote the payload.
// No Node/Electron imports: TextDecoder and ReadableStream are web globals.

import { AgentRuntimeError } from "../errors.js";
import { utf8ByteLength } from "./prompts/index.js";

/** Largest SSE frame (event) accepted, in UTF-8 bytes. */
export const SSE_MAX_FRAME_BYTES = 128 * 1024;

export interface GroqUsage {
  promptTokens: number;
  /** Billed completion tokens: reasoning + content. */
  completionTokens: number;
  totalTokens: number;
  /** `completion_tokens_details.reasoning_tokens` when Groq reports it. */
  reasoningTokens: number | null;
}

export type ChatCompletionStreamEvent =
  | { type: "delta"; content: string }
  | { type: "finish"; reason: string }
  | { type: "usage"; usage: GroqUsage }
  /** An in-band `{"error":{...}}` event. `code` only if it is a short identifier. */
  | { type: "error"; code: string | null }
  | { type: "done" };

export type SseParseFailure = "frame_too_large" | "malformed_event";

export class SseParseError extends Error {
  constructor(readonly failure: SseParseFailure) {
    super(failure);
    this.name = "SseParseError";
  }
}

/**
 * Incremental, byte-level parser: feed it raw chunks, get typed events back.
 * Handles UTF-8 sequences and frames split across chunks, `\n\n` and
 * `\r\n\r\n` delimiters, comments, and `data: [DONE]`.
 */
export class ChatCompletionSseParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private finished = false;
  /** Characters of reasoning seen (and dropped); for diagnostics and probes only. */
  reasoningChars = 0;

  constructor(private readonly maxFrameBytes = SSE_MAX_FRAME_BYTES) {}

  push(chunk: Uint8Array): ChatCompletionStreamEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Flush at end of stream: a trailing frame without a blank line still counts. */
  end(): ChatCompletionStreamEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): ChatCompletionStreamEvent[] {
    const events: ChatCompletionStreamEvent[] = [];
    let match: RegExpExecArray | null;

    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.checkFrameSize(frame);
      this.consume(frame, events);
    }

    this.checkFrameSize(this.buffer);

    if (final && this.buffer.trim()) {
      const frame = this.buffer;
      this.buffer = "";
      this.consume(frame, events);
    }

    return events;
  }

  private checkFrameSize(frame: string) {
    // Cheap bound first: a UTF-16 unit is at most 3 UTF-8 bytes.
    if (frame.length * 3 > this.maxFrameBytes && utf8ByteLength(frame) > this.maxFrameBytes) {
      throw new SseParseError("frame_too_large");
    }
  }

  private consume(frame: string, events: ChatCompletionStreamEvent[]) {
    if (this.finished) return;
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
      .join("\n");

    if (!data.trim()) return;

    if (data.trim() === "[DONE]") {
      this.finished = true;
      events.push({ type: "done" });
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      // Never rethrow: V8's message quotes the input.
      throw new SseParseError("malformed_event");
    }

    if (!isRecord(event)) throw new SseParseError("malformed_event");

    if (event.error !== undefined && event.error !== null) {
      const code = isRecord(event.error) && typeof event.error.code === "string" && /^[a-z0-9_]{1,64}$/.test(event.error.code)
        ? event.error.code
        : null;
      events.push({ type: "error", code });
      return;
    }

    const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;

    if (isRecord(choice)) {
      const delta = choice.delta;
      if (isRecord(delta)) {
        if (typeof delta.content === "string" && delta.content) {
          events.push({ type: "delta", content: delta.content });
        }
        for (const key of ["reasoning", "reasoning_content"] as const) {
          if (typeof delta[key] === "string") this.reasoningChars += (delta[key] as string).length;
        }
      }
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        events.push({ type: "finish", reason: choice.finish_reason });
      }
    }

    const usage = parseUsage(isRecord(event.x_groq) ? event.x_groq.usage : undefined) ?? parseUsage(event.usage);
    if (usage) events.push({ type: "usage", usage });
  }
}

function parseUsage(value: unknown): GroqUsage | null {
  if (!isRecord(value)) return null;
  const { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total } = value;
  if (!isCount(prompt) || !isCount(completion)) return null;
  const details = value.completion_tokens_details;
  const reasoning = isRecord(details) && isCount(details.reasoning_tokens) ? details.reasoning_tokens : null;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: isCount(total) ? total : prompt + completion,
    reasoningTokens: reasoning
  };
}

export interface ReadChatCompletionOptions {
  signal: AbortSignal;
  /** The task's `maxOutputChars`: past it the reader stops and reports `length`. */
  maxOutputChars: number;
  /** Called with each visible content delta and the text so far. */
  onDelta?: (delta: string, text: string) => void;
  /** Maps an in-band error event; defaults to `provider_unavailable`. */
  mapInBandError?: (code: string | null) => AgentRuntimeError;
  maxFrameBytes?: number;
}

export interface ChatCompletionResult {
  text: string;
  /** `stop`, `length`, `content_filter`, …; null when the stream ended without one. */
  finishReason: string | null;
  usage: GroqUsage | null;
  /** True when the reader stopped at `maxOutputChars` (finishReason is then `length`). */
  outputCapped: boolean;
  /** Reasoning characters seen and dropped (never their text). */
  reasoningChars: number;
}

/**
 * Reads a chat-completions SSE body to the end, the output cap, an in-band
 * error, or abort. Aborting cancels the underlying reader (so the connection
 * closes) and rejects with the signal's abort reason.
 */
export async function readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  options: ReadChatCompletionOptions
): Promise<ChatCompletionResult> {
  const { signal } = options;
  signal.throwIfAborted();
  const parser = new ChatCompletionSseParser(options.maxFrameBytes);
  const reader = body.getReader();
  const cancelOnAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  let text = "";
  let finishReason: string | null = null;
  let usage: GroqUsage | null = null;
  let outputCapped = false;

  const apply = (events: ChatCompletionStreamEvent[]): boolean => {
    for (const event of events) {
      switch (event.type) {
        case "delta": {
          const room = options.maxOutputChars - text.length;
          if (event.content.length > room) {
            text += event.content.slice(0, Math.max(0, room));
            finishReason = "length";
            outputCapped = true;
            return true;
          }
          text += event.content;
          options.onDelta?.(event.content, text);
          break;
        }
        case "finish":
          finishReason = event.reason;
          break;
        case "usage":
          usage = event.usage;
          break;
        case "error":
          throw options.mapInBandError?.(event.code) ?? inBandStreamError();
        case "done":
          return true;
      }
    }
    return false;
  };

  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        apply(parser.end());
        break;
      }
      if (apply(parser.push(value))) break;
    }
    return { text, finishReason, usage, outputCapped, reasoningChars: parser.reasoningChars };
  } catch (error) {
    if (error instanceof SseParseError) {
      throw new AgentRuntimeError({
        code: "malformed_provider_response",
        userMessage: "The AI returned an unreadable response. Try again.",
        detail: error.failure,
        retryable: true
      });
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    await reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // A pending read after cancel can make releaseLock throw; the stream is closed either way.
    }
  }
}

function inBandStreamError() {
  return new AgentRuntimeError({
    code: "provider_unavailable",
    userMessage: "The AI stopped before it finished. Try again.",
    detail: "stream_error",
    retryable: true
  });
}

const REASONING_MARKERS = /<\|(?:channel|message|start|end|return|call|constrain)\|>|<\/?think>/i;

/**
 * Defense in depth on top of the content-only reader: text carrying
 * harmony/control markers is discarded (spec §2, reasoning leak guard).
 */
export function containsReasoningMarkers(text: string): boolean {
  return REASONING_MARKERS.test(text);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
