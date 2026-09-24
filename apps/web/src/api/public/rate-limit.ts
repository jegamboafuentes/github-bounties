/**
 * Best-effort fixed window. One process, one map. Cloud Run runs several
 * instances, so the effective ceiling is about 60/min times the instance count.
 */

export const PUBLIC_RATE_LIMIT = 60;
export const PUBLIC_RATE_WINDOW_MS = 60_000;

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

export type RateLimiter = {
  limit: number;
  windowMs: number;
  check: (key: string) => RateLimitDecision;
};

export function createRateLimiter(options?: {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}): RateLimiter {
  const limit = options?.limit ?? PUBLIC_RATE_LIMIT;
  const windowMs = options?.windowMs ?? PUBLIC_RATE_WINDOW_MS;
  const now = options?.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return {
    limit,
    windowMs,
    check(key: string): RateLimitDecision {
      const t = now();
      const current = buckets.get(key);
      if (!current || t >= current.resetAt) {
        const resetAt = t + windowMs;
        buckets.set(key, { count: 1, resetAt });
        return {
          allowed: true,
          limit,
          remaining: limit - 1,
          resetAt,
          retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
        };
      }
      if (current.count >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - t) / 1000));
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt: current.resetAt,
          retryAfterSeconds,
        };
      }
      current.count += 1;
      return {
        allowed: true,
        limit,
        remaining: limit - current.count,
        resetAt: current.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - t) / 1000)),
      };
    },
  };
}

/** Process-local limiter shared by `/api/v1` and `/mcp`. */
export const publicRateLimiter = createRateLimiter();

export function rateLimitHeaders(
  decision: RateLimitDecision,
  nowMs: number = Date.now(),
): Record<string, string> {
  const resetSeconds = Math.max(0, Math.ceil((decision.resetAt - nowMs) / 1000));
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(resetSeconds),
  };
}
