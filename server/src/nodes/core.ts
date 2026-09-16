import { randomToken } from "../crypto.js";
import { now, one, run } from "../db.js";
import type { NodeDefinition } from "../engine/types.js";
import { keyValueRows, sleep, toNumber } from "./util.js";

export const newWebhookPath = () => randomToken(18);

const manualTrigger: NodeDefinition = {
  type: "trigger.manual",
  name: "تشغيل يدوي",
  description: "بتشغّل السيناريو بنفسك من زرار «تشغيل مرة».",
  app: "manual",
  appName: "يدوي",
  color: "#64748b",
  group: "trigger",
  kind: "trigger",
  triggerType: "manual",
  fields: [
    {
      key: "data",
      label: "بيانات تجريبية (JSON)",
      type: "json",
      placeholder: '{ "name": "Ahmed" }',
      help: "اختياري: البيانات دي هتبقى مخرجات الخطوة.",
    },
  ],
  sampleOutput: { triggeredAt: "2026-01-01T10:00:00.000Z", data: {} },
};

const webhookTrigger: NodeDefinition = {
  type: "trigger.webhook",
  name: "Webhook",
  description: "رابط خاص بيستقبل بيانات من أي موقع أو نظام (فورم، متجر، CRM...).",
  app: "webhook",
  appName: "Webhooks",
  color: "#e5487a",
  group: "trigger",
  kind: "trigger",
  triggerType: "webhook",
  fields: [
    {
      key: "path",
      label: "رابط الـ Webhook",
      type: "readonly",
      help: "ابعت أي طلب (GET/POST) للرابط ده. لو فيه خطوة «رد على الـ Webhook» الرد هيستنى نتيجتها.",
    },
  ],
  webhook: { parse: (request) => [request] },
  sampleOutput: {
    method: "POST",
    body: { name: "Ahmed", email: "ahmed@example.com", message: "مرحبا" },
    query: {},
    headers: { "content-type": "application/json" },
  },
};

const formTrigger: NodeDefinition = {
  type: "trigger.form",
  name: "فورم",
  description: "صفحة فورم جاهزة برابط: أي حد يملاها يشغّل السيناريو، والنتيجة (نص أو صورة) تظهرله فوراً.",
  app: "form",
  appName: "فورم",
  color: "#f59e0b",
  group: "trigger",
  kind: "trigger",
  triggerType: "webhook",
  fields: [
    { key: "path", label: "رابط الفورم", type: "readonly", urlKind: "form", help: "افتحه وجرّب بنفسك، أو ابعته لعملاءك." },
    { key: "title", label: "عنوان الفورم", type: "text", default: "اطلب خدمتك" },
    { key: "description", label: "وصف قصير", type: "textarea" },
    {
      key: "formFields",
      label: "الحقول",
      type: "keyvalue",
      default: [{ key: "name", value: "الاسم" }],
      help: "المفتاح = اسم الحقل بالإنجليزي، والقيمة = السؤال. الإجابة بتوصل في {{1.data.name}}. ضيف في آخر السؤال: (صورة) لرفع صورة، (نعم/لا) للاختيار، (ساعة) لميعاد، (اختياري) لحقل مش إجباري.",
    },
    { key: "submitLabel", label: "نص زرار الإرسال", type: "text", default: "إرسال" },
    {
      key: "successMessage",
      label: "رسالة بعد الإرسال",
      type: "text",
      default: "تم الإرسال بنجاح ✓",
      help: "لو في آخر السيناريو خطوة «رد على الـ Webhook»، ردها هو اللي هيظهر (نص أو صور).",
    },
  ],
  webhook: {
    parse(request) {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const data = body.data && typeof body.data === "object" ? body.data : body;
      return [{ data, submittedAt: new Date().toISOString() }];
    },
  },
  sampleOutput: { data: { name: "Ahmed" }, submittedAt: "2026-01-01T10:00:00.000Z" },
};

const scheduleTrigger: NodeDefinition = {
  type: "trigger.schedule",
  name: "جدولة",
  description: "بيشغّل السيناريو كل فترة أو في مواعيد محددة.",
  app: "schedule",
  appName: "جدولة",
  color: "#7c3aed",
  group: "trigger",
  kind: "trigger",
  triggerType: "schedule",
  fields: [
    {
      key: "mode",
      label: "النوع",
      type: "select",
      default: "interval",
      options: [
        { value: "interval", label: "كل عدد دقايق" },
        { value: "cron", label: "Cron (مواعيد مخصصة)" },
      ],
    },
    { key: "minutes", label: "كل كام دقيقة", type: "number", default: 15, showIf: { field: "mode", values: ["interval"] } },
    {
      key: "cron",
      label: "Cron expression",
      type: "text",
      placeholder: "0 9 * * *",
      help: "مثال: 0 9 * * * = كل يوم الساعة 9 الصبح",
      showIf: { field: "mode", values: ["cron"] },
    },
    { key: "timezone", label: "المنطقة الزمنية", type: "text", default: "Africa/Cairo" },
  ],
  sampleOutput: { firedAt: "2026-01-01T09:00:00.000Z" },
};

