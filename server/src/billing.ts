import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { newId, now, one, query, run } from "./db.js";
import { httpError } from "./errors.js";

/*
 * Plans and virtual credits. Customers pay for their own AI / app usage with their own keys, so credits
 * are a platform allowance: every app / AI step a scenario runs costs 1 credit, and the built-in assistant (which
 * runs on the platform's own Claude key) spends its own separate assistant credits.
 */

export type PlanKey = "free" | "trial" | "core" | "pro" | "max";
export type Period = "monthly" | "yearly";

export interface Plan {
  key: PlanKey;
  name: string;
  tagline: string;
  /** USD per month; yearly is the per-month price when paid for a year. */
  price: { monthly: number; yearly: number };
  /** Credits added every month. */
  credits: number;
  assistantCredits: number;
  /** 0 = unlimited. */
  maxActiveScenarios: number;
  /** Shortest schedule / check interval in minutes. */
  minIntervalMinutes: number;
  assistant: boolean;
  logDays: number;
  priority: boolean;
  features: string[];
  public: boolean;
}

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "مجاني",
    tagline: "جرّب وابني أول بوت أو أتمتة ليك",
    price: { monthly: 0, yearly: 0 },
    credits: 1_000,
    assistantCredits: 0,
    maxActiveScenarios: 2,
    minIntervalMinutes: 15,
    assistant: false,
    logDays: 7,
    priority: false,
    features: ["1,000 كريديت كل شهر", "2 سيناريو شغالين", "كل التطبيقات والتيمبلت العربي", "بوتات واتساب وتيليجرام بالذكاء الاصطناعي", "تشغيل كل 15 دقيقة"],
    public: true,
  },
  trial: {
    key: "trial",
    name: "تجربة مجانية",
    tagline: "3 أيام بكل مميزات الاحترافي",
    price: { monthly: 0, yearly: 0 },
    credits: 1_000,
    assistantCredits: 50,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: true,
    logDays: 30,
    priority: true,
    features: ["كل مميزات الاحترافي لمدة 3 أيام", "1,000 كريديت للمنصة + 50 للمساعد الذكي"],
    public: false,
  },
  core: {
    key: "core",
    name: "انطلاقة",
    tagline: "لمشروعك الصغير أو متجرك وهو بيكبر",
    price: { monthly: 5, yearly: 4 },
    credits: 5_000,
    assistantCredits: 0,
    maxActiveScenarios: 10,
    minIntervalMinutes: 5,
    assistant: false,
    logDays: 30,
    priority: false,
    features: [
      "5,000 كريديت كل شهر",
      "10 سيناريوهات شغالين",
      "استوديو المحتوى: صور وكابشن ونشر على كل المنصات",
      "تشغيل كل 5 دقايق",
      "خادم MCP + ربط بأي API",
    ],
    public: true,
  },
  pro: {
    key: "pro",
    name: "احترافي",
    tagline: "المساعد الذكي بيبني ويصلّح معاك",
    price: { monthly: 10, yearly: 8 },
    credits: 12_000,
    assistantCredits: 200,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: true,
    logDays: 30,
    priority: true,
    features: [
      "12,000 كريديت للمنصة + 200 للمساعد الذكي",
      "المساعد الذكي بالعربي: يبني السيناريو من وصفك ويصلّح الأخطاء",
      "سيناريوهات بلا حدود وتشغيل كل دقيقة",
      "أولوية في التنفيذ",
      "كل مميزات انطلاقة",
    ],
    public: true,
  },
  max: {
    key: "max",
    name: "أعمال",
    tagline: "للوكالات والفرق والشغل الكبير",
    price: { monthly: 25, yearly: 20 },
    credits: 40_000,
    assistantCredits: 600,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: true,
    logDays: 60,
    priority: true,
    features: [
      "40,000 كريديت للمنصة + 600 للمساعد الذكي",
      "سجل تشغيل 60 يوم",
      "مساعدة مباشرة منّا في بناء أول سيناريوهات",
      "دعم على واتساب بأولوية",
      "كل مميزات الاحترافي",
    ],
    public: true,
  },
};

