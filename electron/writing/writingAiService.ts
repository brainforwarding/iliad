import { createDiagnosticsLogger, type DiagnosticsLogger } from "../diagnostics/logger.js";
import type { IdeaAutocompleteTextRequest } from "./autocomplete.js";
import { AgentRuntimeError, keyUnreadableError, normalizeAgentError } from "./errors.js";
import { streamGroqText, validateGroqApiKey, type GroqKeyValidation, type GroqRoute, type GroqStreamResult } from "./groq/client.js";
import { DEV_PROXY_URL_ENV, GROQ_MODELS_URL } from "./groq/config.js";
import { ConnectionWarmer, createKeepAliveFetch } from "./groq/connection.js";
import { ProxyEndpointResolver, parseDevProxyUrl, type ProxyEndpoint } from "./groq/endpoint.js";
import { InstallTokenStore } from "./groq/installToken.js";
import { GroqKeyStore, type GroqKeyStateName, type SafeStorageLike } from "./groq/keyStore.js";
import { createAutocompletePartialEmitter } from "./groq/partials.js";
import {
  GROQ_MODEL,
  LATEST_PROMPT_VERSION,
  parseWritingAiTask,
  type PromptVersion,
  type WritingAiTask
} from "./groq/prompts/index.js";
import { buildAutocompleteTask, buildSelectionTask, type SelectionDocumentSnapshot } from "./aiTasks.js";
import { IliadAiProxyClient } from "./groq/proxyClient.js";
import { containsReasoningMarkers } from "./groq/sse.js";
import type { TightenLanguage, TightenMode, TightenSelectionRange } from "./tighten.js";
import type { DocumentNameLanguage } from "./documentName.js";

export type AiRoute = "free" | "own-key" | "blocked";

export interface WritingAssistStatus {
  corrector: { available: boolean; provider: "local" | null };
  /** No counts, no quota state: "out" is learned from request results (spec §6). */
  ai: { route: AiRoute; model: typeof GROQ_MODEL };
  groqKey: {
    state: GroqKeyStateName;
    last4: string | null;
    /** Groq refused the saved key on a request since it was saved (shown in Writing assists). */
    rejected: boolean;
  };
}

export type SetGroqKeyResult =
  | { ok: true; state: WritingAssistStatus["groqKey"] }
  | { ok: false; reason: Exclude<GroqKeyValidation, { ok: true }>["reason"] };

export interface TightenSelectionRequest {
  requestId: string;
  text: string;
  selection: TightenSelectionRange;
  language: TightenLanguage;
  mode?: TightenMode;
  instruction?: string;
  /** The full document with the absolute selection (read-only reference on v2). */
  document?: SelectionDocumentSnapshot;
  /** Validated writing preferences; "" or undefined = none. */
  preferences?: string;
  signal: AbortSignal;
}

export interface WritingAiServiceOptions {
  keyStore?: Pick<GroqKeyStore, "read" | "getState" | "setKey">;
  /** The free route's proxy client (tests inject a fake-proxy-backed one). */
  proxy?: Pick<IliadAiProxyClient, "stream">;
  /** The free route's endpoint, for connection warm-up (defaults to the proxy client's resolver). */
  proxyEndpoint?: { peek(): Promise<ProxyEndpoint> };
  /** Clock for the warm-up rate limit (tests). */
  now?: () => number;
  diagnostics?: DiagnosticsLogger;
  fetchImpl?: typeof fetch;
  safeStorage?: SafeStorageLike | null;
  /** Env overrides (`GROQ_API_KEY`, `ILIAD_AI_PROXY_URL`) are read only when false. Defaults to true. */
  isPackaged?: boolean;
  env?: NodeJS.ProcessEnv;
  clientVersion?: string;
  validateKey?: (key: string) => Promise<GroqKeyValidation>;
}

