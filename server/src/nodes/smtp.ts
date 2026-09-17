import net from "node:net";
import tls from "node:tls";
import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";

/*
 * Plain SMTP (with a password / app password): Gmail, Outlook, Zoho, Hostinger, cPanel mail...
 * Port 465 = TLS from the start, anything else = STARTTLS.
 */

type Socket = net.Socket | tls.TLSSocket;

class SmtpConnection {
  private buffer = "";
  private waiters: ((lines: string[]) => void)[] = [];
  private lines: string[] = [];
  private failure: Error | null = null;

  constructor(private socket: Socket) {
    this.attach(socket);
  }

  private attach(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf("\r\n")) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        this.lines.push(line);
        // "250-..." continues, "250 ..." ends a reply.
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const reply = this.lines;
          this.lines = [];
          this.waiters.shift()?.(reply);
        }
      }
    });
    socket.on("error", (error) => {
      this.failure = error;
      for (const waiter of this.waiters.splice(0)) waiter([`000 ${error.message}`]);
    });
  }

  read(): Promise<string[]> {
    if (this.failure) return Promise.resolve([`000 ${this.failure.message}`]);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async command(line: string | null, expect: number[], label: string, hideLine = false) {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    const code = Number(reply[reply.length - 1]?.slice(0, 3));
    if (!expect.includes(code)) {
      const text = reply.join(" ").slice(0, 300);
      if (code === 535 || code === 534) throw new Error("الإيميل أو كلمة السر غلط - لو Gmail لازم تستخدم App Password مش كلمة السر العادية");
      throw new Error(`SMTP (${label}): ${hideLine ? text.replace(/\S{20,}/g, "…") : text}`);
    }
    return reply;
  }

  upgrade(host: string) {
    return new Promise<void>((resolve, reject) => {
      const secure = tls.connect({ socket: this.socket as net.Socket, servername: host }, () => resolve());
      secure.once("error", reject);
      this.attach(secure);
    });
  }

  close() {
    this.socket.end();
    this.socket.destroy();
  }
}

function connect(host: string, port: number, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(new Error(`مقدرتش أوصل لسيرفر الإيميل ${host}:${port} - ${error.message}`));
    const socket: Socket =
      port === 465 ? tls.connect({ host, port, servername: host }, () => resolve(socket)) : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(30_000, () => socket.destroy(new Error("انتهت المهلة")));
    socket.once("error", onError);
    signal.addEventListener("abort", () => socket.destroy(new Error("اتلغى")), { once: true });
  });
}

const address = (value: string) => value.match(/<([^>]+)>/)?.[1]?.trim() ?? value.trim();
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`);
const emails = (value: unknown) =>
  String(value ?? "")
    .split(/[,;،\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.includes("@"));

async function session(credential: CredentialValue | undefined, signal: AbortSignal) {
  const host = String(credential?.data.host ?? "").trim();
  const port = Number(credential?.data.port) || 465;
  const user = String(credential?.data.user ?? "").trim();
  const password = String(credential?.data.password ?? "").replace(/\s+/g, "");
  if (!host || !user || !password) throw new Error("حساب الإيميل ناقص (السيرفر أو الإيميل أو كلمة السر)");

  const smtp = new SmtpConnection(await connect(host, port, signal));
  try {
    await smtp.command(null, [220], "greeting");
    let ehlo = await smtp.command("EHLO tadfuq.app", [250], "EHLO");
    if (port !== 465) {
      if (!ehlo.some((line) => /STARTTLS/i.test(line))) throw new Error("سيرفر الإيميل مش بيدعم تشفير STARTTLS - جرّب بورت 465");
      await smtp.command("STARTTLS", [220], "STARTTLS");
      await smtp.upgrade(host);
      ehlo = await smtp.command("EHLO tadfuq.app", [250], "EHLO");
    }
    if (ehlo.some((line) => /AUTH[ =].*PLAIN/i.test(line))) {
      await smtp.command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString("base64")}`, [235], "login", true);
    } else {
      await smtp.command("AUTH LOGIN", [334], "login");
      await smtp.command(Buffer.from(user).toString("base64"), [334], "login", true);
      await smtp.command(Buffer.from(password).toString("base64"), [235], "login", true);
    }
    return { smtp, user };
  } catch (error) {
    smtp.close();
    throw error;
  }
}

