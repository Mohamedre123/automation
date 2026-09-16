import { config } from "../config.js";
import { decrypt } from "../crypto.js";
import { newId, now, one, parseJson, run } from "../db.js";
import { getNode } from "../nodes/index.js";
import { resolveMediaMentions } from "../nodes/media.js";
import { assertExecutionQuota } from "../protection.js";
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
  /** Called with the execution id as soon as the run is recorded (for live progress in the editor). */
  onStart?: (executionId: string) => void;
}

const MAX_STEPS = 500;
const MAX_STORED_CHARS = 200_000;

export const findTrigger = (graph: WorkflowGraph) => graph.nodes.find((n) => getNode(n.type)?.kind === "trigger");

export async function loadCredential(userId: string, credentialId: string): Promise<CredentialValue | undefined> {
  const row = await one<{ id: string; type: string; data: string }>(
    "SELECT id, type, data FROM credentials WHERE id = $1 AND user_id = $2",
    [credentialId, userId],
  );
  if (!row) return undefined;
  return { id: row.id, type: row.type, data: decrypt<Record<string, string>>(row.data) };
}

export async function resolveCredential(def: NodeDefinition, node: WorkflowNode, userId: string) {
  if (!def.credentialTypes?.length) return undefined;
  if (!node.credentialId) {
    if (def.credentialOptional) return undefined;
    throw new Error("اختار الحساب (Credential) للخطوة دي");
  }
  const credential = await loadCredential(userId, node.credentialId);
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
  return executionQueue.run(() => execute(options));
}

