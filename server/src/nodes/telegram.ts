import type { CredentialType, FieldDef, NodeDefinition } from "../engine/types.js";
import { withTimeout } from "./util.js";

async function telegram<T = any>(token: string, method: string, body: object, signal?: AbortSignal): Promise<T> {
  if (!token) throw new Error("Bot token مش موجود");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await response.json().catch(() => null)) as { ok: boolean; result: T; description?: string } | null;
  if (!data?.ok) {
    if (response.status === 401 || response.status === 404) throw new Error("Telegram: الـ Bot token غلط");
    throw new Error(`Telegram: ${data?.description ?? `HTTP ${response.status}`}`);
  }
  return data.result;
}

export const telegramCredential: CredentialType = {
  key: "telegramBot",
  name: "Telegram Bot",
  app: "telegram",
  description: "هات الـ token من @BotFather على تيليجرام.",
  docsUrl: "https://core.telegram.org/bots/tutorial#obtain-your-bot-token",
  fields: [{ key: "botToken", label: "Bot Token", secret: true, required: true, placeholder: "123456:ABC-DEF..." }],
  async test(data) {
    const me = await telegram<{ username: string }>(data.botToken, "getMe", {}, AbortSignal.timeout(15_000));
    return `متصل بالبوت @${me.username}`;
  },
};

const chatIdField: FieldDef = {
  key: "chatId",
  label: "Chat ID",
  type: "text",
  required: true,
  placeholder: "{{1.message.chat.id}}",
  help: "رقم المحادثة. لو بترد على رسالة جاية من المحفّز استخدم {{1.message.chat.id}}",
};

const parseModeField: FieldDef = {
  key: "parseMode",
  label: "تنسيق النص",
  type: "select",
  default: "",
  options: [
    { value: "", label: "بدون" },
    { value: "HTML", label: "HTML" },
    { value: "MarkdownV2", label: "MarkdownV2" },
  ],
};

const sampleMessage = {
  message_id: 42,
  from: { id: 123456789, is_bot: false, first_name: "Ahmed", username: "ahmed" },
  chat: { id: 123456789, first_name: "Ahmed", type: "private" },
  date: 1767261600,
  text: "مرحبا، عايز أعرف الأسعار",
};

export const telegramNodes: NodeDefinition[] = [
  {
    type: "telegram.trigger",
    name: "مراقبة الرسائل",
    description: "بيشتغل أول ما حد يبعت رسالة للبوت.",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "trigger",
    kind: "trigger",
    triggerType: "poll",
    credentialTypes: ["telegramBot"],
    fields: [
      {
        key: "updateType",
        label: "نوع التحديثات",
        type: "select",
        default: "message",
        options: [
          { value: "message", label: "رسائل جديدة" },
          { value: "callback_query", label: "ضغطات الأزرار (Callback)" },
          { value: "all", label: "كل التحديثات" },
        ],
      },
      {
        key: "dropWebhook",
        label: "إلغاء أي Webhook قديم على البوت",
        type: "boolean",
        default: true,
        help: "تيليجرام مش بيسمح بالاستقبال من مكانين. لو البوت مربوط بـ Make أو غيره هيتفك منه.",
      },
    ],
    sampleOutput: { update_id: 900000001, message: sampleMessage },
    async poll({ params, credential, state, signal, testMode }) {
      const token = credential?.data.botToken ?? "";
      let nextState = { ...(state ?? {}) };
      if (!nextState.webhookCleared && params.dropWebhook !== false) {
        const info = await telegram<{ url: string }>(token, "getWebhookInfo", {}, signal);
        if (info.url) await telegram(token, "deleteWebhook", { drop_pending_updates: false }, signal);
        nextState.webhookCleared = true;
      }
      const type = String(params.updateType || "message");
      const waitSeconds = testMode ? 3 : 25;
      const updates = await telegram<any[]>(
        token,
        "getUpdates",
        { offset: nextState.offset, timeout: waitSeconds, allowed_updates: type === "all" ? [] : [type] },
        withTimeout(signal, (waitSeconds + 15) * 1000),
      );
      if (updates.length) nextState.offset = updates[updates.length - 1].update_id + 1;
      const items = type === "all" ? updates : updates.filter((u) => type in u);
      return { items, state: nextState };
    },
  },
  {
    type: "telegram.sendMessage",
    name: "إرسال رسالة",
    description: "بيبعت رسالة نصية أو رد على رسالة.",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "apps",
    kind: "action",
    credentialTypes: ["telegramBot"],
    fields: [
      chatIdField,
      { key: "text", label: "النص", type: "textarea", required: true, placeholder: "{{2.text}}" },
      parseModeField,
      { key: "replyToMessageId", label: "رد على رسالة رقم (اختياري)", type: "text", placeholder: "{{1.message.message_id}}" },
      { key: "disablePreview", label: "إخفاء معاينة الروابط", type: "boolean", default: false },
    ],
    sampleOutput: { message_id: 43, chat: { id: 123456789 }, text: "أهلاً بيك!" },
    async run({ params, credential, signal }) {
      const text = String(params.text ?? "");
      if (!text.trim()) throw new Error("نص الرسالة فاضي");
      const body: Record<string, unknown> = {
        chat_id: String(params.chatId ?? "").trim(),
        text: text.slice(0, 4096),
        link_preview_options: { is_disabled: Boolean(params.disablePreview) },
      };
      if (params.parseMode) body.parse_mode = params.parseMode;
      const replyTo = Number(params.replyToMessageId);
      if (Number.isInteger(replyTo) && replyTo > 0) {
        body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
      }
      return { output: await telegram(credential?.data.botToken ?? "", "sendMessage", body, signal) };
    },
  },
  {
    type: "telegram.sendPhoto",
    name: "إرسال صورة",
    description: "بيبعت صورة من رابط مع تعليق.",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "apps",
    kind: "action",
    credentialTypes: ["telegramBot"],
    fields: [
      chatIdField,
      { key: "photo", label: "رابط الصورة", type: "text", required: true, placeholder: "https://..." },
      { key: "caption", label: "التعليق", type: "textarea" },
      parseModeField,
    ],
    sampleOutput: { message_id: 44, chat: { id: 123456789 }, caption: "" },
    async run({ params, credential, signal }) {
      const body: Record<string, unknown> = {
        chat_id: String(params.chatId ?? "").trim(),
        photo: String(params.photo ?? ""),
        caption: String(params.caption ?? "").slice(0, 1024),
      };
      if (params.parseMode) body.parse_mode = params.parseMode;
      return { output: await telegram(credential?.data.botToken ?? "", "sendPhoto", body, signal) };
    },
  },
];
