import { describe, expect, it, vi } from "vitest";
import { AgentRuntimeError, normalizeAgentError } from "../../../electron/writing/errors";
import {
  ChatCompletionSseParser,
  containsReasoningMarkers,
  readChatCompletionStream,
  SSE_MAX_FRAME_BYTES
} from "../../../electron/writing/groq/sse";

const encoder = new TextEncoder();

function chunk(fields: Record<string, unknown>) {
  return `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", ...fields })}\n\n`;
}

function content(text: string) {
  return chunk({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
}

function reasoning(text: string) {
  return chunk({ choices: [{ index: 0, delta: { reasoning: text, channel: "analysis" }, finish_reason: null }] });
}

const usage = { prompt_tokens: 86, completion_tokens: 21, total_tokens: 107, completion_tokens_details: { reasoning_tokens: 7 } };

function finish(reason = "stop", withUsage = true) {
  return chunk({ choices: [{ index: 0, delta: {}, finish_reason: reason }], ...(withUsage ? { x_groq: { id: "req", usage } } : {}) });
}

function streamOf(parts: Array<string | Uint8Array>, onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= parts.length) {
        controller.close();
        return;
      }
      const part = parts[index++];
      controller.enqueue(typeof part === "string" ? encoder.encode(part) : part);
    },
    cancel() {
      onCancel?.();
    }
  });
}

/** Split a string's UTF-8 bytes into chunks of `size` bytes (cutting through multi-byte characters). */
function byteChunks(text: string, size: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) out.push(bytes.slice(at, at + size));
  return out;
}

const read = (parts: Array<string | Uint8Array>, options: Partial<Parameters<typeof readChatCompletionStream>[1]> = {}) =>
  readChatCompletionStream(streamOf(parts), { signal: new AbortController().signal, maxOutputChars: 1000, ...options });