async function execute({ workflow, triggerOutput, mode, respond, signal, onStart }: RunOptions): Promise<ExecutionRecord> {
  const { graph } = workflow;
  const id = newId();
  const startedAt = now();
  const started = Date.now();
  const abortSignal = signal ?? new AbortController().signal;
  const steps: StepLog[] = [];
  let error: string | null = null;

  await run(
    "INSERT INTO executions (id, workflow_id, user_id, status, mode, started_at, steps) VALUES ($1, $2, $3, 'running', $4, $5, '[]')",
    [id, workflow.id, workflow.userId, mode, startedAt],
  );
  onStart?.(id);

  // Editors watching this run see each step light up as it starts and finishes.
  const progress = (currentNode: string | null) =>
    run("UPDATE executions SET steps = $1, current_node = $2 WHERE id = $3", [JSON.stringify(steps), currentNode, id]).catch(() => undefined);

  try {
    await assertExecutionQuota(workflow.userId);
    const trigger = findTrigger(graph);
    if (!trigger) throw new Error("السيناريو محتاج محفّز (Trigger) في البداية");
    const outputs: Record<string, unknown> = { [trigger.id]: triggerOutput };
    const triggerDef = getNode(trigger.type);
    const triggerCredential = trigger.credentialId ? await loadCredential(workflow.userId, trigger.credentialId).catch(() => undefined) : undefined;
    if (triggerDef?.onTriggered) {
      await triggerDef.onTriggered({ output: triggerOutput, credential: triggerCredential, userId: workflow.userId }).catch((e) => {
        console.error(`[execution ${id}] onTriggered failed: ${errorMessage(e)}`);
      });
    }
    const triggerContext = { type: trigger.type, credential: triggerCredential };
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

    // Each pending step carries the outputs it can see: iterators give every item its own copy.
    const queued = (ids: string[], scope: Record<string, unknown>) => ids.map((nodeId) => ({ nodeId, scope }));
    const pending = queued(nextNodes(graph, trigger.id), outputs);
    while (pending.length) {
      if (abortSignal.aborted) throw new Error("اتلغى التشغيل");
      if (steps.length > MAX_STEPS) throw new Error(`السيناريو عدّى الحد الأقصى (${MAX_STEPS} خطوة)`);
      const { nodeId: nextId, scope } = pending.shift()!;
      const node = graph.nodes.find((n) => n.id === nextId);
      if (!node) continue;
      const def = getNode(node.type);
      const stepStart = Date.now();
      const base = { nodeId: node.id, type: node.type, name: node.name || def?.name || node.type, startedAt: now() };

      if (node.disabled) {
        steps.push({ ...base, status: "skipped", durationMs: 0 });
        continue;
      }
      await progress(node.id);

      let params: Record<string, any> | undefined;
      try {
        if (!def?.run) throw new Error(`نوع خطوة غير معروف: ${node.type}`);
        // A required box left empty (never filled or wired) is a setup mistake: say which one instead of calling the service.
        // Steps set to "skip when empty" handle an empty message themselves.
        const skipsEmpty = def.fields.some((f) => f.key === "skipIfEmpty") && (node.params?.skipIfEmpty ?? true) !== false;
        for (const field of skipsEmpty ? [] : def.fields) {
          const raw = node.params?.[field.key] ?? field.default;
          const visible = !field.showIf || field.showIf.values.includes(node.params?.[field.showIf.field] ?? def.fields.find((f) => f.key === field.showIf!.field)?.default);
          if (field.required && visible && (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim()))) {
            throw new Error(`حقل «${field.label}» فاضي - املاه أو دوس «ربط تلقائي بالخطوات اللي قبلها» في إعدادات الخطوة`);
          }
        }
        // Only what the customer typed in the step (not data flowing in from earlier steps) can mention library images.
        params = resolveParams(def.fields, await resolveMediaMentions(node.params ?? {}, workflow.userId), { outputs: scope, vars });
        const result = await def.run({
          params,
          credential: await resolveCredential(def, node, workflow.userId),
          outputs: scope,
          workflow: { id: workflow.id, name: workflow.name, userId: workflow.userId },
          execution: { id, mode },
          signal: withTimeout(abortSignal, def.timeoutMs ?? config.nodeTimeoutMs),
          trigger: triggerContext,
          respond,
        });
        steps.push({
          ...base,
          status: "success",
          durationMs: Date.now() - stepStart,
          input: compact(params),
          output: compact(result.fanOut ? { items: result.fanOut.length, ...(result.output as object) } : result.output),
          branch: result.branch,
        });
        void progress(null);

        if (result.stop) {
          if (result.stop.status === "error") error = `${base.name} (${node.id}): ${result.stop.message}`;
          break;
        }
        if (result.fanOut) {
          const children = nextNodes(graph, node.id, result.branch);
          // Depth-first: item 1 runs all its following steps before item 2 starts.
          const perItem = result.fanOut.flatMap((item, index) =>
            queued(children, {
              ...scope,
              [node.id]: { ...(item && typeof item === "object" && !Array.isArray(item) ? item : { value: item }), _index: index + 1, _total: result.fanOut!.length },
            }),
          );
          pending.unshift(...perItem);
          continue;
        }
        scope[node.id] = result.output;
        pending.unshift(...queued(nextNodes(graph, node.id, result.branch), scope));
      } catch (err) {
        const message = errorMessage(err);
        steps.push({ ...base, status: "error", durationMs: Date.now() - stepStart, input: compact(params), error: message });
        void progress(null);
        if (!node.continueOnFail) {
          error = `${base.name} (${node.id}): ${message}`;
          break;
        }
        scope[node.id] = { error: message };
        pending.unshift(...queued(nextNodes(graph, node.id, def?.outputs ? def.outputs[def.outputs.length - 1].key : undefined), scope));
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

  await run("UPDATE executions SET status = $1, finished_at = $2, duration_ms = $3, error = $4, steps = $5, current_node = NULL WHERE id = $6", [
    record.status,
    record.finishedAt,
    record.durationMs,
    record.error,
    JSON.stringify(steps),
    id,
  ]);
  await run(
    `DELETE FROM executions WHERE workflow_id = $1 AND id NOT IN (
       SELECT id FROM executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2)`,
    [workflow.id, config.executionsKeptPerWorkflow],
  );

  return record;
}

export function executionFromRow(row: any, withSteps = true): ExecutionRecord & { workflowName?: string; currentNode?: string | null } {
  return {
    currentNode: row.current_node ?? null,
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

export async function markStaleExecutions(olderThanMs: number) {
  await run("UPDATE executions SET status = 'error', error = 'التشغيل اتقطع قبل ما يخلص', finished_at = $1 WHERE status = 'running' AND started_at < $2", [
    now(),
    new Date(Date.now() - olderThanMs).toISOString(),
  ]);
}
