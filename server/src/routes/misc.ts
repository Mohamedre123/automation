import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { one, query, run } from "../db.js";
import { executionQueue } from "../engine/executor.js";
import type { WorkflowGraph } from "../engine/types.js";
import { httpError } from "../errors.js";
import { credentialTypes, getNode, nodeDefinitions } from "../nodes/index.js";
import { templates } from "../templates.js";
import { runDueSchedules } from "../triggers/manager.js";
import { insertWorkflow } from "./workflows.js";

export async function miscRoutes(app: FastifyInstance) {
  app.get("/api/meta", async () => ({
    appName: config.appName,
    publicUrl: config.publicUrl,
    platform: { isVercel: config.isVercel, receivesWebhooks: config.receivesWebhooks, backgroundWorkers: config.backgroundWorkers },
    nodes: nodeDefinitions.map(({ run, poll, webhook, ...def }) => def),
    credentialTypes: credentialTypes.map(({ test, ...type }) => ({ ...type, hasTest: Boolean(test) })),
  }));

  app.get("/api/stats", async (req) => {
    const userId = req.user.id;
    const workflows = (await one<{ total: number; active: number }>(
      "SELECT COUNT(*)::int AS total, COALESCE(SUM(active), 0)::int AS active FROM workflows WHERE user_id = $1",
      [userId],
    ))!;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const daily = await query<{ day: string; status: string; count: number }>(
      `SELECT substr(started_at, 1, 10) AS day, status, COUNT(*)::int AS count FROM executions
       WHERE user_id = $1 AND started_at >= $2 GROUP BY 1, 2 ORDER BY 1`,
      [userId, since],
    );
    const last24h = (await one<{ count: number }>("SELECT COUNT(*)::int AS count FROM executions WHERE user_id = $1 AND started_at >= $2", [
      userId,
      new Date(Date.now() - 86_400_000).toISOString(),
    ]))!;
    const totals = daily.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + row.count }), {});
    const finished = (totals.success ?? 0) + (totals.error ?? 0);
    return {
      workflows: workflows.total,
      activeWorkflows: workflows.active,
      executions24h: last24h.count,
      successRate: finished ? Math.round(((totals.success ?? 0) / finished) * 100) : null,
      daily,
      queue: executionQueue.stats,
    };
  });

  app.get("/api/templates", async () => templateSummaries());

  app.post("/api/templates/:id/use", async (req) => {
    const { id } = req.params as { id: string };
    const template = templates.find((t) => t.id === id);
    if (!template) throw httpError(404, "التيمبلت مش موجود");
    const graph: WorkflowGraph = structuredClone(template.graph);
    return { id: await insertWorkflow(req.user.id, template.name, graph, template.description) };
  });

  app.get("/api/datastore", async (req) =>
    query(
      `SELECT store, COUNT(*)::int AS count, MAX(updated_at) AS "updatedAt" FROM datastore WHERE user_id = $1
       GROUP BY store ORDER BY store`,
      [req.user.id],
    ),
  );

  app.get("/api/datastore/:store", async (req) => {
    const { store } = req.params as { store: string };
    const rows = await query<{ key: string; value: string; updated_at: string }>(
      "SELECT key, value, updated_at FROM datastore WHERE user_id = $1 AND store = $2 ORDER BY updated_at DESC LIMIT 500",
      [req.user.id, store],
    );
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value), updatedAt: row.updated_at }));
  });

  app.delete("/api/datastore/:store/:key", async (req) => {
    const { store, key } = req.params as { store: string; key: string };
    await run("DELETE FROM datastore WHERE user_id = $1 AND store = $2 AND key = $3", [req.user.id, store, key]);
    return { ok: true };
  });
}

