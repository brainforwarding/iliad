import { createDiagnosticsLogger, type DiagnosticsLogger } from "../diagnostics/logger.js";
import type { IdeaAutocompleteTextRequest } from "./autocomplete.js";
import { AgentRuntimeError, missingGeminiKeyError, normalizeAgentError } from "./errors.js";
import { generateGeminiAutocomplete } from "./geminiAutocomplete.js";
import { GEMINI_TEXT_MODEL, geminiProse, readGeminiJson, requestGeminiText } from "./geminiText.js";
import { WritingSettingsStore, type GeminiKeyState } from "./settingsStore.js";
import {
  geminiSelectionTransformMaxOutputTokens,
  selectionTransformInstruction,
  tightenModelInput,
  tightenSelectedText,
  type TightenLanguage,
  type TightenMode,
  type TightenSelectionRange
} from "./tighten.js";

export interface WritingAssistStatus {
  corrector: { available: boolean; provider: "local" | null };
  autocomplete: { available: boolean; provider: "gemini-api" | null; model: string | null };
  geminiKey: GeminiKeyState;
}

export interface TightenSelectionRequest {
  requestId: string;
  text: string;
  selection: TightenSelectionRange;
  language: TightenLanguage;
  mode?: TightenMode;
  instruction?: string;
  signal: AbortSignal;
}

interface WritingAiServiceOptions {
  settingsStore?: WritingSettingsStore;
  diagnostics?: DiagnosticsLogger;
  fetchImpl?: typeof fetch;
}

/** Gemini finish reasons that mean the model declined the text (not a transport failure). */
const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "LANGUAGE"
]);

/**
 * One Gemini selection rewrite (✦ AI menu: Shorten and edit presets or a typed
 * instruction). The shared instruction, marked input, and output cleaning are
 * the same ones the menu has always used; only the model call changed.
 * Unfinished (MAX_TOKENS) and declined (SAFETY and similar) answers become
 * explicit failures so a partial rewrite is never offered.
 */
export async function generateGeminiSelectionTransform(
  apiKey: string,
  request: Omit<TightenSelectionRequest, "requestId">,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const mode = request.mode ?? "tighten";
  const response = await requestGeminiText({
    apiKey,
    systemInstruction: selectionTransformInstruction({
      mode,
      language: request.language,
      instruction: request.instruction
    }),
    input: tightenModelInput(request.text, request.selection),
    maxOutputTokens: geminiSelectionTransformMaxOutputTokens(tightenSelectedText(request.text, request.selection), mode),
    stream: false,
    signal: request.signal,
    unavailableMessage: "The AI menu is unavailable. Check your Gemini API key and quota.",
    fetchImpl
  });
  const data = await readGeminiJson(response);
  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason ?? "";

  if (data.promptFeedback?.blockReason || BLOCKED_FINISH_REASONS.has(finishReason)) {
    throw new AgentRuntimeError({
      code: "content_blocked",
      userMessage: "The AI did not return a rewrite for this text.",
      detail: (data.promptFeedback?.blockReason || finishReason).toLowerCase(),
      retryable: false
    });
  }

  if (finishReason === "MAX_TOKENS") {
    throw new AgentRuntimeError({
      code: "output_truncated",
      userMessage: "The AI could not finish this rewrite. Try a shorter selection.",
      detail: "max_tokens",
      retryable: true
    });
  }

  if (finishReason !== "STOP") {
    throw new AgentRuntimeError({
      code: "malformed_provider_response",
      userMessage: "The AI returned an incomplete response. Try again.",
      detail: finishReason ? finishReason.toLowerCase() : "missing_finish_reason",
      retryable: true
    });
  }

  return geminiProse(data);
}

/**
 * Built-in writing AI: inline autocomplete and the ✦ AI selection menu, both
 * on one Gemini key. The corrector runs locally and needs no key.
 */
export class WritingAiService {
  private readonly settingsStore: WritingSettingsStore;
  private readonly diagnostics: DiagnosticsLogger;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(userDataPath: string, options: WritingAiServiceOptions = {}) {
    this.settingsStore = options.settingsStore ?? new WritingSettingsStore(userDataPath);
    this.diagnostics = options.diagnostics ?? createDiagnosticsLogger(userDataPath);
    this.fetchImpl = options.fetchImpl;
  }

  getGeminiKeyState() {
    return this.settingsStore.getGeminiKeyState();
  }

  setGeminiApiKey(key: string | null) {
    return this.settingsStore.setGeminiApiKey(key);
  }

  async writingAssistStatus(): Promise<WritingAssistStatus> {
    const geminiKey = await this.settingsStore.getGeminiKeyState();

    return {
      corrector: { available: true, provider: "local" },
      autocomplete: {
        available: geminiKey.hasKey,
        provider: geminiKey.hasKey ? "gemini-api" : null,
        model: geminiKey.hasKey ? GEMINI_TEXT_MODEL : null
      },
      geminiKey
    };
  }

  async autocompleteIdea(request: IdeaAutocompleteTextRequest): Promise<string> {
    const apiKey = await this.requireGeminiKey();
    const startedAt = Date.now();

    try {
      const text = await generateGeminiAutocomplete(apiKey, request, this.fetchImpl ?? fetch);
      this.diagnostics.info({
        area: "provider",
        event: "autocomplete.gemini.completed",
        model: GEMINI_TEXT_MODEL,
        durationMs: Date.now() - startedAt,
        details: { suggestionKind: request.suggestionKind, outputTextChars: text.length }
      });
      return text;
    } catch (error) {
      this.diagnostics.info({
        area: "provider",
        event: "autocomplete.gemini.failed",
        model: GEMINI_TEXT_MODEL,
        durationMs: Date.now() - startedAt,
        errorCode: normalizeAgentError(error, { wasCanceled: request.signal.aborted }).code
      });
      throw error;
    }
  }

  async tightenSelection(request: TightenSelectionRequest): Promise<string> {
    const apiKey = await this.requireGeminiKey();
    const startedAt = Date.now();
    const mode = request.mode ?? "tighten";

    try {
      const text = await generateGeminiSelectionTransform(apiKey, request, this.fetchImpl ?? fetch);
      this.diagnostics.info({
        area: "provider",
        event: "selection_ai.gemini.completed",
        model: GEMINI_TEXT_MODEL,
        durationMs: Date.now() - startedAt,
        details: { mode, outputTextChars: text.length }
      });
      return text;
    } catch (error) {
      const agentError = normalizeAgentError(error, { wasCanceled: request.signal.aborted });
      this.diagnostics.info({
        area: "provider",
        event: "selection_ai.gemini.failed",
        model: GEMINI_TEXT_MODEL,
        durationMs: Date.now() - startedAt,
        errorCode: agentError.code,
        details: { mode, detail: agentError.detail ?? null }
      });
      throw error;
    }
  }

  dispose() {
    void this.diagnostics.flush();
  }

  private async requireGeminiKey() {
    const apiKey = await this.settingsStore.getGeminiApiKey();

    if (!apiKey) {
      throw missingGeminiKeyError();
    }

    return apiKey;
  }
}
