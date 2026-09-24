import { loadCredential } from "../engine/executor.js";
import type { CredentialType, CredentialValue, NodeDefinition, OwnerMessage, WorkflowGraph } from "../engine/types.js";
import { imageAsBase64, urlList } from "./media.js";
import { anthropicCredential } from "./anthropic.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import {
  addFact,
  addOpen,
  distill,
  extractFacts,
  factsToForget,
  isOwner,
  learnedSection,
  listFacts,
  listOpen,
  OWNER_HELP,
  ownerCommand,
  readLearning,
  saveLearning,
  senderOf,
  sentByPlatform,
  type AiAccount,
  type Learning,
  type OwnerCommand,
  type Sender,
} from "./learning.js";
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
  help: "اختار من موديلات حسابك، أو سيبه على الافتراضي",
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
  "- لو الأداة فشلت أو مش متاحة، قول للعميل الحقيقة بلطف ومتألّفش";

// With learning on: a question the bot has no answer for goes to the owner, never to a guess.
const ASK_OWNER_RULES =
  "# لما متعرفش الإجابة\n" +
  "- لو العميل سأل عن حاجة مش موجودة في معلوماتك (سعر، توفر، ميعاد، تفصيلة)، متخمّنش ومتقولش «مش عارف» وخلاص:\n" +
  "  استخدم أداة ask_owner بسؤال العميل، وبعدها قوله بلطف إنك هتتأكد من صاحب المكان وترد عليه في أقرب وقت.\n" +
  "- متستخدمهاش لحاجة إجابتها موجودة في معلوماتك.";

interface HandoffConfig {
  credential?: CredentialValue;
  target: string;
  pauseHours: number;
  memoryId: string;
  conversation: string;
}

/** Everything the "ask the owner" tool needs to record a question and tell the owner about it. */
interface AskOwnerConfig {
  workflowId: string;
  sender: Sender | null;
  memoryId: string;
  /** Where to ping the owner, if anywhere. */
  channel: () => Promise<CredentialValue | undefined>;
  ownerContact: string;
}

function buildTools(
  selected: string[],
  userId: string,
  store: string,
  signal: AbortSignal,
  handoff: HandoffConfig,
  ask?: AskOwnerConfig,
) {

  const specs: ToolSpec[] = [];
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

  if (ask) {
    specs.push({
      name: "ask_owner",
      description:
        "Use when the customer asks something your knowledge does not cover - a price, availability, a detail you were not given. " +
        "It records the question for the business owner and notifies them; their answer is sent to this customer and remembered. " +
        "After calling it, tell the customer you will check and get back to them. Never guess the answer instead.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The customer's question, in their own words" },
          customer_name: { type: "string", description: "The customer's name, if known" },
        },
        required: ["question"],
      },
    });
    handlers.ask_owner = async (args) => {
      const question = String(args.question ?? "").trim();
      if (!question) throw new Error("question is required");
      // Read fresh: another customer's question may have been added since this reply started.
      const state = await readLearning(userId, ask.workflowId);
      const open = addOpen(state, question, String(args.customer_name || ask.sender?.name || ""), ask.sender?.id ?? "", ask.memoryId);
      await saveLearning(userId, ask.workflowId, state);

      let notified = false;
      const channel = ask.ownerContact ? await ask.channel().catch(() => undefined) : undefined;
      if (channel) {
        const text = [
          `❓ سؤال محتاج إجابتك (رقم ${open.id})`,
          `${open.customer || "عميل"}: ${open.question}`,
          "",
          `رد من هنا كده ← رد ${open.id}: الإجابة`,
          "وهبعتها للعميل وأحفظها للمرة الجاية",
        ].join("\n");
        const target = ask.ownerContact.split(/[,،\n]+/)[0].trim();
        notified = await sendNotification(channel, target, text, signal, userId).then(
          () => true,
          () => false,
        );
      }
      return { recorded: true, question_number: open.id, owner_notified: notified };
    };
  }

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

interface OwnerContext {
  learning: Learning;
  ai: AiAccount;
  userId: string;
  workflowId: string;
  /** The account customers talk to: an answer to a customer goes out through it. */
  customers?: CredentialValue;
  memoryLength: number;
  signal: AbortSignal;
}

