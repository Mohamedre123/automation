import { config } from "../config.js";
import { decrypt } from "../crypto.js";
import { newId, now, one, parseJson, run } from "../db.js";
import { getNode } from "../nodes/index.js";
import { resolveMediaMentions } from "../nodes/media.js";
import { assertExecutionQuota } from "../protection.js";
import { runInBackground } from "../background.js";
import { assertCanRun, billableSteps, chargeRun } from "../billing.js";
import { autoFillFromRun } from "./autofill.js";
import { errorMessage, sleep, withTimeout } from "../nodes/util.js";
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

export async function resolveCredential(
  def: NodeDefinition,
  node: WorkflowNode,
  userId: string,
  load: (id: string) => Promise<CredentialValue | undefined> = (id) => loadCredential(userId, id),
) {
  if (!def.credentialTypes?.length) return undefined;
  if (!node.credentialId) {
    if (def.credentialOptional) return undefined;
    throw new Error("اختار الحساب (Credential) للخطوة دي");
  }
  const credential = await load(node.credentialId);
  if (!credential) throw new Error("الحساب (Credential) المختار اتمسح - اختار واحد تاني");
  if (!def.credentialTypes.includes(credential.type)) throw new Error("نوع الحساب المختار مش مناسب للخطوة دي");
  return credential;
}

function nextNodes(graph: WorkflowGraph, nodeId: string, branch?: string): string[] {
  return graph.edges
    .filter((e) => e.source === nodeId && (branch === undefined || (e.sourceHandle || "main") === branch))
    .map((e) => e.target);
}

/**
 * Worth trying again? A timeout, a dropped connection, a rate limit or a server having a bad
 * moment will pass. A missing field or a rejected key will not, and retrying only wastes time.
 */
