import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, run } from "./db.js";
import { httpError } from "./errors.js";

/**
 * Fixed-window rate limit kept in the database, so it holds across serverless instances.
 * Throws 429 once `limit` requests happened in the current window.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  if (config.rateLimitsDisabled) return;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await one<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = EXCLUDED.window_start
     RETURNING count`,
    [key, windowStart],
  );
  if (row && row.count > limit) {
    const retry = windowStart + windowSeconds - Math.floor(Date.now() / 1000);
    const minutes = Math.max(1, Math.ceil(retry / 60));
    throw Object.assign(httpError(429, message ?? `طلبات كتير في وقت قصير - جرّب تاني بعد ${minutes} دقيقة`), { retryAfter: retry });
  }
}

export const clientIp = (req: FastifyRequest) =>
  String(req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"] ?? req.ip ?? "unknown")
    .split(",")[0]
    .trim();

/** Old windows are useless: the scheduler tick sweeps them. */
export const cleanupRateLimits = () => run("DELETE FROM rate_limits WHERE window_start < $1", [Math.floor(Date.now() / 1000) - 2 * 86_400]);

/** Daily run cap per account: protects the platform from runaway loops or abuse. */
export async function assertExecutionQuota(userId: string) {
  const limit = config.maxExecutionsPerDay;
  if (!limit) return;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const row = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM executions WHERE user_id = $1 AND started_at >= $2", [userId, since]);
  if ((row?.n ?? 0) >= limit) {
    throw new Error(`وصلت للحد الأقصى للتشغيلات في اليوم (${limit}) - السيناريو هيكمّل بكرة، أو كلّم الدعم لزيادة الحد`);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin-allow-popups",
};

export function registerProtection(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply: FastifyReply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!reply.hasHeader(name)) reply.header(name, value);
    if (/^https:/.test(config.publicUrl)) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    // API answers are per user: never cache them in shared caches.
    if (req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    const retryAfter = (reply as any).retryAfter;
    if (retryAfter) reply.header("retry-after", String(retryAfter));
    return payload;
  });

  // Broad per-IP ceiling on public entry points (webhooks, forms, auth), then tighter limits inside the routes.
  app.addHook("onRequest", async (req) => {
    const url = req.url;
    const ip = clientIp(req);
    if (url.startsWith("/webhook/")) {
      const path = url.slice(9).split(/[/?#]/)[0];
      await rateLimit(`hook-ip:${ip}`, 300, 60);
      await rateLimit(`hook:${path}`, config.webhookRatePerMinute, 60, "الـ Webhook ده وصل للحد الأقصى من الطلبات في الدقيقة");
    } else if (url.startsWith("/api/forms/")) {
      await rateLimit(`form-ip:${ip}`, 60, 60);
    } else if (url.startsWith("/api/auth/")) {
      await rateLimit(`auth-ip:${ip}`, 60, 600);
    }
  });
}
