import type { FastifyInstance, FastifyRequest } from "fastify";
import { db, newId, now, parseJson } from "../db.js";
import { executionFromRow, findTrigger } from "../engine/executor.js";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "../engine/types.js";
import { httpError, requireString } from "../errors.js";
import { newWebhookPath } from "../nodes/core.js";
import { getNode } from "../nodes/index.js";
import { errorMessage } from "../nodes/util.js";
import { runOnce, stopWorkflow, syncWorkflow, triggerErrors } from "../triggers/manager.js";

export function sanitizeGraph(input: unknown): WorkflowGraph {
  const raw = (input ?? {}) as { nodes?: any[]; edges?: any[] };
  const nodes: WorkflowNode[] = (Array.isArray(raw.nodes) ? raw.nodes : []).map((n) => {
    if (!n || typeof n.id !== "string" || typeof n.type !== "string") throw httpError(400, "بيانات خطوة غير صالحة");
    if (!getNode(n.type)) throw httpError(400, `نوع خطوة غير معروف: ${n.type}`);
    return {
      id: n.id,
      type: n.type,
      name: typeof n.name === "string" && n.name.trim() ? n.name.trim().slice(0, 100) : undefined,
      position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
      params: n.params && typeof n.params === "object" && !Array.isArray(n.params) ? n.params : {},
      credentialId: typeof n.credentialId === "string" && n.credentialId ? n.credentialId : null,
      disabled: Boolean(n.disabled),
      continueOnFail: Boolean(n.continueOnFail),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) throw httpError(400, "فيه خطوتين بنفس الرقم");
  if (nodes.filter((n) => getNode(n.type)!.kind === "trigger").length > 1) {
    throw httpError(400, "مسموح بمحفّز (Trigger) واحد بس في السيناريو");
  }
  const edges: WorkflowEdge[] = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e) => e && ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => ({
      id: String(e.id ?? `e${e.source}-${e.target}`),
      source: e.source,
      target: e.target,
      sourceHandle: typeof e.sourceHandle === "string" ? e.sourceHandle : null,
    }));
  if (hasCycle(nodes, edges)) throw httpError(400, "مينفعش خطوة ترجع لخطوة قبلها (السيناريو فيه دائرة)");
  return { nodes, edges };
}

function hasCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const e of edges) if (e.source === id && visit(e.target)) return true;
    state.set(id, 2);
    return false;
  };
  return nodes.some((n) => visit(n.id));
}

function ensureWebhookPaths(graph: WorkflowGraph, workflowId: string) {
  for (const node of graph.nodes) {
    if (node.type !== "trigger.webhook") continue;
    const path = String(node.params.path ?? "");
    const taken =
      path && db.prepare("SELECT 1 FROM workflows WHERE id != ? AND instr(graph, ?) > 0").get(workflowId, `"path":"${path}"`);
    if (!path || taken) node.params = { ...node.params, path: newWebhookPath() };
  }
}

function validateForActivation(graph: WorkflowGraph) {
  const trigger = findTrigger(graph);
  if (!trigger) throw httpError(400, "ضيف محفّز (Trigger) قبل التفعيل");
  if (getNode(trigger.type)!.triggerType === "manual") {
    throw httpError(400, "المحفّز اليدوي مينفعش يتفعّل - غيّره لـ Webhook أو جدولة أو تطبيق");
  }
  for (const node of graph.nodes) {
    if (node.disabled) continue;
    const def = getNode(node.type)!;
    const label = `«${node.name || def.name}» (${node.id})`;
    if (def.credentialTypes?.length && !def.credentialOptional && !node.credentialId) {
      throw httpError(400, `الخطوة ${label} محتاجة حساب (Credential)`);
    }
    for (const field of def.fields) {
      const value = node.params[field.key] ?? field.default;
      const visible = !field.showIf || field.showIf.values.includes(node.params[field.showIf.field] ?? getDefault(def, field.showIf.field));
      if (field.required && visible && (value === undefined || value === null || String(value).trim() === "")) {
        throw httpError(400, `الخطوة ${label}: حقل «${field.label}» مطلوب`);
      }
    }
  }
}

const getDefault = (def: ReturnType<typeof getNode>, key: string) => def?.fields.find((f) => f.key === key)?.default;

function toWorkflow(row: any, withGraph: boolean) {
  const graph = parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] });
  const apps = [...new Set(graph.nodes.map((n) => getNode(n.type)?.app).filter(Boolean))];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    apps,
    lastStatus: row.last_status ?? null,
    lastRunAt: row.last_run_at ?? null,
    runs: row.runs ?? undefined,
    triggerError: triggerErrors.get(row.id) ?? null,
    ...(withGraph ? { graph } : {}),
  };
}

function getOwned(req: FastifyRequest, id: string) {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ? AND user_id = ?").get(id, req.user.id) as any;
  if (!row) throw httpError(404, "السيناريو مش موجود");
  return row;
}

function insertWorkflow(userId: string, name: string, graph: WorkflowGraph, description = "") {
  const id = newId();
  ensureWebhookPaths(graph, id);
  const timestamp = now();
  db.prepare(
    "INSERT INTO workflows (id, user_id, name, description, active, graph, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
  ).run(id, userId, name, description, JSON.stringify(graph), timestamp, timestamp);
  return id;
}

