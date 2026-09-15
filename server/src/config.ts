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

const dataDir = path.resolve(process.env.DATA_DIR || path.join(serverRoot, "data"));
fs.mkdirSync(dataDir, { recursive: true });

function loadSecret(): string {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const file = path.join(dataDir, "secret.key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

// `--port 3000` (used by the dev script) wins over PORT, so tooling that sets PORT for the web dev server can't collide.
const portArg = process.argv.indexOf("--port");
const port = Number((portArg !== -1 && process.argv[portArg + 1]) || process.env.PORT || 3000);

export const config = {
  appName: "Tadfuq",
  port,
  host: process.env.HOST || "127.0.0.1",
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  dataDir,
  secret: loadSecret(),
  webDist: path.join(projectRoot, "web", "dist"),
  maxConcurrentExecutions: Number(process.env.MAX_CONCURRENT_EXECUTIONS || 5),
  nodeTimeoutMs: 2 * 60_000,
  executionsKeptPerWorkflow: 100,
  sessionDays: 30,
};
