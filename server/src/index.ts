import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { authenticate, authRoutes } from "./auth.js";
import { config } from "./config.js";
import { markInterruptedExecutions } from "./engine/executor.js";
import { credentialRoutes } from "./routes/credentials.js";
import { miscRoutes } from "./routes/misc.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { workflowRoutes } from "./routes/workflows.js";
import { startAllTriggers, stopAllTriggers } from "./triggers/manager.js";

const app = Fastify({ logger: { level: "info" }, bodyLimit: 5 * 1024 * 1024, trustProxy: true });

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

app.get("/api/health", async () => ({ ok: true }));
await app.register(authRoutes);
await app.register(webhookRoutes);
await app.register(async (api) => {
  api.addHook("onRequest", async (req) => {
    req.user = authenticate(req);
  });
  await api.register(workflowRoutes);
  await api.register(credentialRoutes);
  await api.register(miscRoutes);
});

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/webhook")) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: "Not found" });
  });
}

markInterruptedExecutions();
await app.listen({ port: config.port, host: config.host });
const active = startAllTriggers();
app.log.info(`Tadfuq ready on ${config.publicUrl} - ${active} active workflow(s)`);

const shutdown = async () => {
  stopAllTriggers();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
