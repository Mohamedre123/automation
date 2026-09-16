import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { authenticate, authRoutes } from "./auth.js";
import { config } from "./config.js";
import { ensureDatabase } from "./db.js";
import { credentialRoutes } from "./routes/credentials.js";
import { mediaRoutes } from "./routes/media.js";
import { cronRoutes, miscRoutes } from "./routes/misc.js";
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
    reply.status(status).send({ error: error.message || "حصل خطأ في السيرفر" });
  });

  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/health")) return;
    if (req.url.startsWith("/api") || req.url.startsWith("/webhook") || req.url.startsWith("/media/")) await ensureDatabase();
  });

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
  await app.register(async (api) => {
    api.addHook("onRequest", async (req) => {
      req.user = await authenticate(req);
    });
    await api.register(workflowRoutes);
    await api.register(credentialRoutes);
    await api.register(miscRoutes);
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