describe("readChatCompletionStream", () => {
  it("reads only delta.content and never leaks reasoning", async () => {
    const onDelta = vi.fn();
    const result = await read(
      [
        chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
        reasoning("We need one short sentence."),
        chunk({ choices: [{ index: 0, delta: { reasoning_content: "SECRET-RC" }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: { tool_calls: [{ function: { arguments: "SECRET-TOOL" } }] }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: { channel: "analysis" }, finish_reason: null }] }),
        content("Hi"),
        content(" there"),
        finish(),
        "data: [DONE]\n\n"
      ],
      { onDelta }
    );

    expect(result.text).toBe("Hi there");
    expect(result.text).not.toContain("We need");
    expect(result.finishReason).toBe("stop");
    expect(result.reasoningChars).toBe("We need one short sentence.".length + "SECRET-RC".length);
    expect(onDelta.mock.calls).toEqual([["Hi", "Hi"], [" there", "Hi there"]]);
  });

  it("captures usage from x_groq.usage or top-level usage", async () => {
    const fromXGroq = await read([content("a"), finish("stop", true), "data: [DONE]\n\n"]);
    expect(fromXGroq.usage).toEqual({ promptTokens: 86, completionTokens: 21, totalTokens: 107, reasoningTokens: 7 });

    const topLevel = await read([
      content("a"),
      finish("stop", false),
      chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
      "data: [DONE]\n\n"
    ]);
    expect(topLevel.usage).toEqual({ promptTokens: 10, completionTokens: 4, totalTokens: 14, reasoningTokens: null });
  });

  it("decodes UTF-8 split across chunks and frames split mid-line", async () => {
    const text = "Mara vio 灯台 y 🧑‍🤝‍🧑 — ñandú, é́.";
    const sse = `${content(text.slice(0, 12))}${content(text.slice(12))}${finish()}data: [DONE]\n\n`;
    for (const size of [1, 2, 3, 5, 7]) {
      const result = await read(byteChunks(sse, size));
      expect(result.text).toBe(text);
      expect(result.finishReason).toBe("stop");
    }
  });

  it("accepts CRLF frame delimiters, comments and a last frame without a blank line", async () => {
    const crlf = (frame: string) => frame.replace(/\n\n$/, "\r\n\r\n");
    const result = await read([": keep-alive\r\n\r\n", crlf(content("one")), crlf(content(" two")), finish().trimEnd()]);
    expect(result.text).toBe("one two");
    expect(result.finishReason).toBe("stop");
  });

  it("reports a missing finish_reason as null", async () => {
    const result = await read([content("cut"), "data: [DONE]\n\n"]);
    expect(result).toMatchObject({ text: "cut", finishReason: null, usage: null });
    const noDone = await read([content("cut")]);
    expect(noDone.finishReason).toBeNull();
  });

  it("passes length and content_filter through", async () => {
    expect((await read([content("a"), finish("length")])).finishReason).toBe("length");
    expect((await read([content("a"), finish("content_filter")])).finishReason).toBe("content_filter");
  });

  it("stops at the output cap and reports length", async () => {
    const onCancel = vi.fn();
    const result = await readChatCompletionStream(streamOf([content("12345"), content("67890"), content("never"), finish()], onCancel), {
      signal: new AbortController().signal,
      maxOutputChars: 8
    });
    expect(result).toMatchObject({ text: "12345678", finishReason: "length", outputCapped: true });
    expect(onCancel).toHaveBeenCalled();
  });

  it("allows output exactly at the cap", async () => {
    const result = await read([content("1234"), content("5678"), finish()], { maxOutputChars: 8 });
    expect(result).toMatchObject({ text: "12345678", finishReason: "stop", outputCapped: false });
  });

  it("surfaces an in-band error as an AgentRuntimeError without its message", async () => {
    const error = await read([content("a"), 'data: {"error":{"code":"upstream_timeout","message":"SECRET-DOC-TEXT"}}\n\n']).catch((caught) => caught);
    expect(error).toBeInstanceOf(AgentRuntimeError);
    expect(normalizeAgentError(error).code).toBe("provider_unavailable");
    expect(JSON.stringify(normalizeAgentError(error))).not.toContain("SECRET");

    const mapped = await read(['data: {"error":{"code":"upstream_timeout"}}\n\n'], {
      mapInBandError: (code) => new AgentRuntimeError({ code: code === "upstream_timeout" ? "request_timeout" : "unknown", userMessage: "x", retryable: true })
    }).catch((caught) => caught);
    expect(normalizeAgentError(mapped).code).toBe("request_timeout");
  });

  it("maps malformed JSON to malformed_provider_response without quoting the payload", async () => {
    const error = await read(["data: {not json SECRET-PAYLOAD\n\n"]).catch((caught) => caught);
    const agentError = normalizeAgentError(error);
    expect(agentError).toMatchObject({ code: "malformed_provider_response", detail: "malformed_event" });
    expect(JSON.stringify(agentError)).not.toContain("SECRET");
    expect(String(error.message)).not.toContain("SECRET");
  });

  it("rejects a frame over the size cap, even before it completes", async () => {
    const huge = `data: {"choices":[{"delta":{"content":"${"x".repeat(SSE_MAX_FRAME_BYTES)}"}}]}`;
    const error = await read(byteChunks(huge, 16 * 1024)).catch((caught) => caught);
    expect(normalizeAgentError(error)).toMatchObject({ code: "malformed_provider_response", detail: "frame_too_large" });

    const small = await read([content("ok")], { maxFrameBytes: 64 }).catch((caught) => caught);
    expect(normalizeAgentError(small).detail).toBe("frame_too_large");
  });

  it("aborts between reads, cancels the reader, and rejects as canceled", async () => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        pulls += 1;
        if (pulls === 1) {
          streamController.enqueue(encoder.encode(content("first")));
          return;
        }
        // Never resolves on its own: only the abort can end this read.
        return new Promise<void>(() => undefined);
      },
      cancel() {
        onCancel();
      }
    });
    const seen: string[] = [];
    const pending = readChatCompletionStream(body, {
      signal: controller.signal,
      maxOutputChars: 100,
      onDelta: (_delta, text) => {
        seen.push(text);
        queueMicrotask(() => controller.abort());
      }
    });
    const error = await pending.catch((caught) => caught);
    expect(seen).toEqual(["first"]);
    expect(normalizeAgentError(error, { wasCanceled: controller.signal.aborted }).code).toBe("request_canceled");
    expect(onCancel).toHaveBeenCalled();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readChatCompletionStream(streamOf([content("x")]), { signal: controller.signal, maxOutputChars: 10 })).rejects.toThrow();
  });
});

describe("ChatCompletionSseParser", () => {
  it("ignores events after [DONE]", () => {
    const parser = new ChatCompletionSseParser();
    const events = parser.push(encoder.encode(`${content("a")}data: [DONE]\n\n${content("b")}`));
    expect(events).toEqual([{ type: "delta", content: "a" }, { type: "done" }]);
  });

  it("drops an in-band error code that is not a short identifier", () => {
    const parser = new ChatCompletionSseParser();
    expect(parser.push(encoder.encode('data: {"error":{"code":"Some text: SECRET"}}\n\n'))).toEqual([{ type: "error", code: null }]);
  });
});

describe("containsReasoningMarkers", () => {
  it("flags harmony and think markers", () => {
    expect(containsReasoningMarkers("<|channel|>analysis<|message|>We need")).toBe(true);
    expect(containsReasoningMarkers("<think>hmm</think> Hello")).toBe(true);
    expect(containsReasoningMarkers("<|start|>assistant")).toBe(true);
    expect(containsReasoningMarkers("<|end|>")).toBe(true);
  });

  it("leaves ordinary prose alone", () => {
    expect(containsReasoningMarkers("She thought <b>twice</b> about the channel | message.")).toBe(false);
    expect(containsReasoningMarkers("I think so.")).toBe(false);
  });
});
