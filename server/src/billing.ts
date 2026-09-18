import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { newId, now, one, query, run } from "./db.js";
import { httpError } from "./errors.js";

/*
 * Plans and virtual credits. Customers pay for their own AI / app usage with their own keys, so credits
 * are a platform allowance: every step a scenario runs costs 1 credit, and the built-in assistant (which
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
    tagline: "للتجربة وأول سيناريو ليك",
    price: { monthly: 0, yearly: 0 },
    credits: 1_000,
    assistantCredits: 0,
    maxActiveScenarios: 2,
    minIntervalMinutes: 15,
    assistant: false,
    logDays: 7,
    priority: false,
    features: ["1,000 كريديت في الشهر", "2 سيناريو شغالين في نفس الوقت", "كل التطبيقات والتيمبلت", "أقل فترة بين التشغيلات 15 دقيقة", "خادم MCP لسيناريوهاتك"],
    public: true,
  },
  trial: {
    key: "trial",
    name: "تجربة مجانية",
    tagline: "3 أيام بكل مميزات الاحترافي",
    price: { monthly: 0, yearly: 0 },
    credits: 500,
    assistantCredits: 100,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: true,
    logDays: 30,
    priority: true,
    features: ["كل مميزات الاحترافي لمدة 3 أيام", "500 كريديت للمنصة + 100 للمساعد الذكي"],
    public: false,
  },
  core: {
    key: "core",
    name: "أساسي",
    tagline: "لأتمتة شغلك اليومي من غير حدود",
    price: { monthly: 10.59, yearly: 9 },
    credits: 10_000,
    assistantCredits: 0,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: false,
    logDays: 30,
    priority: false,
    features: ["10,000 كريديت في الشهر", "سيناريوهات شغالة بلا حدود", "جدولة كل دقيقة", "سجل تشغيل 30 يوم", "خادم MCP + ربط بأي API"],
    public: true,
  },
  pro: {
    key: "pro",
    name: "احترافي",
    tagline: "المساعد الذكي بيبني ويصلّح معاك",
    price: { monthly: 18.82, yearly: 16 },
    credits: 8_000,
    assistantCredits: 2_000,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: true,
    logDays: 30,
    priority: true,
    features: [
      "10,000 كريديت في الشهر: 8,000 للمنصة + 2,000 للمساعد",
      "المساعد الذكي: يبني السيناريو من وصفك ويصلّح الأخطاء",
      "أولوية في التنفيذ",
      "كل مميزات الأساسي",
    ],
    public: true,
  },
  max: {
    key: "max",
    name: "ماكس",
    tagline: "للوكالات والشغل الكبير",
    price: { monthly: 34.12, yearly: 29 },
    credits: 16_000,
    assistantCredits: 4_000,
    maxActiveScenarios: 0,
    minIntervalMinutes: 1,
    assistant: true,
    logDays: 60,
    priority: true,
    features: ["20,000 كريديت في الشهر: 16,000 للمنصة + 4,000 للمساعد", "سجل تشغيل 60 يوم", "دعم مباشر بأولوية", "كل مميزات الاحترافي"],
    public: true,
  },
};

export const TRIAL_DAYS = 3;
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
  credits: number;
  assistantCredits: number;
  creditsUsed: number;
  assistantUsed: number;
  resetsAt: string | null;
}

const ACCOUNT_COLUMNS =
  "id, email, name, created_at, plan, plan_period, plan_expires_at, trial_ends_at, credits, assistant_credits, credits_reset_at, credits_used, assistant_used";

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
    credits: Math.max(0, Number(row.credits) || 0),
    assistantCredits: Math.max(0, Number(row.assistant_credits) || 0),
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

/** After a run: 1 credit per step that ran (at least 1). */
export async function chargeRun(userId: string, steps: number) {
  if (await isAdminUser(userId)) return;
  const cost = Math.max(1, steps);
  await run("UPDATE users SET credits = GREATEST(credits - $1, 0), credits_used = credits_used + $1 WHERE id = $2", [cost, userId]);
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

/**
 * Assistant credits follow what a reply costs the platform: about 1 credit per 1,000 tokens, where
 * written tokens weigh 5x and tokens re-read from cache weigh a tenth.
 */
export function assistantCost(usage: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }) {
  const weighted =
    (usage.input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0) + 5 * (usage.output_tokens ?? 0);
  return Math.max(1, Math.ceil(weighted / 1000));
}

