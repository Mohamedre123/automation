import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// server/ (works from both src/ under tsx and dist/ after build)
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(serverRoot, "..");

for (const file of [path.join(projectRoot, ".env"), path.join(serverRoot, ".env")]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const isVercel = Boolean(process.env.VERCEL);
const databaseUrl = process.env.DATABASE_URL || "";

// Local mode keeps an embedded Postgres + generated secret on disk. Vercel's filesystem is read-only.
const dataDir = path.resolve(process.env.DATA_DIR || path.join(serverRoot, "data"));
if (!isVercel) fs.mkdirSync(dataDir, { recursive: true });

function loadSecret(): string {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (isVercel) throw new Error("APP_SECRET env var is required on Vercel (at least 32 characters)");
  const file = path.join(dataDir, "secret.key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

// `--port 3000` (used by the dev script) wins over PORT, so tooling that sets PORT for the web dev server can't collide.
const portArg = process.argv.indexOf("--port");
const port = Number((portArg !== -1 && process.argv[portArg + 1]) || process.env.PORT || 3000);

const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
// APP_URL is an alias: Vercel treats keys starting with PUBLIC_ as public-only variables.
const publicUrl = (process.env.PUBLIC_URL || process.env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : `http://localhost:${port}`)).replace(
  /\/+$/,
  "",
);

export const config = {
  appName: "Tadfuq",
  port,
  host: process.env.HOST || "127.0.0.1",
  publicUrl,
  isVercel,
  databaseUrl,
  dataDir,
  secret: loadSecret(),
  webDist: path.join(projectRoot, "web", "dist"),
  /** Long-lived process: in-process schedule ticker and Telegram polling are available. */
  backgroundWorkers: !isVercel && process.env.BACKGROUND_WORKERS !== "false",
  /** Third parties (Telegram) can reach our webhooks only over public HTTPS. */
  receivesWebhooks: /^https:\/\//.test(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl),
  cronSecret: process.env.CRON_SECRET || "",
  /** false = only the very first account can register (the owner). */
  allowSignup: process.env.ALLOW_SIGNUP !== "false",
  maxConcurrentExecutions: Number(process.env.MAX_CONCURRENT_EXECUTIONS || 5),
  nodeTimeoutMs: 2 * 60_000,
  executionsKeptPerWorkflow: 100,
  sessionDays: 30,
  testSessionSeconds: 120,
};
