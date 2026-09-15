import { Cron } from "croner";
import { db, now, parseJson } from "../db.js";
import {
  executeWorkflow,
  findTrigger,
  loadCredential,
  resolveCredential,
  type RuntimeWorkflow,
} from "../engine/executor.js";
import { resolveParams } from "../engine/expressions.js";
import type { ExecutionMode, ExecutionRecord, NodeDefinition, WebhookResponse, WorkflowGraph, WorkflowNode } from "../engine/types.js";
import { getNode } from "../nodes/index.js";
import { errorMessage, sleep, toNumber } from "../nodes/util.js";

interface Runner {
  stop(): void;
}

const runners = new Map<string, Runner>();
const webhookIndex = new Map<string, string>(); // path -> workflowId
const testListeners = new Map<string, (payload: unknown) => Promise<WebhookResponse>>();
export const triggerErrors = new Map<string, { message: string; at: string }>();

const emptyScope = { outputs: {}, vars: {} };
const triggerParams = (def: NodeDefinition, node: WorkflowNode) => resolveParams(def.fields, node.params ?? {}, emptyScope);

export function loadWorkflow(id: string): RuntimeWorkflow | undefined {
  const row = db.prepare("SELECT id, user_id, name, active, graph FROM workflows WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    active: Boolean(row.active),
    graph: parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }),
  };
}

const setError = (workflowId: string, message: string) => {
  triggerErrors.set(workflowId, { message, at: now() });
  console.error(`[trigger ${workflowId}] ${message}`);
};

export function stopWorkflow(workflowId: string) {
  runners.get(workflowId)?.stop();
  runners.delete(workflowId);
  triggerErrors.delete(workflowId);
}

export function syncWorkflow(workflowId: string) {
  stopWorkflow(workflowId);
  const workflow = loadWorkflow(workflowId);
  if (!workflow?.active) return;
  const trigger = findTrigger(workflow.graph);
  const def = trigger && getNode(trigger.type);
  if (!trigger || !def) return;

  if (def.triggerType === "webhook") {
    const path = String(trigger.params?.path ?? "");
    webhookIndex.set(path, workflowId);
    runners.set(workflowId, {
      stop: () => {
        if (webhookIndex.get(path) === workflowId) webhookIndex.delete(path);
      },
    });
  } else if (def.triggerType === "schedule") {
    runners.set(workflowId, startSchedule(workflow, triggerParams(def, trigger)));
  } else if (def.triggerType === "poll") {
    runners.set(workflowId, startPolling(workflowId, trigger.id, def));
  }
}

function startSchedule(workflow: RuntimeWorkflow, params: Record<string, any>): Runner {
  const fire = () => {
    const current = loadWorkflow(workflow.id);
    if (!current?.active) return;
    executeWorkflow({ workflow: current, triggerOutput: { firedAt: now() }, mode: "schedule" }).catch((e) =>
      setError(workflow.id, errorMessage(e)),
    );
  };
  if (params.mode === "cron") {
    try {
      const job = new Cron(String(params.cron ?? ""), { timezone: params.timezone || undefined }, fire);
      return { stop: () => job.stop() };
    } catch (e) {
      setError(workflow.id, `Cron غير صالح: ${errorMessage(e)}`);
      return { stop() {} };
    }
  }
  const minutes = Math.max(1, toNumber(params.minutes, 15));
  const timer = setInterval(fire, minutes * 60_000);
  return { stop: () => clearInterval(timer) };
}

function loadTriggerState(workflowId: string, nodeId: string) {
  const row = db.prepare("SELECT state FROM trigger_state WHERE workflow_id = ? AND node_id = ?").get(workflowId, nodeId) as
    | { state: string }
    | undefined;
  return parseJson<any>(row?.state, {});
}

function saveTriggerState(workflowId: string, nodeId: string, state: unknown) {
  db.prepare(
    `INSERT INTO trigger_state (workflow_id, node_id, state) VALUES (?, ?, ?)
     ON CONFLICT(workflow_id, node_id) DO UPDATE SET state = excluded.state`,
  ).run(workflowId, nodeId, JSON.stringify(state ?? {}));
}

async function pollOnce(workflow: RuntimeWorkflow, node: WorkflowNode, def: NodeDefinition, signal: AbortSignal, testMode: boolean) {
  const credential = resolveCredential(def, node, workflow.userId);
  const { items, state } = await def.poll!({
    params: triggerParams(def, node),
    credential,
    state: loadTriggerState(workflow.id, node.id),
    signal,
    testMode,
  });
  saveTriggerState(workflow.id, node.id, state);
  return items;
}

