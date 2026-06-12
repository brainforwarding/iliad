import type { AgentError } from "./types.js";

export class AgentRuntimeError extends Error {
  readonly agentError: AgentError;

  constructor(agentError: AgentError) {
    super(agentError.userMessage);
    this.name = "AgentRuntimeError";
    this.agentError = agentError;
  }
}

export function missingApiKeyError() {
  return new AgentRuntimeError({
    code: "missing_api_key",
    userMessage: "Connect Codex or add an OpenAI API key before asking the agent.",
    retryable: false
  });
}

export function malformedProviderResponseError() {
  return new AgentRuntimeError({
    code: "malformed_provider_response",
    userMessage: "OpenAI returned an unexpected response. Try again.",
    retryable: true
  });
}

export function providerStatusError(status: number) {
  return new AgentRuntimeError(agentErrorForProviderStatus(status));
}

export function normalizeAgentError(error: unknown, options: { wasCanceled?: boolean } = {}): AgentError {
  if (error instanceof AgentRuntimeError) {
    return error.agentError;
  }

  if (options.wasCanceled) {
    return {
      code: "request_canceled",
      userMessage: "Canceled.",
      retryable: false
    };
  }

  const name = errorName(error);
  const code = errorCode(error);
  const message = errorMessage(error);
  const host = errorHost(error);

  if (name === "AbortError" || code === "ABORT_ERR") {
    return {
      code: "request_canceled",
      userMessage: "The request stopped before it completed. Try again.",
      retryable: true
    };
  }

  if (code === "ENOTFOUND" && (host === "api.openai.com" || message.includes("api.openai.com"))) {
    return {
      code: "dns_failure",
      userMessage: "Could not reach OpenAI. Check your internet or DNS connection and try again.",
      detail: "api.openai.com",
      retryable: true
    };
  }

  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return {
      code: "request_timeout",
      userMessage: "The request took too long. Try again.",
      retryable: true
    };
  }

  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EAI_AGAIN" || isFetchNetworkFailure(error)) {
    return {
      code: "network_unreachable",
      userMessage: "Could not reach OpenAI. Check your connection and try again.",
      retryable: true
    };
  }

  return {
    code: "unknown",
    userMessage: "The agent request failed. Try again.",
    retryable: true
  };
}

export function agentErrorDiagnostic(agentError: AgentError, providerId?: string) {
  const diagnosticCode = `${diagnosticPrefix(providerId)}_${agentError.code.toUpperCase()}`;
  return agentError.detail ? `${diagnosticCode} ${agentError.detail}` : diagnosticCode;
}

function diagnosticPrefix(providerId?: string) {
  if (providerId === "codex-app-server") {
    return "CODEX";
  }

  if (providerId === "openai-api") {
    return "OPENAI";
  }

  return "AGENT";
}

function agentErrorForProviderStatus(status: number): AgentError {
  if (status === 401 || status === 403) {
    return {
      code: "invalid_api_key",
      userMessage: "The OpenAI API key was rejected. Check the saved key.",
      providerStatus: status,
      retryable: false
    };
  }

  if (status === 404) {
    return {
      code: "model_not_found",
      userMessage: "The selected model was not found. Check the model name in settings.",
      providerStatus: status,
      retryable: false
    };
  }

  if (status === 429) {
    return {
      code: "rate_limited",
      userMessage: "OpenAI rate-limited this request. Try again shortly.",
      providerStatus: status,
      retryable: true
    };
  }

  if (status === 408) {
    return {
      code: "request_timeout",
      userMessage: "The request took too long. Try again.",
      providerStatus: status,
      retryable: true
    };
  }

  if (status >= 500) {
    return {
      code: "provider_unavailable",
      userMessage: "OpenAI is unavailable right now. Try again shortly.",
      providerStatus: status,
      retryable: true
    };
  }

  return {
    code: "unknown",
    userMessage: "The agent request failed. Try again.",
    providerStatus: status,
    retryable: status >= 400
  };
}

function errorName(error: unknown): string {
  return isErrorLike(error) && typeof error.name === "string" ? error.name : "";
}

function errorMessage(error: unknown): string {
  return isErrorLike(error) && typeof error.message === "string" ? error.message : "";
}

function errorCode(error: unknown): string | undefined {
  return findStringProperty(error, "code");
}

function errorHost(error: unknown): string | undefined {
  return findStringProperty(error, "hostname") ?? findStringProperty(error, "host");
}

function findStringProperty(error: unknown, key: string): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && isRecord(current); depth += 1) {
    const value = current[key];

    if (typeof value === "string") {
      return value;
    }

    current = current.cause;
  }

  return undefined;
}

function isFetchNetworkFailure(error: unknown) {
  return errorName(error) === "TypeError" && errorMessage(error) === "fetch failed";
}

function isErrorLike(error: unknown): error is { name?: unknown; message?: unknown } {
  return typeof error === "object" && error !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
