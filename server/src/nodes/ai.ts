import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { anthropicCredential } from "./anthropic.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import { AI_CREDENTIAL_TYPES, extractJson, geminiCredential, openaiCredential, providerLabel, runModel, type ToolSpec } from "./llm.js";
import { assertPublicUrl, parseBody, toNumber, withTimeout } from "./util.js";

export const aiCredentialTypes: CredentialType[] = [geminiCredential, openaiCredential, anthropicCredential];

const MEMORY_STORE = "ذاكرة_المحادثات";

const modelField = {
  key: "model",
  label: "الموديل",
  type: "combo",
  suggestFromCredential: true,
  placeholder: "سيبه فاضي = الموديل الافتراضي للحساب",
} as const;

const TOOL_OPTIONS = [
  { value: "http", label: "طلبات HTTP (يكلم أي API أو موقع عام)" },
  { value: "datastore", label: "حفظ وقراءة من مخزن البيانات" },
  { value: "time", label: "معرفة الوقت والتاريخ الحالي" },
];

function buildTools(selected: string[], userId: string, store: string, signal: AbortSignal) {
  const specs: ToolSpec[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

  if (selected.includes("http")) {
    specs.push({
      name: "http_request",
      description: "Send an HTTP request to a public URL and return the status and response body.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full http(s) URL" },
          method: { type: "string", enum: ["GET", "POST"], description: "HTTP method, default GET" },
          body: { type: "string", description: "JSON body for POST requests (optional)" },
        },
        required: ["url"],
      },
    });
    handlers.http_request = async (args) => {
      const url = assertPublicUrl(String(args.url ?? ""));
      const method = String(args.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
      const response = await fetch(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? String(args.body ?? "{}") : undefined,
        signal: withTimeout(signal, 20_000),
      });
      const text = (await response.text()).slice(0, 8000);
      return { status: response.status, body: parseBody(text, response.headers.get("content-type")) };
    };
  }

  if (selected.includes("datastore")) {
    specs.push(
      {
        name: "save_data",
        description: "Save a value under a key for later (customer details, orders, notes). Overwrites existing keys.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Unique key, e.g. a phone number or order id" },
            value: { type: "string", description: "Value to store (plain text or JSON string)" },
          },
          required: ["key", "value"],
        },
      },
      {
        name: "read_data",
        description: "Read a previously saved value by key.",
        parameters: { type: "object", properties: { key: { type: "string", description: "The key to read" } }, required: ["key"] },
      },
    );
    handlers.save_data = async (args) => {
      const key = String(args.key ?? "").trim();
      if (!key) throw new Error("key is required");
      await datastoreWrite(userId, store, key, args.value ?? null);
      return { saved: true, key };
    };
    handlers.read_data = async (args) => datastoreRead(userId, store, String(args.key ?? "").trim());
  }

  if (selected.includes("time")) {
    specs.push({
      name: "get_current_time",
      description: "Get the current date and time (UTC and Cairo local time).",
      parameters: { type: "object", properties: {} },
    });
    handlers.get_current_time = async () => {
      const date = new Date();
      return {
        utc: date.toISOString(),
        cairo: date.toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "full", timeStyle: "short" }),
      };
    };
  }

  return {
    specs,
    run: async (name: string, args: Record<string, unknown>) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    },
  };
}

type Memory = { role: "user" | "assistant"; text: string }[];

