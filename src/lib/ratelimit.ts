/**
 * Rate limiters for public-facing endpoints. Backed by Upstash Redis
 * (or Vercel KV, same protocol). Each limiter uses a sliding-window
 * algorithm so bursts smooth out without the hard edges of fixed windows.
 *
 * Env vars: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV native names)
 *           or  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *
 * If neither pair is set, the limiters resolve to "allowed" — so dev /
 * preview builds keep working. Production prod set the env vars and
 * abuse is bounded.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function buildRedis(): Redis | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = buildRedis();

function build(config: {
  prefix: string;
  limit: number;
  windowSeconds: number;
}): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSeconds} s`),
    prefix: `rl:${config.prefix}`,
    analytics: false,
  });
}

// Tuned for an operations app with a few dozen officers, not consumer scale.
// Adjust generously if real usage hits a limit.
export const submissionLimiter = build({
  prefix: "submit",
  limit: 30, // 30 form submissions per IP per minute
  windowSeconds: 60,
});

export const uploadTokenLimiter = build({
  prefix: "upload",
  limit: 60, // 60 token grants per IP per minute (photos can be 10+ per visit)
  windowSeconds: 60,
});

export const adminInitLimiter = build({
  prefix: "admin-init",
  limit: 5,
  windowSeconds: 60 * 10,
});

/**
 * Extract a stable client identifier from a Request. Prefer the
 * Vercel-provided forwarding header, fall back to "anon" so the limiter
 * still aggregates abuse (which would be a single key under the same
 * deployment but better than nothing).
 */
export function clientKey(req: Request): string {
  const fwd =
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (!fwd) return "anon";
  return fwd.split(",")[0]!.trim();
}

export type LimitOutcome =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export async function checkLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<LimitOutcome> {
  if (!limiter) return { allowed: true };
  const result = await limiter.limit(identifier);
  if (result.success) return { allowed: true };
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.reset - Date.now()) / 1000),
  );
  return { allowed: false, retryAfterSeconds };
}
