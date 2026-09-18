import { loadCredential } from "../engine/executor.js";
import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { imageAsBase64, urlList } from "./media.js";
import { anthropicCredential } from "./anthropic.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import { AI_CREDENTIAL_TYPES, customAiCredential, extractJson, geminiCredential, openaiCredential, providerLabel, runModel, type ToolSpec, effortFor, speedField } from "./llm.js";
import { NOTIFY_CREDENTIAL_TYPES, sendNotification } from "./notify.js";
import { assertPublicUrl, parseBody, toNumber, withTimeout } from "./util.js";

export const aiCredentialTypes: CredentialType[] = [geminiCredential, openaiCredential, anthropicCredential, customAiCredential];

const MEMORY_STORE = "ذاكرة_المحادثات";
/** Conversations handed to a human: the agent stays silent with that customer until this expires. */
export const HANDOFF_STORE = "تحويلات_للموظف";

const modelField = {
  key: "model",
  label: "الموديل",
  type: "model",
  modelKind: "text",
  help: "اختار من موديلات حسابك، أو سيبه على الافتراضي.",
} as const;

const TOOL_OPTIONS = [
  { value: "handoff", label: "تحويل العميل لموظف وإشعارك فوراً" },
  { value: "datastore", label: "حفظ وقراءة من مخزن البيانات" },
  { value: "http", label: "طلبات HTTP (يكلم أي API أو موقع عام)" },
  { value: "time", label: "معرفة الوقت والتاريخ الحالي" },
];

// Without this the model happily tells customers it "sent" or "saved" things no tool ever did.
const HONESTY_RULES =
  "# قواعد مهمة\n" +
  "- متقولش أبداً إنك بعتّ أو حفظت أو حوّلت أو سجّلت أي حاجة إلا لو الأداة المناسبة اتنفذت ورجعت نجاح.\n" +
  "- لو الأداة فشلت أو مش متاحة، قول للعميل الحقيقة بلطف ومتألّفش.";

interface HandoffConfig {
  credential?: CredentialValue;
  target: string;
  pauseHours: number;
  memoryId: string;
  conversation: string;
}

function buildTools(selected: string[], userId: string, store: string, signal: AbortSignal, handoff: HandoffConfig) {

  const specs: ToolSpec[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

  if (selected.includes("handoff")) {
    specs.push({
      name: "handoff_to_human",
      description:
        "Notify the business owner that this customer wants a human (customer service, a complaint, or anything outside your knowledge), " +
        "then stop auto-replying to this customer. Ask for the customer's name and contact first if you don't have them.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string", description: "Customer name" },
          customer_contact: { type: "string", description: "Phone number, username or any way to reach the customer" },
          reason: { type: "string", description: "Short summary of what the customer needs" },
        },
        required: ["reason"],
      },
    });
    handlers.handoff_to_human = async (args) => {
      if (!handoff.credential) {
        throw new Error(
          "Handoff is not configured: no notification account (the owner must pick a Telegram bot or WhatsApp account in the agent step). Do not claim anything was sent.",
        );
      }
      if (!handoff.target) {
        throw new Error("Handoff is not configured: the owner did not set who receives the handoff. Do not claim anything was sent.");
      }
      const text = [
        "🙋 عميل عايز يكلم موظف",
        `الاسم: ${String(args.customer_name || "غير معروف")}`,
        `التواصل: ${String(args.customer_contact || "غير معروف")}`,
        handoff.conversation ? `معرّف المحادثة: ${handoff.conversation}` : "",
        `الطلب: ${String(args.reason ?? "")}`,
      ]
        .filter(Boolean)
        .join("\n");
      await sendNotification(handoff.credential, handoff.target, text, signal, userId);
      const paused = handoff.pauseHours > 0 && Boolean(handoff.memoryId);
      if (paused) {
        await datastoreWrite(userId, HANDOFF_STORE, handoff.memoryId, {
          until: new Date(Date.now() + handoff.pauseHours * 3_600_000).toISOString(),
          reason: args.reason ?? "",
          customer: args.customer_name ?? "",
        });
      }
      return { sent: true, bot_paused_for_this_customer: paused };
    };
  }

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

