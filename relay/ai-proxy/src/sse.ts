// SSE in and out. In: the app's own OpenAI-compatible reader
// (`ChatCompletionSseParser`, content only; reasoning and every other field
// ignored). Out: minimal chunks with only `choices[0].delta.content` and
// `finish_reason`, the shape the app's reader expects on both routes. Usage is
// never forwarded.

export {
  ChatCompletionSseParser,
  SseParseError,
  type ChatCompletionStreamEvent,
  type GroqUsage
} from "../../../electron/writing/groq/sse.js";

const encoder = new TextEncoder();

export function contentChunk(content: string): Uint8Array {
  return frame({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
}

export function finishChunk(reason: string): Uint8Array {
  return frame({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
}

/** In-band error: a fixed code, never a message. */
export function errorChunk(code: "upstream_error" | "upstream_timeout"): Uint8Array {
  return frame({ error: { code } });
}

export function doneChunk(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

function frame(value: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
}
