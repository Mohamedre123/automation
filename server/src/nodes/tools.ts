import type { NodeDefinition } from "../engine/types.js";
import { parseJsonParam } from "./api.js";
import { compare } from "./core.js";
import { toNumber } from "./util.js";

const ROUTES = 5;

const OPERATION = (options: [string, string][], fallback: string) => ({
  key: "operation",
  label: "العملية",
  type: "select" as const,
  default: fallback,
  options: options.map(([value, label]) => ({ value, label })),
});

function shiftDate(date: Date, amount: number, unit: string) {
  const ms = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }[unit] ?? 86_400_000;
  if (unit === "months") {
    const copy = new Date(date);
    copy.setMonth(copy.getMonth() + amount);
    return copy;
  }
  return new Date(date.getTime() + amount * ms);
}

function formatDate(date: Date, format: string, timeZone: string) {
  switch (format) {
    case "date":
      return date.toLocaleDateString("ar-EG", { timeZone, dateStyle: "long" });
    case "time":
      return date.toLocaleTimeString("ar-EG", { timeZone, timeStyle: "short" });
    case "datetime":
      return date.toLocaleString("ar-EG", { timeZone, dateStyle: "long", timeStyle: "short" });
    case "ymd":
      return date.toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD
    case "weekday":
      return date.toLocaleDateString("ar-EG", { timeZone, weekday: "long" });
    default:
      return date.toISOString();
  }
}

