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

  app.get("/api/templates", async () =>
    templates.map((t) => {
      const apps = new Map<string, string>();
      for (const node of t.graph.nodes) {
        const def = getNode(node.type);
        if (def && !apps.has(def.app)) apps.set(def.app, def.appName);
      }
      return { ...t, apps: [...apps].map(([key, name]) => ({ key, name })), steps: t.graph.nodes.length };
    }),
  );

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
