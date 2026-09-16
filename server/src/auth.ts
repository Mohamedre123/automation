import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto.js";
import { newId, now, one, run } from "./db.js";
import { clientIp, rateLimit } from "./protection.js";
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

async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  await run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), userId, expires]);
  await run("DELETE FROM sessions WHERE expires_at < $1", [now()]);
  return token;
}

const bearer = (req: FastifyRequest) => {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
};

export async function authenticate(req: FastifyRequest): Promise<AuthUser> {
  const token = bearer(req);
  if (!token) throw httpError(401, "لازم تسجّل دخول");
  const row = await one<AuthUser & { expires_at: string }>(
    `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [sha256(token)],
  );
  if (!row || row.expires_at < now()) throw httpError(401, "الجلسة انتهت - سجّل دخول تاني");
  return { id: row.id, email: row.email, name: row.name };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req) => {
    await rateLimit(`register:${clientIp(req)}`, 5, 3600, "اتعمل حسابات كتير من نفس الجهاز - جرّب بعد ساعة");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = requireString(body.name, "الاسم", 100);
    const email = requireString(body.email, "الإيميل", 200).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "الإيميل مش صحيح");
    if (password.length < 8) throw httpError(400, "كلمة السر لازم تكون 8 حروف على الأقل");
    if (!config.allowSignup) {
      const users = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users");
      if (users && users.n > 0) throw httpError(403, "التسجيل مقفول على المنصة دي");
    }
    if (await one("SELECT 1 AS found FROM users WHERE email = $1", [email])) throw httpError(409, "الإيميل ده متسجل قبل كده");

    const id = newId();
    await run("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [
      id,
      email,
      name,
      hashPassword(password),
      now(),
    ]);
    return { token: await createSession(id), user: { id, email, name } };
  });

  app.post("/api/auth/login", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    // Brute force: limit attempts per account and per device.
    await rateLimit(`login:${email}`, 8, 900, "محاولات دخول كتير على الحساب ده - استنى ربع ساعة وجرّب تاني");
    await rateLimit(`login-ip:${clientIp(req)}`, 30, 900, "محاولات دخول كتير - استنى ربع ساعة وجرّب تاني");
    const user = await one<AuthUser & { password_hash: string }>("SELECT id, email, name, password_hash FROM users WHERE email = $1", [email]);
    if (!user || !verifyPassword(password, user.password_hash)) throw httpError(401, "الإيميل أو كلمة السر غلط");
    return { token: await createSession(user.id), user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/api/auth/logout", async (req) => {
    const token = bearer(req);
    if (token) await run("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({ user: await authenticate(req) }));
}