export async function workflowRoutes(app: FastifyInstance) {
  app.get("/api/workflows", async (req) => {
    const rows = db
      .prepare(
        `SELECT w.*,
           (SELECT status FROM executions e WHERE e.workflow_id = w.id ORDER BY started_at DESC LIMIT 1) AS last_status,
           (SELECT started_at FROM executions e WHERE e.workflow_id = w.id ORDER BY started_at DESC LIMIT 1) AS last_run_at,
           (SELECT COUNT(*) FROM executions e WHERE e.workflow_id = w.id) AS runs
         FROM workflows w WHERE w.user_id = ? ORDER BY w.updated_at DESC`,
      )
      .all(req.user.id);
    return rows.map((row) => toWorkflow(row, false));
  });

  app.post("/api/workflows", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "سيناريو جديد";
    const id = insertWorkflow(req.user.id, name, sanitizeGraph(body.graph));
    return toWorkflow(getOwned(req, id), true);
  });

  app.get("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toWorkflow(getOwned(req, id), true);
  });

  app.put("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = getOwned(req, id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = body.name === undefined ? row.name : requireString(body.name, "اسم السيناريو", 120);
    const description = typeof body.description === "string" ? body.description.slice(0, 1000) : row.description;
    const graph = body.graph === undefined ? parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }) : sanitizeGraph(body.graph);
    ensureWebhookPaths(graph, id);
    if (row.active) validateForActivation(graph);
    db.prepare("UPDATE workflows SET name = ?, description = ?, graph = ?, updated_at = ? WHERE id = ?").run(
      name,
      description,
      JSON.stringify(graph),
      now(),
      id,
    );
    if (row.active) syncWorkflow(id);
    return toWorkflow(getOwned(req, id), true);
  });

  app.post("/api/workflows/:id/activate", async (req) => {
    const { id } = req.params as { id: string };
    const row = getOwned(req, id);
    const active = Boolean((req.body as { active?: boolean } | undefined)?.active);
    if (active) validateForActivation(parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }));
    db.prepare("UPDATE workflows SET active = ?, updated_at = ? WHERE id = ?").run(active ? 1 : 0, now(), id);
    syncWorkflow(id);
    return toWorkflow(getOwned(req, id), true);
  });

  app.post("/api/workflows/:id/duplicate", async (req) => {
    const { id } = req.params as { id: string };
    const row = getOwned(req, id);
    const graph = parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] });
    for (const node of graph.nodes) if (node.type === "trigger.webhook") node.params = { ...node.params, path: "" };
    const copyId = insertWorkflow(req.user.id, `${row.name} (نسخة)`.slice(0, 120), graph, row.description);
    return toWorkflow(getOwned(req, copyId), true);
  });

  app.delete("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    getOwned(req, id);
    stopWorkflow(id);
    db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
    return { ok: true };
  });

  app.post("/api/workflows/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getOwned(req, id);
    const body = (req.body ?? {}) as { graph?: unknown };
    const graph = body.graph ? sanitizeGraph(body.graph) : parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] });
    if (graph.nodes.some((n) => n.type === "trigger.webhook" && !n.params.path)) {
      throw httpError(400, "احفظ السيناريو الأول عشان يتعمل رابط الـ Webhook");
    }
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    try {
      return await runOnce(
        { id, name: row.name, userId: req.user.id, active: Boolean(row.active), graph },
        controller.signal,
      );
    } catch (error) {
      throw httpError(400, errorMessage(error));
    }
  });

  app.get("/api/workflows/:id/executions", async (req) => {
    const { id } = req.params as { id: string };
    getOwned(req, id);
    const rows = db
      .prepare(
        `SELECT id, workflow_id, status, mode, started_at, finished_at, duration_ms, error, json_array_length(steps) AS step_count
         FROM executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50`,
      )
      .all(id) as any[];
    return rows.map((row) => ({ ...executionFromRow(row, false), stepCount: row.step_count }));
  });

  app.delete("/api/workflows/:id/executions", async (req) => {
    const { id } = req.params as { id: string };
    getOwned(req, id);
    db.prepare("DELETE FROM executions WHERE workflow_id = ? AND status != 'running'").run(id);
    return { ok: true };
  });

  app.get("/api/executions", async (req) => {
    const query = req.query as { status?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const status = ["success", "error", "running"].includes(query.status ?? "") ? String(query.status) : null;
    const rows = db
      .prepare(
        `SELECT e.id, e.workflow_id, e.status, e.mode, e.started_at, e.finished_at, e.duration_ms, e.error,
                json_array_length(e.steps) AS step_count, w.name AS workflow_name
         FROM executions e JOIN workflows w ON w.id = e.workflow_id
         WHERE e.user_id = ? AND (? IS NULL OR e.status = ?)
         ORDER BY e.started_at DESC LIMIT ?`,
      )
      .all(req.user.id, status, status, limit) as any[];
    return rows.map((row) => ({ ...executionFromRow(row, false), stepCount: row.step_count }));
  });

  app.get("/api/executions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = db
      .prepare(
        `SELECT e.*, w.name AS workflow_name FROM executions e JOIN workflows w ON w.id = e.workflow_id
         WHERE e.id = ? AND e.user_id = ?`,
      )
      .get(id, req.user.id);
    if (!row) throw httpError(404, "التشغيل مش موجود");
    return executionFromRow(row);
  });
}
