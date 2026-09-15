import { buildApp } from "./app.js";
import { config } from "./config.js";
import { ensureDatabase } from "./db.js";
import { markStaleExecutions } from "./engine/executor.js";
import { startBackgroundWorkers, stopBackgroundWorkers } from "./triggers/manager.js";

// Long-running server (local dev, VPS, Railway...). Vercel uses src/vercel.ts instead.
const app = await buildApp();
await ensureDatabase();
await markStaleExecutions(0);
await app.listen({ port: config.port, host: config.host });
const polling = await startBackgroundWorkers();
app.log.info(`Tadfuq ready on ${config.publicUrl} - ${polling} polling trigger(s), webhooks ${config.receivesWebhooks ? "public" : "local only"}`);

const shutdown = async () => {
  stopBackgroundWorkers();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