/** Add a line to a customer's remembered conversation, so the bot knows what they were told. */
async function remember(userId: string, memoryId: string, text: string, memoryLength: number) {
  const { value } = await datastoreRead(userId, MEMORY_STORE, memoryId);
  const history = Array.isArray(value) ? (value as Memory) : [];
  await datastoreWrite(userId, MEMORY_STORE, memoryId, [...history, { role: "assistant", text }].slice(-memoryLength));
}

/** What the owner told the bot to do, done - and the reply the owner sees. */
async function obeyOwner(command: OwnerCommand, ctx: OwnerContext): Promise<string> {
  const { learning } = ctx;
  const save = () => saveLearning(ctx.userId, ctx.workflowId, learning);

  switch (command.kind) {
    case "help":
      return OWNER_HELP;
    case "list":
      return listFacts(learning);
    case "open":
      return listOpen(learning);

    case "teach": {
      // "اتعلم" is an order: if the AI cannot tidy it, the owner's own words are kept as they are.
      let text = command.text;
      let replaces: number[] = [];
      try {
        const distilled = await distill(ctx.ai, learning, { answer: command.text });
        if (distilled.fact) text = distilled.fact;
        replaces = distilled.replaces;
      } catch {
        /* keep the owner's words */
      }
      const old = learning.facts.filter((f) => replaces.includes(f.id));
      const fact = addFact(learning, text, "owner", replaces);
      await save();
      return [`حفظتها ✓ (رقم ${fact.id})`, fact.text, ...(old.length ? ["", "وشلت القديمة اللي كانت بتقول:", ...old.map((f) => `- ${f.text}`)] : [])].join("\n");
    }

    case "forget": {
      const ids = await factsToForget(ctx.ai, learning, command.text).catch(() => [] as number[]);
      if (!ids.length) return `ملقتش حاجة عن «${command.text}».\n\n${listFacts(learning)}`;
      const gone = learning.facts.filter((f) => ids.includes(f.id));
      learning.facts = learning.facts.filter((f) => !ids.includes(f.id));
      await save();
      return ["نسيتها ✓", ...gone.map((f) => `- ${f.text}`)].join("\n");
    }

    case "answer": {
      const question = learning.open.find((q) => q.id === command.id);
      if (!question) return `مفيش سؤال مستني رقمه ${command.id}.\n\n${listOpen(learning)}`;

      // 1. The answer goes to the customer who asked, in the owner's own words.
      let sent = false;
      let problem = "";
      if (!question.chat) problem = "مفيش رقم للعميل ده أبعتله عليه";
      else if (!ctx.customers) problem = "مش لاقي الحساب اللي العملاء بيكلموا البوت عليه";
      else {
        try {
          await sendNotification(ctx.customers, question.chat, command.text, ctx.signal, ctx.userId);
          sent = true;
        } catch (e) {
          problem = (e as Error).message;
        }
      }

      // 2. The bot keeps it for the next customer who asks the same thing.
      let fact: ReturnType<typeof addFact> | null = null;
      try {
        const distilled = await distill(ctx.ai, learning, { question: question.question, answer: command.text });
        if (distilled.fact) fact = addFact(learning, distilled.fact, "answer", distilled.replaces, question.question);
      } catch {
        /* the customer still got the answer */
      }

      // 3. Done with it - unless it could not reach the customer, so the owner can try again.
      if (sent || !question.chat) learning.open = learning.open.filter((q) => q.id !== question.id);
      await save();
      if (sent && question.memoryId) await remember(ctx.userId, question.memoryId, command.text, ctx.memoryLength).catch(() => undefined);

      const who = question.customer || question.chat || "العميل";
      return [
        sent ? `بعتّ الإجابة لـ ${who} ✓` : `⚠️ مقدرتش أبعتها لـ ${who}: ${problem}${question.chat ? "\nالسؤال لسه مفتوح - جرّب تاني" : ""}`,
        fact ? `واتعلمت: ${fact.text}` : "(مفيش معلومة عامة أحفظها من الرد ده للعملاء التانيين)",
      ].join("\n");
    }
  }
}