export async function chargeAssistant(userId: string, credits: number) {
  if (credits <= 0 || (await isAdminUser(userId))) return;
  await run(
    "UPDATE users SET assistant_credits = GREATEST(assistant_credits - $1, 0), assistant_used = assistant_used + $1 WHERE id = $2",
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
  app.get("/api/plans", async () => ({ plans: planList(), trialDays: TRIAL_DAYS }));
}

/** Logged-in customer: their plan, credits and subscription requests. */
export async function billingRoutes(app: FastifyInstance) {
  app.get("/api/billing", async (req) => {
    const account = await getAccount(req.user.id);
    const requests = await query(
      `SELECT id, plan, period, status, note, created_at AS "createdAt" FROM subscription_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.user.id],
    );
    return { account: publicAccount(account), plans: planList(), requests, trialDays: TRIAL_DAYS };
  });

  app.post("/api/billing/request", async (req) => {
    const body = (req.body ?? {}) as { plan?: string; period?: string; note?: string };
    const plan = PLANS[body.plan as PlanKey];
    if (!plan || !plan.public || plan.key === "free") throw httpError(400, "اختار باقة");
    const period: Period = body.period === "yearly" ? "yearly" : "monthly";
    const pending = await one("SELECT id FROM subscription_requests WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
    if (pending) {
      await run("UPDATE subscription_requests SET plan = $1, period = $2, note = $3, created_at = $4 WHERE id = $5", [
        plan.key,
        period,
        String(body.note ?? "").slice(0, 500),
        now(),
        (pending as { id: string }).id,
      ]);
    } else {
      await run("INSERT INTO subscription_requests (id, user_id, plan, period, note, status, created_at) VALUES ($1, $2, $3, $4, $5, 'pending', $6)", [
        newId(),
        req.user.id,
        plan.key,
        period,
        String(body.note ?? "").slice(0, 500),
        now(),
      ]);
    }
    return { ok: true };
  });
}

/** Owner console: every account, and switches to grant / remove plans, trials and credits. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    if (!isAdminEmail(req.user.email)) throw httpError(403, "الصفحة دي للأدمن بس");
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
      `SELECT r.id, r.user_id AS "userId", r.plan, r.period, r.note, r.status, r.created_at AS "createdAt", u.email, u.name
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
    return { users, requests, plans: Object.values(PLANS) };
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
    await run("UPDATE subscription_requests SET status = 'done' WHERE user_id = $1 AND status = 'pending'", [userId]);
    return publicAccount(await getAccount(userId));
  });

  app.post("/api/admin/users/:id/credits", async (req) => {
    const userId = await target((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { credits?: number; assistantCredits?: number };
    const credits = Math.trunc(Number(body.credits) || 0);
    const assistant = Math.trunc(Number(body.assistantCredits) || 0);
    await run("UPDATE users SET credits = GREATEST(credits + $1, 0), assistant_credits = GREATEST(assistant_credits + $2, 0) WHERE id = $3", [
      credits,
      assistant,
      userId,
    ]);
    return publicAccount(await getAccount(userId));
  });

  app.post("/api/admin/requests/:id", async (req) => {
    const body = (req.body ?? {}) as { status?: string };
    const status = body.status === "rejected" ? "rejected" : "done";
    await run("UPDATE subscription_requests SET status = $1 WHERE id = $2", [status, (req.params as { id: string }).id]);
    return { ok: true };
  });
}
