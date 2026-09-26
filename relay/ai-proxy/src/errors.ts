// Error contract (spec §5): every refusal is `{ "error": { "code", ... } }`
// with a fixed code; never a provider body, never request text. No CORS
// headers anywhere (desktop only).

export type ProxyErrorCode =
  | "quota_exhausted"
  | "global_cap"
  | "install_limited"
  | "free_tier_disabled"
  | "client_outdated"
  | "invalid_token"
  | "token_expired"
  | "upstream_busy"
  | "upstream_error"
  | "upstream_timeout"
  | "bad_request"
  | "too_large"
  | "rate_limited"
  | "not_found"
  | "method_not_allowed"
  | "internal_error";

export const ERROR_STATUS: Record<ProxyErrorCode, number> = {
  quota_exhausted: 429,
  global_cap: 429,
  install_limited: 429,
  free_tier_disabled: 503,
  client_outdated: 426,
  invalid_token: 401,
  token_expired: 401,
  upstream_busy: 503,
  upstream_error: 502,
  upstream_timeout: 504,
  bad_request: 400,
  too_large: 413,
  rate_limited: 429,
  not_found: 404,
  method_not_allowed: 405,
  internal_error: 500
};

export interface ErrorExtras {
  /** ISO 8601, next 00:00 UTC; only on quota refusals. */
  resetAt?: string;
  /** `quota_exhausted` only: which layer refused (diagnostics; the app shows one notice). */
  scope?: "install" | "network";
  /** Seconds; sent as the `Retry-After` header. */
  retryAfter?: number;
  allow?: string;
}

export function errorResponse(code: ProxyErrorCode, extras: ErrorExtras = {}): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  if (extras.retryAfter !== undefined) headers["Retry-After"] = String(extras.retryAfter);
  if (extras.allow) headers.Allow = extras.allow;
  const error: Record<string, string> = { code };
  if (extras.resetAt) error.resetAt = extras.resetAt;
  if (extras.scope) error.scope = extras.scope;
  return new Response(JSON.stringify({ error }), { status: ERROR_STATUS[code], headers });
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

// ---------------------------------------------------------------------------
// UTC day helpers: quotas reset at 00:00 UTC.

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of the UTC day containing `nowMs`. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Next 00:00 UTC after the day `day`, as ISO 8601. */
export function resetAtForDay(day: string): string {
  return new Date(dayStartMs(day) + DAY_MS).toISOString();
}

export function isUtcDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && utcDay(dayStartMs(value)) === value;
}

export { DAY_MS };
