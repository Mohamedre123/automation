import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { assistantRoutes } from "./assistant.js";
import { authenticate, authRoutes } from "./auth.js";
import { registerProtection, rateLimit } from "./protection.js";
import { adminRoutes, billingRoutes, planRoutes } from "./billing.js";
import { mcpServerRoutes, mcpToolboxRoutes } from "./mcp.js";
import { config } from "./config.js";
import { ensureDatabase, one } from "./db.js";
import { credentialRoutes } from "./routes/credentials.js";
import { mediaLibraryRoutes, mediaRoutes } from "./routes/media.js";
import { cronRoutes, miscRoutes, publicRoutes } from "./routes/misc.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { workflowRoutes } from "./routes/workflows.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: config.isVercel ? "warn" : "info" }, bodyLimit: 4 * 1024 * 1024, trustProxy: true });

  // Webhooks can be called from any website; the app API stays same-origin.
  await app.register(cors, () => (req: any, callback: any) => {
    callback(null, { origin: String(req.url ?? "").startsWith("/webhook/") });
  });
  await app.register(formbody);
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.decorateRequest("user", null as any);

  app.setErrorHandler((error: any, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    if (error.retryAfter) (reply as any).retryAfter = error.retryAfter;
    reply.status(status).send({ error: error.message || "حصل خطأ في السيرفر" });
  });

  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/health")) return;
    if (req.url.startsWith("/api") || req.url.startsWith("/webhook") || req.url.startsWith("/media/")) await ensureDatabase();
  });

  registerProtection(app);

  // Always answers, so a broken database or missing env var is visible instead of a blank 500.
  app.get("/api/health", async () => {
    const health: Record<string, unknown> = {
      ok: true,
      publicUrl: config.publicUrl,
      webhooksReachable: config.receivesWebhooks,
      scheduler: config.cronSecret ? "ready" : "CRON_SECRET مش متضبط",
    };
    try {
      await ensureDatabase();
      health.database = "connected";
      // Round trip to the database from this server: every chatbot message makes several of these.
      const pings: number[] = [];
      for (let i = 0; i < 3; i++) {
        const started = performance.now();
        await one("SELECT 1");
        pings.push(Math.round(performance.now() - started));
      }
      health.databasePingMs = pings;
      health.serverRegion = process.env.VERCEL_REGION ?? "local";
      health.databaseRegion = config.databaseUrl.match(/aws-\d+-([a-z]+-[a-z]+-\d+)/)?.[1] ?? "unknown";
      // Scheduled scenarios only run when something pings /api/cron/tick, so how long ago that
      // last happened is the one number that says whether schedules are alive.
      const tick = await one<{ value: string }>("SELECT value FROM app_settings WHERE key = 'lastTick'");
      health.lastTickAt = tick?.value ?? null;
      health.minutesSinceTick = tick?.value ? Math.round((Date.now() - Date.parse(tick.value)) / 60_000) : null;
    } catch (error) {
      health.ok = false;
      health.database = error instanceof Error ? error.message : String(error);
    }
    return health;
  });
  await app.register(authRoutes);
  await app.register(webhookRoutes);
  await app.register(cronRoutes);
  await app.register(mediaRoutes);
  await app.register(publicRoutes);
  await app.register(planRoutes);
  await app.register(mcpServerRoutes);
  await app.register(async (api) => {
    api.addHook("onRequest", async (req) => {
      req.user = await authenticate(req);
      // Per-account ceiling on the whole logged-in API.
      await rateLimit(`api:${req.user.id}`, 600, 60);
    });
    await api.register(workflowRoutes);
    await api.register(credentialRoutes);
    await api.register(miscRoutes);
    await api.register(mediaLibraryRoutes);
    await api.register(assistantRoutes);
    await api.register(billingRoutes);
    await api.register(mcpToolboxRoutes);
    await api.register(adminRoutes);
  });

  // Local production build serves the frontend itself; on Vercel the CDN does.
  if (!config.isVercel && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/webhook")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ error: "Not found" });
    });
  }

  return app;
}
