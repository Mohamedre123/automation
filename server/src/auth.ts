import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { codeEmail, isConfigured, mailSettings, sendPlatformMail, sendQuietly, type MailSettings } from "./mailer.js";
import { welcomeEmail } from "./emails.js";
import { config } from "./config.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto.js";
import { newId, now, one, run } from "./db.js";
import { clientIp, rateLimit } from "./protection.js";
import { isAdminEmail, startTrial } from "./billing.js";
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

const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;

/** Emails a fresh 6-digit code (replacing any earlier one). At most one per minute per address. */
async function sendCode(userId: string, email: string, name: string, purpose: "register" | "login", account: MailSettings, quietIfRecent = false) {
  const previous = await one<{ sent_at: string }>("SELECT sent_at FROM email_codes WHERE email = $1", [email]);
  if (previous && Date.now() - new Date(previous.sent_at).getTime() < 55_000) {
    // A code just went out (e.g. signed up a moment ago): the one in the inbox is still good.
    if (quietIfRecent) return;
    throw httpError(429, "استنى دقيقة قبل ما تطلب كود جديد");
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await run(
    `INSERT INTO email_codes (email, user_id, code_hash, expires_at, attempts, sent_at) VALUES ($1, $2, $3, $4, 0, $5)
     ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = EXCLUDED.sent_at`,
    [email, userId, sha256(`${email}:${code}`), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), now()],
  );
  try {
    await sendPlatformMail(email, codeEmail(code, name, purpose), account);
  } catch (error) {
    console.error("[auth] verification email failed:", error instanceof Error ? error.message : error);
    throw httpError(502, "ما قدرناش نبعت الإيميل دلوقتي - جرّب كمان شوية");
  }
}