/**
 * Built-in writing AI: inline autocomplete, the ✦ AI selection menu and
 * naming untitled documents, on
 * Groq (`openai/gpt-oss-120b`) through one of two routes, chosen per request
 * from the key store (spec §1): no key → free (Iliad AI proxy); a key → own
 * key (direct); an unreadable key → blocked. There is no fallback between
 * routes. The corrector runs locally and needs no AI.
 */
export class WritingAiService {
  private readonly keyStore: Pick<GroqKeyStore, "read" | "getState" | "setKey">;
  private readonly proxy: Pick<IliadAiProxyClient, "stream">;
  private readonly diagnostics: DiagnosticsLogger;
  private readonly fetchImpl: typeof fetch | undefined;
  /** AI requests (both routes) and warm-ups share one keep-alive connection pool. */
  private readonly warmer: ConnectionWarmer;
  private readonly proxyEndpoint: { peek(): Promise<ProxyEndpoint> } | null;
  private readonly validateKey: (key: string) => Promise<GroqKeyValidation>;
  /** The saved key Groq rejected on a request (memory only), for the menu's error state. */
  private rejectedKey: string | null = null;

  constructor(userDataPath: string, options: WritingAiServiceOptions = {}) {
    const isPackaged = options.isPackaged ?? true;
    const env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl;
    this.warmer = new ConnectionWarmer({ fetchImpl: options.fetchImpl ?? createKeepAliveFetch(), now: options.now });
    this.keyStore = options.keyStore ?? new GroqKeyStore(userDataPath, {
      safeStorage: options.safeStorage ?? null,
      allowEnvKey: !isPackaged,
      env
    });
    const endpoint = options.proxy
      ? null
      : new ProxyEndpointResolver(userDataPath, {
          devOverrideUrl: isPackaged ? null : parseDevProxyUrl(env[DEV_PROXY_URL_ENV]),
          fetchImpl: options.fetchImpl
        });
    this.proxyEndpoint = options.proxyEndpoint ?? endpoint;
    this.proxy = options.proxy ?? new IliadAiProxyClient({
      endpoint: endpoint!,
      tokens: new InstallTokenStore(userDataPath),
      clientVersion: options.clientVersion ?? "0.0.0",
      fetchImpl: this.warmer.fetch
    });
    this.diagnostics = options.diagnostics ?? createDiagnosticsLogger(userDataPath);
    this.validateKey = options.validateKey ?? ((key) => validateGroqApiKey(key, { fetchImpl: this.fetchImpl }));
  }

  async getGroqKeyState(): Promise<WritingAssistStatus["groqKey"]> {
    const read = await this.keyStore.read();
    const state = await this.keyStore.getState();
    return { ...state, rejected: read.state === "ok" && read.key === this.rejectedKey };
  }

  /** Validates a new key against Groq before saving it (only a 200 saves); null removes it. */
  async setGroqApiKey(key: string | null): Promise<SetGroqKeyResult> {
    if (key !== null) {
      const trimmed = key.trim();
      const validation = await this.validateKey(trimmed);
      this.diagnostics.info({
        area: "provider",
        event: "ai.key.validated",
        details: { outcome: validation.ok ? "ok" : validation.reason }
      });
      if (!validation.ok) return validation;
      key = trimmed;
    }

    this.rejectedKey = null;
    await this.keyStore.setKey(key);
    return { ok: true, state: await this.getGroqKeyState() };
  }

  async writingAssistStatus(): Promise<WritingAssistStatus> {
    const groqKey = await this.getGroqKeyState();
    return {
      corrector: { available: true, provider: "local" },
      ai: { route: routeForKeyState(groqKey.state), model: GROQ_MODEL },
      groqKey
    };
  }

