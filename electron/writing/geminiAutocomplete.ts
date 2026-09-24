import { autocompleteInstructions, autocompleteModelInput, type IdeaAutocompleteTextRequest } from "./autocomplete.js";
import { GEMINI_TEXT_MODEL, geminiProse as prose, readGeminiJson, requestGeminiText, type GeminiTextResponse } from "./geminiText.js";

export const AUTOCOMPLETE_GEMINI_MODEL = GEMINI_TEXT_MODEL;

export function stableAutocompletePrefix(text: string) {
  const boundary = text.search(/\S+\s*$/u);
  const stable = boundary < 0 ? "" : text.slice(0, boundary);
  return stable.trim().split(/\s+/u).length >= 3 ? stable : "";
}

export async function readGeminiAutocompleteStream(response: Response, request: IdeaAutocompleteTextRequest) {
  if (!response.body) throw new Error("Missing Gemini stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", finishReason = "", emitted = "";
  let lastEmission = 0;
  const consume = (packet: string) => {
    const data = packet.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as GeminiTextResponse;
    if (event.error) throw new Error("Gemini stream failed");
    text += prose(event);
    finishReason = event.candidates?.[0]?.finishReason ?? finishReason;
    if (text.length > 8000) throw new Error("Gemini output exceeded limit");
    const stable = stableAutocompletePrefix(text);
    if (!finishReason && stable.startsWith(emitted) && stable.length > emitted.length && Date.now() - lastEmission >= 100) {
      request.onPartial?.(stable);
      emitted = stable;
      lastEmission = Date.now();
    }
  };
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { value, done } = await reader.read();
      request.signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 128_000) throw new Error("Gemini stream frame exceeded limit");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    return finishReason === "STOP" ? text : "";
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** A single text request: no agent session, tools, or conversation history. */
export async function generateGeminiAutocomplete(
  apiKey: string,
  request: IdeaAutocompleteTextRequest,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const response = await requestGeminiText({
    apiKey,
    systemInstruction: autocompleteInstructions(request.language, request.suggestionKind, request.extend),
    input: autocompleteModelInput(request),
    // Gemini counts thinking in the output budget. Prose length is bounded
    // by the prompt and the shared output cleaner, not this token budget.
    maxOutputTokens: request.suggestionKind === "idea" ? 4096 : request.suggestionKind === "paragraph" ? 2048 : 1024,
    stream: Boolean(request.onPartial),
    signal: request.signal,
    unavailableMessage: "Gemini autocomplete is unavailable. Check your Gemini API key and quota.",
    fetchImpl
  });
  if (request.onPartial) return readGeminiAutocompleteStream(response, request);
  const data = await readGeminiJson(response);
  const candidate = data.candidates?.[0];
  // Do not offer truncated thoughts or partial output after a safety stop.
  if (candidate?.finishReason !== "STOP") return "";
  return prose(data);
}