async function signedIn(id: string, email: string, name: string) {
  await startTrial(id);
  return { token: await createSession(id), user: { id, email, name, isAdmin: isAdminEmail(email) } };
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
    const existing = await one<{ id: string; email_verified: number }>("SELECT id, email_verified FROM users WHERE email = $1", [email]);
    if (existing?.email_verified) throw httpError(409, "الإيميل ده متسجل قبل كده - سجّل دخول");

    // Accounts are confirmed by a code sent to the email (when the platform's mail is set up).
    const mail = await mailSettings();
    let id = existing?.id;
    if (id) {
      // Signed up before but never confirmed: take over with the new details and send a fresh code.
      await run("UPDATE users SET name = $1, password_hash = $2 WHERE id = $3", [name, hashPassword(password), id]);
    } else {
      id = newId();
      await run("INSERT INTO users (id, email, name, password_hash, created_at, email_verified) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        email,
        name,
        hashPassword(password),
        now(),
        mail ? 0 : 1,
      ]);
    }
    if (!mail) return signedIn(id, email, name);
    await sendCode(id, email, name, "register", mail);
    return { verify: true, email };
  });

  app.post("/api/auth/login", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    // Brute force: limit attempts per account and per device.
    await rateLimit(`login:${email}`, 8, 900, "محاولات دخول كتير على الحساب ده - استنى ربع ساعة وجرّب تاني");
    await rateLimit(`login-ip:${clientIp(req)}`, 30, 900, "محاولات دخول كتير - استنى ربع ساعة وجرّب تاني");
    const user = await one<AuthUser & { password_hash: string; email_verified: number }>(
      "SELECT id, email, name, password_hash, email_verified FROM users WHERE email = $1",
      [email],
    );
    if (!user || !verifyPassword(password, user.password_hash)) throw httpError(401, "الإيميل أو كلمة السر غلط");
    if (!user.email_verified) {
      const mail = await mailSettings();
      if (mail) {
        await sendCode(user.id, user.email, user.name, "register", mail, true);
        return { verify: true, email: user.email };
      }
      await run("UPDATE users SET email_verified = 1 WHERE id = $1", [user.id]);
    }
    return { token: await createSession(user.id), user: { id: user.id, email: user.email, name: user.name, isAdmin: isAdminEmail(user.email) } };
  });

  /** The 6-digit code from the email: confirms the account and signs in. */
  app.post("/api/auth/verify", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    // Arabic-Indic digits (٠١٢…) from Arabic keyboards count too.
    const code = String(body.code ?? "")
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\D/g, "");
    await rateLimit(`verify-ip:${clientIp(req)}`, 30, 900, "محاولات كتير - استنى ربع ساعة");
    const row = await one<{ user_id: string; code_hash: string; expires_at: string; attempts: number }>(
      "SELECT user_id, code_hash, expires_at, attempts FROM email_codes WHERE email = $1",
      [email],
    );
    if (!row) throw httpError(400, "مفيش كود متبعت للإيميل ده - اطلب كود جديد");
    if (row.expires_at < now()) throw httpError(400, "الكود انتهى - اطلب كود جديد");
    if (row.attempts >= CODE_ATTEMPTS) throw httpError(400, "جربت كتير - اطلب كود جديد");
    if (code.length !== 6 || sha256(`${email}:${code}`) !== row.code_hash) {
      await run("UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1", [email]);
      const left = CODE_ATTEMPTS - row.attempts - 1;
      throw httpError(400, left > 0 ? `الكود غلط - باقي ${left} محاولات` : "الكود غلط - اطلب كود جديد");
    }
    await run("DELETE FROM email_codes WHERE email = $1", [email]);
    const user = await one<AuthUser & { email_verified: number }>("SELECT id, email, name, email_verified FROM users WHERE id = $1", [row.user_id]);
    if (!user) throw httpError(404, "الحساب مش موجود");
    if (!user.email_verified) {
      await run("UPDATE users SET email_verified = 1 WHERE id = $1", [user.id]);
      // The free trial starts once the account is confirmed.
      await startTrial(user.id);
      void sendQuietly(user.email, welcomeEmail(user.name), "welcome");
    }
    return { token: await createSession(user.id), user: { id: user.id, email: user.email, name: user.name, isAdmin: isAdminEmail(user.email) } };
  });

  app.post("/api/auth/resend", async (req) => {
    const email = String(((req.body ?? {}) as Record<string, unknown>).email ?? "").trim().toLowerCase();
    await rateLimit(`resend-ip:${clientIp(req)}`, 10, 3600, "طلبت أكواد كتير - استنى شوية");
    const user = await one<AuthUser & { email_verified: number }>("SELECT id, email, name, email_verified FROM users WHERE email = $1", [email]);
    // Same answer either way: no hint about which emails have accounts.
    if (user && !user.email_verified) {
      const mail = await mailSettings();
      if (mail) await sendCode(user.id, user.email, user.name, "register", mail);
    }
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req) => {
    const token = bearer(req);
    if (token) await run("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
    return { ok: true };
  });

  app.put("/api/auth/profile", async (req) => {
    const user = await authenticate(req);
    const name = requireString(((req.body ?? {}) as { name?: string }).name, "الاسم", 100);
    await run("UPDATE users SET name = $1 WHERE id = $2", [name, user.id]);
    return { user: { ...user, name, isAdmin: isAdminEmail(user.email) } };
  });

  /** New password: needs the current one, and signs out every other device. */
  app.post("/api/auth/password", async (req) => {
    const user = await authenticate(req);
    await rateLimit(`password:${user.id}`, 5, 900, "محاولات كتير - استنى ربع ساعة");
    const body = (req.body ?? {}) as { current?: string; next?: string };
    const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    if (!row || !verifyPassword(String(body.current ?? ""), row.password_hash)) throw httpError(400, "كلمة السر الحالية غلط");
    const next = String(body.next ?? "");
    if (next.length < 8) throw httpError(400, "كلمة السر الجديدة لازم تكون 8 حروف على الأقل");
    await run("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(next), user.id]);
    await run("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [user.id, sha256(bearer(req))]);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    const user = await authenticate(req);
    return { user: { ...user, isAdmin: isAdminEmail(user.email) } };
  });
}