  async autocompleteIdea(request: IdeaAutocompleteTextRequest): Promise<string> {
    const build = (version: PromptVersion) =>
      buildAutocompleteTask(version, {
        language: request.language,
        kind: request.suggestionKind,
        extend: request.extend === true,
        prefix: request.prefix,
        suffix: request.suffix,
        documentTitle: request.documentTitle,
        headingPath: request.headingPath,
        nearbyHeadings: request.nearbyHeadings,
        direction: request.direction ?? "",
        avoid: request.avoid ?? [],
        document: request.document,
        preferences: request.preferences
      });
    const emitPartial = request.onPartial ? createAutocompletePartialEmitter(request.onPartial) : null;
    const result = await this.run("autocomplete", request.signal, build, emitPartial ? (_delta, text) => emitPartial(text) : undefined, {
      suggestionKind: request.suggestionKind
    });

    // Only a clean stop is offered; `length`, `content_filter` or a missing
    // reason → no suggestion. Reasoning/control markers → discarded.
    if (result.finishReason !== "stop" || containsReasoningMarkers(result.text)) return "";
    return result.text;
  }

  async tightenSelection(request: TightenSelectionRequest): Promise<string> {
    const mode = request.mode ?? "tighten";
    const build = (version: PromptVersion) =>
      buildSelectionTask(version, {
        language: request.language,
        mode,
        ...(mode === "edit" ? { instruction: request.instruction ?? "" } : {}),
        text: request.text,
        selection: { from: request.selection.from, to: request.selection.to },
        document: request.document,
        preferences: request.preferences
      });
    const result = await this.run("selection_ai", request.signal, build, undefined, { mode });

    switch (result.finishReason) {
      case "stop":
        if (containsReasoningMarkers(result.text)) throw malformed("reasoning_marker");
        return result.text;
      case "length":
        throw new AgentRuntimeError({
          code: "output_truncated",
          userMessage: "The AI could not finish this rewrite. Try a shorter selection.",
          detail: "length",
          retryable: true
        });
      case "content_filter":
        throw new AgentRuntimeError({
          code: "content_blocked",
          userMessage: "The AI did not return a rewrite for this text.",
          detail: "content_filter",
          retryable: false
        });
      default:
        throw malformed(result.finishReason ? "finish_other" : "missing_finish_reason");
    }
  }

  /**
   * A short title for an untitled document from its opening text (the `name`
   * task, v2 on), on the same route as every other request. Returns the raw
   * answer; the caller cleans it. Only a clean stop without reasoning
   * markers is returned; anything else throws.
   */
  async suggestName(request: { language: DocumentNameLanguage; text: string }, signal: AbortSignal): Promise<string> {
    const build = (version: PromptVersion): WritingAiTask => {
      switch (version) {
        case 1:
          // `name` exists only from v2 on.
          throw new Error("name task needs prompt v2 or later");
        case 2:
          return { v: 2, task: "name", language: request.language, text: request.text };
        case 3:
          return { v: 3, task: "name", language: request.language, text: request.text };
        default:
          return unknownVersion(version);
      }
    };
    const result = await this.run("document_name", signal, build, undefined, {});

    if (result.finishReason === "stop" && !containsReasoningMarkers(result.text)) return result.text;
    if (result.finishReason === "content_filter") {
      throw new AgentRuntimeError({
        code: "content_blocked",
        userMessage: "The AI did not return a title for this text.",
        detail: "content_filter",
        retryable: false
      });
    }
    throw malformed(result.finishReason === "stop" ? "reasoning_marker" : result.finishReason ? "finish_other" : "missing_finish_reason");
  }

  dispose() {
    void this.diagnostics.flush();
  }

  /**
   * Keeps the connection to the active endpoint warm (the renderer calls it
   * when the writer returns to the editor): own key → a bodiless, unauthenticated
   * `HEAD` to Groq; free → `GET /healthz` on the proxy (never `/v1/generate`,
   * no install token, no quota). Nothing when AI is blocked or the proxy isn't
   * configured; at most once per origin per WRITING_AI_WARM_INTERVAL_MS, and
   * not at all while real requests keep the connection in use.
   */
  async warmConnection(): Promise<"own-key" | "free" | "skipped"> {
    const state = (await this.keyStore.getState()).state;
    const route = routeForKeyState(state);
    if (route === "own-key") return this.warmer.warm(GROQ_MODELS_URL, "HEAD") ? "own-key" : "skipped";
    if (route !== "free" || !this.proxyEndpoint) return "skipped";
    const endpoint = await this.proxyEndpoint.peek().catch(() => null);
    if (!endpoint?.ok) return "skipped";
    return this.warmer.warm(`${endpoint.baseUrl}/healthz`, "GET") ? "free" : "skipped";
  }

