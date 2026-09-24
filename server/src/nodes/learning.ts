import { createHash } from "node:crypto";
import type { CredentialType, CredentialValue } from "../engine/types.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import { extractJson, runModel } from "./llm.js";

/*
 * What a chatbot learns on the job.
 *
 * The owner writes the basics once (the "knowledge" box). After that the bot keeps learning from
 * the one person whose word is final - the owner - and from nobody else:
 *
 *  - The owner teaches it in chat:      "اتعلم: التوصيل لإسكندرية 60 جنيه"
 *  - The bot meets a question it cannot answer: it tells the customer it will check, records the
 *    question and pings the owner. The owner answers - "رد 3: أيوه متاح" - the answer goes to that
 *    customer, and the bot keeps it for everyone after.
 *  - On WhatsApp (WasenderAPI) the owner can just reply to a customer from their own phone. The bot
 *    sees the reply, learns from it, and keeps quiet in that chat for a while so the two of them
 *    do not talk over each other.
 *  - The owner can paste old conversations or an FAQ and the bot pulls the facts out of them.
 *
 * Every lesson goes through the owner's AI account first: it keeps only facts that will help the
 * next customer (a price, a rule, opening hours - not "تمام" or one customer's order number), and
 * it replaces an older fact the new one contradicts, so a changed price does not live on as two
 * answers. Customers can never teach the bot anything.
 */

export const LEARN_STORE = "ما_اتعلمه_البوت";
const SENT_STORE = "رسائل_المنصة_المرسلة";
const MAX_FACTS = 200;
const MAX_OPEN = 50;

export type FactSource = "owner" | "answer" | "reply" | "import" | "app";

export interface Fact {
  id: number;
  text: string;
  source: FactSource;
  /** The customer's question it answered, when it came from an answer. */
  question?: string;
  at: string;
}

export interface OpenQuestion {
  id: number;
  question: string;
  customer: string;
  /** Where the answer goes: a phone number or a Telegram chat id. */
  chat: string;
  /** The conversation's memory key, so the answer is remembered in it too. */
  memoryId?: string;
  at: string;
}

export interface Learning {
  facts: Fact[];
  open: OpenQuestion[];
  next: number;
}

const empty = (): Learning => ({ facts: [], open: [], next: 1 });

export async function readLearning(userId: string, workflowId: string): Promise<Learning> {
  const { value } = await datastoreRead(userId, LEARN_STORE, workflowId);
  const state = (value ?? {}) as Partial<Learning>;
  return {
    facts: Array.isArray(state.facts) ? state.facts : [],
    open: Array.isArray(state.open) ? state.open : [],
    next: Number(state.next) > 0 ? Number(state.next) : 1,
  };
}

export async function saveLearning(userId: string, workflowId: string, state: Learning) {
  await datastoreWrite(userId, LEARN_STORE, workflowId, {
    facts: state.facts.slice(-MAX_FACTS),
    open: state.open.slice(-MAX_OPEN),
    next: state.next,
  });
}

/** Add a fact, dropping the ones it replaces. Returns the new fact. */
export function addFact(state: Learning, text: string, source: FactSource, replaces: number[] = [], question?: string): Fact {
  const gone = new Set(replaces);
  state.facts = state.facts.filter((f) => !gone.has(f.id));
  const fact: Fact = { id: state.next++, text: text.trim().slice(0, 600), source, ...(question ? { question: question.slice(0, 400) } : {}), at: new Date().toISOString() };
  state.facts.push(fact);
  return fact;
}

export function addOpen(state: Learning, question: string, customer: string, chat: string, memoryId?: string): OpenQuestion {
  // The same customer asking the same thing twice is one question, not two.
  const existing = state.open.find((q) => q.chat === chat && q.question.trim() === question.trim());
  if (existing) return existing;
  const open: OpenQuestion = {
    id: state.next++,
    question: question.trim().slice(0, 600),
    customer: customer.slice(0, 120),
    chat,
    ...(memoryId ? { memoryId } : {}),
    at: new Date().toISOString(),
  };
  state.open.push(open);
  return open;
}