export const TRIAL_DAYS = 3;

/** Top-ups: added on top of the plan, never expire, used after the monthly credits. */
export interface CreditPack {
  key: string;
  name: string;
  credits: number;
  assistantCredits: number;
  price: number;
}

export const CREDIT_PACKS: CreditPack[] = [
  { key: "c5k", name: "5,000 كريديت", credits: 5_000, assistantCredits: 0, price: 3 },
  { key: "c15k", name: "15,000 كريديت", credits: 15_000, assistantCredits: 0, price: 7 },
  { key: "c40k", name: "40,000 كريديت", credits: 40_000, assistantCredits: 0, price: 15 },
  { key: "a200", name: "200 كريديت للمساعد", credits: 0, assistantCredits: 200, price: 4 },
  { key: "a600", name: "600 كريديت للمساعد", credits: 0, assistantCredits: 600, price: 10 },
];

/*
 * The assistant runs on the owner's Claude key, so its credits are real money: 1 assistant credit = 1 US cent
 * of Claude usage, priced per model (per million tokens). Cache reads cost 10% of input, cache writes 125% (5 min) or 200% (1 hour).
 */
export const ASSISTANT_CREDIT_USD = 0.01;
const MODEL_PRICES: [RegExp, { input: number; output: number }][] = [
  [/fable|mythos/, { input: 10, output: 50 }],
  [/opus/, { input: 5, output: 25 }],
  [/sonnet-5/, { input: 2, output: 10 }],
  [/sonnet/, { input: 3, output: 15 }],
  [/haiku/, { input: 1, output: 5 }],
];

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
};

