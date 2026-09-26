export type AgentErrorCode =
  | "invalid_api_key"
  /** A saved own Groq key that cannot be decrypted: AI is blocked, never rerouted to free. */
  | "key_unreadable"
  /** Free route: this install's or network's daily quota (proxy `quota_exhausted` / `install_limited`). */
  | "free_quota_exhausted"
  /** Free route: the proxy's global daily spend cap (`global_cap`). */
  | "free_global_cap"
  /** Free route: kill switch (`free_tier_disabled`) or no proxy configured for this build. */
  | "free_unavailable"
  /** Free route: this app version is below the proxy's minimum (`client_outdated`). */
  | "client_outdated"
  | "rate_limited"
  | "provider_unavailable"
  | "network_unreachable"
  | "dns_failure"
  | "request_timeout"
  | "request_canceled"
  | "model_not_found"
  | "malformed_provider_response"
  | "output_truncated"
  | "content_blocked"
  | "unknown";

export interface AgentError {
  code: AgentErrorCode;
  userMessage: string;
  detail?: string;
  providerStatus?: number;
  retryable: boolean;
  /** ISO 8601 time the free quota resets (00:00 UTC); only on free-route "out" refusals. */
  resetAt?: string;
}

export class AgentRuntimeError extends Error {
  readonly agentError: AgentError;

  constructor(agentError: AgentError) {
    super(agentError.userMessage);
    this.name = "AgentRuntimeError";
    this.agentError = agentError;
  }
}

export function keyUnreadableError() {
  return new AgentRuntimeError({
    code: "key_unreadable",
    userMessage: "Re-enter your Groq key in Writing assists.",
    retryable: false
  });
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

  if (name === "AbortError" || code === "ABORT_ERR") {
    return {
      code: "request_canceled",
      userMessage: "The request stopped before it completed. Try again.",
      retryable: true
    };
  }

  if (code === "ENOTFOUND") {
    return {
      code: "dns_failure",
      userMessage: "Could not reach the AI service. Check your internet or DNS connection and try again.",
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
      userMessage: "Could not reach the AI service. Check your connection and try again.",
      retryable: true
    };
  }

  return {
    code: "unknown",
    userMessage: "The AI request failed. Try again.",
    retryable: true
  };
}

export function agentErrorDiagnostic(agentError: AgentError) {
  const diagnosticCode = `AI_${agentError.code.toUpperCase()}`;
  return agentError.detail ? `${diagnosticCode} ${agentError.detail}` : diagnosticCode;
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