/** The part of the bot's instructions that holds what it learned. */
export function learnedSection(state: Learning): string {
  if (!state.facts.length) return "";
  return [
    "# معلومات اتعلمتها من صاحب المشروع نفسه",
    "دي أحدث وأدق من أي معلومة تانية فوق - لو فيه تعارض، اعتمد على دي.",
    ...state.facts.map((f) => `- ${f.text}`),
  ].join("\n");
}

/* ---------------------------------------------------------------- the owner */

/** Western digits, whatever keyboard the owner typed on. */
const latinDigits = (text: string) => text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

export interface Sender {
  /** A phone number (digits) or a Telegram chat id. */
  id: string;
  username?: string;
  name?: string;
}

/** Who sent the message that started this run, for the chat triggers that have a sender. */
export function senderOf(triggerType: string | undefined, output: unknown): Sender | null {
  const o = (output ?? {}) as any;
  if (triggerType === "wasender.trigger" || triggerType === "whatsapp.trigger") {
    const id = String(o.phone ?? "").trim();
    return id ? { id, name: o.pushName ?? o.name ?? "" } : null;
  }
  if (triggerType === "telegram.trigger") {
    const message = o.message ?? o.callback_query?.message;
    const chat = message?.chat?.id;
    if (chat === undefined || chat === null) return null;
    const from = o.message?.from ?? o.callback_query?.from ?? {};
    return { id: String(chat), username: from.username ? String(from.username) : undefined, name: [from.first_name, from.last_name].filter(Boolean).join(" ") };
  }
  return null;
}

/**
 * Is this the owner? The owner is whoever is written in "رقمك انت" (several can be written, comma
 * separated). Phones match on their last ten digits, so 01012345678 and 201012345678 are the same
 * person; a Telegram owner is an @username or a chat id. With nothing written, nobody is the owner -
 * which is what keeps a customer from teaching the bot.
 */