/** What one Claude reply cost, in dollars (unknown models are priced like the most expensive tier). */
export function assistantUsd(model: string, usage: Usage) {
  const price = MODEL_PRICES.find(([pattern]) => pattern.test(model))?.[1] ?? { input: 10, output: 50 };
  // Cache writes: 1.25x input for the 5-minute cache, 2x for the 1-hour one.
  const written = usage.cache_creation_input_tokens ?? 0;
  const hour = Math.min(written, usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const input = (usage.input_tokens ?? 0) + 2 * hour + 1.25 * (written - hour) + 0.1 * (usage.cache_read_input_tokens ?? 0);
  return (input * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000;
}

/** Owner-editable settings (admin console), falling back to env / defaults. */
let settingsCache: { at: number; values: Record<string, string> } | null = null;
async function settings() {
  if (settingsCache && Date.now() - settingsCache.at < 30_000) return settingsCache.values;
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM app_settings");
  settingsCache = { at: Date.now(), values: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return settingsCache.values;
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await settings())[key] || undefined;
}

export async function paymentInfo() {
  const values = await settings();
  const rate = Number(values.egpRate);
  return {
    phone: values.paymentPhone || config.payment.phone,
    egpRate: rate > 0 ? rate : config.payment.egpRate,
    methods: ["محفظة إلكترونية (فودافون كاش / اتصالات / أورانج / وي)", "إنستاباي InstaPay"],
  };
}

/** Steps that talk to an app or an AI cost a credit; logic, data and "typing..." steps are free. */
export function billableSteps(steps: { type: string; status: string }[], groupOf: (type: string) => string | undefined) {
  return steps.filter((s) => s.status !== "skipped" && s.type !== "telegram.typing" && ["ai", "apps"].includes(groupOf(s.type) ?? "")).length;
}
const DAY = 86_400_000;
const addDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY).toISOString();

export const isAdminEmail = (email: string) => config.adminEmails.includes(email.trim().toLowerCase());

interface AccountRow {
  id: string;
  email: string;
  name: string;
  created_at: string;
  plan: string;
  plan_period: string | null;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  credits: number;
  assistant_credits: number;
  credits_reset_at: string | null;
  credits_used: number;
  assistant_used: number;
  extra_credits: number;
  extra_assistant_credits: number;
}

export interface Account {
  userId: string;
  email: string;
  isAdmin: boolean;
  plan: Plan;
  period: Period;
  /** Paid plans: when they end. Trial: when the trial ends. */
  expiresAt: string | null;
  trialEndsAt: string | null;
  /** Everything left: this month's credits plus bought top-ups. */
  credits: number;
  assistantCredits: number;
  extraCredits: number;
  extraAssistantCredits: number;
  creditsUsed: number;
  assistantUsed: number;
  resetsAt: string | null;
}

const ACCOUNT_COLUMNS =
  "id, email, name, created_at, plan, plan_period, plan_expires_at, trial_ends_at, credits, assistant_credits, credits_reset_at, credits_used, assistant_used, extra_credits, extra_assistant_credits";

function toAccount(row: AccountRow): Account {
  const plan = PLANS[row.plan as PlanKey] ?? PLANS.free;
  return {
    userId: row.id,
    email: row.email,
    isAdmin: isAdminEmail(row.email),
    plan,
    period: row.plan_period === "yearly" ? "yearly" : "monthly",
    expiresAt: plan.key === "trial" ? row.trial_ends_at : row.plan_expires_at,
    trialEndsAt: row.trial_ends_at,
    credits: Math.max(0, Number(row.credits) || 0) + Math.max(0, Number(row.extra_credits) || 0),
    assistantCredits: Math.max(0, Number(row.assistant_credits) || 0) + Math.max(0, Number(row.extra_assistant_credits) || 0),
    extraCredits: Math.max(0, Number(row.extra_credits) || 0),
    extraAssistantCredits: Math.max(0, Number(row.extra_assistant_credits) || 0),
    creditsUsed: Number(row.credits_used) || 0,
    assistantUsed: Number(row.assistant_used) || 0,
    resetsAt: row.credits_reset_at,
  };
}

/** Sets a plan and fills its monthly credits. */
async function setPlan(userId: string, plan: PlanKey, period: Period, expiresAt: string | null, trialEndsAt?: string | null) {
  const p = PLANS[plan];
  const resetAt = plan === "trial" ? trialEndsAt ?? addDays(new Date(), TRIAL_DAYS) : addDays(new Date(), 30);
  await run(
    `UPDATE users SET plan = $1, plan_period = $2, plan_expires_at = $3, credits = $4, assistant_credits = $5,
       credits_reset_at = $6, credits_used = 0, assistant_used = 0${trialEndsAt !== undefined ? ", trial_ends_at = $8" : ""}
     WHERE id = $7`,
    trialEndsAt !== undefined
      ? [plan, period, expiresAt, p.credits, p.assistantCredits, resetAt, userId, trialEndsAt]
      : [plan, period, expiresAt, p.credits, p.assistantCredits, resetAt, userId],
  );
}

/** Bought or granted credits: they stay until used (a negative amount takes some away). */
async function addCredits(userId: string, credits: number, assistant: number) {
  await run(
    `UPDATE users SET extra_credits = GREATEST(extra_credits + $1, 0), extra_assistant_credits = GREATEST(extra_assistant_credits + $2, 0),
       credits = CASE WHEN $1 < 0 AND extra_credits + $1 < 0 THEN GREATEST(credits + extra_credits + $1, 0) ELSE credits END,
       assistant_credits = CASE WHEN $2 < 0 AND extra_assistant_credits + $2 < 0 THEN GREATEST(assistant_credits + extra_assistant_credits + $2, 0) ELSE assistant_credits END
     WHERE id = $3`,
    [credits, assistant, userId],
  );
}

export async function startTrial(userId: string, days = TRIAL_DAYS) {
  const ends = addDays(new Date(), days);
  await setPlan(userId, "trial", "monthly", null, ends);
}

/** Reads the account, applying anything that came due: trial end, plan expiry, monthly refill. */
export async function getAccount(userId: string): Promise<Account> {
  let row = await one<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = $1`, [userId]);
  if (!row) throw httpError(404, "الحساب مش موجود");
  const nowIso = now();

  // Accounts from before plans existed start with the free trial.
  if (!row.credits_reset_at) {
    await startTrial(userId);
    row = (await one<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = $1`, [userId]))!;
  }
  const trialOver = row.plan === "trial" && (!row.trial_ends_at || row.trial_ends_at <= nowIso);
  const paidOver = ["core", "pro", "max"].includes(row.plan) && row.plan_expires_at && row.plan_expires_at <= nowIso;
  if (trialOver || paidOver || !PLANS[row.plan as PlanKey]) {
    await setPlan(userId, "free", "monthly", null);
    row = (await one<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = $1`, [userId]))!;
  } else if (row.plan !== "trial" && row.credits_reset_at && row.credits_reset_at <= nowIso) {
    // New month: credits refill to the plan's amount (unused credits don't pile up).
    const p = PLANS[row.plan as PlanKey];
    let next = new Date(row.credits_reset_at);
    while (next.toISOString() <= nowIso) next = new Date(next.getTime() + 30 * DAY);
    await run(
      "UPDATE users SET credits = $1, assistant_credits = $2, credits_reset_at = $3, credits_used = 0, assistant_used = 0 WHERE id = $4",
      [p.credits, p.assistantCredits, next.toISOString(), userId],
    );
    row = { ...row, credits: p.credits, assistant_credits: p.assistantCredits, credits_reset_at: next.toISOString(), credits_used: 0, assistant_used: 0 };
  }
  return toAccount(row);
}

const OUT_OF_CREDITS = "الكريديت بتاعك خلص - السيناريوهات والمساعد واقفين لحد ما تجدد الباقة أو تترقّى من صفحة «الاشتراك»";

/** Before a scenario runs: enough credits, and (on plans with a limit) one of the allowed active scenarios. */
export async function assertCanRun(userId: string, workflowId?: string, mode?: string) {
  const account = await getAccount(userId);
  if (account.isAdmin) return account;
  if (account.credits <= 0) throw new Error(OUT_OF_CREDITS);
  const limit = account.plan.maxActiveScenarios;
  if (limit && workflowId && mode !== "manual") {
    const allowed = await query<{ id: string }>(
      "SELECT id FROM workflows WHERE user_id = $1 AND active = 1 ORDER BY created_at ASC LIMIT $2",
      [userId, limit],
    );
    if (!allowed.some((w) => w.id === workflowId)) {
      throw new Error(`باقة «${account.plan.name}» بتشغّل ${limit} سيناريو بس في نفس الوقت - اقفل سيناريو تاني أو اترقّى لباقة أعلى`);
    }
  }
  return account;
}

/** After a run: 1 credit per app / AI step. This month's credits go first, then bought top-ups. */
export async function chargeRun(userId: string, cost: number) {
  if (cost <= 0 || (await isAdminUser(userId))) return;
  await run(
    `UPDATE users SET credits = GREATEST(credits - $1, 0), extra_credits = GREATEST(extra_credits - GREATEST($1 - credits, 0), 0),
       credits_used = credits_used + $1 WHERE id = $2`,
    [cost, userId],
  );
}

/** Assistant access: plan includes it, and both balances still have credit. */
export async function assistantAllowance(userId: string): Promise<{ ok: true; account: Account } | { ok: false; reason: "plan" | "credits" | "assistant_credits"; account: Account }> {
  const account = await getAccount(userId);
  if (account.isAdmin) return { ok: true, account };
  if (!account.plan.assistant) return { ok: false, reason: "plan", account };
  if (account.credits <= 0) return { ok: false, reason: "credits", account };
  if (account.assistantCredits <= 0) return { ok: false, reason: "assistant_credits", account };
  return { ok: true, account };
}

export async function chargeAssistant(userId: string, credits: number) {
  if (credits <= 0 || (await isAdminUser(userId))) return;
  await run(
    `UPDATE users SET assistant_credits = GREATEST(assistant_credits - $1, 0),
       extra_assistant_credits = GREATEST(extra_assistant_credits - GREATEST($1 - assistant_credits, 0), 0),
       assistant_used = assistant_used + $1 WHERE id = $2`,
    [credits, userId],
  );
}

async function isAdminUser(userId: string) {
  const row = await one<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
  return Boolean(row && isAdminEmail(row.email));
}

/** Activation rules of the plan: how many scenarios can be live, and how often they may check. */
export async function assertCanActivate(userId: string, workflowId: string, intervals: number[]) {
  const account = await getAccount(userId);
  if (account.isAdmin) return;
  if (account.credits <= 0) throw httpError(402, OUT_OF_CREDITS);
  const plan = account.plan;
  if (plan.maxActiveScenarios) {
    const row = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM workflows WHERE user_id = $1 AND active = 1 AND id <> $2", [userId, workflowId]);
    if ((row?.n ?? 0) >= plan.maxActiveScenarios) {
      throw httpError(402, `باقة «${plan.name}» بتسمح بـ ${plan.maxActiveScenarios} سيناريو شغالين بس - اقفل واحد أو اترقّى لباقة أعلى`);
    }
  }
  const tooFrequent = intervals.find((minutes) => minutes > 0 && minutes < plan.minIntervalMinutes);
  if (tooFrequent !== undefined) {
    throw httpError(402, `باقة «${plan.name}» أقل فترة فيها بين التشغيلات ${plan.minIntervalMinutes} دقيقة - غيّر «كل كام دقيقة» أو اترقّى`);
  }
}

export function publicAccount(account: Account) {
  return {
    plan: { key: account.plan.key, name: account.plan.name, assistant: account.plan.assistant || account.isAdmin },
    period: account.period,
    expiresAt: account.expiresAt,
    trialEndsAt: account.trialEndsAt,
    credits: account.credits,
    assistantCredits: account.assistantCredits,
    extraCredits: account.extraCredits,
    extraAssistantCredits: account.extraAssistantCredits,
    creditsUsed: account.creditsUsed,
    assistantUsed: account.assistantUsed,
    monthlyCredits: account.plan.credits,
    monthlyAssistantCredits: account.plan.assistantCredits,
    resetsAt: account.resetsAt,
    isAdmin: account.isAdmin,
    limits: { maxActiveScenarios: account.plan.maxActiveScenarios, minIntervalMinutes: account.plan.minIntervalMinutes },
  };
}

const planList = () => Object.values(PLANS).filter((p) => p.public);

/* ---------- routes ---------- */

/** Public: the pricing page. */
export async function planRoutes(app: FastifyInstance) {
  app.get("/api/plans", async () => ({ plans: planList(), trialDays: TRIAL_DAYS, packs: CREDIT_PACKS, payment: await paymentInfo() }));
}

/** Logged-in customer: their plan, credits and subscription requests. */
export async function billingRoutes(app: FastifyInstance) {
  app.get("/api/billing", async (req) => {
    const account = await getAccount(req.user.id);
    const requests = await query(
      `SELECT id, kind, plan, pack, amount, period, status, note, created_at AS "createdAt" FROM subscription_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.user.id],
    );
    return { account: publicAccount(account), plans: planList(), requests, trialDays: TRIAL_DAYS, packs: CREDIT_PACKS, payment: await paymentInfo() };
  });

  /** Where the credits went: per day and per scenario over the last 30 days. */
  app.get("/api/billing/usage", async (req) => {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const days = await query<{ day: string; credits: number; runs: number }>(
      `SELECT substr(started_at, 1, 10) AS day, COALESCE(SUM(credits), 0)::int AS credits, COUNT(*)::int AS runs
       FROM executions WHERE user_id = $1 AND started_at >= $2 GROUP BY 1 ORDER BY 1`,
      [req.user.id, since],
    );
    const scenarios = await query<{ id: string; name: string; credits: number; runs: number }>(
      `SELECT w.id, w.name, COALESCE(SUM(e.credits), 0)::int AS credits, COUNT(e.id)::int AS runs
       FROM executions e JOIN workflows w ON w.id = e.workflow_id
       WHERE e.user_id = $1 AND e.started_at >= $2 GROUP BY w.id, w.name ORDER BY credits DESC, runs DESC LIMIT 20`,
      [req.user.id, since],
    );
    return { days, scenarios };
  });

  app.post("/api/billing/request", async (req) => {
    const body = (req.body ?? {}) as { kind?: string; plan?: string; period?: string; pack?: string; note?: string };
    const note = String(body.note ?? "").slice(0, 500);
    if (body.kind === "credits") {
      const pack = CREDIT_PACKS.find((p) => p.key === body.pack);
      if (!pack) throw httpError(400, "اختار باقة كريديت");
      await run(
        "INSERT INTO subscription_requests (id, user_id, kind, plan, pack, amount, period, note, status, created_at) VALUES ($1, $2, 'credits', '', $3, $4, 'monthly', $5, 'pending', $6)",
        [newId(), req.user.id, pack.key, `$${pack.price}`, note, now()],
      );
      return { ok: true };
    }
    const plan = PLANS[body.plan as PlanKey];
    if (!plan || !plan.public || plan.key === "free") throw httpError(400, "اختار باقة");
    const period: Period = body.period === "yearly" ? "yearly" : "monthly";
    const amount = `$${period === "yearly" ? Math.round(plan.price.yearly * 12) : plan.price.monthly}`;
    // One open plan request at a time: a new choice replaces the old one.
    const pending = await one<{ id: string }>("SELECT id FROM subscription_requests WHERE user_id = $1 AND status = 'pending' AND kind = 'plan'", [req.user.id]);
    if (pending) {
      await run("UPDATE subscription_requests SET plan = $1, period = $2, note = $3, amount = $4, created_at = $5 WHERE id = $6", [
        plan.key,
        period,
        note,
        amount,
        now(),
        pending.id,
      ]);
    } else {
      await run(
        "INSERT INTO subscription_requests (id, user_id, kind, plan, amount, period, note, status, created_at) VALUES ($1, $2, 'plan', $3, $4, $5, $6, 'pending', $7)",
        [newId(), req.user.id, plan.key, amount, period, note, now()],
      );
    }
    return { ok: true };
  });
}

