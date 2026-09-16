import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth } from "./api.js";

export const messagingCredentials: CredentialType[] = [
  {
    key: "resendApi",
    name: "إيميل (Resend)",
    app: "email",
    description: "إرسال إيميلات من دومينك. اعمل حساب مجاني على resend.com، وثّق الدومين، وهات API Key.",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "re_..." },
      { key: "from", label: "الإيميل المرسل", required: true, placeholder: "شركتي <hello@yourdomain.com>" },
    ],
    test: (data) => checkAuth("Resend", "https://api.resend.com/domains", { authorization: `Bearer ${data.apiKey}` }),
  },
  {
    key: "slackBot",
    name: "Slack",
    app: "slack",
    description: "اعمل Slack App وضيف صلاحية chat:write، وهات Bot User OAuth Token. متنساش تضيف البوت للقناة.",
    docsUrl: "https://api.slack.com/apps",
    fields: [{ key: "botToken", label: "Bot Token", secret: true, required: true, placeholder: "xoxb-..." }],
    async test(data) {
      const res = await apiRequest("Slack", "https://slack.com/api/auth.test", {
        method: "POST",
        headers: { authorization: `Bearer ${data.botToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Slack: ${res.error}`);
      return `متصل بـ ${res.team}`;
    },
  },
  {
    key: "discordWebhook",
    name: "Discord",
    app: "discord",
    description: "من إعدادات القناة ← Integrations ← Webhooks ← New Webhook ← Copy URL.",
    fields: [{ key: "webhookUrl", label: "Webhook URL", secret: true, required: true, placeholder: "https://discord.com/api/webhooks/..." }],
    test: (data) => checkAuth("Discord", data.webhookUrl, {}),
  },
];

export const messagingNodes: NodeDefinition[] = [
  {
    type: "email.send",
    name: "إرسال إيميل",
    description: "بيبعت إيميل (نص أو HTML) لعميل أو ليك.",
    app: "email",
    appName: "إيميل",
    color: "#f43f5e",
    group: "apps",
    kind: "action",
    credentialTypes: ["resendApi"],
    fields: [
      { key: "to", label: "إلى", type: "text", required: true, placeholder: "{{1.data.email}} (أكتر من واحد بفاصلة)" },
      { key: "subject", label: "العنوان", type: "text", required: true },
      { key: "body", label: "المحتوى", type: "textarea", required: true },
      {
        key: "format",
        label: "نوع المحتوى",
        type: "select",
        default: "text",
        options: [
          { value: "text", label: "نص عادي" },
          { value: "html", label: "HTML" },
        ],
      },
      { key: "replyTo", label: "الرد يروح على (اختياري)", type: "text" },
    ],
    sampleOutput: { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" },
    async run({ params, credential, signal }) {
      const to = String(params.to ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!to.length) throw new Error("مفيش مستلم");
      const body: Record<string, unknown> = { from: credential?.data.from, to, subject: String(params.subject ?? "") };
      if (params.format === "html") body.html = String(params.body ?? "");
      else body.text = String(params.body ?? "");
      if (String(params.replyTo ?? "").trim()) body.reply_to = String(params.replyTo).trim();
      return {
        output: await apiRequest("Resend", "https://api.resend.com/emails", {
          json: body,
          headers: { authorization: `Bearer ${credential?.data.apiKey}` },
          signal,
        }),
      };
    },
  },
  {
    type: "slack.message",
    name: "إرسال رسالة Slack",
    description: "بيبعت رسالة لقناة أو شخص في Slack.",
    app: "slack",
    appName: "Slack",
    color: "#4a154b",
    group: "apps",
    kind: "action",
    credentialTypes: ["slackBot"],
    fields: [
      { key: "channel", label: "القناة", type: "text", required: true, placeholder: "#general أو ID القناة" },
      { key: "text", label: "الرسالة", type: "textarea", required: true },
    ],
    sampleOutput: { ok: true, channel: "C123", ts: "1789565400.000100" },
    async run({ params, credential, signal }) {
      const res = await apiRequest("Slack", "https://slack.com/api/chat.postMessage", {
        json: { channel: String(params.channel ?? "").trim(), text: String(params.text ?? "") },
        headers: { authorization: `Bearer ${credential?.data.botToken}` },
        signal,
      });
      if (!res.ok) {
        throw new Error(res.error === "not_in_channel" ? "Slack: البوت مش في القناة - اكتب /invite @اسم_البوت في القناة" : `Slack: ${res.error}`);
      }
      return { output: res };
    },
  },
  {
    type: "discord.message",
    name: "إرسال رسالة Discord",
    description: "بيبعت رسالة لقناة Discord عن طريق Webhook.",
    app: "discord",
    appName: "Discord",
    color: "#5865f2",
    group: "apps",
    kind: "action",
    credentialTypes: ["discordWebhook"],
    fields: [
      { key: "content", label: "الرسالة", type: "textarea", required: true },
      { key: "username", label: "اسم المرسل (اختياري)", type: "text" },
    ],
    sampleOutput: { sent: true },
    async run({ params, credential, signal }) {
      const url = new URL(String(credential?.data.webhookUrl ?? ""));
      url.searchParams.set("wait", "true");
      const res = await apiRequest("Discord", url, {
        json: { content: String(params.content ?? "").slice(0, 2000), ...(params.username ? { username: String(params.username) } : {}) },
        signal,
      });
      return { output: { sent: true, id: res?.id } };
    },
  },
];