/** The chatbot step in a scenario and the accounts it works with - for answering from the app. */
async function chatbotAccounts(workflow: { userId: string; graph: WorkflowGraph }) {
  const agent = workflow.graph.nodes.find((n) => n.type === "ai.agent" && !n.disabled);
  const trigger = workflow.graph.nodes.find((n) => /\.trigger$/.test(n.type) && n.credentialId);
  const [ai, customers] = await Promise.all([
    agent?.credentialId ? loadCredential(workflow.userId, agent.credentialId) : undefined,
    trigger?.credentialId ? loadCredential(workflow.userId, trigger.credentialId) : undefined,
  ]);
  const model = typeof agent?.params?.model === "string" && !agent.params.model.includes("{{") ? agent.params.model : undefined;
  return {
    agent,
    ai,
    model,
    customers: customers && NOTIFY_CREDENTIAL_TYPES.includes(customers.type) ? customers : undefined,
    memoryLength: Math.min(Math.max(Math.floor(toNumber(agent?.params?.memoryLength, 12)), 2), 50),
  };
}

/** The owner answering a waiting question from the app instead of from their phone - same result. */
export async function answerFromApp(workflow: { id: string; userId: string; graph: WorkflowGraph }, questionId: number, text: string) {
  const accounts = await chatbotAccounts(workflow);
  const learning = await readLearning(workflow.userId, workflow.id);
  const signal = AbortSignal.timeout(60_000);
  const reply = await obeyOwner(
    { kind: "answer", id: questionId, text },
    {
      learning,
      ai: { credential: accounts.ai, types: aiCredentialTypes, model: accounts.model, signal },
      userId: workflow.userId,
      workflowId: workflow.id,
      customers: accounts.customers,
      memoryLength: accounts.memoryLength,
      signal,
    },
  );
  return { reply, learning };
}

/** Old conversations or an FAQ pasted in the app, turned into facts the bot keeps. */
export async function importFromApp(workflow: { id: string; userId: string; graph: WorkflowGraph }, text: string) {
  const accounts = await chatbotAccounts(workflow);
  if (!accounts.ai) throw new Error("اختار حساب الذكاء الاصطناعي في خطوة الـ AI Agent الأول - هو اللي بيقرا المحادثات ويطلّع منها المعلومات");
  const learning = await readLearning(workflow.userId, workflow.id);
  const facts = await extractFacts({ credential: accounts.ai, types: aiCredentialTypes, model: accounts.model, signal: AbortSignal.timeout(120_000) }, learning, text);
  const added = facts.map((fact) => addFact(learning, fact, "import"));
  await saveLearning(workflow.userId, workflow.id, learning);
  return { added, learning };
}

/**
 * The owner answered a customer themselves, from their own WhatsApp. The chatbot in this scenario
 * takes the reply as a lesson, remembers it in that customer's conversation, and keeps quiet with
 * that customer for a while so it does not talk over the owner.
 */
export async function learnFromOwnerReply(workflow: { id: string; userId: string; graph: WorkflowGraph }, message: OwnerMessage) {
  const agent = workflow.graph.nodes.find((n) => n.type === "ai.agent" && !n.disabled && n.params?.learn !== false);
  if (!agent) return;
  // What the platform itself sent comes back as "sent from this number" too - that is not the owner.
  if (await sentByPlatform(workflow.userId, message.chat, message.text, message.messageId)) return;

  // The conversation was remembered under the customer's number (or chat id, when hidden).
  const keys = [...new Set([message.chat, message.jid].filter(Boolean) as string[])];
  let memoryId = `${workflow.id}:${message.chat}`;
  let history: Memory = [];
  for (const key of keys) {
    const read = await datastoreRead(workflow.userId, MEMORY_STORE, `${workflow.id}:${key}`);
    if (read.found && Array.isArray(read.value)) {
      memoryId = `${workflow.id}:${key}`;
      history = read.value as Memory;
      break;
    }
  }
  const normal = (text: string) => text.replace(/\s+/g, " ").trim();
  // Belt and braces: the bot's own last reply, echoed back.
  if (history.some((m) => m.role === "assistant" && normal(m.text) === normal(message.text))) return;

  const params = agent.params ?? {};
  const memoryLength = Math.min(Math.max(Math.floor(toNumber(params.memoryLength, 12)), 2), 50);
  const pauseHours = Math.max(0, toNumber(params.ownerPauseHours, 2));
  // What the customer last asked, in the few lines before the owner's reply.
  const question = [...history.slice(-4)].reverse().find((m) => m.role === "user")?.text ?? "";

  await datastoreWrite(workflow.userId, MEMORY_STORE, memoryId, [...history, { role: "assistant", text: message.text }].slice(-memoryLength));
  if (pauseHours > 0) {
    await datastoreWrite(workflow.userId, HANDOFF_STORE, memoryId, {
      until: new Date(Date.now() + pauseHours * 3_600_000).toISOString(),
      reason: "صاحب الرقم بيرد بنفسه",
      byOwner: true,
    });
  }

  if (!question || !agent.credentialId) return;
  const credential = await loadCredential(workflow.userId, agent.credentialId);
  if (!credential) return;
  const learning = await readLearning(workflow.userId, workflow.id);
  const distilled = await distill(
    { credential, types: aiCredentialTypes, model: typeof params.model === "string" && !params.model.includes("{{") ? params.model : undefined, signal: AbortSignal.timeout(60_000) },
    learning,
    { question, answer: message.text },
  ).catch(() => ({ fact: null, replaces: [] as number[] }));
  // The owner answered this customer - whatever the bot had waiting from them is settled.
  learning.open = learning.open.filter((q) => !keys.includes(q.chat));
  if (distilled.fact) addFact(learning, distilled.fact, "reply", distilled.replaces, question);
  await saveLearning(workflow.userId, workflow.id, learning);
}