export const aiNodes: NodeDefinition[] = [
  {
    type: "ai.generate",
    name: "كتابة / رد بالذكاء الاصطناعي",
    description: "رد، تلخيص، ترجمة، تصنيف أو كتابة محتوى. شغال بـ Gemini أو ChatGPT أو Claude حسب الحساب اللي تختاره.",
    app: "ai",
    appName: "الذكاء الاصطناعي",
    color: "#7c3aed",
    group: "ai",
    kind: "action",
    credentialTypes: AI_CREDENTIAL_TYPES,
    fields: [
      modelField,
      { key: "system", label: "التعليمات (System)", type: "textarea", placeholder: "أنت كاتب محتوى محترف... رد بالعربي." },
      { key: "prompt", label: "المطلوب", type: "textarea", required: true, placeholder: "{{1.message.text}}" },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false, help: "هيظهر في {{N.json}} - اطلب في التعليمات إن الرد يكون JSON" },
    ],
    sampleOutput: {
      text: "أهلاً بيك! الأسعار بتبدأ من 500 جنيه.",
      json: null,
      provider: "gemini",
      model: "gemini-3.8-flash",
      usage: { inputTokens: 120, outputTokens: 40 },
    },
    async run({ params, credential, signal }) {
      const prompt = String(params.prompt ?? "");
      if (!prompt.trim()) throw new Error("المطلوب فاضي");
      const out = await runModel(credential, aiCredentialTypes, {
        model: params.model,
        system: String(params.system ?? "").trim() || undefined,
        history: [],
        prompt,
        tools: [],
        runTool: async () => null,
        maxSteps: 1,
        maxTokens: Math.max(1, Math.floor(toNumber(params.maxTokens, 16000))),
        signal,
      });
      return {
        output: {
          text: out.text,
          json: params.parseJson ? extractJson(out.text) : null,
          provider: providerLabel[credential!.type],
          model: out.model,
          usage: out.usage,
        },
      };
    },
  },
  {
    type: "ai.agent",
    name: "AI Agent",
    description: "مساعد ذكي بيفكر ويستخدم أدوات (APIs، مخزن البيانات...) وبيفتكر المحادثة. شغال بأي مزوّد.",
    app: "agent",
    appName: "AI Agent",
    color: "#9333ea",
    group: "ai",
    kind: "action",
    credentialTypes: AI_CREDENTIAL_TYPES,
    fields: [
      modelField,
      {
        key: "system",
        label: "شخصية ودور الـ Agent",
        type: "textarea",
        placeholder: "أنت مساعد خدمة عملاء لمتجر ... ردودك قصيرة وودودة باللهجة المصرية.",
      },
      {
        key: "knowledge",
        label: "معلومات يعتمد عليها (Knowledge)",
        type: "textarea",
        placeholder: "الأسعار، المواعيد، سياسة الاسترجاع، العنوان...",
        help: "الـ Agent هيجاوب من المعلومات دي بس ومش هيألّف.",
      },
      { key: "prompt", label: "رسالة العميل / المهمة", type: "textarea", required: true, placeholder: "{{1.message.text}}" },
      {
        key: "memoryKey",
        label: "مفتاح الذاكرة",
        type: "text",
        placeholder: "{{1.message.chat.id}}",
        help: "عشان يفتكر كلام كل عميل لوحده. سيبه فاضي لو مش محتاج ذاكرة.",
      },
      { key: "memoryLength", label: "عدد الرسائل اللي يفتكرها", type: "number", default: 12 },
      { key: "tools", label: "الأدوات المتاحة للـ Agent", type: "multiselect", default: [], options: TOOL_OPTIONS },
      { key: "dataStore", label: "مخزن البيانات الخاص بالأدوات", type: "text", default: "agent" },
      { key: "maxSteps", label: "أقصى عدد استخدام للأدوات", type: "number", default: 5 },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false },
    ],
    sampleOutput: {
      text: "تمام يا أحمد، سجلت طلبك وهنتواصل معاك خلال ساعة.",
      json: null,
      toolCalls: [{ name: "save_data", args: { key: "01000000000", value: "طلب: 2 تيشيرت" }, result: { saved: true } }],
      provider: "gemini",
      model: "gemini-3.8-flash",
      usage: { inputTokens: 900, outputTokens: 60 },
    },
    async run({ params, credential, workflow, signal }) {
      const prompt = String(params.prompt ?? "");
      if (!prompt.trim()) throw new Error("رسالة العميل / المهمة فاضية");

      const memoryKey = String(params.memoryKey ?? "").trim();
      const memoryId = memoryKey ? `${workflow.id}:${memoryKey}` : "";
      const memoryLength = Math.min(Math.max(Math.floor(toNumber(params.memoryLength, 12)), 2), 50);
      const history: Memory = memoryId ? (((await datastoreRead(workflow.userId, MEMORY_STORE, memoryId)).value as Memory) ?? []) : [];

      const knowledge = String(params.knowledge ?? "").trim();
      const system = [String(params.system ?? "").trim(), knowledge && `# معلومات مرجعية (اعتمد عليها فقط)\n${knowledge}`]
        .filter(Boolean)
        .join("\n\n");

      const tools = buildTools(Array.isArray(params.tools) ? params.tools : [], workflow.userId, String(params.dataStore || "agent"), signal);
      const out = await runModel(credential, aiCredentialTypes, {
        model: params.model,
        system: system || undefined,
        history: history.slice(-memoryLength),
        prompt,
        tools: tools.specs,
        runTool: tools.run,
        maxSteps: Math.min(Math.max(Math.floor(toNumber(params.maxSteps, 5)), 1), 15),
        maxTokens: Math.max(1, Math.floor(toNumber(params.maxTokens, 16000))),
        signal,
      });

      if (memoryId) {
        const updated = [...history, { role: "user", text: prompt }, { role: "assistant", text: out.text }].slice(-memoryLength);
        await datastoreWrite(workflow.userId, MEMORY_STORE, memoryId, updated);
      }

      return {
        output: {
          text: out.text,
          json: params.parseJson ? extractJson(out.text) : null,
          toolCalls: out.toolCalls,
          provider: providerLabel[credential!.type],
          model: out.model,
          usage: out.usage,
        },
      };
    },
  },
];
