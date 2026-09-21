import type { CredentialType, FieldDef, NodeDefinition } from "../engine/types.js";
import { urlList } from "./media.js";
import { rememberTelegramContact } from "./notify.js";
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
  description: "هات الـ token من @BotFather على تيليجرام. يُفضّل بوت مخصص للمنصة",
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
  placeholder: "@my_channel أو رقم المحادثة",
  help: "للقناة اكتب اليوزرنيم بـ @ (والبوت لازم يكون أدمن فيها). وللرد على عميل دوس زرار البيانات واختار رقم محادثته من المحفّز",
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

export const skipIfEmptyField: FieldDef = {
  key: "skipIfEmpty",
  label: "متبعتش حاجة لو النص فاضي",
  type: "boolean",
  default: true,
  help: "مثلاً لما الـ AI Agent يحوّل العميل لموظف ويسكت",
};

const plainText = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`\n]+)`/g, "$1");

const sampleMessage = {
  message_id: 42,
  from: { id: 123456789, is_bot: false, first_name: "Ahmed", username: "ahmed" },
  chat: { id: 123456789, first_name: "Ahmed", type: "private" },
  date: 1767261600,
  text: "مرحبا، عايز أعرف الأسعار",
};

const updateTypes = (params: Record<string, any>) => {
  const type = String(params.updateType || "message");
  return type === "all" ? [] : [type];
};

const matchesType = (update: any, params: Record<string, any>) => {
  const types = updateTypes(params);
  return types.length === 0 || types.some((t) => t in (update ?? {}));
};