/** Added when a product photo is attached: write about what is actually shown. */
const PRODUCT_CONTEXT =
  "الصورة المرفقة هي المنتج الحقيقي. اكتب عن المنتج زي ما هو ظاهر في الصورة بالظبط (نوعه وتغليفه وشكله)، ومتفترضش إنه اتفتح أو تتكلم عن حاجة مش باينة. لو بتكتب وصف لتصميم صورة، اطلب إن المنتج يظهر بنفس شكله وتغليفه من غير تعديل";

export const aiNodes: NodeDefinition[] = [
  {
    type: "ai.generate",
    name: "كتابة / رد بالذكاء الاصطناعي",
    description: "رد، تلخيص، ترجمة، تصنيف أو كتابة محتوى. شغال بـ Gemini أو ChatGPT أو Claude حسب الحساب اللي تختاره",
    app: "ai",
    appName: "الذكاء الاصطناعي",
    color: "#7c3aed",
    group: "ai",
    kind: "action",
    credentialTypes: AI_CREDENTIAL_TYPES,
    fields: [
      modelField,
      { key: "system", label: "التعليمات (System)", type: "textarea", placeholder: "أنت كاتب محتوى محترف... رد بالعربي" },
      { key: "prompt", label: "المطلوب", type: "textarea", required: true, placeholder: "اكتب المطلوب من الذكاء الاصطناعي", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      {
        key: "images",
        label: "صورة المنتج يشوفها الذكاء الاصطناعي (اختياري)",
        type: "text",
        placeholder: "اكتب @ واختار صورة",
        help: "بيكتب عن المنتج اللي في الصورة بالظبط. لو فاضية بتتاخد تلقائي من صورة المنتج في الخطوات اللي قبلها",
      },
      {
        key: "search",
        label: "يدوّر على النت بنفسه",
        type: "boolean",
        default: false,
        help: "بيخلي الذكاء الاصطناعي يبحث ويقرا مواقع حقيقية قبل ما يرد، بدل ما يجاوب من معلوماته القديمة. شغال مع Gemini وChatGPT وClaude",
      },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false, help: "هيظهر في {{N.json}} - اطلب في التعليمات إن الرد يكون JSON" },
    ],
    sampleOutput: {
      text: "أهلاً بيك! الأسعار بتبدأ من 500 جنيه",
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
        webSearch: params.search === true,
        // Searching means reading pages and coming back, so it needs more than one turn.
        maxSteps: params.search === true ? 6 : 1,
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
    description: "مساعد ذكي بيفكر ويستخدم أدوات، بيفتكر المحادثة، وبيحوّل العميل ليك لما يحتاج موظف. شغال بأي مزوّد",
    app: "agent",
    appName: "AI Agent",
    color: "#9333ea",
    group: "ai",
    kind: "action",
    credentialTypes: AI_CREDENTIAL_TYPES,
    guide: [
      "بيرد على العملاء من «شخصية ودور الـ Agent» و«المعلومات» اللي بتكتبها تحت - ومش بيألّف حاجة مش فيها",
      "بيفتكر كلام كل عميل لوحده: حط رقم العميل من خطوة الرسالة في «مفتاح الذاكرة»",
      "بيتعلّم منك: أي سؤال ميعرفوش بيبعتهولك، وردّك بيوصل للعميل ويتحفظ. الشرح خطوة بخطوة تحت في «اللي البوت اتعلمه»",
    ],
    fields: [
      modelField,
      {
        key: "system",
        label: "شخصية ودور الـ Agent",
        type: "textarea",
        placeholder: "أنت مساعد خدمة عملاء لمتجر ... ردودك قصيرة وودودة باللهجة المصرية",
      },
      {
        key: "knowledge",
        label: "معلومات يعتمد عليها (Knowledge)",
        type: "textarea",
        placeholder: "الأسعار، المواعيد، سياسة الاسترجاع، العنوان...",
        help: "الـ Agent هيجاوب من المعلومات دي بس ومش هيألّف",
      },
      {
        key: "learn",
        label: "يتعلم لوحده من ردودك",
        type: "boolean",
        default: true,
        help: "السؤال اللي ميعرفوش بيبعتهولك بدل ما يألّف، وردّك بيتحفظ. الشرح خطوة بخطوة تحت في «اللي البوت اتعلمه»",
      },
      {
        key: "ownerContact",
        label: "رقمك انت (صاحب المشروع)",
        type: "text",
        placeholder: "201012345678 أو @your_username",
        help: "البوت بيبعت الأسئلة لهنا، وبياخد التعليم من هنا بس. واتساب: رقمك بكود الدولة زي 201012345678 (رقم غير رقم البوت). تيليجرام: @يوزرنيمك. فاضي = نفس «التحويل لموظف: يوصل لمين»",
      },
      {
        key: "ownerPauseHours",
        label: "لو رديت انت بنفسك على عميل، البوت يسكت معاه كام ساعة",
        type: "number",
        default: 2,
        help: "واتساب WasenderAPI بس: لما ترد انت على عميل من موبايلك، البوت يسيبك تكمل معاه المدة دي من غير ما يقاطعك. 0 = يكمل يرد عادي",
      },
      { key: "prompt", label: "رسالة العميل / المهمة", type: "textarea", required: true, placeholder: "رسالة العميل", help: "دوس زرار البيانات جوه الخانة واختار من خطوة قبلها" },
      {
        key: "memoryKey",
        label: "مفتاح الذاكرة",
        type: "text",
        placeholder: "رقم العميل أو رقم المحادثة",
        help: "حاجة تميّز كل عميل (رقمه أو رقم محادثته) عشان يفتكر كلامه لوحده - دوس زرار البيانات واختارها من المحفّز. فاضي = من غير ذاكرة",
      },
      { key: "memoryLength", label: "عدد الرسائل اللي يفتكرها", type: "number", default: 12 },
      { key: "tools", label: "الأدوات المتاحة للـ Agent", type: "multiselect", default: [], options: TOOL_OPTIONS },
      {
        key: "handoffCredentialId",
        label: "التحويل لموظف: الإشعار يتبعت من أنهي حساب",
        type: "credential",
        credentialTypes: NOTIFY_CREDENTIAL_TYPES,
        help: "سيبه فاضي = نفس البوت أو رقم الواتساب اللي بيكلم العملاء في المحفّز. أو اختار بوت/رقم تاني، أو خدمة خارجية بتاعتك",
      },
      {
        key: "handoffTarget",
        label: "التحويل لموظف: يوصل لمين (المسؤول)",
        type: "text",
        placeholder: "@your_username أو 201012345678",
        help: "تيليجرام: اكتب يوزرنيم المسؤول (@name) أو الـ Chat ID - ومهم: المسؤول لازم يفتح البوت ويبعتله أي رسالة مرة واحدة الأول. واتساب: رقم المسؤول بالكود الدولي من غير + (مثلاً 201012345678)",
      },
      {
        key: "handoffPauseHours",
        label: "التحويل لموظف: يسكت البوت مع العميل كام ساعة",
        type: "number",
        default: 24,
        help: "0 = البوت يكمّل يرد عادي بعد التحويل. تقدر ترجّعه قبل كده بمسح العميل من مخزن «تحويلات_للموظف»",
      },
      { key: "dataStore", label: "مخزن البيانات الخاص بالأدوات", type: "text", default: "agent" },
      { key: "maxSteps", label: "أقصى عدد استخدام للأدوات", type: "number", default: 5 },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false },
      speedField("fast"),
    ],
    sampleOutput: {
      text: "تمام يا أحمد، بلّغت خدمة العملاء وهيتواصلوا معاك حالاً",
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
      const memoryLength = Math.min(Math.max(Math.floor(toNumber(params.memoryLength, 12)), 2), 50);
      const learnOn = params.learn !== false;
      const sender = senderOf(trigger?.type, trigger?.output);
      const ownerContact = String(params.ownerContact ?? "").trim() || String(params.handoffTarget ?? "").trim();

      // Handoff state, conversation memory and what the bot has learned are read together.
      const [handoffRead, memoryRead, learning] = await Promise.all([
        memoryId ? datastoreRead(workflow.userId, HANDOFF_STORE, memoryId) : undefined,
        memoryId ? datastoreRead(workflow.userId, MEMORY_STORE, memoryId) : undefined,
        learnOn ? readLearning(workflow.userId, workflow.id) : null,
      ]);

      // Where a message to the owner goes: the account picked for handoff, or else the same bot or
      // number the customers are talking to. Loaded once, and only if something needs it.
      const handoffCredentialId = String(params.handoffCredentialId ?? "").trim();
      let ownerChannelLoad: Promise<CredentialValue | undefined> | undefined;
      const ownerChannel = () =>
        (ownerChannelLoad ??= handoffCredentialId
          ? loadCredential(workflow.userId, handoffCredentialId)
          : Promise.resolve(trigger?.credential && NOTIFY_CREDENTIAL_TYPES.includes(trigger.credential.type) ? trigger.credential : undefined));

      // The owner teaching the bot. Only from the owner's own number or account - never a customer.
      const fromOwner = Boolean(learning) && isOwner(sender, ownerContact);
      const command = fromOwner ? ownerCommand(prompt) : null;
      if (learning && command) {
        const reply = await obeyOwner(command, {
          learning,
          ai: { credential, types: aiCredentialTypes, model: params.model, signal },
          userId: workflow.userId,
          workflowId: workflow.id,
          customers: trigger?.credential && NOTIFY_CREDENTIAL_TYPES.includes(trigger.credential.type) ? trigger.credential : undefined,
          memoryLength,
          signal,
        });
        return { output: { text: reply, json: null, handedOff: false, fromOwner: true, toolCalls: [], provider: providerLabel[credential?.type ?? ""] } };
      }

      // A human took over this conversation: stay silent until the pause ends.
      const handoffState = handoffRead?.value as { until?: string } | null | undefined;
      if (handoffState?.until && handoffState.until > new Date().toISOString()) {
        return { output: { text: "", json: null, handedOff: true, handedOffUntil: handoffState.until, toolCalls: [] } };
      }

      const history: Memory = (memoryRead?.value as Memory) ?? [];

      const selectedTools: string[] = Array.isArray(params.tools) ? params.tools : [];
      const handoff: HandoffConfig = {
        credential: selectedTools.includes("handoff") ? await ownerChannel() : undefined,
        target: String(params.handoffTarget ?? ""),
        pauseHours: Math.max(0, toNumber(params.handoffPauseHours, 24)),
        memoryId,
        conversation: memoryKey,
      };

      const knowledge = String(params.knowledge ?? "").trim();
      // The owner trying the bot out is not asked to answer their own question.
      const asksOwner = Boolean(learning) && !fromOwner;
      const system = [
        String(params.system ?? "").trim(),
        knowledge && `# معلومات مرجعية (اعتمد عليها فقط)\n${knowledge}`,
        learning ? learnedSection(learning) : "",
        HONESTY_RULES,
        asksOwner ? ASK_OWNER_RULES : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const tools = buildTools(
        selectedTools,
        workflow.userId,
        String(params.dataStore || "agent"),
        signal,
        handoff,
        asksOwner ? { workflowId: workflow.id, sender, memoryId, channel: ownerChannel, ownerContact } : undefined,
      );
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
