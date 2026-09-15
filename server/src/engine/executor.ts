import { config } from "../config.js";
import { decrypt } from "../crypto.js";
import { db, newId, now, parseJson } from "../db.js";
import { getNode } from "../nodes/index.js";
import { errorMessage, withTimeout } from "../nodes/util.js";
import { resolveParams, systemVars } from "./expressions.js";
import { ExecutionQueue } from "./queue.js";
import type {
  CredentialValue,
  ExecutionMode,
  ExecutionRecord,
  NodeDefinition,
  StepLog,
  WebhookResponse,
  WorkflowGraph,
  WorkflowNode,
} from "./types.js";

export const executionQueue = new ExecutionQueue(config.maxConcurrentExecutions);

export interface RuntimeWorkflow {
  id: string;
  name: string;
  userId: string;
  active: boolean;
  graph: WorkflowGraph;
}

export interface RunOptions {
  workflow: RuntimeWorkflow;
  triggerOutput: unknown;
  mode: ExecutionMode;
  respond?: (response: WebhookResponse) => void;
  signal?: AbortSignal;
}

const MAX_STEPS = 500;
const MAX_STORED_CHARS = 200_000;

export const findTrigger = (graph: WorkflowGraph) => graph.nodes.find((n) => getNode(n.type)?.kind === "trigger");

export function loadCredential(userId: string, credentialId: string): CredentialValue | undefined {
  const row = db
    .prepare("SELECT id, type, data FROM credentials WHERE id = ? AND user_id = ?")
    .get(credentialId, userId) as { id: string; type: string; data: string } | undefined;
  if (!row) return undefined;
  return { id: row.id, type: row.type, data: decrypt<Record<string, string>>(row.data) };
}

export function resolveCredential(def: NodeDefinition, node: WorkflowNode, userId: string) {
  if (!def.credentialTypes?.length) return undefined;
  if (!node.credentialId) {
    if (def.credentialOptional) return undefined;
    throw new Error("اختار الحساب (Credential) للخطوة دي");
  }
  const credential = loadCredential(userId, node.credentialId);
  if (!credential) throw new Error("الحساب (Credential) المختار اتمسح - اختار واحد تاني");
  if (!def.credentialTypes.includes(credential.type)) throw new Error("نوع الحساب المختار مش مناسب للخطوة دي");
  return credential;
}

function nextNodes(graph: WorkflowGraph, nodeId: string, branch?: string): string[] {
  return graph.edges
    .filter((e) => e.source === nodeId && (branch === undefined || (e.sourceHandle || "main") === branch))
    .map((e) => e.target);
}

function compact(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    return text.length <= MAX_STORED_CHARS ? value : { _truncated: true, preview: text.slice(0, 5000) };
  } catch {
    return { _unserializable: true };
  }
}

export function executeWorkflow(options: RunOptions): Promise<ExecutionRecord> {
  return executionQueue.run(() => run(options));
}

async function run({ workflow, triggerOutput, mode, respond, signal }: RunOptions): Promise<ExecutionRecord> {
  const { graph } = workflow;
  const id = newId();
  const startedAt = now();
  const started = Date.now();
  const abortSignal = signal ?? new AbortController().signal;
  const steps: StepLog[] = [];
  let error: string | null = null;

  db.prepare(
    "INSERT INTO executions (id, workflow_id, user_id, status, mode, started_at, steps) VALUES (?, ?, ?, 'running', ?, ?, '[]')",
  ).run(id, workflow.id, workflow.userId, mode, startedAt);

  try {
    const trigger = findTrigger(graph);
    if (!trigger) throw new Error("السيناريو محتاج محفّز (Trigger) في البداية");
    const outputs: Record<string, unknown> = { [trigger.id]: triggerOutput };
    const vars = systemVars({ id: workflow.id, name: workflow.name }, { id, mode });
    steps.push({
      nodeId: trigger.id,
      type: trigger.type,
      name: trigger.name || getNode(trigger.type)?.name || trigger.type,
      status: "success",
      startedAt,
      durationMs: 0,
      output: compact(triggerOutput),
    });

    const pending = nextNodes(graph, trigger.id);
    while (pending.length) {
      if (abortSignal.aborted) throw new Error("اتلغى التشغيل");
      if (steps.length > MAX_STEPS) throw new Error(`السيناريو عدّى الحد الأقصى (${MAX_STEPS} خطوة)`);
      const nextId = pending.shift();
      const node = graph.nodes.find((n) => n.id === nextId);
      if (!node) continue;
      const def = getNode(node.type);
      const stepStart = Date.now();
      const base = { nodeId: node.id, type: node.type, name: node.name || def?.name || node.type, startedAt: now() };

      if (node.disabled) {
        steps.push({ ...base, status: "skipped", durationMs: 0 });
        continue;
      }

      let params: Record<string, any> | undefined;
      try {
        if (!def?.run) throw new Error(`نوع خطوة غير معروف: ${node.type}`);
        params = resolveParams(def.fields, node.params ?? {}, { outputs, vars });
        const result = await def.run({
          params,
          credential: resolveCredential(def, node, workflow.userId),
          outputs,
          workflow: { id: workflow.id, name: workflow.name, userId: workflow.userId },
          execution: { id, mode },
          signal: withTimeout(abortSignal, config.nodeTimeoutMs),
          respond,
        });
        outputs[node.id] = result.output;
        steps.push({
          ...base,
          status: "success",
          durationMs: Date.now() - stepStart,
          input: compact(params),
          output: compact(result.output),
          branch: result.branch,
        });
        pending.push(...nextNodes(graph, node.id, result.branch));
      } catch (err) {
        const message = errorMessage(err);
        steps.push({ ...base, status: "error", durationMs: Date.now() - stepStart, input: compact(params), error: message });
        if (!node.continueOnFail) {
          error = `${base.name} (${node.id}): ${message}`;
          break;
        }
        outputs[node.id] = { error: message };
        pending.push(...nextNodes(graph, node.id, def?.outputs ? "false" : undefined));
      }
    }
  } catch (err) {
    error = errorMessage(err);
  }

  const record: ExecutionRecord = {
    id,
    workflowId: workflow.id,
    status: error ? "error" : "success",
    mode,
    startedAt,
    finishedAt: now(),
    durationMs: Date.now() - started,
    error,
    steps,
  };

  db.prepare("UPDATE executions SET status = ?, finished_at = ?, duration_ms = ?, error = ?, steps = ? WHERE id = ?").run(
    record.status,
    record.finishedAt,
    record.durationMs,
    record.error,
    JSON.stringify(steps),
    id,
  );
  db.prepare(
    `DELETE FROM executions WHERE workflow_id = ? AND id NOT IN (
       SELECT id FROM executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?)`,
  ).run(workflow.id, workflow.id, config.executionsKeptPerWorkflow);

  return record;
}

export function executionFromRow(row: any, withSteps = true): ExecutionRecord & { workflowName?: string } {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name ?? undefined,
    status: row.status,
    mode: row.mode,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    error: row.error,
    steps: withSteps ? parseJson<StepLog[]>(row.steps, []) : [],
  };
}

export function markInterruptedExecutions() {
  db.prepare(
    "UPDATE executions SET status = 'error', error = 'السيرفر اتقفل أثناء التشغيل', finished_at = ? WHERE status = 'running'",
  ).run(now());
}