const ifNode: NodeDefinition = {
  type: "logic.if",
  name: "شرط (If)",
  description: "بيقسّم المسار حسب شرط: فرع «نعم» وفرع «لا».",
  app: "logic",
  appName: "التحكم في المسار",
  color: "#16a34a",
  group: "logic",
  kind: "action",
  outputs: [
    { key: "true", label: "نعم" },
    { key: "false", label: "لا" },
  ],
  fields: [
    {
      key: "combine",
      label: "طريقة الدمج",
      type: "select",
      default: "all",
      options: [
        { value: "all", label: "كل الشروط لازم تتحقق (AND)" },
        { value: "any", label: "أي شرط يكفي (OR)" },
      ],
    },
    { key: "conditions", label: "الشروط", type: "conditions", default: [] },
  ],
  sampleOutput: { passed: true },
  async run({ params }) {
    const conditions: { left: unknown; op: string; right: unknown }[] = Array.isArray(params.conditions)
      ? params.conditions
      : [];
    const results = conditions.map((c) => compare(c.left, c.op, c.right));
    const passed =
      results.length === 0 ? true : params.combine === "any" ? results.some(Boolean) : results.every(Boolean);
    return { output: { passed }, branch: passed ? "true" : "false" };
  },
};

export function compare(left: unknown, op: string, right: unknown): boolean {
  const l = left === undefined || left === null ? "" : typeof left === "object" ? JSON.stringify(left) : String(left);
  const r = right === undefined || right === null ? "" : String(right);
  const ln = Number(l);
  const rn = Number(r);
  const numeric = l.trim() !== "" && r.trim() !== "" && Number.isFinite(ln) && Number.isFinite(rn);
  switch (op) {
    case "equals":
      return numeric ? ln === rn : l === r;
    case "not_equals":
      return numeric ? ln !== rn : l !== r;
    case "contains":
      return Array.isArray(left) ? left.map(String).includes(r) : l.toLowerCase().includes(r.toLowerCase());
    case "not_contains":
      return Array.isArray(left) ? !left.map(String).includes(r) : !l.toLowerCase().includes(r.toLowerCase());
    case "starts_with":
      return l.toLowerCase().startsWith(r.toLowerCase());
    case "ends_with":
      return l.toLowerCase().endsWith(r.toLowerCase());
    case "gt":
      return numeric && ln > rn;
    case "gte":
      return numeric && ln >= rn;
    case "lt":
      return numeric && ln < rn;
    case "lte":
      return numeric && ln <= rn;
    case "is_empty":
      return l.trim() === "" || l === "[]" || l === "{}";
    case "not_empty":
      return !(l.trim() === "" || l === "[]" || l === "{}");
    case "regex":
      try {
        return new RegExp(r, "i").test(l);
      } catch {
        return false;
      }
    default:
      throw new Error(`عملية مقارنة غير معروفة: ${op}`);
  }
}

const setNode: NodeDefinition = {
  type: "logic.set",
  name: "تجهيز بيانات",
  description: "بتبني object جديد من بيانات الخطوات اللي قبلها.",
  app: "tools",
  appName: "أدوات",
  color: "#0f766e",
  group: "logic",
  kind: "action",
  fields: [
    {
      key: "values",
      label: "الحقول",
      type: "keyvalue",
      default: [],
      help: "لو القيمة متغير واحد بس زي {{1.body}} هيتحفظ بنوعه الأصلي (رقم/Object).",
    },
  ],
  sampleOutput: { field: "value" },
  async run({ params }) {
    return { output: Object.fromEntries(keyValueRows(params.values).map((row) => [row.key, row.value])) };
  },
};

const delayNode: NodeDefinition = {
  type: "logic.delay",
  name: "انتظار",
  description: "بيستنى عدد ثواني قبل الخطوة اللي بعده.",
  app: "tools",
  appName: "أدوات",
  color: "#0f766e",
  group: "logic",
  kind: "action",
  fields: [{ key: "seconds", label: "عدد الثواني (حد أقصى 120)", type: "number", default: 5 }],
  sampleOutput: { waitedSeconds: 5 },
  async run({ params, signal }) {
    const seconds = Math.min(Math.max(toNumber(params.seconds, 5), 0), 120);
    await sleep(seconds * 1000, signal);
    return { output: { waitedSeconds: seconds } };
  },
};

