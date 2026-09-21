import type { CredentialType, FieldDef, NodeDefinition, WebhookResponse } from "../engine/types.js";
import { postJson } from "./llm.js";
import { skipIfEmptyField } from "./telegram.js";

const WASENDER_BASE = "https://wasenderapi.com/api";
const GRAPH_BASE = "https://graph.facebook.com/v25.0";

/* ================= WasenderAPI (cheaper, no Meta approval) ================= */

export const wasenderCredential: CredentialType = {
  key: "wasenderApi",
  name: "WasenderAPI (واتساب)",
  app: "whatsapp",
  description: "أرخص طريقة لربط واتساب: من لوحة WasenderAPI اربط رقمك، وهات الـ API Key بتاع الجلسة",
  docsUrl: "https://wasenderapi.com/api-docs",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "من Session ← API Key" },
    {
      key: "webhookSecret",
      label: "Webhook Secret (اختياري)",
      secret: true,
      help: "من إعدادات الـ Webhook في WasenderAPI - بيتأكد إن الرسايل جاية منهم فعلاً",
    },
  ],
  async test(data) {
    const response = await fetch(`${WASENDER_BASE}/whatsapp-sessions`, {
      headers: { authorization: `Bearer ${data.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) throw new Error("WasenderAPI: المفتاح غلط");
    return "المفتاح اتقبل";
  },
};

const toField: FieldDef = {
  key: "to",
  label: "رقم المستلم",
  type: "text",
  required: true,
  placeholder: "201012345678",
  help: "بكود الدولة من غير + أو مسافات، ودوس زرار البيانات جوه الخانة عشان تحط قيمة من خطوة قبلها",
};

const messageTypeField: FieldDef = {
  key: "messageType",
  label: "نوع الرسالة",
  type: "select",
  default: "text",
  options: [
    { value: "text", label: "نص" },
    { value: "image", label: "صورة" },
    { value: "video", label: "فيديو" },
    { value: "document", label: "ملف" },
  ],
};

const sampleIncoming = {
  event: "messages.received",
  from: "201012345678@s.whatsapp.net",
  phone: "201012345678",
  text: "عايز أعرف الأسعار",
  pushName: "Ahmed",
  isGroup: false,
  raw: {},
};

/**
 * WhatsApp now often hides the sender behind a private id ("125713776689337@lid") instead of the
 * phone number. WasenderAPI sends the real number alongside it; use that so replies reach the person.
 * With no real number available, keep the whole "...@lid" id - WasenderAPI can reply to that too,
 * whereas the bare digits look like a phone number that doesn't exist.
 */
function senderPhone(key: any, data: any, remoteJid: string) {
  const candidates = [
    key.cleanedSenderPn,
    key.senderPn,
    key.remoteJidAlt,
    key.cleanedParticipantPn,
    key.participantPn,
    data.cleanedSenderPn,
    data.senderPn,
    data.remoteJidAlt,
  ];
  if (!remoteJid.endsWith("@lid")) candidates.unshift(remoteJid);
  for (const value of candidates) {
    const text = String(value ?? "");
    if (!text || text.endsWith("@lid")) continue;
    const digits = text.split("@")[0].replace(/\D/g, "");
    if (digits.length >= 7) return digits;
  }
  return remoteJid;
}

export const wasenderNodes: NodeDefinition[] = [
  {
    type: "wasender.trigger",
    name: "رسالة واتساب جديدة",
    description: "بيشتغل أول ما رسالة واتساب توصل على رقمك المربوط بـ WasenderAPI",
    app: "whatsapp",
    appName: "واتساب (WasenderAPI)",
    color: "#25d366",
    group: "trigger",
    kind: "trigger",
    triggerType: "webhook",
    credentialTypes: ["wasenderApi"],
    fields: [
      {
        key: "path",
        label: "رابط الـ Webhook",
        type: "readonly",
        help: "انسخ الرابط ده وحطه في WasenderAPI ← Session ← Webhooks، وفعّل حدث Message Received",
      },
      {
        key: "eventType",
        label: "الحدث",
        type: "select",
        default: "messages.received",
        options: [
          { value: "messages.received", label: "رسايل واردة بس" },
          { value: "messages.upsert", label: "واردة وصادرة" },
          { value: "all", label: "كل الأحداث" },
        ],
      },
      { key: "ignoreGroups", label: "تجاهل رسايل الجروبات", type: "boolean", default: true },
    ],
    sampleOutput: sampleIncoming,
    webhook: {
      parse(request, { params, credential }) {
        const secret = credential?.data.webhookSecret;
        if (secret && request.headers["x-webhook-signature"] !== secret) {
          throw Object.assign(new Error("توقيع الـ Webhook مش مطابق"), { statusCode: 401 });
        }
        const body = (request.body ?? {}) as any;
        const event = String(body.event ?? "");
        const wanted = String(params.eventType || "messages.received");
        if (wanted !== "all" && event && event !== wanted) return [];

        const data = body.data ?? {};
        const message = data.messages ?? data.message ?? data;
        if (message?.key?.fromMe || data.fromMe) return []; // never react to our own replies
        const remoteJid = String(message?.key?.remoteJid ?? data.key?.remoteJid ?? data.remoteJid ?? data.from ?? "");
        const isGroup = remoteJid.includes("@g.us");
        if (isGroup && params.ignoreGroups !== false) return [];
        const text = String(
          data.messageBody ??
            message?.messageBody ??
            message?.message?.conversation ??
            message?.message?.extendedTextMessage?.text ??
            message?.conversation ??
            data.text ??
            "",
        );
        return [
          {
            event,
            from: remoteJid,
            phone: senderPhone(message?.key ?? data.key ?? {}, data, remoteJid),
            text,
            pushName: message?.pushName ?? data.pushName ?? "",
            isGroup,
            raw: body,
          },
        ];
      },
    },
  },
  {
    type: "wasender.send",
    name: "إرسال رسالة واتساب",
    description: "بيبعت نص أو صورة أو ملف على واتساب عن طريق WasenderAPI",
    app: "whatsapp",
    appName: "واتساب (WasenderAPI)",
    color: "#25d366",
    group: "apps",
    kind: "action",
    credentialTypes: ["wasenderApi"],
    fields: [
      toField,
      messageTypeField,
      { key: "text", label: "النص / التعليق", type: "textarea", placeholder: "اكتب الرسالة هنا", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      {
        key: "mediaUrl",
        label: "الملف",
        type: "text",
        placeholder: "@{اسم الصورة} أو رابط ملف",
        showIf: { field: "messageType", values: ["image", "video", "document"] },
      },
      { key: "fileName", label: "اسم الملف", type: "text", showIf: { field: "messageType", values: ["document"] } },
      skipIfEmptyField,
    ],
    sampleOutput: { success: true, data: { msgId: "3EB0..." } },
    async run({ params, credential, signal }) {
      const to = String(params.to ?? "").replace(/[^\d@.a-zA-Z-]/g, "");
      if (!to) throw new Error("رقم المستلم فاضي");
      const text = String(params.text ?? "");
      const type = String(params.messageType || "text");
      const body: Record<string, unknown> = { to, text };
      if (type !== "text") {
        const url = String(params.mediaUrl ?? "").trim();
        if (!url) throw new Error("رابط الملف فاضي");
        if (type === "image") body.imageUrl = url;
        if (type === "video") body.videoUrl = url;
        if (type === "document") {
          body.documentUrl = url;
          body.fileName = String(params.fileName || "file");
        }
      } else if (!text.trim()) {
        if (params.skipIfEmpty !== false) return { output: { skipped: true, reason: "النص فاضي" } };
        throw new Error("نص الرسالة فاضي");
      }
      try {
        return {
          output: await postJson(
            `${WASENDER_BASE}/send-message`,
            body,
            { authorization: `Bearer ${credential?.data.apiKey ?? ""}` },
            signal,
            "WasenderAPI",
          ),
        };
      } catch (error) {
        const message = (error as Error).message;
        if (/JID does not exist|not.*on WhatsApp/i.test(message)) {
          throw new Error(
            `الرقم ${to} مش متسجل على واتساب. اتأكد إنه بكود الدولة (زي 201012345678). لو جاي من رسالة واردة استخدم {{1.phone}} - ومحتاج تعيد تشغيل الرسالة بعد التحديث عشان الرقم الحقيقي يوصل بدل الكود المخفي بتاع واتساب`,
          );
        }
        throw error;
      }
    },
  },
];

/* ================= WhatsApp Cloud API (official) ================= */

export const whatsappCloudCredential: CredentialType = {
  key: "whatsappCloud",
  name: "واتساب الرسمي (Meta Cloud API)",
  app: "whatsapp",
  description: "من Meta for Developers ← WhatsApp ← API Setup: التوكن ورقم الـ Phone number ID",
  docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
  fields: [
    { key: "accessToken", label: "Access Token", secret: true, required: true },
    { key: "phoneNumberId", label: "Phone number ID", required: true, placeholder: "123456789012345" },
    { key: "verifyToken", label: "Verify Token", secret: true, help: "أي نص من اختيارك - هتكتبه نفسه في إعدادات الـ Webhook عند Meta" },
  ],
  async test(data) {
    const response = await fetch(`${GRAPH_BASE}/${data.phoneNumberId}?fields=display_phone_number`, {
      headers: { authorization: `Bearer ${data.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`واتساب: ${body?.error?.message ?? `HTTP ${response.status}`}`);
    return `متصل بالرقم ${body.display_phone_number ?? data.phoneNumberId}`;
  },
};

export const whatsappCloudNodes: NodeDefinition[] = [
  {
    type: "whatsapp.trigger",
    name: "رسالة واتساب جديدة (الرسمي)",
    description: "بيستقبل رسايل واتساب من Meta Cloud API",
    app: "whatsapp",
    appName: "واتساب الرسمي",
    color: "#128c7e",
    group: "trigger",
    kind: "trigger",
    triggerType: "webhook",
    credentialTypes: ["whatsappCloud"],
    fields: [
      {
        key: "path",
        label: "رابط الـ Webhook (Callback URL)",
        type: "readonly",
        help: "حطه في Meta ← WhatsApp ← Configuration ← Callback URL، والـ Verify token اللي في الحساب",
      },
    ],
    sampleOutput: {
      phone: "201012345678",
      name: "Ahmed",
      text: "السلام عليكم",
      messageId: "wamid.HBgLMTY...",
      raw: {},
    },
    webhook: {
      // Meta's subscription handshake: GET with hub.challenge
      verify(request, { credential }): WebhookResponse | undefined {
        const query = (request.query ?? {}) as Record<string, string>;
        if (request.method !== "GET" || query["hub.mode"] !== "subscribe") return undefined;
        const expected = credential?.data.verifyToken ?? "";
        if (expected && query["hub.verify_token"] !== expected) {
          return { status: 403, headers: {}, body: { error: "verify token غلط" } };
        }
        return { status: 200, headers: { "content-type": "text/plain" }, body: String(query["hub.challenge"] ?? "") };
      },
      parse(request) {
        const body = (request.body ?? {}) as any;
        const items: unknown[] = [];
        for (const entry of body.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value ?? {};
            const contactName = value.contacts?.[0]?.profile?.name ?? "";
            for (const message of value.messages ?? []) {
              items.push({
                phone: message.from,
                name: contactName,
                text: message.text?.body ?? message.button?.text ?? message.interactive?.list_reply?.title ?? "",
                type: message.type,
                messageId: message.id,
                raw: body,
              });
            }
          }
        }
        return items;
      },
    },
  },
  {
    type: "whatsapp.send",
    name: "إرسال رسالة واتساب (الرسمي)",
    description: "بيبعت رسالة نصية أو صورة من رقم واتساب الرسمي",
    app: "whatsapp",
    appName: "واتساب الرسمي",
    color: "#128c7e",
    group: "apps",
    kind: "action",
    credentialTypes: ["whatsappCloud"],
    fields: [
      toField,
      {
        key: "messageType",
        label: "نوع الرسالة",
        type: "select",
        default: "text",
        options: [
          { value: "text", label: "نص" },
          { value: "image", label: "صورة" },
          { value: "document", label: "ملف" },
        ],
      },
      { key: "text", label: "النص / التعليق", type: "textarea", placeholder: "اكتب الرسالة هنا", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      { key: "mediaUrl", label: "رابط الملف", type: "text", showIf: { field: "messageType", values: ["image", "document"] } },
      skipIfEmptyField,
    ],
    sampleOutput: { messaging_product: "whatsapp", messages: [{ id: "wamid.HBgLMTY..." }] },
    async run({ params, credential, signal }) {
      const to = String(params.to ?? "").replace(/[^\d]/g, "");
      if (!to) throw new Error("رقم المستلم فاضي");
      const type = String(params.messageType || "text");
      const text = String(params.text ?? "");
      const body: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to, type };
      if (type === "text") {
        if (!text.trim()) {
          if (params.skipIfEmpty !== false) return { output: { skipped: true, reason: "النص فاضي" } };
          throw new Error("نص الرسالة فاضي");
        }
        body.text = { preview_url: true, body: text };
      } else {
        const link = String(params.mediaUrl ?? "").trim();
        if (!link) throw new Error("رابط الملف فاضي");
        body[type] = type === "image" ? { link, caption: text } : { link, caption: text, filename: "file" };
      }
      return {
        output: await postJson(
          `${GRAPH_BASE}/${credential?.data.phoneNumberId}/messages`,
          body,
          { authorization: `Bearer ${credential?.data.accessToken ?? ""}` },
          signal,
          "واتساب",
        ),
      };
    },
  },
];
