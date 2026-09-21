import { decrypt, encrypt } from "./crypto.js";
import type { Mail } from "./emails.js";
import { one, run } from "./db.js";
import { sendSmtpMail } from "./nodes/smtp.js";

/*
 * The platform's own mail: verification codes, subscription news, payment receipts.
 *
 * Two ways to send, both set from the admin console and stored encrypted:
 *  - Resend (what we recommend): an API key, and a sender on your own domain. Nothing to open,
 *    no ports, and it works the same on a serverless host.
 *  - SMTP: any mailbox with a host, a user and a password.
 *
 * MAIL_* environment variables still work as a fallback so a fresh deploy can send before
 * anybody opens the admin console.
 */

export interface MailSettings {
  provider: "resend" | "smtp";
  /** Resend. */
  apiKey: string;
  /** Shown as the sender: "تدفّق <no-reply@yourdomain.com>". */
  fromName: string;
  fromEmail: string;
  /** Where a customer's reply lands (optional). */
  replyTo: string;
  /** SMTP. */
  host: string;
  port: string;
  user: string;
  password: string;
  /** "tls" = TLS from the start on any port, "starttls" = upgrade; empty = by port (465 TLS). */
  secure: string;
}

const EMPTY: MailSettings = {
  provider: "resend",
  apiKey: "",
  fromName: "تدفّق",
  fromEmail: "",
  replyTo: "",
  host: "",
  port: "465",
  user: "",
  password: "",
  secure: "",
};

/** Older installs stored an SMTP-only account; it still reads as settings. */
function normalize(saved: Partial<MailSettings> & { fromName?: string }): MailSettings {
  const settings = { ...EMPTY, ...saved };
  if (!saved.provider) settings.provider = saved.apiKey ? "resend" : "smtp";
  if (!settings.fromEmail && settings.user.includes("@")) settings.fromEmail = settings.user;
  return settings;
}

export function isConfigured(settings: MailSettings | null): settings is MailSettings {
  if (!settings) return false;
  return settings.provider === "resend"
    ? Boolean(settings.apiKey && settings.fromEmail)
    : Boolean(settings.host && settings.user && settings.password);
}

export async function mailSettings(): Promise<MailSettings | null> {
  const row = await one<{ value: string }>("SELECT value FROM app_settings WHERE key = 'mailAccount'");
  if (row) {
    try {
      const saved = normalize(decrypt<Partial<MailSettings>>(row.value));
      if (isConfigured(saved)) return saved;
    } catch {
      /* unreadable (the secret changed): fall through to the environment */
    }
  }
  const env = process.env;
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    return normalize({
      provider: "resend",
      apiKey: env.RESEND_API_KEY,
      fromEmail: env.MAIL_FROM,
      fromName: env.MAIL_FROM_NAME || "تدفّق",
      replyTo: env.MAIL_REPLY_TO || "",
    });
  }
  if (env.MAIL_HOST && env.MAIL_USER && env.MAIL_PASSWORD) {
    return normalize({
      provider: "smtp",
      host: env.MAIL_HOST,
      port: env.MAIL_PORT || "465",
      user: env.MAIL_USER,
      password: env.MAIL_PASSWORD,
      fromName: env.MAIL_FROM_NAME || "تدفّق",
      fromEmail: env.MAIL_FROM || env.MAIL_USER,
      secure: env.MAIL_SECURE || "",
    });
  }
  return null;
}

export async function saveMailSettings(settings: MailSettings) {
  await run("INSERT INTO app_settings (key, value) VALUES ('mailAccount', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [
    encrypt(settings),
  ]);
}

/** Resend errors say exactly what is wrong; this keeps that and adds what to do about it. */
function resendMessage(status: number, body: any): string {
  const message = body?.message ?? body?.error?.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) return `Resend: المفتاح مرفوض - اتأكد إن API Key صح وإنه لسه شغال (${message})`;
  if (/domain is not verified|not verified/i.test(message)) {
    return "Resend: الدومين لسه مش متحقق منه - ادخل Resend ← Domains وكمّل سجلات الـ DNS، وبعدين استنى لحد ما يبقى Verified";
  }
  if (/you can only send testing emails|own email address/i.test(message)) {
    return "Resend: لسه بتستخدم دومين التجربة، فمينفعش تبعت غير لإيميلك انت. ضيف دومينك في Resend ← Domains وغيّر «الإيميل اللي بيبعت»";
  }
  if (status === 422 || /from/i.test(message)) return `Resend: «الإيميل اللي بيبعت» مرفوض - لازم يكون على دومين متحقق منه (${message})`;
  if (status === 429) return "Resend: وصلت للحد المسموح من الإرسال - استنى شوية وجرّب تاني";
  return `Resend: ${message}`;
}

async function sendWithResend(settings: MailSettings, to: string, mail: Mail) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${settings.fromName || "تدفّق"} <${settings.fromEmail}>`,
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(resendMessage(response.status, body));
  return { id: (body as any)?.id ?? "" };
}

export async function sendPlatformMail(to: string, mail: Mail, override?: MailSettings | null) {
  const settings = override ?? (await mailSettings());
  if (!isConfigured(settings)) throw new Error("إيميل المنصة مش متضبط - افتح لوحة الأدمن واضبط «إيميل المنصة»");
  if (settings.provider === "resend") return sendWithResend(settings, to, mail);
  return sendSmtpMail(
    {
      id: "platform",
      type: "smtpAccount",
      data: {
        host: settings.host,
        port: settings.port,
        user: settings.user,
        password: settings.password,
        secure: settings.secure,
        fromName: settings.fromName || "تدفّق",
        from: settings.fromEmail || settings.user,
      },
    },
    { to: [to], subject: mail.subject, body: mail.html, html: true, text: mail.text },
    AbortSignal.timeout(25_000),
  );
}

/**
 * Mail that is nice to have but must never break what the customer was doing:
 * a subscription is activated whether or not the receipt email goes out.
 */
export async function sendQuietly(to: string, mail: Mail, label: string) {
  try {
    if (!to?.includes("@")) return;
    await sendPlatformMail(to, mail);
  } catch (error) {
    console.error(`[mail] ${label} -> ${to}:`, error instanceof Error ? error.message : error);
  }
}

export { codeEmail } from "./emails.js";