export const toolNodes: NodeDefinition[] = [
  {
    type: "logic.switch",
    name: "راوتر (مسارات متعددة)",
    description: "بيوجّه البيانات لأول مسار شرطه يتحقق (لحد 5 مسارات)، ولو مفيش يروح لمسار «غير كده».",
    app: "logic",
    appName: "التحكم في المسار",
    color: "#16a34a",
    group: "logic",
    kind: "action",
    outputs: [...Array.from({ length: ROUTES }, (_, i) => ({ key: `r${i + 1}`, label: `مسار ${i + 1}` })), { key: "else", label: "غير كده" }],
    fields: [
      {
        key: "routes",
        label: "شروط المسارات بالترتيب",
        type: "conditions",
        default: [],
        help: "الشرط الأول = مسار 1، التاني = مسار 2... أول شرط يتحقق هو اللي يشتغل.",
      },
    ],
    sampleOutput: { route: "r1", matched: 1 },
    async run({ params }) {
      const routes: { left: unknown; op: string; right: unknown }[] = Array.isArray(params.routes) ? params.routes.slice(0, ROUTES) : [];
      const index = routes.findIndex((r) => compare(r.left, r.op, r.right));
      const branch = index >= 0 ? `r${index + 1}` : "else";
      return { output: { route: branch, matched: index >= 0 ? index + 1 : null }, branch };
    },
  },
  {
    type: "logic.iterator",
    name: "تكرار على قايمة (Iterator)",
    description: "بياخد قايمة (منتجات، صفوف، رسايل...) والخطوات اللي بعده بتشتغل مرة لكل عنصر.",
    app: "logic",
    appName: "التحكم في المسار",
    color: "#16a34a",
    group: "logic",
    kind: "action",
    fields: [
      { key: "list", label: "القايمة", type: "text", required: true, placeholder: "{{2.rows}}", help: "متغير واحد بيرجّع مصفوفة. كل عنصر بيوصل للخطوات اللي بعده في {{N}}." },
      { key: "limit", label: "أقصى عدد عناصر", type: "number", default: 100 },
    ],
    sampleOutput: { name: "عنصر من القايمة", _index: 1, _total: 3 },
    async run({ params }) {
      let list = params.list;
      if (typeof list === "string") list = parseJsonParam(list, "القايمة");
      if (list && typeof list === "object" && !Array.isArray(list)) {
        list = Object.values(list).find(Array.isArray) ?? [list];
      }
      if (!Array.isArray(list)) throw new Error("القيمة دي مش قايمة - اختار متغير بيرجّع مصفوفة");
      const limit = Math.min(Math.max(Math.floor(toNumber(params.limit, 100)), 1), 200);
      return { output: { count: Math.min(list.length, limit) }, fanOut: list.slice(0, limit) };
    },
  },
  {
    type: "logic.filter",
    name: "فلتر",
    description: "بيكمّل للخطوات اللي بعده بس لو الشروط اتحققت، غير كده الفرع بيقف بهدوء.",
    app: "logic",
    appName: "التحكم في المسار",
    color: "#16a34a",
    group: "logic",
    kind: "action",
    fields: [
      {
        key: "combine",
        label: "طريقة الدمج",
        type: "select",
        default: "all",
        options: [
          { value: "all", label: "كل الشروط (AND)" },
          { value: "any", label: "أي شرط (OR)" },
        ],
      },
      { key: "conditions", label: "الشروط", type: "conditions", default: [] },
    ],
    sampleOutput: { passed: true },
    async run({ params }) {
      const conditions: { left: unknown; op: string; right: unknown }[] = Array.isArray(params.conditions) ? params.conditions : [];
      const results = conditions.map((c) => compare(c.left, c.op, c.right));
      const passed = results.length === 0 || (params.combine === "any" ? results.some(Boolean) : results.every(Boolean));
      return { output: { passed }, branch: passed ? undefined : "__filtered" };
    },
  },
  {
    type: "logic.stop",
    name: "إيقاف السيناريو",
    description: "بيوقف التشغيل كله هنا، كنجاح أو كخطأ برسالة توضّح السبب.",
    app: "logic",
    appName: "التحكم في المسار",
    color: "#16a34a",
    group: "logic",
    kind: "action",
    fields: [
      {
        key: "status",
        label: "النتيجة",
        type: "select",
        default: "success",
        options: [
          { value: "success", label: "إيقاف بنجاح" },
          { value: "error", label: "إيقاف كخطأ" },
        ],
      },
      { key: "message", label: "الرسالة", type: "text", placeholder: "العميل موجود قبل كده" },
    ],
    sampleOutput: { stopped: true },
    async run({ params }) {
      const status = params.status === "error" ? "error" : "success";
      const message = String(params.message || (status === "error" ? "اتوقف بخطأ" : "اتوقف"));
      return { output: { stopped: true, message }, stop: { status, message } };
    },
  },
  {
    type: "tools.text",
    name: "أدوات النصوص",
    description: "استبدال، تقسيم، استخراج بـ Regex، تحويل حروف، قص النص، وعدد الحروف.",
    app: "tools",
    appName: "أدوات",
    color: "#0f766e",
    group: "logic",
    kind: "action",
    fields: [
      OPERATION(
        [
          ["replace", "استبدال"],
          ["split", "تقسيم لقايمة"],
          ["extract", "استخراج بـ Regex"],
          ["trim", "شيل المسافات الزيادة"],
          ["upper", "حروف كابيتال (إنجليزي)"],
          ["lower", "حروف سمول (إنجليزي)"],
          ["truncate", "قص لعدد حروف"],
          ["length", "عدد الحروف"],
        ],
        "replace",
      ),
      { key: "text", label: "النص", type: "textarea", required: true },
      { key: "find", label: "دوّر على", type: "text", showIf: { field: "operation", values: ["replace"] } },
      { key: "replaceWith", label: "استبدله بـ", type: "text", showIf: { field: "operation", values: ["replace"] } },
      { key: "separator", label: "الفاصل", type: "text", default: ",", showIf: { field: "operation", values: ["split"] } },
      { key: "pattern", label: "Regex", type: "text", placeholder: "\\d{11}", showIf: { field: "operation", values: ["extract"] } },
      { key: "maxLength", label: "عدد الحروف", type: "number", default: 100, showIf: { field: "operation", values: ["truncate"] } },
    ],
    sampleOutput: { result: "النص بعد التعديل" },
    async run({ params }) {
      const text = String(params.text ?? "");
      switch (params.operation) {
        case "split":
          return { output: { result: text.split(String(params.separator ?? ",")).map((s) => s.trim()).filter(Boolean) } };
        case "extract": {
          let regex: RegExp;
          try {
            regex = new RegExp(String(params.pattern ?? ""), "g");
          } catch {
            throw new Error("الـ Regex مش صحيح");
          }
          const matches = [...text.matchAll(regex)].map((m) => m[1] ?? m[0]);
          return { output: { result: matches[0] ?? null, all: matches } };
        }
        case "trim":
          return { output: { result: text.replace(/\s+/g, " ").trim() } };
        case "upper":
          return { output: { result: text.toUpperCase() } };
        case "lower":
          return { output: { result: text.toLowerCase() } };
        case "truncate": {
          const max = Math.max(1, Math.floor(toNumber(params.maxLength, 100)));
          return { output: { result: text.length > max ? `${text.slice(0, max)}…` : text } };
        }
        case "length":
          return { output: { result: [...text].length } };
        default:
          return { output: { result: text.split(String(params.find ?? "")).join(String(params.replaceWith ?? "")) } };
      }
    },
  },
  {
    type: "tools.date",
    name: "التاريخ والوقت",
    description: "الوقت الحالي، تنسيق تاريخ بالعربي، إضافة أو طرح مدة، والفرق بين تاريخين.",
    app: "tools",
    appName: "أدوات",
    color: "#0f766e",
    group: "logic",
    kind: "action",
    fields: [
      OPERATION(
        [
          ["format", "تنسيق تاريخ"],
          ["add", "إضافة / طرح مدة"],
          ["diff", "الفرق بين تاريخين"],
        ],
        "format",
      ),
      { key: "date", label: "التاريخ", type: "text", default: "{{$now}}", help: "أي تاريخ مفهوم (ISO مثلاً)." },
      { key: "amount", label: "المدة (سالب = طرح)", type: "number", default: 1, showIf: { field: "operation", values: ["add"] } },
      {
        key: "unit",
        label: "الوحدة",
        type: "select",
        default: "days",
        options: [
          { value: "minutes", label: "دقايق" },
          { value: "hours", label: "ساعات" },
          { value: "days", label: "أيام" },
          { value: "weeks", label: "أسابيع" },
          { value: "months", label: "شهور" },
        ],
        showIf: { field: "operation", values: ["add", "diff"] },
      },
      { key: "date2", label: "التاريخ التاني", type: "text", showIf: { field: "operation", values: ["diff"] } },
      {
        key: "format",
        label: "الشكل",
        type: "select",
        default: "datetime",
        options: [
          { value: "datetime", label: "تاريخ ووقت بالعربي" },
          { value: "date", label: "تاريخ بالعربي" },
          { value: "time", label: "وقت" },
          { value: "weekday", label: "اسم اليوم" },
          { value: "ymd", label: "YYYY-MM-DD" },
          { value: "iso", label: "ISO" },
        ],
        showIf: { field: "operation", values: ["format", "add"] },
      },
      { key: "timezone", label: "المنطقة الزمنية", type: "text", default: "Africa/Cairo" },
    ],
    sampleOutput: { result: "١٦ سبتمبر ٢٠٢٦ في ٤:٣٠ م", iso: "2026-09-16T13:30:00.000Z", timestamp: 1789565400000 },
    async run({ params }) {
      const timeZone = String(params.timezone || "Africa/Cairo");
      const date = new Date(String(params.date || new Date().toISOString()));
      if (Number.isNaN(date.getTime())) throw new Error("التاريخ مش مفهوم");
      if (params.operation === "diff") {
        const other = new Date(String(params.date2 ?? ""));
        if (Number.isNaN(other.getTime())) throw new Error("التاريخ التاني مش مفهوم");
        const units: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000, months: 2_629_800_000 };
        const diff = (other.getTime() - date.getTime()) / (units[String(params.unit)] ?? 86_400_000);
        return { output: { result: Math.round(diff * 100) / 100 } };
      }
      const target = params.operation === "add" ? shiftDate(date, toNumber(params.amount, 1), String(params.unit)) : date;
      return { output: { result: formatDate(target, String(params.format || "datetime"), timeZone), iso: target.toISOString(), timestamp: target.getTime() } };
    },
  },
  {
    type: "tools.math",
    name: "عمليات حسابية",
    description: "احسب أي معادلة بالأرقام: خصم، ضريبة، إجمالي، متوسط...",
    app: "tools",
    appName: "أدوات",
    color: "#0f766e",
    group: "logic",
    kind: "action",
    fields: [
      { key: "expression", label: "المعادلة", type: "text", required: true, placeholder: "{{2.price}} * 1.14 - 50" },
      { key: "decimals", label: "عدد الأرقام العشرية", type: "number", default: 2 },
    ],
    sampleOutput: { result: 1090.5 },
    async run({ params }) {
      const expression = String(params.expression ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
      // Only digits, operators and parentheses reach evaluation.
      if (!/^[\d\s+\-*/%().]+$/.test(expression) || !expression.trim()) throw new Error("المعادلة لازم تكون أرقام وعلامات حسابية بس");
      let value: unknown;
      try {
        value = Function(`"use strict"; return (${expression});`)();
      } catch {
        throw new Error("المعادلة مش صحيحة");
      }
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("النتيجة مش رقم صحيح (قسمة على صفر؟)");
      const decimals = Math.min(Math.max(Math.floor(toNumber(params.decimals, 2)), 0), 10);
      return { output: { result: Number(value.toFixed(decimals)) } };
    },
  },
  {
    type: "tools.json",
    name: "JSON",
    description: "حوّل نص JSON لبيانات تقدر تستخدمها، أو حوّل بيانات لنص JSON.",
    app: "tools",
    appName: "أدوات",
    color: "#0f766e",
    group: "logic",
    kind: "action",
    fields: [
      OPERATION(
        [
          ["parse", "نص ← بيانات"],
          ["stringify", "بيانات ← نص"],
        ],
        "parse",
      ),
      { key: "input", label: "المدخل", type: "textarea", required: true, placeholder: "{{1.body.payload}}" },
    ],
    sampleOutput: { result: { name: "Ahmed" } },
    async run({ params }) {
      if (params.operation === "stringify") {
        return { output: { result: typeof params.input === "string" ? params.input : JSON.stringify(params.input) } };
      }
      return { output: { result: typeof params.input === "string" ? parseJsonParam(params.input, "المدخل") : params.input } };
    },
  },
];