export async function sendSmtpMail(
  credential: CredentialValue | undefined,
  mail: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; html?: boolean; replyTo?: string },
  signal: AbortSignal,
) {
  const { smtp, user } = await session(credential, signal);
  try {
    const fromName = String(credential?.data.fromName ?? "").trim();
    const from = fromName ? `${encodeHeader(fromName)} <${user}>` : user;
    await smtp.command(`MAIL FROM:<${address(user)}>`, [250], "MAIL FROM");
    for (const recipient of [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])]) {
      await smtp.command(`RCPT TO:<${address(recipient)}>`, [250, 251], `RCPT ${recipient}`);
    }
    await smtp.command("DATA", [354], "DATA");
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${address(user).split("@")[1] ?? "tadfuq.app"}>`;
    const headers = [
      `From: ${from}`,
      `To: ${mail.to.join(", ")}`,
      ...(mail.cc?.length ? [`Cc: ${mail.cc.join(", ")}`] : []),
      ...(mail.replyTo ? [`Reply-To: ${mail.replyTo}`] : []),
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      `Content-Type: ${mail.html ? "text/html" : "text/plain"}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
    ];
    const body = (Buffer.from(mail.body).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
    await smtp.command(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.`, [250], "إرسال الرسالة");
    await smtp.command("QUIT", [221], "QUIT").catch(() => undefined);
    return { sent: true, messageId, to: mail.to };
  } finally {
    smtp.close();
  }
}

export const smtpCredential: CredentialType = {
  key: "smtpAccount",
  name: "إيميل (Gmail / Outlook / أي إيميل بـ SMTP)",
  app: "gmail",
  description: "إرسال إيميلات من إيميلك نفسه بكلمة سر التطبيقات - من غير أي تطبيقات أو تسجيل دخول.",
  fields: [
    { key: "host", label: "سيرفر SMTP", required: true, placeholder: "smtp.gmail.com" },
    { key: "port", label: "البورت", placeholder: "465", help: "465 (الأشهر) أو 587." },
    { key: "user", label: "الإيميل", required: true, placeholder: "you@gmail.com" },
    { key: "password", label: "كلمة السر (App Password)", secret: true, required: true },
    { key: "fromName", label: "اسم المرسل (اختياري)", placeholder: "متجر تدفّق" },
  ],
  steps: [
    "Gmail: افتح myaccount.google.com ← Security وفعّل 2-Step Verification لو مش متفعّل.",
    "افتح myaccount.google.com/apppasswords، اكتب اسم (مثلاً تدفق) ودوس Create - هيطلعلك باسورد من 16 حرف، انسخه.",
    "هنا: السيرفر smtp.gmail.com والبورت 465 والإيميل بتاعك، والصق الباسورد اللي نسخته.",
    "Outlook / Hotmail: السيرفر smtp.office365.com والبورت 587.",
    "إيميل الدومين (Hostinger / cPanel / Zoho): هتلاقي سيرفر SMTP والبورت في إعدادات الإيميل عند الاستضافة.",
  ],
  async test(data) {
    const { smtp, user } = await session({ id: "", type: "smtpAccount", data }, AbortSignal.timeout(30_000));
    await smtp.command("QUIT", [221], "QUIT").catch(() => undefined);
    smtp.close();
    return `متصل كـ ${user}`;
  },
};

export const smtpNode: NodeDefinition = {
  type: "email.smtpSend",
  name: "إرسال إيميل (Gmail / SMTP)",
  description: "بيبعت إيميل من إيميلك (Gmail أو Outlook أو إيميل الدومين) - نص أو HTML.",
  app: "gmail",
  appName: "إيميل",
  color: "#ea4335",
  group: "apps",
  kind: "action",
  credentialTypes: ["smtpAccount"],
  fields: [
    { key: "to", label: "إلى", type: "text", required: true, placeholder: "{{1.data.email}}" },
    { key: "subject", label: "العنوان", type: "text", required: true },
    { key: "body", label: "المحتوى", type: "textarea", required: true },
    {
      key: "format",
      label: "نوع المحتوى",
      type: "select",
      default: "text",
      options: [
        { value: "text", label: "نص" },
        { value: "html", label: "HTML" },
      ],
    },
    { key: "cc", label: "نسخة (CC)", type: "text" },
    { key: "bcc", label: "نسخة مخفية (BCC)", type: "text" },
    { key: "replyTo", label: "الرد يروح على", type: "text" },
  ],
  sampleOutput: { sent: true, messageId: "<1789.abc@gmail.com>", to: ["client@example.com"] },
  async run({ params, credential, signal }) {
    const to = emails(params.to);
    if (!to.length) throw new Error("مفيش إيميل صحيح في «إلى»");
    const output = await sendSmtpMail(
      credential,
      {
        to,
        cc: emails(params.cc),
        bcc: emails(params.bcc),
        subject: String(params.subject ?? ""),
        body: String(params.body ?? ""),
        html: params.format === "html",
        replyTo: String(params.replyTo ?? "").trim() || undefined,
      },
      signal,
    );
    return { output };
  },
};
