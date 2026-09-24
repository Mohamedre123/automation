import { config } from "../config.js";
import { assertCanActivate } from "../billing.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { newId, now, one, parseJson, query, run } from "../db.js";
import { wireGraph } from "../engine/autofill.js";
import { executeWorkflow, executionFromRow } from "../engine/executor.js";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "../engine/types.js";
import { httpError, requireString } from "../errors.js";
import { newWebhookPath } from "../nodes/core.js";
import { getNode } from "../nodes/index.js";
import { errorMessage } from "../nodes/util.js";
import {
  activateTrigger,
  cancelTestSession,
  deactivateTrigger,
  getTestSession,
  rowToWorkflow,
  startTestRun,
  stopLocalWorker,
  syncLocalWorker,
  triggerInfo,
} from "../triggers/manager.js";

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
      // "Try again if it fails" - kept only when set, so a graph without it saves exactly as before.
      ...(Number(n.retries) > 0 ? { retries: Math.min(Math.trunc(Number(n.retries)), 5) } : {}),
      ...(Number(n.retries) > 0 && Number(n.retryWaitSeconds) > 0
        ? { retryWaitSeconds: Math.min(Math.max(Number(n.retryWaitSeconds), 1), 120) }
        : {}),
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

/**
 * A save that leaves out the trigger's link keeps the one it had. The link is pasted into outside
 * services (WasenderAPI, a website form), so quietly minting a new one - because an agent editing
 * the scenario did not copy that field back - would leave the old link dead and the bot silent.
 */
function keepTriggerPath(previous: WorkflowGraph, graph: WorkflowGraph) {
  const before = previous.nodes.find((n) => getNode(n.type)?.kind === "trigger");
  const after = graph.nodes.find((n) => getNode(n.type)?.kind === "trigger");
  const path = String(before?.params?.path ?? "");
  if (!before || !after || !path || before.type !== after.type || String(after.params?.path ?? "")) return;
  after.params = { ...after.params, path };
}

/** Webhook and app triggers own a unique URL path. */
async function ensureTriggerPaths(graph: WorkflowGraph, workflowId: string) {
  for (const node of graph.nodes) {
    const triggerType = getNode(node.type)?.triggerType;
    if (triggerType !== "webhook" && triggerType !== "app") continue;
    const path = String(node.params.path ?? "");
    const taken = path && (await one("SELECT 1 AS taken FROM workflows WHERE id != $1 AND trigger_path = $2", [workflowId, path]));
    if (!path || taken) node.params = { ...node.params, path: newWebhookPath() };
  }
}

function triggerColumns(graph: WorkflowGraph) {
  const info = triggerInfo(graph);
  return { type: info?.def.triggerType ?? null, path: info?.path || null };
}

/** How often the trigger checks or runs, in minutes (for the plan's minimum interval). */
function triggerIntervals(graph: WorkflowGraph): number[] {
  const info = triggerInfo(graph);
  if (!info) return [];
  const params = info.node.params ?? {};
  if (info.node.type === "trigger.schedule") return params.mode === "interval" ? [Number(params.minutes ?? 15)] : [];
  const field = info.def.fields.find((f) => f.key === "minutes");
  return field ? [Number(params.minutes ?? field.default ?? 15)] : [];
}