/** Added when a product photo is attached: write about what is actually shown. */
const PRODUCT_CONTEXT =
  "الصورة المرفقة هي المنتج الحقيقي. اكتب عن المنتج زي ما هو ظاهر في الصورة بالظبط (نوعه وتغليفه وشكله)، ومتفترضش إنه اتفتح أو تتكلم عن حاجة مش باينة. لو بتكتب وصف لتصميم صورة، اطلب إن المنتج يظهر بنفس شكله وتغليفه من غير تعديل.";

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
      {
        key: "images",
        label: "صورة المنتج يشوفها الذكاء الاصطناعي (اختياري)",
        type: "text",
        placeholder: "اكتب @ واختار صورة",
        help: "بيكتب عن المنتج اللي في الصورة بالظبط. لو فاضية بتتاخد تلقائي من صورة المنتج في الخطوات اللي قبلها.",
      },
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
      const images = [];
      for (const url of urlList(params.images).slice(0, 4)) images.push(await imageAsBase64(url, signal));
      const out = await runModel(credential, aiCredentialTypes, {
        model: params.model,
        system: [String(params.system ?? "").trim(), images.length ? PRODUCT_CONTEXT : ""].filter(Boolean).join("\n\n") || undefined,
        history: [],
        prompt,
        images: images.map((img) => ({ mimeType: img.data ? img.mimeType : "image/jpeg", data: img.data })),
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
    description: "مساعد ذكي بيفكر ويستخدم أدوات، بيفتكر المحادثة، وبيحوّل العميل ليك لما يحتاج موظف. شغال بأي مزوّد.",
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
      {
        key: "handoffCredentialId",
        label: "التحويل لموظف: الإشعار يتبعت من أنهي حساب",
        type: "credential",
        credentialTypes: NOTIFY_CREDENTIAL_TYPES,
        help: "سيبه فاضي = نفس البوت أو رقم الواتساب اللي بيكلم العملاء في المحفّز. أو اختار بوت/رقم تاني، أو خدمة خارجية بتاعتك.",
      },
      {
        key: "handoffTarget",
        label: "التحويل لموظف: يوصل لمين (المسؤول)",
        type: "text",
        placeholder: "@your_username أو 201012345678",
        help: "تيليجرام: اكتب يوزرنيم المسؤول (@name) أو الـ Chat ID - ومهم: المسؤول لازم يفتح البوت ويبعتله أي رسالة مرة واحدة الأول. واتساب: رقم المسؤول بالكود الدولي من غير + (مثلاً 201012345678).",
      },
      {
        key: "handoffPauseHours",
        label: "التحويل لموظف: يسكت البوت مع العميل كام ساعة",
        type: "number",
        default: 24,
        help: "0 = البوت يكمّل يرد عادي بعد التحويل. تقدر ترجّعه قبل كده بمسح العميل من مخزن «تحويلات_للموظف».",
      },
      { key: "dataStore", label: "مخزن البيانات الخاص بالأدوات", type: "text", default: "agent" },
      { key: "maxSteps", label: "أقصى عدد استخدام للأدوات", type: "number", default: 5 },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false },
      speedField("fast"),
    ],
    sampleOutput: {
      text: "تمام يا أحمد، بلّغت خدمة العملاء وهيتواصلوا معاك حالاً.",
      json: null,
      handedOff: false,
      toolCalls: [{ name: "handoff_to_human", args: { customer_name: "Ahmed", reason: "استفسار عن طلب" }, result: { sent: true } }],
      provider: "gemini",
      model: "gemini-3.8-flash",
      usage: { inputTokens: 900, outputTokens: 60 },
    },
    async run({ params, credential, workflow, signal, trigger }) {
      const prompt = String(params.prompt ?? "");
      if (!prompt.trim()) throw new Error("رسالة العميل / المهمة فاضية");

      const memoryKey = String(params.memoryKey ?? "").trim();
      const memoryId = memoryKey ? `${workflow.id}:${memoryKey}` : "";

      // Handoff state and conversation memory are read together.
      const [handoffRead, memoryRead] = memoryId
        ? await Promise.all([datastoreRead(workflow.userId, HANDOFF_STORE, memoryId), datastoreRead(workflow.userId, MEMORY_STORE, memoryId)])
        : [undefined, undefined];
      // A human took over this conversation: stay silent until the pause ends.
      const handoffState = handoffRead?.value as { until?: string } | null | undefined;
      if (handoffState?.until && handoffState.until > new Date().toISOString()) {
        return { output: { text: "", json: null, handedOff: true, handedOffUntil: handoffState.until, toolCalls: [] } };
      }

      const memoryLength = Math.min(Math.max(Math.floor(toNumber(params.memoryLength, 12)), 2), 50);
      const history: Memory = (memoryRead?.value as Memory) ?? [];

      const selectedTools: string[] = Array.isArray(params.tools) ? params.tools : [];
      const handoffCredentialId = String(params.handoffCredentialId ?? "").trim();
      const handoff: HandoffConfig = {
        credential: !selectedTools.includes("handoff")
          ? undefined
          : handoffCredentialId
            ? await loadCredential(workflow.userId, handoffCredentialId)
            : // Default: notify through the same bot / number the customers are talking to.
              trigger?.credential && NOTIFY_CREDENTIAL_TYPES.includes(trigger.credential.type)
              ? trigger.credential
              : undefined,
        target: String(params.handoffTarget ?? ""),
        pauseHours: Math.max(0, toNumber(params.handoffPauseHours, 24)),
        memoryId,
        conversation: memoryKey,
      };

      const knowledge = String(params.knowledge ?? "").trim();
      const system = [
        String(params.system ?? "").trim(),
        knowledge && `# معلومات مرجعية (اعتمد عليها فقط)\n${knowledge}`,
        HONESTY_RULES,
      ]
        .filter(Boolean)
        .join("\n\n");

      const tools = buildTools(selectedTools, workflow.userId, String(params.dataStore || "agent"), signal, handoff);
      const out = await runModel(credential, aiCredentialTypes, {
        model: params.model,
        system,
        history: history.slice(-memoryLength),
        prompt,
        tools: tools.specs,
        runTool: tools.run,
        maxSteps: Math.min(Math.max(Math.floor(toNumber(params.maxSteps, 5)), 1), 15),
        maxTokens: Math.max(1, Math.floor(toNumber(params.maxTokens, 16000))),
        effort: effortFor(params.speed ?? "fast"),
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
          handedOff: out.toolCalls.some((c) => c.name === "handoff_to_human" && (c.result as { sent?: boolean })?.sent),
          toolCalls: out.toolCalls,
          provider: providerLabel[credential!.type],
          model: out.model,
          usage: out.usage,
        },
      };
    },
  },
];
