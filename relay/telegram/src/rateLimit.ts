export type RateLimitName =
  | "ask"
  | "status"
  | "unpaired"
  | "pairingStart"
  | "badRevokeAuth"
  | "badWebSocketAuth"
  | "duplicateWebhook";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export const DEFAULT_RATE_LIMITS: Record<RateLimitName, RateLimitRule> = {
  ask: { limit: 8, windowMs: 60_000 },
  status: { limit: 12, windowMs: 60_000 },
  unpaired: { limit: 5, windowMs: 60_000 },
  pairingStart: { limit: 6, windowMs: 60_000 },
  badRevokeAuth: { limit: 5, windowMs: 60_000 },
  badWebSocketAuth: { limit: 5, windowMs: 60_000 },
  duplicateWebhook: { limit: 20, windowMs: 60_000 }
};

interface Bucket {
  count: number;
  resetAtMs: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly rules: Record<RateLimitName, RateLimitRule> = DEFAULT_RATE_LIMITS) {}

  consume(name: RateLimitName, key: string, nowMs: number): RateLimitDecision {
    const rule = this.rules[name];
    const bucketKey = `${name}:${key}`;
    const current = this.buckets.get(bucketKey);
    const bucket = current && current.resetAtMs > nowMs ? current : { count: 0, resetAtMs: nowMs + rule.windowMs };

    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);

    const remaining = Math.max(0, rule.limit - bucket.count);
    return {
      allowed: bucket.count <= rule.limit,
      remaining,
      retryAfterMs: Math.max(0, bucket.resetAtMs - nowMs)
    };
  }

  snapshot() {
    return Array.from(this.buckets.entries()).map(([key, bucket]) => ({ key, ...bucket }));
  }
}
