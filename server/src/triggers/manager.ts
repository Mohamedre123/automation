import crypto from "node:crypto";
import { Cron } from "croner";
import { runInBackground } from "../background.js";
import { config } from "../config.js";
import { newId, now, one, parseJson, query, run } from "../db.js";
import {
  executeWorkflow,
  executionFromRow,
  findTrigger,
  markStaleExecutions,
  resolveCredential,
  type RuntimeWorkflow,
} from "../engine/executor.js";
import { resolveParams } from "../engine/expressions.js";
import type {
  ExecutionMode,
  ExecutionRecord,
  NodeDefinition,
  WebhookRequest,
  WebhookResponse,
  WorkflowGraph,
  WorkflowNode,
} from "../engine/types.js";
import { getNode } from "../nodes/index.js";
import { runScheduledPosts } from "../nodes/publishAll.js";
import { errorMessage, sleep, toNumber } from "../nodes/util.js";

/*
 * Triggers work without any always-on process (Vercel):
 * - webhook / app (Telegram) triggers: external calls hit /webhook/:path, looked up in the database
 * - schedules: next_run_at in the database, fired by /api/cron/tick (or an in-process ticker locally)
 * - "run once": a test session row that the next matching webhook call consumes
 * Locally (no public HTTPS URL) app triggers fall back to polling from this process.
 */

type TriggerInfo = { node: WorkflowNode; def: NodeDefinition; path: string };

const emptyScope = { outputs: {}, vars: {} };
export const triggerParams = (def: NodeDefinition, node: WorkflowNode) => resolveParams(def.fields, node.params ?? {}, emptyScope);
export const webhookUrl = (path: string) => `${config.publicUrl}/webhook/${path}`;
const secretTokenFor = (path: string) => crypto.createHmac("sha256", config.secret).update(`webhook:${path}`).digest("hex");
const appUsesWebhook = (def: NodeDefinition) => Boolean(def.webhook?.register) && config.receivesWebhooks;

export function triggerInfo(graph: WorkflowGraph): TriggerInfo | undefined {
  const node = findTrigger(graph);
  const def = node ? getNode(node.type) : undefined;
  return node && def ? { node, def, path: String(node.params?.path ?? "") } : undefined;
}

export function rowToWorkflow(row: any): RuntimeWorkflow {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    active: Boolean(row.active),
    graph: parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }),
  };
}

export async function loadWorkflow(id: string) {
  const row = await one("SELECT * FROM workflows WHERE id = $1", [id]);
  return row ? rowToWorkflow(row) : undefined;
}

export async function setTriggerError(workflowId: string, message: string | null) {
  await run("UPDATE workflows SET trigger_error = $1 WHERE id = $2", [
    message ? JSON.stringify({ message, at: now() }) : null,
    workflowId,
  ]);
  if (message) console.error(`[trigger ${workflowId}] ${message}`);
}

export function computeNextRun(params: Record<string, any>, from = new Date()): string {
  if (params.mode === "cron") {
    let next: Date | null;
    try {
      next = new Cron(String(params.cron ?? ""), { timezone: params.timezone || undefined }).nextRun(from);
    } catch (e) {
      throw new Error(`Cron غير صالح: ${errorMessage(e)}`);
    }
    if (!next) throw new Error("الـ Cron ده مش هيشتغل تاني");
    return next.toISOString();
  }
  return new Date(from.getTime() + Math.max(1, toNumber(params.minutes, 15)) * 60_000).toISOString();
}

const credentialFor = (workflow: RuntimeWorkflow, info: TriggerInfo) => resolveCredential(info.def, info.node, workflow.userId);

async function registerAppWebhook(workflow: RuntimeWorkflow, info: TriggerInfo) {
  await info.def.webhook!.register!({
    params: triggerParams(info.def, info.node),
    credential: await credentialFor(workflow, info),
    url: webhookUrl(info.path),
    secretToken: secretTokenFor(info.path),
    signal: AbortSignal.timeout(20_000),
  });
}

/* ---------- activation ---------- */
export async function activateTrigger(workflow: RuntimeWorkflow): Promise<{ nextRunAt: string | null }> {
  const info = triggerInfo(workflow.graph);
  if (!info) throw new Error("ضيف محفّز (Trigger) قبل التفعيل");
  if (info.def.triggerType === "schedule") return { nextRunAt: computeNextRun(triggerParams(info.def, info.node)) };
  if (info.def.triggerType === "app") {
    if (appUsesWebhook(info.def)) await registerAppWebhook(workflow, info);
    else if (!(info.def.poll && config.backgroundWorkers)) {
      throw new Error("المحفّز ده محتاج رابط HTTPS عام للمنصة - اضبط PUBLIC_URL");
    }
  }
  return { nextRunAt: null };
}

