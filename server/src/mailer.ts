import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";
import { one, run } from "./db.js";
import { sendSmtpMail } from "./nodes/smtp.js";

/*
 * The platform's own mail (verification codes). The owner sets the sending account (e.g. a Gmail with an
 * App Password) in the admin console; it is stored encrypted. MAIL_* env vars work as a fallback.
 */

export interface MailAccount {
  host: string;
  port: string;
  user: string;
  password: string;
  fromName: string;
  /** "tls" = TLS from the start on any port, "starttls" = upgrade; empty = by port (465 TLS). */
  secure?: string;
}

export async function mailAccount(): Promise<MailAccount | null> {
  const row = await one<{ value: string }>("SELECT value FROM app_settings WHERE key = 'mailAccount'");
  if (row) {
    try {
      const saved = decrypt<MailAccount>(row.value);
      if (saved.host && saved.user && saved.password) return saved;
    } catch {
      /* unreadable (secret changed): fall through */
    }
  }
  const env = process.env;
  if (env.MAIL_HOST && env.MAIL_USER && env.MAIL_PASSWORD) {
    return { host: env.MAIL_HOST, port: env.MAIL_PORT || "465", user: env.MAIL_USER, password: env.MAIL_PASSWORD, fromName: env.MAIL_FROM_NAME || "تدفّق", secure: env.MAIL_SECURE || "" };
  }
  return null;
}

export async function saveMailAccount(account: MailAccount) {
  await run("INSERT INTO app_settings (key, value) VALUES ('mailAccount', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [encrypt(account)]);
}

export async function sendPlatformMail(to: string, mail: { subject: string; html: string; text: string }, account?: MailAccount | null) {
  const from = account ?? (await mailAccount());
  if (!from) throw new Error("إيميل المنصة مش متضبط");
  return sendSmtpMail(
    { id: "platform", type: "smtpAccount", data: { ...from, fromName: from.fromName || "تدفّق" } },
    { to: [to], subject: mail.subject, body: mail.html, html: true, text: mail.text },
    AbortSignal.timeout(25_000),
  );
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Verification email. The code is the only number anywhere in it (subject, body and text part), written as
 * one run of Western digits, so Gmail's "copy code" and the reader both pick exactly those six digits.
 */
export function codeEmail(code: string, name: string, purpose: "register" | "login") {
  const who = escapeHtml(name.trim() || "بيك");
  const intro = purpose === "register" ? "أهلاً بيك في تدفّق! عشان نفعّل حسابك، اكتب الكود ده في صفحة التسجيل:" : "حد (غالباً انت) بيحاول يدخل حسابك في تدفّق. اكتب الكود ده عشان تكمّل:";
  const site = config.publicUrl;
  const subject = `${code} هو كود التحقق بتاعك في تدفّق`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f5efe8;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">كود التحقق بتاعك: ${code}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(120,60,20,0.12);">
        <tr><td style="background:linear-gradient(135deg,#f97316,#ea580c 55%,#e11d48);background-color:#ea580c;padding:26px 28px;text-align:center;">
          <img src="${site}/logo.png" alt="" width="44" height="44" style="display:inline-block;vertical-align:middle;border:0;">
          <span style="display:inline-block;vertical-align:middle;color:#ffffff;font-size:26px;font-weight:bold;margin-right:10px;">تدفّق</span>
        </td></tr>
        <tr><td style="padding:30px 28px 10px;text-align:right;color:#2b1d12;direction:rtl;">
          <p style="margin:0 0 8px;font-size:18px;font-weight:bold;">أهلاً ${who} 👋</p>
          <p style="margin:0;font-size:15px;line-height:1.9;color:#5b4a3c;">${intro}</p>
        </td></tr>
        <tr><td align="center" style="padding:18px 28px 8px;">
          <div dir="ltr" style="display:inline-block;background:#fff7ed;border:2px dashed #fb923c;border-radius:14px;padding:16px 26px;font-family:'Courier New',Consolas,monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#c2410c;">${code}</div>
        </td></tr>
        <tr><td style="padding:10px 28px 26px;text-align:right;direction:rtl;">
          <p style="margin:0 0 6px;font-size:13.5px;color:#8a7461;">الكود صالح لمدة عشر دقائق بس، ومتقولوش لأي حد - فريق تدفّق عمره ما هيطلبه منك.</p>
          <p style="margin:0;font-size:13.5px;color:#8a7461;">لو مش انت اللي طلبته، تجاهل الإيميل ده وحسابك في أمان.</p>
        </td></tr>
        <tr><td style="background:#fbf6f0;padding:18px 28px;text-align:center;border-top:1px solid #f1e4d6;">
          <p style="margin:0 0 4px;font-size:13px;color:#8a7461;">تدفّق - أتمت شغلك كله من غير كود</p>
          <a href="${site}" style="font-size:13px;color:#ea580c;text-decoration:none;">افتح تدفّق</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    `أهلاً ${name.trim() || "بيك"}،`,
    "",
    purpose === "register" ? "كود تفعيل حسابك في تدفّق:" : "كود الدخول لحسابك في تدفّق:",
    "",
    code,
    "",
    "الكود صالح لمدة عشر دقائق بس. لو مش انت اللي طلبته تجاهل الإيميل ده.",
    "",
    `تدفّق - ${site}`,
  ].join("\n");
  return { subject, html, text };
}
