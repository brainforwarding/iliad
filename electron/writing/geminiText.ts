import { AgentRuntimeError } from "./errors.js";

/** The single Gemini model behind all built-in writing AI. */
export const GEMINI_TEXT_MODEL = "gemini-3.8-flash";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiTextResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  promptFeedback?: { blockReason?: string };
  error?: unknown;
}

export interface GeminiTextRequest {
  apiKey: string;
  systemInstruction: string;
  input: string;
  /** Gemini counts thinking in this budget; size it for thinking plus the answer. */
  maxOutputTokens: number;
  stream: boolean;
  signal: AbortSignal;
  /** Shown when the request fails at the HTTP level; never includes provider text. */
  unavailableMessage: string;
  fetchImpl?: typeof fetch;
}

/** Visible answer text only; thought parts are never returned. */
export function geminiProse(data: GeminiTextResponse) {
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * A single text request: no agent session, tools, or conversation history.
 * Resolves with the successful response (SSE or JSON, per `stream`); HTTP
 * failures become neutral `AgentRuntimeError`s.
 */
export async function requestGeminiText(request: GeminiTextRequest): Promise<Response> {
  request.signal.throwIfAborted();
  const fetchImpl = request.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${GEMINI_API_BASE}/${GEMINI_TEXT_MODEL}:${request.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": request.apiKey },
      signal: request.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: request.input }] }],
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
          candidateCount: 1
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: { details?: Array<{ reason?: string }> };
    } | null;
    const invalidKey =
      response.status === 401 ||
      response.status === 403 ||
      errorBody?.error?.details?.some((detail) => detail.reason === "API_KEY_INVALID");
    // Never surface provider bodies, which may echo document text or credentials.
    throw new AgentRuntimeError({
      code: invalidKey
        ? "invalid_api_key"
        : response.status === 429
          ? "rate_limited"
          : response.status === 404
            ? "model_not_found"
            : "provider_unavailable",
      userMessage: request.unavailableMessage,
      providerStatus: response.status,
      retryable: response.status === 429 || response.status >= 500
    });
  }

  return response;
}

export async function readGeminiJson(response: Response): Promise<GeminiTextResponse> {
  return (await response.json().catch(() => {
    throw new AgentRuntimeError({
      code: "malformed_provider_response",
      userMessage: "Gemini returned an unreadable response.",
      retryable: true
    });
  })) as GeminiTextResponse;
}