const respondNode: NodeDefinition = {
  type: "logic.respond",
  name: "رد على الـ Webhook",
  description: "بيرجّع رد مخصص للي بعت الطلب على الـ Webhook (مثلاً API بيرجع نتيجة AI).",
  app: "webhook",
  appName: "Webhooks",
  color: "#e5487a",
  group: "logic",
  kind: "action",
  fields: [
    { key: "status", label: "كود الحالة", type: "number", default: 200 },
    {
      key: "bodyType",
      label: "نوع الرد",
      type: "select",
      default: "json",
      options: [
        { value: "json", label: "JSON" },
        { value: "text", label: "نص" },
      ],
    },
    { key: "jsonBody", label: "الرد (JSON)", type: "json", placeholder: '{ "ok": true }', showIf: { field: "bodyType", values: ["json"] } },
    { key: "textBody", label: "الرد (نص)", type: "textarea", showIf: { field: "bodyType", values: ["text"] } },
    { key: "headers", label: "Headers", type: "keyvalue", default: [] },
  ],
  sampleOutput: { sent: true, status: 200 },
  async run({ params, respond }) {
    const status = toNumber(params.status, 200);
    const headers = Object.fromEntries(keyValueRows(params.headers).map((row) => [row.key, String(row.value ?? "")]));
    const body = params.bodyType === "text" ? String(params.textBody ?? "") : (params.jsonBody ?? {});
    respond?.({ status, headers, body });
    return { output: { sent: Boolean(respond), status, body } };
  },
};

const storeField = { key: "store", label: "اسم المخزن", type: "text", default: "default", required: true } as const;

export async function datastoreWrite(userId: string, store: string, key: string, value: unknown) {
  await run(
    `INSERT INTO datastore (user_id, store, key, value, updated_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, store, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [userId, store, key, JSON.stringify(value ?? null), now()],
  );
}

export async function datastoreRead(userId: string, store: string, key: string): Promise<{ found: boolean; value: unknown }> {
  const row = await one<{ value: string }>("SELECT value FROM datastore WHERE user_id = $1 AND store = $2 AND key = $3", [
    userId,
    store,
    key,
  ]);
  return { found: Boolean(row), value: row ? JSON.parse(row.value) : null };
}

const datastoreSet: NodeDefinition = {
  type: "datastore.set",
  name: "حفظ في مخزن البيانات",
  description: "بيحفظ قيمة بمفتاح (عميل، رصيد، آخر رسالة...) عشان تستخدمها بعدين.",
  app: "datastore",
  appName: "مخزن البيانات",
  color: "#0284c7",
  group: "data",
  kind: "action",
  fields: [
    storeField,
    { key: "key", label: "المفتاح", type: "text", required: true, placeholder: "{{1.body.email}}" },
    { key: "value", label: "القيمة", type: "json", placeholder: '{ "name": "{{1.body.name}}" }', help: "JSON أو نص بين علامات تنصيص." },
  ],
  sampleOutput: { store: "default", key: "ahmed@example.com", value: { name: "Ahmed" } },
  async run({ params, workflow }) {
    const key = String(params.key ?? "").trim();
    if (!key) throw new Error("المفتاح فاضي");
    const store = String(params.store || "default");
    await datastoreWrite(workflow.userId, store, key, params.value);
    return { output: { store, key, value: params.value ?? null } };
  },
};

const datastoreGet: NodeDefinition = {
  type: "datastore.get",
  name: "قراءة من مخزن البيانات",
  description: "بيجيب القيمة المحفوظة بمفتاح معيّن.",
  app: "datastore",
  appName: "مخزن البيانات",
  color: "#0284c7",
  group: "data",
  kind: "action",
  fields: [storeField, { key: "key", label: "المفتاح", type: "text", required: true }],
  sampleOutput: { found: true, key: "ahmed@example.com", value: { name: "Ahmed" } },
  async run({ params, workflow }) {
    const key = String(params.key ?? "").trim();
    return { output: { key, ...(await datastoreRead(workflow.userId, String(params.store || "default"), key)) } };
  },
};

const datastoreDelete: NodeDefinition = {
  type: "datastore.delete",
  name: "حذف من مخزن البيانات",
  description: "بيمسح مفتاح من المخزن.",
  app: "datastore",
  appName: "مخزن البيانات",
  color: "#0284c7",
  group: "data",
  kind: "action",
  fields: [storeField, { key: "key", label: "المفتاح", type: "text", required: true }],
  sampleOutput: { deleted: true },
  async run({ params, workflow }) {
    const deleted = await run("DELETE FROM datastore WHERE user_id = $1 AND store = $2 AND key = $3", [
      workflow.userId,
      String(params.store || "default"),
      String(params.key ?? "").trim(),
    ]);
    return { output: { deleted: deleted > 0 } };
  },
};

export const coreNodes: NodeDefinition[] = [
  formTrigger,
  webhookTrigger,
  scheduleTrigger,
  manualTrigger,
  ifNode,
  setNode,
  delayNode,
  respondNode,
  datastoreSet,
  datastoreGet,
  datastoreDelete,
];
