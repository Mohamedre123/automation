import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto.js";
import { db, newId, now } from "./db.js";
import { httpError, requireString } from "./errors.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}

function createSession(userId: string): string {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
  return token;
}

const bearer = (req: FastifyRequest) => {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
};

export function authenticate(req: FastifyRequest): AuthUser {
  const token = bearer(req);
  if (!token) throw httpError(401, "لازم تسجّل دخول");
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as (AuthUser & { expires_at: string }) | undefined;
  if (!row || row.expires_at < now()) throw httpError(401, "الجلسة انتهت - سجّل دخول تاني");
  return { id: row.id, email: row.email, name: row.name };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = requireString(body.name, "الاسم", 100);
    const email = requireString(body.email, "الإيميل", 200).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "الإيميل مش صحيح");
    if (password.length < 8) throw httpError(400, "كلمة السر لازم تكون 8 حروف على الأقل");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw httpError(409, "الإيميل ده متسجل قبل كده");

    const id = newId();
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      email,
      name,
      hashPassword(password),
      now(),
    );
    return { token: createSession(id), user: { id, email, name } };
  });

  app.post("/api/auth/login", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const user = db.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").get(email) as
      | (AuthUser & { password_hash: string })
      | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) throw httpError(401, "الإيميل أو كلمة السر غلط");
    return { token: createSession(user.id), user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/api/auth/logout", async (req) => {
    const token = bearer(req);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({ user: authenticate(req) }));
}
