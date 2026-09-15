import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db, newId, now } from "../db.js";
import { executionQueue } from "../engine/executor.js";
import type { WorkflowGraph } from "../engine/types.js";
import { httpError } from "../errors.js";
import { newWebhookPath } from "../nodes/core.js";
import { credentialTypes, getNode, nodeDefinitions } from "../nodes/index.js";
import { templates } from "../templates.js";

export async function miscRoutes(app: FastifyInstance) {
  app.get("/api/meta", async () => ({
    appName: config.appName,
    publicUrl: config.publicUrl,
    nodes: nodeDefinitions.map(({ run, poll, ...def }) => def),
    credentialTypes: credentialTypes.map(({ test, ...type }) => ({ ...type, hasTest: Boolean(test) })),
  }));

  app.get("/api/stats", async (req) => {
    const userId = req.user.id;
    const workflows = db
      .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(active), 0) AS active FROM workflows WHERE user_id = ?")
      .get(userId) as { total: number; active: number };
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const daily = db
      .prepare(
        `SELECT substr(started_at, 1, 10) AS day, status, COUNT(*) AS count FROM executions
         WHERE user_id = ? AND started_at >= ? GROUP BY day, status ORDER BY day`,
      )
      .all(userId, since) as { day: string; status: string; count: number }[];
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const last24h = db
      .prepare("SELECT COUNT(*) AS count FROM executions WHERE user_id = ? AND started_at >= ?")
      .get(userId, dayAgo) as { count: number };
    const totals = daily.reduce(
      (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + row.count }),
      {} as Record<string, number>,
    );
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
    templates.map((t) => ({
      ...t,
      apps: [...new Set(t.graph.nodes.map((n) => getNode(n.type)?.app).filter(Boolean))],
    })),
  );

  app.post("/api/templates/:id/use", async (req) => {
    const { id } = req.params as { id: string };
    const template = templates.find((t) => t.id === id);
    if (!template) throw httpError(404, "التيمبلت مش موجود");
    const graph: WorkflowGraph = structuredClone(template.graph);
    for (const node of graph.nodes) {
      if (node.type === "trigger.webhook") node.params = { ...node.params, path: newWebhookPath() };
    }
    const workflowId = newId();
    const timestamp = now();
    db.prepare(
      "INSERT INTO workflows (id, user_id, name, description, active, graph, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
    ).run(workflowId, req.user.id, template.name, template.description, JSON.stringify(graph), timestamp, timestamp);
    return { id: workflowId };
  });

  app.get("/api/datastore", async (req) => {
    const rows = db
      .prepare(
        "SELECT store, COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM datastore WHERE user_id = ? GROUP BY store ORDER BY store",
      )
      .all(req.user.id);
    return rows;
  });

  app.get("/api/datastore/:store", async (req) => {
    const { store } = req.params as { store: string };
    const rows = db
      .prepare("SELECT key, value, updated_at FROM datastore WHERE user_id = ? AND store = ? ORDER BY updated_at DESC LIMIT 500")
      .all(req.user.id, store) as { key: string; value: string; updated_at: string }[];
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value), updatedAt: row.updated_at }));
  });

  app.delete("/api/datastore/:store/:key", async (req) => {
    const { store, key } = req.params as { store: string; key: string };
    db.prepare("DELETE FROM datastore WHERE user_id = ? AND store = ? AND key = ?").run(req.user.id, store, key);
    return { ok: true };
  });
}