  private async route(): Promise<{ name: AiRoute; route: GroqRoute | null; key: string | null }> {
    const read = await this.keyStore.read();
    if (read.state === "ok") return { name: "own-key", route: { kind: "own-key", apiKey: read.key }, key: read.key };
    if (read.state === "unreadable") return { name: "blocked", route: null, key: null };
    return { name: "free", route: { kind: "free", proxy: this.proxy }, key: null };
  }

  private async run(
    area: "autocomplete" | "selection_ai" | "document_name",
    signal: AbortSignal,
    buildTask: (version: PromptVersion) => WritingAiTask,
    onDelta: ((delta: string, text: string) => void) | undefined,
    details: Record<string, string>
  ): Promise<GroqStreamResult> {
    const startedAt = Date.now();
    const route = await this.route();

    try {
      // An unreadable own key blocks AI: never sent through the free proxy.
      if (!route.route) throw keyUnreadableError();
      // Both routes send the newest version for every task (the Worker serving
      // it is deployed before the app that sends it; docs/release.md).
      const promptVersion = LATEST_PROMPT_VERSION;
      details = { ...details, promptVersion: String(promptVersion) };
      const task = checkedTask(buildTask(promptVersion));
      const result = await streamGroqText({ route: route.route, task, signal, onDelta, fetchImpl: this.warmer.fetch });
      // Diagnostics: codes, counts and timings only — never text, keys, tokens or bodies.
      this.diagnostics.info({
        area: "provider",
        event: `${area}.ai.completed`,
        model: GROQ_MODEL,
        durationMs: Date.now() - startedAt,
        details: {
          ...details,
          route: route.name,
          firstDeltaMs: result.firstDeltaMs,
          finishReason: result.finishReason,
          outputTextChars: result.text.length
        }
      });
      return result;
    } catch (error) {
      const agentError = normalizeAgentError(error, { wasCanceled: signal.aborted });
      if (agentError.code === "invalid_api_key" && route.key) this.rejectedKey = route.key;
      this.diagnostics.info({
        area: "provider",
        event: `${area}.ai.failed`,
        model: GROQ_MODEL,
        durationMs: Date.now() - startedAt,
        errorCode: agentError.code,
        providerStatus: agentError.providerStatus,
        details: { ...details, route: route.name, detail: agentError.detail ?? null }
      });
      throw error;
    }
  }
}

export function routeForKeyState(state: GroqKeyStateName): AiRoute {
  return state === "ok" ? "own-key" : state === "unreadable" ? "blocked" : "free";
}

/** Tasks are built from already-normalized IPC requests; the strict parser is a last check before sending. */
function checkedTask(task: WritingAiTask): WritingAiTask {
  const parsed = parseWritingAiTask(task);
  if (!parsed.ok) {
    throw new AgentRuntimeError({
      code: "provider_unavailable",
      userMessage: "The AI couldn't take this request.",
      detail: `task_invalid_${parsed.field.replace(/[^A-Za-z]/g, "").slice(0, 24)}`,
      retryable: false
    });
  }
  return parsed.task;
}

function unknownVersion(version: never): never {
  throw new Error(`unknown prompt version: ${String(version)}`);
}

function malformed(detail: string) {
  return new AgentRuntimeError({
    code: "malformed_provider_response",
    userMessage: "The AI returned an incomplete response. Try again.",
    detail,
    retryable: true
  });
}