function worthRetrying(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.name === "AbortError") return false;
  if (error.name === "TimeoutError") return true;
  const text = `${error.name} ${error.message}`;
  if (/مفتاح|صلاحيات|مرفوض|فاضي|مطلوب|غلط|unauthorized|forbidden|invalid|not found|401|403|404|422/i.test(text)) return false;
  return /timeout|timed out|socket|network|fetch failed|ECONN|EAI_AGAIN|ETIMEDOUT|rate limit|too many|الحد المسموح|انتهت المهلة|429|\b5\d\d\b/i.test(text);
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

  // Each account is read and decrypted once per run, however many steps use it.
  const credentialCache = new Map<string, Promise<CredentialValue | undefined>>();
  const credentialById = (credentialId: string) => {
    let cached = credentialCache.get(credentialId);
    if (!cached) {
      cached = loadCredential(workflow.userId, credentialId);
      credentialCache.set(credentialId, cached);
    }
    return cached;
  };

  // Recording the run and checking the daily quota happen together, not one after the other.
  const [quota, allowance] = await Promise.allSettled([
    assertExecutionQuota(workflow.userId),
    assertCanRun(workflow.userId, workflow.id, mode),
    run(
      "INSERT INTO executions (id, workflow_id, user_id, status, mode, started_at, steps) VALUES ($1, $2, $3, 'running', $4, $5, '[]')",
      [id, workflow.id, workflow.userId, mode, startedAt],
    ),
  ]).then(async (results) => {
    if (results[2].status === "rejected") throw results[2].reason;
    return results;
  });
  onStart?.(id);

  // Editors watching this run see each step light up as it starts and finishes. The writes go out in
  // order in the background, so a chatbot's reply never waits for them.
  let progressChain: Promise<unknown> = Promise.resolve();
  const progress = (currentNode: string | null) => {
    const snapshot = JSON.stringify(steps);
    progressChain = progressChain.then(() =>
      run("UPDATE executions SET steps = $1, current_node = $2 WHERE id = $3 AND status = 'running'", [snapshot, currentNode, id]).catch(() => undefined),
    );
  };
  // Side work (remembering the contact, etc.) runs alongside the steps.
  const sideTasks: Promise<unknown>[] = [];

  try {
    if (quota.status === "rejected") throw quota.reason;
    if (allowance.status === "rejected") throw allowance.reason;
    const trigger = findTrigger(graph);
    if (!trigger) throw new Error("السيناريو محتاج محفّز (Trigger) في البداية");
    const outputs: Record<string, unknown> = { [trigger.id]: triggerOutput };
    const triggerDef = getNode(trigger.type);
    const triggerCredential = trigger.credentialId ? await credentialById(trigger.credentialId).catch(() => undefined) : undefined;
    if (triggerDef?.onTriggered) {
      sideTasks.push(
        triggerDef.onTriggered({ output: triggerOutput, credential: triggerCredential, userId: workflow.userId }).catch((e) => {
          console.error(`[execution ${id}] onTriggered failed: ${errorMessage(e)}`);
        }),
      );
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
      progress(node.id);

      let params: Record<string, any> | undefined;
      let attempts = 1;
      try {
        if (!def?.run) throw new Error(`نوع خطوة غير معروف: ${node.type}`);
        // Only what the customer typed in the step (not data flowing in from earlier steps) can mention library images.
        params = resolveParams(def.fields, await resolveMediaMentions(node.params ?? {}, workflow.userId), { outputs: scope, vars });
        // Empty caption / image / video boxes take what the earlier steps produced.
        params = autoFillFromRun(def, node, params, graph, scope);
        // A required box still empty after auto-filling is a setup mistake: say which one instead of calling the service.
        // Steps set to "skip when empty" handle an empty message themselves.
        const skipsEmpty = def.fields.some((f) => f.key === "skipIfEmpty") && (node.params?.skipIfEmpty ?? true) !== false;
        for (const field of skipsEmpty ? [] : def.fields) {
          const raw = node.params?.[field.key] ?? field.default;
          const visible = !field.showIf || field.showIf.values.includes(node.params?.[field.showIf.field] ?? def.fields.find((f) => f.key === field.showIf!.field)?.default);
          const resolved = params[field.key];
          const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());
          if (field.required && visible && isEmpty(raw) && isEmpty(resolved)) {
            throw new Error(`حقل «${field.label}» فاضي ومفيش خطوة قبلها يتاخد منها - املاه في إعدادات الخطوة`);
          }
        }
        const context = {
          params,
          credential: await resolveCredential(def, node, workflow.userId, credentialById),
          outputs: scope,
          workflow: { id: workflow.id, name: workflow.name, userId: workflow.userId },
          execution: { id, mode },
          signal: withTimeout(abortSignal, def.timeoutMs ?? config.nodeTimeoutMs),
          trigger: triggerContext,
          respond,
        };
        // "Try again if it fails": the internet is unreliable and most failures are a moment long.
        const tries = 1 + Math.min(Math.max(Math.trunc(Number(node.retries) || 0), 0), 5);
        let wait = Math.min(Math.max(Number(node.retryWaitSeconds) || 5, 1), 120) * 1000;
        let result!: Awaited<ReturnType<NonNullable<typeof def.run>>>;
        for (let attempt = 1; ; attempt++) {
          try {
            result = await def.run(context);
            attempts = attempt;
            break;
          } catch (err) {
            // A cancelled run, or a mistake in the setup, will fail the same way every time.
            // And there is no point sleeping past the moment the host kills the run anyway.
            const left = config.runBudgetMs - (Date.now() - started);
            if (attempt >= tries || abortSignal.aborted || !worthRetrying(err) || left < wait + 5_000) {
              attempts = attempt;
              throw err;
            }
            await sleep(wait, abortSignal);
            wait = Math.min(wait * 2, 120_000);
          }
        }
        steps.push({
          ...base,
          status: "success",
          ...(attempts > 1 ? { attempts } : {}),
          durationMs: Date.now() - stepStart,
          input: compact(params),
          output: compact(result.fanOut ? { items: result.fanOut.length, ...(result.output as object) } : result.output),
          branch: result.branch,
        });
        progress(null);

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
        steps.push({
          ...base,
          status: "error",
          ...(attempts > 1 ? { attempts } : {}),
          durationMs: Date.now() - stepStart,
          input: compact(params),
          error: message,
        });
        progress(null);
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

  await Promise.allSettled(sideTasks);
  await progressChain;
  // Credits: every step that actually ran (the trigger and skipped steps are free), at least 1 per run.
  const credits = allowance.status === "fulfilled" ? billableSteps(steps, (type) => getNode(type)?.group) : 0;
  if (credits) await chargeRun(workflow.userId, credits).catch((e) => console.error(`[execution ${id}] charge failed: ${errorMessage(e)}`));
  await run("UPDATE executions SET status = $1, finished_at = $2, duration_ms = $3, error = $4, steps = $5, current_node = NULL, credits = $7 WHERE id = $6", [
    record.status,
    record.finishedAt,
    record.durationMs,
    record.error,
    JSON.stringify(steps),
    id,
    credits,
  ]);
  // Trimming old history is housekeeping: don't make the caller wait for it.
  runInBackground(
    run(
      `DELETE FROM executions WHERE workflow_id = $1 AND id NOT IN (
         SELECT id FROM executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2)`,
      [workflow.id, config.executionsKeptPerWorkflow],
    ),
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
