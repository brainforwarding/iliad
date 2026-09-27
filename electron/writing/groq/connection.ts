// A warm HTTPS connection to the active AI endpoint (own key → api.groq.com;
// free → the Iliad AI proxy), so the first request after a pause doesn't pay
// DNS + TCP + TLS (~70–200 ms measured, spec
// 2026-09-27-ai-context-and-preferences.md, "Follow-up: per-kind context and
// speed").
//
// Node's global fetch closes idle keep-alive sockets after 4 s (undici's
// default when the server sends no Keep-Alive hint, as Groq and Cloudflare
// don't), so the writing AI uses its own undici Agent with a longer idle
// timeout, and a warm-up request — no body, no auth, no quota — reopens the
// connection when the writer comes back to the editor, at most once per
// WRITING_AI_WARM_INTERVAL_MS per origin. Real requests count as use.

import { Agent, fetch as undiciFetch } from "undici";

/** Idle sockets to the AI endpoint stay open this long (the server may close them sooner). */
export const WRITING_AI_KEEP_ALIVE_MS = 120_000;
/** At most one warm-up request per origin this often; a real request resets it. */
export const WRITING_AI_WARM_INTERVAL_MS = 60_000;
const WARM_TIMEOUT_MS = 5_000;

/** fetch over a dedicated keep-alive Agent (same undici fetch and errors as Node's global fetch). */
export function createKeepAliveFetch(keepAliveMs = WRITING_AI_KEEP_ALIVE_MS): typeof fetch {
  const dispatcher = new Agent({ keepAliveTimeout: keepAliveMs, keepAliveMaxTimeout: keepAliveMs });
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher })) as unknown as typeof fetch;
}

export interface ConnectionWarmerOptions {
  fetchImpl: typeof fetch;
  now?: () => number;
  intervalMs?: number;
}

export class ConnectionWarmer {
  private readonly baseFetch: typeof fetch;
  private readonly now: () => number;
  private readonly intervalMs: number;
  /** Origin → last warm-up or real request. */
  private readonly lastUse = new Map<string, number>();

  constructor(options: ConnectionWarmerOptions) {
    this.baseFetch = options.fetchImpl;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? WRITING_AI_WARM_INTERVAL_MS;
  }

  /** The fetch for real AI requests: the same connection pool, and each request counts as use. */
  readonly fetch: typeof fetch = (input, init) => {
    const origin = originOf(input);
    if (origin) this.lastUse.set(origin, this.now());
    return this.baseFetch(input, init);
  };

  /**
   * Opens (or keeps) the connection to `url`'s origin with a bodiless
   * request, unless that origin was used or warmed within the interval.
   * Never throws; the answer is discarded. Returns whether a request went out.
   */
  warm(url: string, method: "HEAD" | "GET" = "HEAD"): boolean {
    const origin = originOf(url);
    if (!origin) return false;
    const now = this.now();
    const last = this.lastUse.get(origin);
    if (last !== undefined && now - last < this.intervalMs) return false;
    this.lastUse.set(origin, now);
    void this.baseFetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(WARM_TIMEOUT_MS) })
      // Reading the (tiny) body returns the socket to the pool.
      .then((response) => response.arrayBuffer())
      .catch(() => undefined);
    return true;
  }
}

function originOf(input: unknown): string | null {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: unknown })?.url;
    return typeof url === "string" ? new URL(url).origin : null;
  } catch {
    return null;
  }
}