export function isOwner(sender: Sender | null, ownerContact: string): boolean {
  if (!sender) return false;
  const owners = latinDigits(String(ownerContact ?? ""))
    .split(/[,،\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const owner of owners) {
    if (owner.startsWith("@")) {
      if (sender.username && sender.username.toLowerCase() === owner.slice(1).toLowerCase()) return true;
      continue;
    }
    const want = owner.replace(/\D/g, "");
    const have = sender.id.replace(/\D/g, "");
    if (!want || !have) continue;
    if (want === have) return true;
    if (want.length >= 10 && have.length >= 10 && want.slice(-10) === have.slice(-10)) return true;
  }
  return false;
}

export type OwnerCommand =
  | { kind: "teach"; text: string }
  | { kind: "forget"; text: string }
  | { kind: "list" }
  | { kind: "open" }
  | { kind: "answer"; id: number; text: string }
  | { kind: "help" };

/** The few things the owner can say to the bot to teach it. Anything else is an ordinary message. */
export function ownerCommand(message: string): OwnerCommand | null {
  const text = latinDigits(message).trim().replace(/^[#/]+\s*/, "");
  const sep = "\\s*[:：\\-–]?\\s*";
  let m = text.match(new RegExp(`^(?:رد|جاوب|الرد|إجابة|اجابة)\\s*(?:على|علي)?\\s*(?:سؤال|السؤال)?\\s*(\\d+)${sep}([\\s\\S]+)$`));
  if (m) return { kind: "answer", id: Number(m[1]), text: m[2].trim() };
  m = text.match(new RegExp(`^(?:اتعلم|إتعلم|اتعلّم|تعلم|تعلّم|تعلّم|معلومة|معلومه|احفظ|إحفظ)${sep}([\\s\\S]+)$`));
  if (m) return { kind: "teach", text: m[1].trim() };
  m = text.match(new RegExp(`^(?:انسى|إنسى|انسي|إنسي|امسح|إمسح)${sep}([\\s\\S]+)$`));
  if (m) return { kind: "forget", text: m[1].trim() };
  if (/^(?:(?:ايه|إيه)\s+)?(?:اللي|اللى|الي)\s+(?:اتعلمته|إتعلمته|اتعلمتو|تعلمته)\s*[؟?]?$|^(?:المعلومات|معلوماتك|اللي اتعلمته)\s*[؟?]?$/.test(text)) return { kind: "list" };
  if (/^(?:الأسئلة|الاسئلة|أسئلة|اسئلة|الأسئلة المفتوحة|الاسئلة المفتوحة)\s*[؟?]?$/.test(text)) return { kind: "open" };
  if (/^(?:مساعدة|المساعدة|الأوامر|الاوامر|اوامر|أوامر)\s*[؟?]?$/.test(text)) return { kind: "help" };
  return null;
}

export const OWNER_HELP = [
  "إزاي تعلّم البوت (من رقمك انت بس):",
  "• اتعلم: المعلومة ← يحفظها ويرد بيها على العملاء",
  "• انسى: الموضوع أو رقمه ← يمسحها",
  "• اللي اتعلمته ← يعرضلك كل اللي حافظه بأرقامه",
  "• الأسئلة ← الأسئلة اللي العملاء سألوها ومعرفش يرد عليها",
  "• رد 3: الإجابة ← يبعت الإجابة للعميل صاحب السؤال رقم 3، ويحفظها للمرة الجاية",
].join("\n");

export function listFacts(state: Learning): string {
  if (!state.facts.length) return "لسه متعلمتش حاجة. ابعتلي: اتعلم: المعلومة";
  const lines = state.facts.slice(-40).map((f) => `${f.id}. ${f.text}`);
  const more = state.facts.length > 40 ? `\n(وفيه ${state.facts.length - 40} أقدم - كلهم في صفحة السيناريو)` : "";
  return `اللي اتعلمته (${state.facts.length}):\n${lines.join("\n")}${more}\n\nعشان تمسح واحدة: انسى رقمها`;
}

export function listOpen(state: Learning): string {
  if (!state.open.length) return "مفيش أسئلة مستنية إجابتك ✓";
  const lines = state.open.slice(-15).map((q) => `${q.id}. ${q.customer ? `${q.customer}: ` : ""}${q.question}`);
  return `أسئلة مستنية إجابتك:\n${lines.join("\n")}\n\nرد عليها كده ← رد ${state.open[state.open.length - 1].id}: الإجابة`;
}

/* ---------------------------------------------------------------- distilling */

export interface AiAccount {
  credential: CredentialValue | undefined;
  types: CredentialType[];
  model?: string;
  signal: AbortSignal;
}

const DISTILL_SYSTEM = [
  "You keep the knowledge base a small business's customer-service chatbot answers from.",
  "You are given the facts it already knows (with ids), and something new from the business OWNER.",
  "Return JSON only: {\"fact\": string | null, \"replaces\": number[]}",
  "",
  "- fact: ONE short standalone sentence a future customer could be told - a price, a rule, opening hours,",
  "  delivery areas and costs, availability, how to order, a policy. Written in the owner's own language",
  "  and dialect, with the owner's numbers exactly. If a customer's question is given, write the fact so it",
  "  makes sense without the question (\"التوصيل لإسكندرية 60 جنيه\", not \"60 جنيه\").",
  "- fact is null when there is nothing reusable: greetings, thanks, \"تمام\", \"هكلمك\", \"ثانية\",",
  "  or anything only about this one customer (their name, their order number, their address).",
  "- replaces: the ids of known facts the new one updates or contradicts (the same price, the same rule).",
  "  Empty when it is new. Never list a fact that is merely related.",
  "- Never add anything the owner did not say.",
].join("\n");

const known = (state: Learning) => (state.facts.length ? state.facts.map((f) => `${f.id}: ${f.text}`).join("\n") : "(nothing yet)");

async function askJson(ai: AiAccount, system: string, prompt: string, maxTokens: number): Promise<any> {
  const out = await runModel(ai.credential, ai.types, {
    model: ai.model,
    system,
    history: [],
    prompt,
    tools: [],
    runTool: async () => undefined,
    maxSteps: 1,
    maxTokens,
    effort: "low",
    signal: ai.signal,
  });
  return extractJson(out.text);
}

/** Turn what the owner said into one reusable fact (or nothing), and find what it replaces. */
export async function distill(
  ai: AiAccount,
  state: Learning,
  input: { answer: string; question?: string },
): Promise<{ fact: string | null; replaces: number[] }> {
  const prompt = [
    `Known facts:\n${known(state)}`,
    input.question ? `A customer asked:\n${input.question}` : "",
    `The owner ${input.question ? "answered" : "said"}:\n${input.answer}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const json = await askJson(ai, DISTILL_SYSTEM, prompt, 600);
  const fact = typeof json?.fact === "string" && json.fact.trim() ? json.fact.trim() : null;
  const ids = new Set(state.facts.map((f) => f.id));
  const replaces = Array.isArray(json?.replaces) ? json.replaces.map(Number).filter((id: number) => ids.has(id)) : [];
  return { fact, replaces };
}

/** Which known facts the owner means by "انسى ...": a number, or a topic. */
export async function factsToForget(ai: AiAccount | null, state: Learning, what: string): Promise<number[]> {
  const numbers = latinDigits(what).match(/\d+/g)?.map(Number) ?? [];
  const ids = new Set(state.facts.map((f) => f.id));
  const direct = numbers.filter((n) => ids.has(n));
  if (direct.length || !ai || !state.facts.length) return direct;
  const json = await askJson(
    ai,
    "The owner of a chatbot wants it to forget something. Given the known facts with ids, return JSON only: {\"ids\": number[]} - the facts that are about what the owner named. Empty if none clearly match.",
    `Known facts:\n${known(state)}\n\nForget:\n${what}`,
    300,
  );
  return Array.isArray(json?.ids) ? json.ids.map(Number).filter((id: number) => ids.has(id)) : [];
}

/** Pull reusable facts out of old conversations or an FAQ the owner pasted. */
export async function extractFacts(ai: AiAccount, state: Learning, text: string): Promise<string[]> {
  const json = await askJson(
    ai,
    [
      "You build the knowledge base of a small business's customer-service chatbot from material the OWNER pasted:",
      "an exported chat, old conversations, an FAQ, a price list or notes.",
      "Return JSON only: {\"facts\": string[]}",
      "- Each fact is ONE short standalone sentence a future customer could be told: prices, products, rules,",
      "  hours, delivery, payment, how to order. Keep the business's own language, dialect and numbers exactly.",
      "- In a conversation, only what the BUSINESS side said counts as true - a customer's guess is not a fact.",
      "- Skip greetings, small talk, and anything about one particular customer (names, phones, addresses, order numbers).",
      "- Skip what the known facts already say. When the pasted material has a newer version of a known fact, include the new one.",
      "- At most 60 facts. Never add anything that is not in the material.",
    ].join("\n"),
    `Known facts:\n${known(state)}\n\nMaterial:\n${text.slice(0, 60_000)}`,
    6000,
  );
  return Array.isArray(json?.facts) ? json.facts.map((f: unknown) => String(f ?? "").trim()).filter(Boolean).slice(0, 60) : [];
}

/* ---------------------------------------------------------------- the platform's own messages */

const hash = (text: string) => createHash("sha1").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
const chatKey = (to: string) => {
  const digits = to.split("@")[0].replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : to;
};

/**
 * Remember what the platform itself sent on WhatsApp, so when that message comes back as "sent from
 * this number" it is not mistaken for the owner typing a reply.
 */
export async function rememberSent(userId: string, to: string, text: string, messageId?: string) {
  if (!to || !text) return;
  const key = chatKey(to);
  const { value } = await datastoreRead(userId, SENT_STORE, key);
  const day = Date.now() - 86_400_000;
  const list = (Array.isArray(value) ? value : []).filter((m: any) => Date.parse(m.at) > day).slice(-19);
  list.push({ id: messageId ?? "", h: hash(text), at: new Date().toISOString() });
  await datastoreWrite(userId, SENT_STORE, key, list);
}

export async function sentByPlatform(userId: string, chat: string, text: string, messageId?: string): Promise<boolean> {
  const { value } = await datastoreRead(userId, SENT_STORE, chatKey(chat));
  const list = Array.isArray(value) ? value : [];
  const h = hash(text);
  const recent = Date.now() - 15 * 60_000;
  return list.some((m: any) => (messageId && m.id && m.id === messageId) || (m.h === h && Date.parse(m.at) > recent));
}
