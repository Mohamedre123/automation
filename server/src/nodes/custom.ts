import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { config } from "../config.js";
import { assertAllowedUrl, parseBody, withTimeout } from "./util.js";

/**
 * "Bring your own provider": any external service the customer already pays for
 * (another WhatsApp gateway, SMS, a social scheduler like Ayrshare / Publer, their own backend).
 */
export const customApiCredential: CredentialType = {
  key: "customApi",
  name: "خدمة خارجية (API خاص بيك)",
  app: "customapi",
  description: "لو عندك مزوّد تاني غير المتاح عندنا (واتساب غير رسمي، SMS، خدمة نشر، أو سيستم شركتك): حط رابطه ومفتاحه وهيشتغل في أي سيناريو.",
  fields: [
    { key: "baseUrl", label: "رابط الـ API", required: true, placeholder: "https://api.provider.com/v1" },
    { key: "authHeader", label: "اسم Header المفتاح", placeholder: "Authorization", help: "فاضي = Authorization" },
    { key: "authValue", label: "قيمة المفتاح", secret: true, placeholder: "Bearer xxxxx أو المفتاح لوحده" },
    {
      key: "sendPath",
      label: "مسار إرسال رسالة (اختياري)",
      placeholder: "/messages/send",
      help: "لو الخدمة بتبعت رسايل: هيستخدم في إشعارات التحويل لموظف.",
    },
    {
      key: "messageBody",
      label: "شكل رسالة الإرسال (اختياري)",
      placeholder: '{"to":"[to]","text":"[text]"}',
      help: "[to] = المستلم و [text] = النص. فاضي = الشكل ده بالظبط.",
    },
  ],
  async test(data) {
    const header = String(data.authHeader ?? "").trim();
    if (header && !/^[A-Za-z0-9-]{1,60}$/.test(header)) {
      throw new Error("«اسم Header المفتاح» لازم يكون اسم قصير زي Authorization أو X-API-Key - المفتاح نفسه بيتكتب في «قيمة المفتاح»");
    }
    const url = String(data.baseUrl ?? "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("رابط الـ API لازم يبدأ بـ https://");
    return "الإعدادات سليمة ✓ (جرّب خطوة من السيناريو للتأكد من الرد)";
  },
  steps: [
    "من لوحة المزوّد بتاعك هات رابط الـ API الأساسي (Base URL) والمفتاح (API Key / Token).",
    "من التوثيق بتاعهم اعرف المفتاح بيتبعت إزاي: غالباً Header اسمه Authorization وقيمته Bearer + المفتاح، أو Header زي X-API-Key.",
    "لو هتستخدمه لإرسال رسايل (زي واتساب غير رسمي أو SMS): اكتب مسار الإرسال وشكل الـ JSON اللي بيطلبه، وحط [to] مكان رقم المستلم و [text] مكان النص.",
    "في السيناريو استخدم خطوة «خدمة خارجية: إرسال طلب» - أو اختاره في «انشر على كل المنصات» كخدمة نشر إضافية.",
  ],
};

const base = (c?: CredentialValue) => String(c?.data.baseUrl ?? "").trim().replace(/\/+$/, "");
const joinUrl = (c: CredentialValue | undefined, path: string) => {
  const p = String(path ?? "").trim();
  if (/^https?:\/\//i.test(p)) return p;
  return `${base(c)}${p ? (p.startsWith("/") ? p : `/${p}`) : ""}`;
};

export function customAuthHeaders(c?: CredentialValue): Record<string, string> {
  const value = String(c?.data.authValue ?? "").trim();
  if (!value) return {};
  return { [String(c?.data.authHeader ?? "").trim() || "authorization"]: value };
}

/** Fills [placeholders] inside a JSON template, escaping values safely for JSON strings. */
export function fillTemplate(template: string, values: Record<string, string>) {
  const filled = template.replace(/\[(\w+)\]/g, (match, key: string) =>
    key in values ? JSON.stringify(values[key] ?? "").slice(1, -1) : match,
  );
  try {
    return JSON.parse(filled);
  } catch {
    throw new Error("شكل الـ JSON في إعدادات الخدمة الخارجية مش صحيح");
  }
}

export async function customRequest(c: CredentialValue | undefined, method: string, path: string, body: unknown, signal: AbortSignal) {
  const url = joinUrl(c, path);
  if (!/^https?:\/\//i.test(url)) throw new Error("رابط الخدمة الخارجية مش صحيح - اتأكد من Base URL في الحساب");
  const hasBody = method !== "GET" && body !== undefined && body !== "";
  assertAllowedUrl(url, config.blockPrivateUrls);
  const response = await fetch(url, {
    method,
    headers: { accept: "application/json", ...customAuthHeaders(c), ...(hasBody ? { "content-type": "application/json" } : {}) },
    body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    signal: withTimeout(signal, 60_000),
  });
  const text = await response.text();
  const data = parseBody(text, response.headers.get("content-type"));
  if (!response.ok) {
    // Web servers answer with HTML pages: keep only their title.
    const detail = /<html/i.test(text) ? (text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim() : text.slice(0, 300);
    const host = new URL(url).hostname;
    if (/upload-post\.com$/i.test(host)) {
      throw new Error(
        "الخدمة الخارجية: رابط Upload-Post هنا غلط (ده رابط الموقع مش الـ API). الأسهل: ضيف حساب «Upload-Post» الجاهز من «الحسابات» واستخدم خطوة «Upload-Post: نشر على المنصات» بدل الخدمة الخارجية.",
      );
    }
    const hint =
      response.status === 405
        ? "المسار ده مش بيقبل الطلب ده - غالباً «رابط الـ API» في الحساب هو رابط الموقع مش رابط الـ API، أو المسار أو الـ Method غلط."
        : response.status === 404
          ? "المسار مش موجود - راجع «رابط الـ API» في الحساب والمسار في الخطوة من توثيق الخدمة."
          : response.status === 401 || response.status === 403
            ? "المفتاح غلط أو اتكتب في الخانة الغلط - راجع «اسم Header المفتاح» و«قيمة المفتاح»."
            : "";
    throw new Error(`الخدمة الخارجية: HTTP ${response.status}${detail ? ` (${detail})` : ""}${hint ? ` - ${hint}` : ""}`);
  }
  return { status: response.status, data };
}

/** Plain-text notification through the customer's own messaging provider. */
export async function sendCustomMessage(c: CredentialValue, to: string, text: string, signal: AbortSignal) {
  if (!String(c.data.sendPath ?? "").trim()) throw new Error("حساب الخدمة الخارجية ناقصه «مسار إرسال رسالة»");
  const template = String(c.data.messageBody ?? "").trim() || '{"to":"[to]","text":"[text]"}';
  await customRequest(c, "POST", c.data.sendPath, fillTemplate(template, { to, text }), signal);
}

export const customApiNode: NodeDefinition = {
  type: "custom.request",
  name: "خدمة خارجية: إرسال طلب",
  description: "بيكلم المزوّد الخاص بيك (واتساب غير رسمي، SMS، خدمة نشر، سيستمك) بالمفتاح المحفوظ في الحساب.",
  app: "customapi",
  appName: "خدمة خارجية",
  color: "#64748b",
  group: "apps",
  kind: "action",
  credentialTypes: ["customApi"],
  fields: [
    {
      key: "method",
      label: "Method",
      type: "select",
      default: "POST",
      options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })),
    },
    { key: "path", label: "المسار", type: "text", required: true, placeholder: "/messages/send", help: "بيتضاف بعد رابط الـ API اللي في الحساب." },
    { key: "body", label: "Body (JSON)", type: "json", placeholder: '{ "to": "{{1.phone}}", "text": "{{2.text}}" }' },
  ],
  sampleOutput: { status: 200, data: { success: true, id: "msg_123" } },
  async run({ params, credential, signal }) {
    const method = String(params.method || "POST").toUpperCase();
    return { output: await customRequest(credential, method, String(params.path ?? ""), params.body, signal) };
  },
};
