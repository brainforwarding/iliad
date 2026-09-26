// Minimal structural shims for the Cloudflare runtime surface this Worker
// uses, so the package typechecks with plain DOM + Node types and the unit
// tests can inject in-memory versions (same approach as the removed
// relay/telegram package).

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export type SqlValue = string | number | null;

export interface SqlCursorLike {
  toArray(): Record<string, SqlValue>[];
}

export interface SqlStorageLike {
  exec(query: string, ...bindings: SqlValue[]): SqlCursorLike;
}

export interface DurableObjectStorageLike {
  sql: SqlStorageLike;
  transactionSync<T>(fn: () => T): T;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

export interface DurableObjectIdLike {
  toString(): string;
}

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike, options?: { locationHint?: string }): DurableObjectStubLike;
}

/** Workers Rate Limiting binding (`[[ratelimits]]`): per-location, approximate. */
export interface RateLimitLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AiProxyEnv {
  QUOTA?: DurableObjectNamespaceLike;
  INSTALL_RATE_LIMITER?: RateLimitLike;
  GENERATE_RATE_LIMITER?: RateLimitLike;

  FREE_TIER_ENABLED?: string;
  INSTALL_DAILY_REQUESTS?: string;
  IP_DAILY_REQUESTS?: string;
  IP_DAILY_NEW_INSTALLS?: string;
  IP48_DAILY_NEW_INSTALLS?: string;
  DENY_SUBJECTS?: string;
  SUPPORTED_PROMPT_VERSIONS?: string;
  GLOBAL_DAILY_NANO_USD?: string;
  INPUT_NANO_USD_PER_TOKEN?: string;
  OUTPUT_NANO_USD_PER_TOKEN?: string;
  PROMPT_OVERHEAD_TOKENS?: string;
  TOKEN_TTL_DAYS?: string;
  TOKEN_REFRESH_DAYS?: string;
  MIN_CLIENT_VERSION?: string;
  QUOTA_LOCATION_HINT?: string;

  // Secrets (`wrangler secret put`), never in the repo.
  GROQ_API_KEY?: string;
  TOKEN_SIGNING_KEYS?: string;
  IP_HASH_KEY?: string;
  ADMIN_TOKEN?: string;
}