function validateForActivation(graph: WorkflowGraph) {
  const info = triggerInfo(graph);
  if (!info) throw httpError(400, "ضيف محفّز (Trigger) قبل التفعيل");
  if (info.def.triggerType === "manual") {
    throw httpError(
      400,
      "المحفّز «تشغيل يدوي» بيشتغل بزرار «تشغيل مرة» بس ومش بيتفعّل. عشان السيناريو يفضل شغال لوحده: امسح المحفّز وحط «جدولة» (كل يوم في ساعة) أو «فورم» أو رسايل واتساب / تيليجرام",
    );
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
      const controller = field.showIf ? def.fields.find((f) => f.key === field.showIf!.field) : undefined;
      const visible = !field.showIf || field.showIf.values.includes(node.params[field.showIf.field] ?? controller?.default);
      // Caption / image / video boxes fill themselves from earlier steps at run time.
      if (field.autoFill) continue;
      if (field.required && visible && (value === undefined || value === null || String(value).trim() === "")) {
        throw httpError(400, `الخطوة ${label}: حقل «${field.label}» مطلوب`);
      }
    }
    // An agent allowed to hand off must know who to notify, or it can only apologise to the customer.
    const tools = Array.isArray(node.params.tools) ? node.params.tools : [];
    if (node.type === "ai.agent" && tools.includes("handoff")) {
      if (!String(node.params.handoffTarget ?? "").trim()) {
        throw httpError(400, `الخطوة ${label}: فعّلت «تحويل العميل لموظف» - اكتب يوزرنيم أو رقم المسؤول اللي يوصله التحويل`);
      }
      const triggerCanNotify = ["telegram.trigger", "wasender.trigger", "whatsapp.trigger"].includes(info.node.type);
      if (!String(node.params.handoffCredentialId ?? "").trim() && !triggerCanNotify) {
        throw httpError(400, `الخطوة ${label}: اختار البوت أو رقم الواتساب اللي يبعت منه إشعار التحويل`);
      }
    }
  }
}

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
    triggerError: parseJson<{ message: string; at: string } | null>(row.trigger_error, null),
    ...(withGraph ? { graph } : {}),
  };
}

async function getOwned(req: FastifyRequest, id: string) {
  const row = await one("SELECT * FROM workflows WHERE id = $1 AND user_id = $2", [id, req.user.id]);
  if (!row) throw httpError(404, "السيناريو مش موجود");
  return row;
}