/** Owner console: every account, and switches to grant / remove plans, trials and credits. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    if (!isAdminEmail(req.user.email)) throw httpError(403, "الصفحة دي للأدمن بس");
  });

  app.get("/api/admin/settings", async () => ({
    ...(await paymentInfo()),
    assistantModel: (await getSetting("assistantModel")) ?? "claude-opus-5",
    assistantCreditUsd: ASSISTANT_CREDIT_USD,
  }));

  app.put("/api/admin/settings", async (req) => {
    const body = (req.body ?? {}) as { egpRate?: number | string; paymentPhone?: string; assistantModel?: string };
    const updates: [string, string][] = [];
    if (body.assistantModel !== undefined) {
      if (!/^claude-[a-z0-9.-]+$/i.test(body.assistantModel)) throw httpError(400, "اسم الموديل مش صحيح");
      updates.push(["assistantModel", body.assistantModel]);
    }
    if (body.egpRate !== undefined) {
      const rate = Number(body.egpRate);
      if (!(rate > 0 && rate < 10_000)) throw httpError(400, "سعر الدولار لازم يكون رقم أكبر من صفر");
      updates.push(["egpRate", String(rate)]);
    }
    if (body.paymentPhone !== undefined) {
      const phone = String(body.paymentPhone).trim();
      if (!/^\+?\d{8,15}$/.test(phone.replace(/[\s-]/g, ""))) throw httpError(400, "رقم الدفع مش صحيح");
      updates.push(["paymentPhone", phone.replace(/[\s-]/g, "")]);
    }
    for (const [key, value] of updates) {
      await run("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
    }
    settingsCache = null;
    return { ...(await paymentInfo()), assistantModel: (await getSetting("assistantModel")) ?? "claude-opus-5" };
  });

  app.get("/api/admin/users", async () => {
    const rows = await query<AccountRow & { workflows: number; active_workflows: number; runs_30d: number }>(
      `SELECT ${ACCOUNT_COLUMNS.split(", ")
        .map((c) => `u.${c}`)
        .join(", ")},
         (SELECT COUNT(*)::int FROM workflows w WHERE w.user_id = u.id) AS workflows,
         (SELECT COUNT(*)::int FROM workflows w WHERE w.user_id = u.id AND w.active = 1) AS active_workflows,
         (SELECT COUNT(*)::int FROM executions e WHERE e.user_id = u.id AND e.started_at >= $1) AS runs_30d
       FROM users u ORDER BY u.created_at DESC`,
      [new Date(Date.now() - 30 * DAY).toISOString()],
    );
    const requests = await query(
      `SELECT r.id, r.user_id AS "userId", r.kind, r.plan, r.pack, r.amount, r.period, r.note, r.status, r.created_at AS "createdAt", u.email, u.name
       FROM subscription_requests r JOIN users u ON u.id = r.user_id ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 100`,
    );
    const users = rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      workflows: row.workflows,
      activeWorkflows: row.active_workflows,
      runs30d: row.runs_30d,
      ...publicAccount(toAccount(row)),
    }));
    return { users, requests, plans: Object.values(PLANS), packs: CREDIT_PACKS };
  });

  const target = async (id: string) => {
    const row = await one<{ id: string }>("SELECT id FROM users WHERE id = $1", [id]);
    if (!row) throw httpError(404, "المستخدم مش موجود");
    return row.id;
  };

  app.post("/api/admin/users/:id/plan", async (req) => {
    const userId = await target((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { plan?: string; period?: string; days?: number };
    const plan = PLANS[body.plan as PlanKey];
    if (!plan) throw httpError(400, "باقة غير معروفة");
    if (plan.key === "trial") {
      await startTrial(userId, Math.min(Math.max(Number(body.days) || TRIAL_DAYS, 1), 60));
    } else if (plan.key === "free") {
      await setPlan(userId, "free", "monthly", null);
    } else {
      const period: Period = body.period === "yearly" ? "yearly" : "monthly";
      const days = Number(body.days) > 0 ? Number(body.days) : period === "yearly" ? 365 : 30;
      await setPlan(userId, plan.key, period, addDays(new Date(), days));
    }
    await run("UPDATE subscription_requests SET status = 'done' WHERE user_id = $1 AND status = 'pending' AND kind = 'plan'", [userId]);
    return publicAccount(await getAccount(userId));
  });

  app.post("/api/admin/users/:id/credits", async (req) => {
    const userId = await target((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { credits?: number; assistantCredits?: number };
    const credits = Math.trunc(Number(body.credits) || 0);
    const assistant = Math.trunc(Number(body.assistantCredits) || 0);
    await addCredits(userId, credits, assistant);
    return publicAccount(await getAccount(userId));
  });

  /** Approve (apply what was paid for) or reject a request. */
  app.post("/api/admin/requests/:id", async (req) => {
    const body = (req.body ?? {}) as { status?: string };
    const request = await one<{ id: string; user_id: string; kind: string; plan: string; pack: string; period: string; status: string }>(
      "SELECT * FROM subscription_requests WHERE id = $1",
      [(req.params as { id: string }).id],
    );
    if (!request) throw httpError(404, "الطلب مش موجود");
    if (request.status !== "pending") throw httpError(400, "الطلب ده اتقفل قبل كده");
    if (body.status === "rejected") {
      await run("UPDATE subscription_requests SET status = 'rejected' WHERE id = $1", [request.id]);
      return { ok: true };
    }
    if (request.kind === "credits") {
      const pack = CREDIT_PACKS.find((p) => p.key === request.pack);
      if (!pack) throw httpError(400, "باقة الكريديت دي مش موجودة");
      await addCredits(request.user_id, pack.credits, pack.assistantCredits);
    } else {
      const period: Period = request.period === "yearly" ? "yearly" : "monthly";
      await setPlan(request.user_id, request.plan as PlanKey, period, addDays(new Date(), period === "yearly" ? 365 : 30));
    }
    await run("UPDATE subscription_requests SET status = 'done' WHERE id = $1", [request.id]);
    return { ok: true };
  });
}
