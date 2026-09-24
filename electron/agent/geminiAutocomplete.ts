import { autocompleteInstructions, autocompleteModelInput, type IdeaAutocompleteTextRequest } from "./autocomplete.js";
import { AgentRuntimeError } from "./errors.js";

export const AUTOCOMPLETE_GEMINI_MODEL = "gemini-3.8-flash";

interface GeminiTextResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  error?: unknown;
}

function prose(data: GeminiTextResponse) {
  return (data.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("");
}

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
  request.signal.throwIfAborted();
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${AUTOCOMPLETE_GEMINI_MODEL}:${request.onPartial ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: request.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: autocompleteInstructions(request.language, request.suggestionKind, request.extend) }] },
        contents: [{ role: "user", parts: [{ text: autocompleteModelInput(request) }] }],
        generationConfig: {
          // Gemini counts thinking in the output budget. Prose length is bounded
          // by the prompt and the shared output cleaner, not this token budget.
          maxOutputTokens: request.suggestionKind === "idea" ? 4096 : request.suggestionKind === "paragraph" ? 2048 : 1024,
          thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
          candidateCount: 1
        }
      })
    }
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as {
      error?: { details?: Array<{ reason?: string }> }
    } | null;
    const invalidKey = response.status === 401 || response.status === 403 ||
      errorBody?.error?.details?.some((detail) => detail.reason === "API_KEY_INVALID");
    // Never surface provider bodies, which may echo document text or credentials.
    throw new AgentRuntimeError({
      code: invalidKey
        ? "invalid_api_key"
        : response.status === 429 ? "rate_limited"
          : response.status === 404 ? "model_not_found" : "provider_unavailable",
      userMessage: "Gemini autocomplete is unavailable. Check your Gemini API key and quota.",
      providerStatus: response.status,
      retryable: response.status === 429 || response.status >= 500
    });
  }
  if (request.onPartial) return readGeminiAutocompleteStream(response, request);
  const data = await response.json().catch(() => {
    throw new AgentRuntimeError({ code: "malformed_provider_response", userMessage: "Gemini returned an unreadable response.", retryable: true });
  }) as GeminiTextResponse;
  const candidate = data.candidates?.[0];
  // Do not offer truncated thoughts or partial output after a safety stop.
  if (candidate?.finishReason !== "STOP") return "";
  return prose(data);
}