export async function insertWorkflow(userId: string, name: string, graph: WorkflowGraph, description = "") {
  if (config.maxWorkflowsPerUser) {
    const count = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM workflows WHERE user_id = $1", [userId]);
    if ((count?.n ?? 0) >= config.maxWorkflowsPerUser) {
      throw httpError(403, `وصلت للحد الأقصى لعدد السيناريوهات (${config.maxWorkflowsPerUser}) - امسح سيناريوهات مش محتاجها`);
    }
  }
  const id = newId();
  // Every new scenario arrives wired: empty caption / image / video boxes point at the steps before them.
  graph = wireGraph(graph, getNode);
  await ensureTriggerPaths(graph, id);
  const trigger = triggerColumns(graph);
  const timestamp = now();
  await run(
    `INSERT INTO workflows (id, user_id, name, description, active, graph, trigger_type, trigger_path, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
    [id, userId, name, description, JSON.stringify(graph), trigger.type, trigger.path, timestamp, timestamp],
  );
  return id;
}

/** Saves a new graph for an inactive workflow (used by the platform assistant). */
export async function updateInactiveWorkflow(userId: string, id: string, graphInput: unknown, name?: string) {
  const row = await one("SELECT * FROM workflows WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!row) throw httpError(404, "السيناريو مش موجود");
  if (row.active) throw httpError(409, "السيناريو مفعّل - لازم يتوقف الأول قبل التعديل");
  const graph = wireGraph(sanitizeGraph(graphInput), getNode);
  keepTriggerPath(parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }), graph);
  await ensureTriggerPaths(graph, id);
  const trigger = triggerColumns(graph);
  await run("UPDATE workflows SET name = $1, graph = $2, trigger_type = $3, trigger_path = $4, updated_at = $5 WHERE id = $6", [
    name?.trim() ? name.trim().slice(0, 120) : row.name,
    JSON.stringify(graph),
    trigger.type,
    trigger.path,
    now(),
    id,
  ]);
}

/** Start or stop a scenario. Shared by the app route and anything building through an agent. */
export async function setWorkflowActive(userId: string, id: string, active: boolean) {
  const row = await one("SELECT * FROM workflows WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!row) throw httpError(404, "السيناريو مش موجود");
  const workflow = rowToWorkflow(row);
  if (active) {
    validateForActivation(workflow.graph);
    await assertCanActivate(userId, id, triggerIntervals(workflow.graph));
    let nextRunAt: string | null;
    try {
      ({ nextRunAt } = await activateTrigger(workflow));
    } catch (error) {
      throw httpError(400, errorMessage(error));
    }
    await run("UPDATE workflows SET active = 1, next_run_at = $1, trigger_error = NULL, updated_at = $2 WHERE id = $3", [nextRunAt, now(), id]);
  } else {
    if (row.active) await deactivateTrigger(workflow);
    await run("UPDATE workflows SET active = 0, next_run_at = NULL, trigger_error = NULL, updated_at = $1 WHERE id = $2", [now(), id]);
  }
  await syncLocalWorker(id);
  return active;
}

/**
 * One run, start to finish, with the result. Used by agents (MCP) - unlike the editor there is
 * nobody sitting there to send test data, so the trigger is handed whatever the agent passed.
 */
export async function runScenarioOnce(userId: string, id: string, data: Record<string, unknown>) {
  const row = await one("SELECT * FROM workflows WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!row) throw httpError(404, "السيناريو مش موجود");
  const workflow = rowToWorkflow(row);
  const info = triggerInfo(workflow.graph);
  const triggerOutput =
    info?.node.type === "trigger.form"
      ? { data, submittedAt: now() }
      : info?.node.type === "trigger.webhook"
        ? { method: "POST", headers: {}, query: {}, body: data }
        : { triggeredAt: now(), data };
  return executeWorkflow({ workflow, triggerOutput, mode: "manual" });
}

export async function workflowRoutes(app: FastifyInstance) {
  /** Every public link the account's scenarios listen on (webhooks, forms, chat bots), in one place. */
  app.get("/api/workflows/links", async (req) => {
    const rows = await query("SELECT id, name, active, graph FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC", [req.user.id]);
    return rows.flatMap((row) => {
      const info = triggerInfo(parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }));
      if (!info?.path || info.def.triggerType !== "webhook") return [];
      const isForm = info.node.type === "trigger.form";
      return [
        {
          workflowId: row.id,
          workflow: row.name,
          active: Boolean(row.active),
          trigger: info.def.name,
          app: info.def.app,
          kind: isForm ? "form" : "webhook",
          url: isForm ? `${config.publicUrl}/form/${info.path}` : `${config.publicUrl}/webhook/${info.path}`,
        },
      ];
    });
  });

  app.get("/api/workflows", async (req) => {
    const rows = await query(
      `SELECT w.*,
         (SELECT status FROM executions e WHERE e.workflow_id = w.id ORDER BY started_at DESC LIMIT 1) AS last_status,
         (SELECT started_at FROM executions e WHERE e.workflow_id = w.id ORDER BY started_at DESC LIMIT 1) AS last_run_at,
         (SELECT COUNT(*)::int FROM executions e WHERE e.workflow_id = w.id) AS runs
       FROM workflows w WHERE w.user_id = $1 ORDER BY w.updated_at DESC`,
      [req.user.id],
    );
    return rows.map((row) => toWorkflow(row, false));
  });

  app.post("/api/workflows", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "سيناريو جديد";
    const id = await insertWorkflow(req.user.id, name, sanitizeGraph(body.graph));
    return toWorkflow(await getOwned(req, id), true);
  });

  app.get("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    return toWorkflow(await getOwned(req, id), true);
  });

  app.put("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = body.name === undefined ? row.name : requireString(body.name, "اسم السيناريو", 120);
    const description = typeof body.description === "string" ? body.description.slice(0, 1000) : row.description;
    const graph = body.graph === undefined ? parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }) : sanitizeGraph(body.graph);
    keepTriggerPath(parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }), graph);
    await ensureTriggerPaths(graph, id);
    const trigger = triggerColumns(graph);

    let nextRunAt: string | null = row.next_run_at;
    if (row.active) {
      validateForActivation(graph);
      const previous = rowToWorkflow(row);
      const before = triggerInfo(previous.graph);
      const after = triggerInfo(graph);
      if (before?.node.type !== after?.node.type || before?.node.credentialId !== after?.node.credentialId || before?.path !== after?.path) {
        await deactivateTrigger(previous);
      }
      try {
        nextRunAt = (await activateTrigger({ ...previous, name, graph })).nextRunAt;
      } catch (error) {
        throw httpError(400, errorMessage(error));
      }
    }

    await run(
      `UPDATE workflows SET name = $1, description = $2, graph = $3, trigger_type = $4, trigger_path = $5, next_run_at = $6, updated_at = $7
       WHERE id = $8`,
      [name, description, JSON.stringify(graph), trigger.type, trigger.path, nextRunAt, now(), id],
    );
    if (row.active) await syncLocalWorker(id);
    return toWorkflow(await getOwned(req, id), true);
  });

  app.post("/api/workflows/:id/activate", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    const workflow = rowToWorkflow(row);
    const active = Boolean((req.body as { active?: boolean } | undefined)?.active);

    if (active) {
      validateForActivation(workflow.graph);
      await assertCanActivate(req.user.id, id, triggerIntervals(workflow.graph));
      let nextRunAt: string | null;
      try {
        ({ nextRunAt } = await activateTrigger(workflow));
      } catch (error) {
        throw httpError(400, errorMessage(error));
      }
      await run("UPDATE workflows SET active = 1, next_run_at = $1, trigger_error = NULL, updated_at = $2 WHERE id = $3", [nextRunAt, now(), id]);
    } else {
      if (row.active) await deactivateTrigger(workflow);
      await run("UPDATE workflows SET active = 0, next_run_at = NULL, trigger_error = NULL, updated_at = $1 WHERE id = $2", [now(), id]);
    }
    await syncLocalWorker(id);
    return toWorkflow(await getOwned(req, id), true);
  });

  app.post("/api/workflows/:id/duplicate", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    const graph = parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] });
    for (const node of graph.nodes) if (node.params?.path) node.params = { ...node.params, path: "" };
    const copyId = await insertWorkflow(req.user.id, `${row.name} (نسخة)`.slice(0, 120), graph, row.description);
    return toWorkflow(await getOwned(req, copyId), true);
  });

  app.delete("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    if (row.active) await deactivateTrigger(rowToWorkflow(row));
    stopLocalWorker(id);
    await run("DELETE FROM workflows WHERE id = $1", [id]);
    return { ok: true };
  });

  app.post("/api/workflows/:id/run", async (req) => {
    const { id } = req.params as { id: string };
    const row = await getOwned(req, id);
    const body = (req.body ?? {}) as { graph?: unknown; live?: boolean };
    const graph = body.graph ? sanitizeGraph(body.graph) : parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] });
    try {
      return await startTestRun({ id, name: row.name, userId: req.user.id, active: Boolean(row.active), graph }, body.live === true);
    } catch (error) {
      throw httpError(400, errorMessage(error));
    }
  });

  app.get("/api/workflows/:id/test/:sessionId", async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getTestSession(sessionId, req.user.id);
    if (!session) throw httpError(404, "جلسة التجربة مش موجودة");
    return session;
  });

  app.delete("/api/workflows/:id/test/:sessionId", async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    await cancelTestSession(sessionId, req.user.id);
    return { ok: true };
  });

  app.get("/api/workflows/:id/executions", async (req) => {
    const { id } = req.params as { id: string };
    await getOwned(req, id);
    const rows = await query(
      `SELECT id, workflow_id, status, mode, started_at, finished_at, duration_ms, error, jsonb_array_length(steps::jsonb) AS step_count
       FROM executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [id],
    );
    return rows.map((row) => ({ ...executionFromRow(row, false), stepCount: row.step_count }));
  });

  app.delete("/api/workflows/:id/executions", async (req) => {
    const { id } = req.params as { id: string };
    await getOwned(req, id);
    await run("DELETE FROM executions WHERE workflow_id = $1 AND status != 'running'", [id]);
    return { ok: true };
  });

  app.get("/api/executions", async (req) => {
    const params = req.query as { status?: string; limit?: string };
    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    const status = ["success", "error", "running"].includes(params.status ?? "") ? String(params.status) : null;
    const rows = await query(
      `SELECT e.id, e.workflow_id, e.status, e.mode, e.started_at, e.finished_at, e.duration_ms, e.error,
              jsonb_array_length(e.steps::jsonb) AS step_count, w.name AS workflow_name
       FROM executions e JOIN workflows w ON w.id = e.workflow_id
       WHERE e.user_id = $1 AND ($2::text IS NULL OR e.status = $2)
       ORDER BY e.started_at DESC LIMIT $3`,
      [req.user.id, status, limit],
    );
    return rows.map((row) => ({ ...executionFromRow(row, false), stepCount: row.step_count }));
  });

  app.get("/api/executions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = await one(
      `SELECT e.*, w.name AS workflow_name FROM executions e JOIN workflows w ON w.id = e.workflow_id
       WHERE e.id = $1 AND e.user_id = $2`,
      [id, req.user.id],
    );
    if (!row) throw httpError(404, "التشغيل مش موجود");
    return executionFromRow(row);
  });
}