function startPolling(workflowId: string, nodeId: string, def: NodeDefinition): Runner {
  const controller = new AbortController();
  (async () => {
    let backoff = 5_000;
    while (!controller.signal.aborted) {
      try {
        const workflow = loadWorkflow(workflowId);
        const node = workflow?.graph.nodes.find((n) => n.id === nodeId);
        if (!workflow?.active || !node) break;
        const items = await pollOnce(workflow, node, def, controller.signal, false);
        for (const item of items) {
          await executeWorkflow({ workflow, triggerOutput: item, mode: "poll" });
        }
        triggerErrors.delete(workflowId);
        backoff = 5_000;
        await sleep(500, controller.signal);
      } catch (e) {
        if (controller.signal.aborted) break;
        setError(workflowId, errorMessage(e));
        await sleep(backoff, controller.signal).catch(() => {});
        backoff = Math.min(backoff * 2, 5 * 60_000);
      }
    }
  })().catch(() => {});
  return { stop: () => controller.abort() };
}

/** Starts the execution now; the response resolves from a respond node, the end of the run, or a timeout. */
function dispatchWebhook(workflow: RuntimeWorkflow, payload: unknown, mode: ExecutionMode, signal?: AbortSignal) {
  const waitsForRespond = workflow.graph.nodes.some((n) => n.type === "logic.respond" && !n.disabled);
  let resolveResponse!: (response: WebhookResponse) => void;
  const response = new Promise<WebhookResponse>((resolve) => (resolveResponse = resolve));
  const execution = executeWorkflow({
    workflow,
    triggerOutput: payload,
    mode,
    signal,
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
  setTimeout(() => resolveResponse({ status: 504, headers: {}, body: { error: "انتهت مهلة انتظار الرد" } }), 60_000).unref();
  return { response, execution };
}

export async function handleWebhook(path: string, payload: unknown): Promise<WebhookResponse> {
  const listener = testListeners.get(path);
  if (listener) {
    testListeners.delete(path);
    return listener(payload);
  }
  const workflowId = webhookIndex.get(path);
  const workflow = workflowId ? loadWorkflow(workflowId) : undefined;
  if (!workflow?.active) {
    return { status: 404, headers: {}, body: { error: "الـ Webhook ده مش موجود أو السيناريو مش مفعّل" } };
  }
  return dispatchWebhook(workflow, payload, "webhook").response;
}

export interface RunOnceResult {
  execution?: ExecutionRecord;
  count?: number;
  message?: string;
}

/** «تشغيل مرة»: runs the (possibly unsaved) graph, waiting for real trigger data when needed. */
export async function runOnce(workflow: RuntimeWorkflow, signal: AbortSignal): Promise<RunOnceResult> {
  const trigger = findTrigger(workflow.graph);
  const def = trigger && getNode(trigger.type);
  if (!trigger || !def) throw new Error("ضيف محفّز (Trigger) الأول");
  const params = triggerParams(def, trigger);

  switch (def.triggerType) {
    case "manual":
      return {
        execution: await executeWorkflow({
          workflow,
          triggerOutput: { triggeredAt: now(), data: params.data ?? {} },
          mode: "manual",
          signal,
        }),
      };
    case "schedule":
      return { execution: await executeWorkflow({ workflow, triggerOutput: { firedAt: now() }, mode: "manual", signal }) };
    case "webhook": {
      const path = String(params.path ?? "");
      const execution = await new Promise<ExecutionRecord | null>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          if (testListeners.get(path) === listener) testListeners.delete(path);
        };
        const onAbort = () => {
          cleanup();
          resolve(null);
        };
        const timer = setTimeout(onAbort, 120_000);
        const listener = (payload: unknown) => {
          cleanup();
          const dispatched = dispatchWebhook(workflow, payload, "manual", signal);
          dispatched.execution.then(resolve, reject);
          return dispatched.response;
        };
        testListeners.set(path, listener);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return execution ? { execution } : { message: "مفيش طلب وصل على الـ Webhook خلال دقيقتين" };
    }
    case "poll": {
      if (workflow.active) throw new Error("السيناريو مفعّل والمحفّز شغال في الخلفية - وقّف التفعيل الأول عشان تجرّب");
      if (def.credentialTypes?.length && trigger.credentialId && !loadCredential(workflow.userId, trigger.credentialId)) {
        throw new Error("الحساب (Credential) المختار للمحفّز مش موجود");
      }
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && !signal.aborted) {
        const items = await pollOnce(workflow, trigger, def, signal, true);
        if (items.length) {
          let execution: ExecutionRecord | undefined;
          for (const item of items) {
            execution = await executeWorkflow({ workflow, triggerOutput: item, mode: "manual", signal });
          }
          return { execution, count: items.length };
        }
      }
      return { message: "مفيش بيانات جديدة وصلت خلال دقيقة ونص" };
    }
    default:
      throw new Error("نوع محفّز غير مدعوم");
  }
}

export function startAllTriggers() {
  const rows = db.prepare("SELECT id FROM workflows WHERE active = 1").all() as { id: string }[];
  for (const row of rows) syncWorkflow(row.id);
  return rows.length;
}

export function stopAllTriggers() {
  for (const id of [...runners.keys()]) stopWorkflow(id);
}
