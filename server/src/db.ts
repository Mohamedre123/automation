import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * One Postgres dialect everywhere:
 * - DATABASE_URL set (Supabase / any Postgres) -> postgres.js
 * - otherwise (local dev) -> embedded PGlite stored in DATA_DIR/pgdata
 */
interface Driver {
  query(text: string, params: unknown[]): Promise<{ rows: any[]; count: number }>;
  exec(text: string): Promise<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 0,
    graph TEXT NOT NULL,
    trigger_type TEXT,
    trigger_path TEXT,
    next_run_at TEXT,
    trigger_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
  CREATE INDEX IF NOT EXISTS idx_workflows_path ON workflows(trigger_path);
  CREATE INDEX IF NOT EXISTS idx_workflows_due ON workflows(active, next_run_at);

  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    error TEXT,
    steps TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_executions_user ON executions(user_id, started_at);

  CREATE TABLE IF NOT EXISTS trigger_state (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (workflow_id, node_id)
  );

  CREATE TABLE IF NOT EXISTS datastore (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, store, key)
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id, created_at);
  ALTER TABLE media ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '';
  ALTER TABLE media ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'generated';
  CREATE INDEX IF NOT EXISTS idx_media_folder ON media(user_id, folder);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

  CREATE TABLE IF NOT EXISTS test_sessions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    trigger_path TEXT NOT NULL,
    graph TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    execution_id TEXT,
    message TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_test_sessions_path ON test_sessions(trigger_path, status);
`;

function assertDatabaseUrl(url: string) {
  if (/\[|\]|YOUR-PASSWORD/i.test(url)) {
    throw new Error("DATABASE_URL لسه فيه [YOUR-PASSWORD] - بدّله بكلمة سر قاعدة البيانات الحقيقية");
  }
  if (!/^postgres(ql)?:\/\//.test(url.trim())) {
    throw new Error("DATABASE_URL لازم يبدأ بـ postgresql:// - انسخه من Supabase ← Connect ← Transaction pooler");
  }
  try {
    new URL(url.trim());
  } catch {
    throw new Error("DATABASE_URL مش صحيح - غالباً كلمة السر فيها رموز زي @ أو # أو / ، غيّرها لحروف وأرقام بس");
  }
}

async function createDriver(): Promise<Driver> {
  if (config.databaseUrl) {
    assertDatabaseUrl(config.databaseUrl);
    const { default: postgres } = await import("postgres");
    const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
    // Supabase transaction pooler (port 6543) does not support prepared statements.
    const sql = postgres(config.databaseUrl.trim(), {
      prepare: false,
      max: config.isVercel ? 1 : 5,
      idle_timeout: 20,
      ssl: local ? false : "require",
      onnotice: () => {},
    });
    return {
      async query(text, params) {
        const result = await sql.unsafe(text, params as any[]);
        return { rows: [...result], count: result.count ?? result.length };
      },
      async exec(text) {
        await sql.unsafe(text);
      },
    };
  }
  if (config.isVercel) throw new Error("DATABASE_URL env var is required on Vercel (Supabase connection string)");
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create(path.join(config.dataDir, "pgdata"));
  return {
    async query(text, params) {
      const result = await pg.query(text, params as any[]);
      return { rows: result.rows as any[], count: result.affectedRows ?? result.rows.length };
    },
    async exec(text) {
      await pg.exec(text);
    },
  };
}

let driverPromise: Promise<Driver> | null = null;

function driver(): Promise<Driver> {
  driverPromise ??= (async () => {
    const d = await createDriver();
    await d.exec(SCHEMA);
    await importLegacySqlite(d);
    return d;
  })().catch((error) => {
    driverPromise = null;
    throw error;
  });
  return driverPromise;
}

const clean = (params: unknown[]) => params.map((p) => (p === undefined ? null : p));

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await (await driver()).query(text, clean(params))).rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

/** Returns affected row count. */
export async function run(text: string, params: unknown[] = []): Promise<number> {
  return (await (await driver()).query(text, clean(params))).count;
}

export const ensureDatabase = () => driver().then(() => undefined);

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** One-time local migration from the first SQLite version of the app. */
async function importLegacySqlite(d: Driver) {
  if (config.isVercel || config.databaseUrl) return;
  const file = path.join(config.dataDir, "tadfuq.db");
  const marker = path.join(config.dataDir, "sqlite-imported");
  if (!fs.existsSync(file) || fs.existsSync(marker)) return;
  const existing = await d.query("SELECT COUNT(*)::int AS n FROM users", []);
  if (existing.rows[0].n > 0) return fs.writeFileSync(marker, now());

  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(file, { readOnly: true });
  const copy = async (table: string, columns: string[]) => {
    const rows = legacy.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as Record<string, unknown>[];
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    for (const row of rows) {
      await d.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, columns.map((c) => row[c]));
    }
  };
  await copy("users", ["id", "email", "name", "password_hash", "created_at"]);
  await copy("workflows", ["id", "user_id", "name", "description", "graph", "created_at", "updated_at"]);
  await copy("credentials", ["id", "user_id", "type", "name", "data", "created_at", "updated_at"]);
  await copy("datastore", ["user_id", "store", "key", "value", "updated_at"]);
  legacy.close();
  fs.writeFileSync(marker, now());
  console.log("Imported users, workflows, credentials and datastore from the old SQLite database");
}