export const telegramNodes: NodeDefinition[] = [
  {
    type: "telegram.trigger",
    name: "مراقبة الرسائل",
    description: "بيشتغل أول ما حد يبعت رسالة للبوت",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "trigger",
    kind: "trigger",
    triggerType: "app",
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
        help: "البوت بيستقبل من مكان واحد بس. لو نفس البوت مربوط بمنصة تانية هيتفك منها",
      },
    ],
    sampleOutput: { update_id: 900000001, message: sampleMessage },
    onTriggered: async ({ output, credential, userId }) => {
      // Show "typing..." right away while the reply is being prepared.
      const chatId = (output as any)?.message?.chat?.id ?? (output as any)?.callback_query?.message?.chat?.id;
      const typing =
        chatId && credential?.data.botToken
          ? telegram(credential.data.botToken, "sendChatAction", { chat_id: chatId, action: "typing" }, AbortSignal.timeout(5_000)).catch(() => undefined)
          : undefined;
      await Promise.all([rememberTelegramContact(userId, credential, output), typing]);
    },
    // Deployed (public HTTPS): Telegram pushes updates to our webhook.
    webhook: {
      async register({ params, credential, url, secretToken, signal }) {
        await telegram(
          credential?.data.botToken ?? "",
          "setWebhook",
          { url, secret_token: secretToken, allowed_updates: updateTypes(params), drop_pending_updates: false },
          signal,
        );
      },
      async unregister({ credential, signal }) {
        await telegram(credential?.data.botToken ?? "", "deleteWebhook", { drop_pending_updates: false }, signal);
      },
      parse(request, { params, secretToken }) {
        if (request.headers["x-telegram-bot-api-secret-token"] !== secretToken) {
          throw Object.assign(new Error("Invalid Telegram secret token"), { statusCode: 401 });
        }
        return matchesType(request.body, params) ? [request.body] : [];
      },
    },
    // Local dev (no public URL): long polling from the running server.
    async poll({ params, credential, state, signal, testMode }) {
      const token = credential?.data.botToken ?? "";
      const nextState = { ...(state ?? {}) };
      if (!nextState.webhookCleared) {
        const info = await telegram<{ url: string }>(token, "getWebhookInfo", {}, signal);
        if (info.url) await telegram(token, "deleteWebhook", { drop_pending_updates: false }, signal);
        nextState.webhookCleared = true;
      }
      const waitSeconds = testMode ? 3 : 25;
      const updates = await telegram<any[]>(
        token,
        "getUpdates",
        { offset: nextState.offset, timeout: waitSeconds, allowed_updates: updateTypes(params) },
        withTimeout(signal, (waitSeconds + 15) * 1000),
      );
      if (updates.length) nextState.offset = updates[updates.length - 1].update_id + 1;
      return { items: updates.filter((u) => matchesType(u, params)), state: nextState };
    },
  },
  {
    type: "telegram.sendMessage",
    name: "إرسال رسالة",
    description: "بيبعت رسالة نصية أو رد على رسالة",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "apps",
    kind: "action",
    credentialTypes: ["telegramBot"],
    fields: [
      chatIdField,
      { key: "text", label: "النص", type: "textarea", required: true, placeholder: "اكتب الرسالة هنا", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      parseModeField,
      { key: "replyToMessageId", label: "رد على رسالة رقم (اختياري)", type: "text", placeholder: "رقم الرسالة", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      { key: "disablePreview", label: "إخفاء معاينة الروابط", type: "boolean", default: false },
      skipIfEmptyField,
    ],
    sampleOutput: { message_id: 43, chat: { id: 123456789 }, text: "أهلاً بيك!" },
    async run({ params, credential, signal }) {
      // Without a parse mode Telegram shows Markdown literally: AI replies often carry **bold** and ### headings.
      const raw = String(params.text ?? "");
      const text = params.parseMode ? raw : plainText(raw);
      if (!text.trim()) {
        if (params.skipIfEmpty !== false) return { output: { skipped: true, reason: "النص فاضي" } };
        throw new Error("نص الرسالة فاضي");
      }
      const token = credential?.data.botToken ?? "";
      const chatId = String(params.chatId ?? "").trim();
      const replyTo = Number(params.replyToMessageId);
      // Telegram caps a message at 4096 characters: long AI answers are split.
      const chunks = text.match(/[\s\S]{1,4000}(?=\s|$)|[\s\S]{1,4000}/g) ?? [text];
      let last: unknown;
      for (const [i, chunk] of chunks.entries()) {
        const body: Record<string, unknown> = {
          chat_id: chatId,
          text: chunk,
          link_preview_options: { is_disabled: Boolean(params.disablePreview) },
        };
        if (params.parseMode) body.parse_mode = params.parseMode;
        if (i === 0 && Number.isInteger(replyTo) && replyTo > 0) {
          body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
        }
        last = await telegram(token, "sendMessage", body, signal);
      }
      return { output: last };
    },
  },
  {
    type: "telegram.sendPhoto",
    name: "إرسال صورة",
    description: "بيبعت صورة من رابط مع تعليق",
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
  {
    type: "telegram.sendAlbum",
    name: "إرسال ألبوم صور",
    description: "بيبعت من صورتين لـ 10 في رسالة واحدة (ألبوم)، والتعليق بيتحط على أول صورة",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "apps",
    kind: "action",
    credentialTypes: ["telegramBot"],
    fields: [
      chatIdField,
      { key: "photos", label: "الصور", type: "textarea", required: true, placeholder: "@{تيشيرت أبيض}\n@{بنطلون جينز}", help: "اكتب @ واختار كل صورة (كل صورة في سطر)" },
      { key: "caption", label: "التعليق", type: "textarea" },
      parseModeField,
    ],
    sampleOutput: [{ message_id: 46, media_group_id: "13291..." }],
    async run({ params, credential, signal }) {
      const photos = urlList(params.photos).slice(0, 10);
      if (!photos.length) throw new Error("اختار صورة واحدة على الأقل - اكتب @ واختار من مكتبة الصور");
      const caption = String(params.caption ?? "").slice(0, 1024);
      const media = photos.map((photo, i) => ({
        type: "photo",
        media: photo,
        ...(i === 0 && caption ? { caption, ...(params.parseMode ? { parse_mode: params.parseMode } : {}) } : {}),
      }));
      if (media.length === 1) {
        const body: Record<string, unknown> = { chat_id: String(params.chatId ?? "").trim(), photo: photos[0], caption };
        if (params.parseMode) body.parse_mode = params.parseMode;
        return { output: await telegram(credential?.data.botToken ?? "", "sendPhoto", body, signal) };
      }
      const body = { chat_id: String(params.chatId ?? "").trim(), media };
      return { output: await telegram(credential?.data.botToken ?? "", "sendMediaGroup", body, signal) };
    },
  },
  {
    type: "telegram.sendVideo",
    name: "إرسال فيديو",
    description: "بيبعت فيديو من رابط مع تعليق (لحد 20 ميجا)",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "apps",
    kind: "action",
    credentialTypes: ["telegramBot"],
    fields: [
      chatIdField,
      { key: "video", label: "الفيديو", type: "text", required: true, placeholder: "@{اسم الفيديو} أو رابط فيديو" },
      { key: "caption", label: "التعليق", type: "textarea" },
      parseModeField,
    ],
    sampleOutput: { message_id: 45, chat: { id: 123456789 }, caption: "" },
    async run({ params, credential, signal }) {
      const body: Record<string, unknown> = {
        chat_id: String(params.chatId ?? "").trim(),
        video: String(params.video ?? ""),
        caption: String(params.caption ?? "").slice(0, 1024),
        supports_streaming: true,
      };
      if (params.parseMode) body.parse_mode = params.parseMode;
      return { output: await telegram(credential?.data.botToken ?? "", "sendVideo", body, signal) };
    },
  },
  {
    type: "telegram.typing",
    name: "إظهار «بيكتب...»",
    description: "بيظهر للعميل إن البوت بيكتب لحد ما الرد يوصل",
    app: "telegram",
    appName: "Telegram Bot",
    color: "#229ed9",
    group: "apps",
    kind: "action",
    credentialTypes: ["telegramBot"],
    fields: [chatIdField],
    sampleOutput: { sent: true },
    async run({ params, credential, signal }) {
      await telegram(credential?.data.botToken ?? "", "sendChatAction", { chat_id: String(params.chatId ?? "").trim(), action: "typing" }, signal);
      return { output: { sent: true } };
    },
  },
];