export async function deactivateTrigger(workflow: RuntimeWorkflow) {
  const info = triggerInfo(workflow.graph);
  if (!info || info.def.triggerType !== "app" || !appUsesWebhook(info.def) || !info.def.webhook?.unregister) return;
  try {
    await info.def.webhook.unregister({
      params: triggerParams(info.def, info.node),
      credential: await credentialFor(workflow, info),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error(`[trigger ${workflow.id}] unregister failed: ${errorMessage(e)}`);
  }
}

/* ---------- incoming webhooks ---------- */
async function webhookContext(workflow: RuntimeWorkflow, info: TriggerInfo, path: string) {
  return {
    params: triggerParams(info.def, info.node),
    secretToken: secretTokenFor(path),
    credential: info.def.credentialTypes?.length ? await credentialFor(workflow, info).catch(() => undefined) : undefined,
  };
}

function parseItems(info: TriggerInfo, request: WebhookRequest, ctx: Awaited<ReturnType<typeof webhookContext>>): unknown[] {
  return info.def.webhook ? info.def.webhook.parse(request, ctx) : [request];
}

async function runItems(workflow: RuntimeWorkflow, items: unknown[], mode: ExecutionMode) {
  let last: ExecutionRecord | undefined;
  for (const item of items) last = await executeWorkflow({ workflow, triggerOutput: item, mode });
  return last;
}

/** Starts the execution; the response resolves from a respond node, the end of the run, or a timeout. */
function dispatchWebhook(workflow: RuntimeWorkflow, payload: unknown, mode: ExecutionMode) {
  const waitsForRespond = workflow.graph.nodes.some((n) => n.type === "logic.respond" && !n.disabled);
  let resolveResponse!: (response: WebhookResponse) => void;
  const response = new Promise<WebhookResponse>((resolve) => (resolveResponse = resolve));
  const execution = executeWorkflow({
    workflow,
    triggerOutput: payload,
    mode,
    respond: waitsForRespond ? resolveResponse : undefined,
  });
  if (!waitsForRespond) resolveResponse({ status: 200, headers: {}, body: { accepted: true } });
  execution.then(
    (record) =>
      resolveResponse(
        record.status === "error"
          ? { status: 500, headers: {}, body: { error: record.error, executionId: record.id } }
          : { status: 200, headers: {}, body: { executed: true, executionId: record.id } },
      ),
    (e) => resolveResponse({ status: 500, headers: {}, body: { error: errorMessage(e) } }),
  );
  setTimeout(() => resolveResponse({ status: 504, headers: {}, body: { error: "انتهت مهلة انتظار الرد" } }), 60_000).unref?.();
  return { response, execution };
}

const notFound: WebhookResponse = { status: 404, headers: {}, body: { error: "الـ Webhook ده مش موجود أو السيناريو مش مفعّل" } };

export async function handleWebhook(path: string, request: WebhookRequest): Promise<WebhookResponse> {
  const session = await one(
    `UPDATE test_sessions SET status = 'running'
     WHERE id = (SELECT id FROM test_sessions WHERE trigger_path = $1 AND status = 'waiting' AND expires_at > $2
                 ORDER BY created_at DESC LIMIT 1)
       AND status = 'waiting'
     RETURNING *`,
    [path, now()],
  );
  if (session) return deliverToTestSession(session, request);

  const row = await one("SELECT * FROM workflows WHERE trigger_path = $1 AND active = 1", [path]);
  const workflow = row ? rowToWorkflow(row) : undefined;
  const info = workflow ? triggerInfo(workflow.graph) : undefined;
  if (!workflow || !info) return notFound;

  let items: unknown[];
  try {
    const ctx = await webhookContext(workflow, info, path);
    // Platform handshakes (Meta's hub.challenge) answer before any execution.
    const verified = info.def.webhook?.verify?.(request, ctx);
    if (verified) return verified;
    items = parseItems(info, request, ctx);
  } catch (e: any) {
    return { status: e.statusCode ?? 400, headers: {}, body: { error: errorMessage(e) } };
  }
  if (info.def.triggerType === "app") {
    runInBackground(runItems(workflow, items, "poll"));
    return { status: 200, headers: {}, body: { ok: true } };
  }
  const dispatched = dispatchWebhook(workflow, items[0], "webhook");
  runInBackground(dispatched.execution);
  return dispatched.response;
}

async function deliverToTestSession(session: any, request: WebhookRequest): Promise<WebhookResponse> {
  const base = await loadWorkflow(session.workflow_id);
  if (!base) return notFound;
  const workflow = { ...base, graph: parseJson<WorkflowGraph>(session.graph, base.graph) };
  const info = triggerInfo(workflow.graph);
  if (!info) return notFound;

  let items: unknown[];
  try {
    items = parseItems(info, request, await webhookContext(workflow, info, session.trigger_path));
  } catch (e: any) {
    await run("UPDATE test_sessions SET status = 'waiting' WHERE id = $1", [session.id]);
    return { status: e.statusCode ?? 400, headers: {}, body: { error: errorMessage(e) } };
  }
  if (!items.length) {
    await run("UPDATE test_sessions SET status = 'waiting' WHERE id = $1", [session.id]);
    return { status: 200, headers: {}, body: { ignored: true } };
  }

  const finish = async (record?: ExecutionRecord, message?: string) => {
    await run("UPDATE test_sessions SET status = $1, execution_id = $2, message = $3 WHERE id = $4", [
      record ? "done" : "error",
      record?.id ?? null,
      message ?? null,
      session.id,
    ]);
    await cleanupTestTrigger(workflow);
  };

  if (info.def.triggerType === "app") {
    runInBackground(runItems(workflow, items, "manual").then((r) => finish(r), (e) => finish(undefined, errorMessage(e))));
    return { status: 200, headers: {}, body: { ok: true } };
  }
  const dispatched = dispatchWebhook(workflow, items[0], "manual");
  runInBackground(dispatched.execution.then((r) => finish(r), (e) => finish(undefined, errorMessage(e))));
  return dispatched.response;
}

/* ---------- «تشغيل مرة» ---------- */
export interface TestRunResult {
  execution?: ExecutionRecord;
  sessionId?: string;
  waitingFor?: "webhook" | "app";
  url?: string;
}

async function createTestSession(workflow: RuntimeWorkflow, path: string) {
  if (!path) throw new Error("احفظ السيناريو الأول عشان يتعمل رابط المحفّز");
  await run("UPDATE test_sessions SET status = 'cancelled' WHERE workflow_id = $1 AND status = 'waiting'", [workflow.id]);
  const id = newId();
  const created = new Date();
  await run(
    `INSERT INTO test_sessions (id, workflow_id, user_id, trigger_path, graph, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      workflow.id,
      workflow.userId,
      path,
      JSON.stringify(workflow.graph),
      created.toISOString(),
      new Date(created.getTime() + config.testSessionSeconds * 1000).toISOString(),
    ],
  );
  return id;
}

export async function startTestRun(workflow: RuntimeWorkflow): Promise<TestRunResult> {
  const info = triggerInfo(workflow.graph);
  if (!info) throw new Error("ضيف محفّز (Trigger) الأول");
  const params = triggerParams(info.def, info.node);

  switch (info.def.triggerType) {
    case "manual":
      return {
        execution: await executeWorkflow({ workflow, triggerOutput: { triggeredAt: now(), data: params.data ?? {} }, mode: "manual" }),
      };
    case "schedule": {
      if (info.def.poll) {
        const items = await pollOnce(workflow, info, AbortSignal.timeout(60_000), true);
        if (!items.length) throw new Error("مفيش بيانات دلوقتي أجرّب عليها - تأكد إن فيه عنصر واحد على الأقل (صف، طلب، خبر...)");
        return { execution: await executeWorkflow({ workflow, triggerOutput: items[0], mode: "manual" }) };
      }
      return { execution: await executeWorkflow({ workflow, triggerOutput: { firedAt: now() }, mode: "manual" }) };
    }
    case "webhook":
      return { sessionId: await createTestSession(workflow, info.path), waitingFor: "webhook", url: webhookUrl(info.path) };
    case "app": {
      if (workflow.active) throw new Error("السيناريو مفعّل وبيستقبل رسايل دلوقتي - وقّف التفعيل الأول عشان تجرّب");
      await credentialFor(workflow, info);
      const sessionId = await createTestSession(workflow, info.path);
      if (appUsesWebhook(info.def)) await registerAppWebhook(workflow, info);
      else if (info.def.poll && config.backgroundWorkers) void pollForTest(sessionId, workflow, info);
      else throw new Error("المحفّز ده محتاج رابط HTTPS عام للمنصة - اضبط PUBLIC_URL");
      return { sessionId, waitingFor: "app" };
    }
    default:
      throw new Error("نوع محفّز غير مدعوم");
  }
}

async function cleanupTestTrigger(workflow: RuntimeWorkflow) {
  const current = await one<{ active: number }>("SELECT active FROM workflows WHERE id = $1", [workflow.id]);
  if (current && !current.active) await deactivateTrigger(workflow);
}

async function cleanupFromSession(session: any) {
  const base = await loadWorkflow(session.workflow_id);
  if (base) await cleanupTestTrigger({ ...base, graph: parseJson<WorkflowGraph>(session.graph, base.graph) });
}

export async function getTestSession(sessionId: string, userId: string) {
  const session = await one("SELECT * FROM test_sessions WHERE id = $1 AND user_id = $2", [sessionId, userId]);
  if (!session) return undefined;
  if (session.status === "waiting" && session.expires_at < now()) {
    const expired = await run("UPDATE test_sessions SET status = 'expired' WHERE id = $1 AND status = 'waiting'", [sessionId]);
    session.status = "expired";
    if (expired) await cleanupFromSession(session);
  }
  const row = session.execution_id ? await one("SELECT * FROM executions WHERE id = $1", [session.execution_id]) : undefined;
  return {
    status: session.status as string,
    message: session.message ?? (session.status === "expired" ? `مفيش بيانات وصلت خلال ${config.testSessionSeconds / 60} دقيقة` : null),
    execution: row ? executionFromRow(row) : null,
  };
}

export async function cancelTestSession(sessionId: string, userId: string) {
  const session = await one("SELECT * FROM test_sessions WHERE id = $1 AND user_id = $2", [sessionId, userId]);
  if (!session) return;
  const cancelled = await run("UPDATE test_sessions SET status = 'cancelled' WHERE id = $1 AND status = 'waiting'", [sessionId]);
  if (cancelled) await cleanupFromSession(session);
}

/* ---------- polling (local dev only) ---------- */
async function loadTriggerState(workflowId: string, nodeId: string) {
  const row = await one<{ state: string }>("SELECT state FROM trigger_state WHERE workflow_id = $1 AND node_id = $2", [workflowId, nodeId]);
  return parseJson<any>(row?.state, {});
}

async function pollOnce(workflow: RuntimeWorkflow, info: TriggerInfo, signal: AbortSignal, testMode: boolean) {
  const { items, state } = await info.def.poll!({
    params: triggerParams(info.def, info.node),
    credential: await credentialFor(workflow, info),
    state: await loadTriggerState(workflow.id, info.node.id),
    signal,
    testMode,
  });
  await run(
    `INSERT INTO trigger_state (workflow_id, node_id, state) VALUES ($1, $2, $3)
     ON CONFLICT (workflow_id, node_id) DO UPDATE SET state = EXCLUDED.state`,
    [workflow.id, info.node.id, JSON.stringify(state ?? {})],
  );
  return items;
}

async function pollForTest(sessionId: string, workflow: RuntimeWorkflow, info: TriggerInfo) {
  try {
    for (;;) {
      const session = await one("SELECT status, expires_at FROM test_sessions WHERE id = $1", [sessionId]);
      if (!session || session.status !== "waiting" || session.expires_at < now()) return;
      const items = await pollOnce(workflow, info, new AbortController().signal, true);
      if (!items.length) continue;
      if (!(await run("UPDATE test_sessions SET status = 'running' WHERE id = $1 AND status = 'waiting'", [sessionId]))) return;
      const record = await runItems(workflow, items, "manual");
      await run("UPDATE test_sessions SET status = 'done', execution_id = $1 WHERE id = $2", [record?.id ?? null, sessionId]);
      return;
    }
  } catch (e) {
    await run("UPDATE test_sessions SET status = 'error', message = $1 WHERE id = $2", [errorMessage(e), sessionId]).catch(() => {});
  }
}

const pollers = new Map<string, AbortController>();
let scheduleTimer: ReturnType<typeof setInterval> | undefined;

export function stopLocalWorker(workflowId: string) {
  pollers.get(workflowId)?.abort();
  pollers.delete(workflowId);
}

export async function syncLocalWorker(workflowId: string) {
  stopLocalWorker(workflowId);
  if (!config.backgroundWorkers) return;
  const workflow = await loadWorkflow(workflowId);
  const info = workflow?.active ? triggerInfo(workflow.graph) : undefined;
  if (!info || info.def.triggerType !== "app" || !info.def.poll || appUsesWebhook(info.def)) return;

  const controller = new AbortController();
  pollers.set(workflowId, controller);
  void (async () => {
    let backoff = 5_000;
    let failing = false;
    while (!controller.signal.aborted) {
      try {
        const current = await loadWorkflow(workflowId);
        const currentInfo = current?.active ? triggerInfo(current.graph) : undefined;
        if (!current || !currentInfo) break;
        const items = await pollOnce(current, currentInfo, controller.signal, false);
        if (failing) await setTriggerError(workflowId, null);
        failing = false;
        backoff = 5_000;
        for (const item of items) await executeWorkflow({ workflow: current, triggerOutput: item, mode: "poll" });
        await sleep(300, controller.signal);
      } catch (e) {
        if (controller.signal.aborted) break;
        failing = true;
        await setTriggerError(workflowId, errorMessage(e)).catch(() => {});
        await sleep(backoff, controller.signal).catch(() => {});
        backoff = Math.min(backoff * 2, 300_000);
      }
    }
  })();
}

/* ---------- schedules ---------- */
export async function runDueSchedules(limit = 25): Promise<number> {
  const due = await query(
    `SELECT * FROM workflows WHERE active = 1 AND trigger_type = 'schedule' AND next_run_at IS NOT NULL AND next_run_at <= $1
     ORDER BY next_run_at LIMIT $2`,
    [now(), limit],
  );
  let ran = 0;
  for (const row of due) {
    const workflow = rowToWorkflow(row);
    const info = triggerInfo(workflow.graph);
    if (!info) continue;
    let next: string | null = null;
    try {
      next = computeNextRun(triggerParams(info.def, info.node));
    } catch (e) {
      await setTriggerError(row.id, errorMessage(e));
    }
    // Claim the slot so overlapping ticks never run it twice.
    const claimed = await run("UPDATE workflows SET next_run_at = $1 WHERE id = $2 AND next_run_at = $3", [next, row.id, row.next_run_at]);
    if (!claimed) continue;
    ran++;
    if (info.def.poll) {
      // "Watch" triggers (RSS, new rows, new orders...): one execution per new item since the last check.
      try {
        const items = await pollOnce(workflow, info, AbortSignal.timeout(90_000), false);
        for (const item of items.slice(0, 50)) await executeWorkflow({ workflow, triggerOutput: item, mode: "poll" });
        if (row.trigger_error) await setTriggerError(row.id, null);
      } catch (e) {
        await setTriggerError(row.id, errorMessage(e));
      }
      continue;
    }
    await executeWorkflow({ workflow, triggerOutput: { firedAt: now() }, mode: "schedule" }).catch((e) =>
      setTriggerError(row.id, errorMessage(e)),
    );
  }
  ran += await runScheduledPosts().catch((e) => {
    console.error("[scheduled posts]", e);
    return 0;
  });
  await markStaleExecutions(20 * 60_000);
  await run("DELETE FROM test_sessions WHERE created_at < $1", [new Date(Date.now() - 86_400_000).toISOString()]);
  // Generated images expire; images the customer uploaded stay until they delete them.
  await run("DELETE FROM media WHERE source = 'generated' AND created_at < $1", [new Date(Date.now() - 30 * 86_400_000).toISOString()]);
  return ran;
}

export async function startBackgroundWorkers() {
  if (!config.backgroundWorkers) return 0;
  scheduleTimer = setInterval(() => void runDueSchedules().catch((e) => console.error("[schedules]", e)), 20_000);
  const rows = await query<{ id: string }>("SELECT id FROM workflows WHERE active = 1 AND trigger_type = 'app'");
  for (const row of rows) await syncLocalWorker(row.id);
  return rows.length;
}

export function stopBackgroundWorkers() {
  clearInterval(scheduleTimer);
  for (const id of [...pollers.keys()]) stopLocalWorker(id);
}