/** Plain steps for starting a template, written for its trigger (form, schedule, messages...). */
function templateGuide(graph: WorkflowGraph): { starts: string; howTo: string[] } {
  const trigger = graph.nodes.find((n) => getNode(n.type)?.kind === "trigger");
  const def = trigger ? getNode(trigger.type) : undefined;
  const accounts = "اختار الحسابات في الخطوات اللي عليها علامة حساب (أو دوس «ربط» جنب الخانة وهتلاقي الشرح).";
  const common = ["دوس «استخدم التيمبلت» - هيتعمل سيناريو باسمه ويفتح في المحرر.", accounts];
  if (!trigger || !def) return { starts: "", howTo: common };
  switch (true) {
    case trigger.type === "trigger.form":
      return {
        starts: "بفورم",
        howTo: [
          ...common,
          "دوس على أول خطوة «فورم»: هتلاقي «رابط الفورم» - ده صفحة جاهزة فيها الأسئلة (تقدر تعدّل الأسئلة من نفس الخطوة).",
          "للتجربة: دوس «تشغيل مرة» وبعدين زرار «افتح الفورم» اللي هيظهر فوق، واملاه خلال دقيقتين - هتشوف كل خطوة بتنور.",
          "عشان يشتغل على طول: فعّل السيناريو من زرار «متوقف / مفعّل» فوق.",
          "ابعت رابط الفورم لعملاءك أو حطه في موقعك - كل مرة حد يملاه السيناريو بيشتغل لوحده، والنتايج في «التشغيلات».",
        ],
      };
    case trigger.type === "trigger.schedule":
      return {
        starts: "بميعاد",
        howTo: [
          ...common,
          "دوس على خطوة «جدولة» وحدد ساعة البداية (وساعة النشر لو فيه نشر).",
          "جرّبه مرة بزرار «تشغيل مرة» وشوف النتيجة.",
          "فعّله من زرار «متوقف / مفعّل» - هيشتغل لوحده كل يوم في ميعاده.",
        ],
      };
    case def.triggerType === "schedule":
      return {
        starts: "لما يوصل جديد",
        howTo: [...common, "دوس «تشغيل مرة» عشان يجرّب على آخر عنصر موجود.", "فعّله - هيشيّك كل كام دقيقة ويشتغل مع كل جديد."],
      };
    case trigger.type === "trigger.webhook":
      return {
        starts: "برابط Webhook",
        howTo: [
          ...common,
          "دوس على خطوة «Webhook» وانسخ الرابط، وحطه في الموقع أو النظام اللي هيبعت البيانات.",
          "فعّل السيناريو - كل ما النظام يبعت بيانات السيناريو هيشتغل.",
        ],
      };
    case def.triggerType === "app":
      return {
        starts: "برسالة",
        howTo: [
          ...common,
          "فعّل السيناريو من زرار «متوقف / مفعّل» فوق.",
          "ابعت رسالة للبوت أو الرقم من موبايلك - هتلاقي الرد وصل، وكل تشغيل متسجل في «التشغيلات».",
        ],
      };
    default:
      return {
        starts: "يدوي",
        howTo: [...common, "دوس «تشغيل مرة» كل ما تحب تشغّله.", "عايزه يشتغل لوحده؟ غيّر المحفّز لـ «جدولة»."],
      };
  }
}

function templateSummaries() {
  return templates.map((t) => {
    const apps = new Map<string, string>();
    for (const node of t.graph.nodes) {
      const def = getNode(node.type);
      if (def && !apps.has(def.app)) apps.set(def.app, def.appName);
    }
    return { ...t, apps: [...apps].map(([key, name]) => ({ key, name })), steps: t.graph.nodes.length, ...templateGuide(t.graph) };
  });
}

/** Marketing pages (no login): the integration directory and the template gallery. */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/api/public/catalog", async () => {
    const apps = new Map<string, { key: string; name: string; color: string; group: string; triggers: string[]; actions: string[] }>();
    for (const def of nodeDefinitions) {
      // Several providers can share one app (WasenderAPI + official WhatsApp): show the app's plain name.
      const name = def.app === "whatsapp" ? "واتساب" : def.appName;
      const entry = apps.get(def.app) ?? { key: def.app, name, color: def.color, group: def.group, triggers: [], actions: [] };
      (def.kind === "trigger" ? entry.triggers : entry.actions).push(def.name);
      apps.set(def.app, entry);
    }
    return [...apps.values()];
  });

  app.get("/api/public/templates", async () => templateSummaries().map(({ graph, ...summary }) => summary));
}

/** Fires due schedules. Called by Vercel Cron / cron-job.org (or the local ticker). */
export async function cronRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/cron/tick",
    handler: async (req) => {
      if (!config.cronSecret) throw httpError(503, "CRON_SECRET مش متضبط في متغيرات البيئة");
      const secret = (req.query as { secret?: string })?.secret;
      if (req.headers.authorization !== `Bearer ${config.cronSecret}` && secret !== config.cronSecret) {
        throw httpError(401, "Unauthorized");
      }
      return { ok: true, ran: await runDueSchedules() };
    },
  });
}
