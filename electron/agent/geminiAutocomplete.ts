import { autocompleteInstructions, autocompleteModelInput, type IdeaAutocompleteTextRequest } from "./autocomplete.js";
import { AgentRuntimeError } from "./errors.js";

export const AUTOCOMPLETE_GEMINI_MODEL = "gemini-3.8-flash";

/** A single text request: no agent session, tools, or conversation history. */
export async function generateGeminiAutocomplete(
  apiKey: string,
  request: IdeaAutocompleteTextRequest,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  request.signal.throwIfAborted();
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${AUTOCOMPLETE_GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: request.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: autocompleteInstructions(request.language, request.suggestionKind) }] },
        contents: [{ role: "user", parts: [{ text: autocompleteModelInput(request) }] }],
        generationConfig: {
          // Gemini counts thinking in the output budget. Prose length is bounded
          // by the prompt and the shared output cleaner, not this token budget.
          maxOutputTokens: request.suggestionKind === "paragraph" ? 2048 : 1024,
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
  const data = await response.json().catch(() => {
    throw new AgentRuntimeError({ code: "malformed_provider_response", userMessage: "Gemini returned an unreadable response.", retryable: true });
  }) as {
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const candidate = data.candidates?.[0];
  // Do not offer truncated thoughts or partial output after a safety stop.
  if (candidate?.finishReason !== "STOP") return "";
  return (candidate.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text).join("");
}
