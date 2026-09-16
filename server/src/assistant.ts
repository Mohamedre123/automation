import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, parseJson, query } from "./db.js";
import { executionFromRow } from "./engine/executor.js";
import type { WorkflowGraph } from "./engine/types.js";
import { httpError } from "./errors.js";
import { credentialTypes, nodeDefinitions } from "./nodes/index.js";
import { errorMessage } from "./nodes/util.js";
import { insertWorkflow, sanitizeGraph, updateInactiveWorkflow } from "./routes/workflows.js";

/*
 * «مساعد تدفّق»: an in-app Claude agent that knows the platform, builds workflows for the user
 * and explains failed runs. Uses the platform owner's key, so it is a paid-plan feature.
 */

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 12;

type Access = { ok: true } | { ok: false; reason: "not_configured" | "plan" };

async function assistantAccess(req: FastifyRequest): Promise<Access> {
  if (!config.assistantApiKey) return { ok: false, reason: "not_configured" };
  if (config.adminEmails.includes(req.user.email.toLowerCase())) return { ok: true };
  const row = await one<{ plan: string }>("SELECT plan FROM users WHERE id = $1", [req.user.id]);
  return row && row.plan !== "free" ? { ok: true } : { ok: false, reason: "plan" };
}

let catalogJson: string | null = null;
function catalog() {
  catalogJson ??= JSON.stringify({
    nodes: nodeDefinitions.map((d) => ({
      type: d.type,
      name: d.name,
      app: d.appName,
      kind: d.kind,
      triggerType: d.triggerType,
      description: d.description,
      credentialTypes: d.credentialTypes,
      credentialOptional: d.credentialOptional || undefined,
      outputs: d.outputs?.map((o) => o.key),
      fields: d.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required || undefined,
        default: f.default,
        options: f.options?.map((o) => o.value),
        showIf: f.showIf,
        credentialTypes: f.credentialTypes,
      })),
      sampleOutput: d.sampleOutput,
    })),
    credentialTypes: credentialTypes.map((c) => ({ key: c.key, name: c.name })),
  });
  return catalogJson;
}

const INSTRUCTIONS = `أنت «مساعد تدفّق»، المساعد الذكي جوه منصة الأتمتة «تدفّق» (زي Make وn8n). بتساعد المستخدم يبني سيناريوهات أتمتة، ويفهم المنصة، ويحل أخطاء التشغيل.

# أسلوبك
- رد باللهجة المصرية، واضح ومختصر، وقسّم الخطوات بنقاط لما يكون فيه أكتر من خطوة.
- لو طلب المستخدم مش واضح بما يكفي لبناء سيناريو صح، اسأل سؤال واحد قصير بس قبل ما تبني.
- متقولش أبداً إنك عملت أو عدّلت سيناريو إلا لو الأداة رجعت نجاح.
- قبل ما تعدّل سيناريو موجود، اشرح التعديل واستنى موافقة المستخدم. إنشاء سيناريو جديد مش محتاج موافقة لو المستخدم طلبه.

# شكل السيناريو (graph)
{ "nodes": [...], "edges": [...] }
- كل node: { "id": "1", "type": "<من الكتالوج>", "name": "اسم اختياري", "position": { "x": 0, "y": 0 }, "params": { ... }, "credentialId": null }
- الـ ids أرقام نصية بالترتيب ("1", "2", ...). المحفّز (kind = trigger) دايماً "1"، ومسموح بمحفّز واحد بس.
- المواقع: x = ترتيب الخطوة × 280، و y = 0. الفروع: ‎-130 لفرع و ‎+130 للتاني.
- كل edge: { "id": "e1-2", "source": "1", "target": "2", "sourceHandle": null }
- خطوة الشرط logic.if ليها مخرجين: sourceHandle "true" (نعم) و"false" (لا). باقي الخطوات sourceHandle = null.
- أكتر من edge طالعين من نفس الخطوة = الفروع بتشتغل كلها (زي Router).
- مفيش دوائر (خطوة ترجع لخطوة قبلها).

# الربط بين الخطوات
- أي قيمة نصية في params تقدر تستخدم فيها {{<id>.<path>}} عشان تاخد من مخرجات خطوة سابقة، مثلاً {{1.message.text}} أو {{2.json.score}} أو {{3.items[0].name}}.
- استخدم sampleOutput بتاع كل خطوة في الكتالوج عشان تعرف المسارات الصح.
- متغيرات النظام: {{$now}} {{$today}} {{$execution.id}} {{$workflow.name}}.
- حقول type = "json" بتاخد نص JSON، وحقول keyvalue بتاخد [{"key": "...", "value": "..."}]، وحقول conditions بتاخد [{"left": "...", "op": "equals", "right": "..."}]، وmultiselect بتاخد مصفوفة قيم.

# الحسابات (Credentials)
- الخطوة اللي ليها credentialTypes محتاجة credentialId لحساب من نفس النوع. استخدم list_credentials وحط الـ id لو فيه حساب مناسب.
- لو مفيش، سيب credentialId = null وقول للمستخدم يضيف الحساب من صفحة «الحسابات» ويختاره في الخطوة.
- متطلبش من المستخدم أبداً يبعتلك مفاتيح API في الشات.

# المحفّزات
- trigger.form: فورم برابط عام، الإجابات في {{1.data.<key>}}. الأنسب لما حد محتاج يدخل بيانات بنفسه.
- trigger.webhook: لما نظام خارجي يبعت بيانات، في {{1.body.<key>}}. ولو السيناريو محتاج يرجّع رد استخدم logic.respond في الآخر.
- trigger.schedule: مواعيد (interval بالدقايق أو cron).
- telegram.trigger / wasender.trigger / whatsapp.trigger: رسايل واردة.

# بعد ما تبني سيناريو
اشرح في سطرين إيه اللي اتعمل، وقول بالظبط إيه اللي المستخدم محتاج يكمّله (الحسابات، Chat ID، معلومات الشركة...) وإزاي يجرّب بزرار «تشغيل مرة» ويفعّله.

# حل الأخطاء
استخدم get_recent_executions، حدد الخطوة اللي فشلت وسبب الخطأ من الرسالة والمدخلات، واشرح الحل بخطوات عملية. لو الحل تعديل في السيناريو، اعرضه واطلب الموافقة قبل update_workflow.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_workflows",
    description: "List the user's workflows: id, name, active flag, trigger type and last run status.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_workflow",
    description: "Get one workflow including its full graph.",
    input_schema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
  },
  {
    name: "get_recent_executions",
    description: "Recent runs of a workflow with status, error and each step's input/output, to diagnose failures.",
    input_schema: {
      type: "object",
      properties: { workflow_id: { type: "string" }, limit: { type: "integer", description: "1 to 5, default 3" } },
      required: ["workflow_id"],
    },
  },
  {
    name: "list_credentials",
    description: "List the user's connected accounts (id, type, name) so steps can reference them. Secrets are never returned.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_workflow",
    description: "Create a new, inactive workflow from a graph in the platform format. Returns its id.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Arabic workflow name" },
        graph: { type: "object", description: "{ nodes: [...], edges: [...] }" },
      },
      required: ["name", "graph"],
    },
  },
  {
    name: "update_workflow",
    description: "Replace the graph (and optionally the name) of an existing inactive workflow. Only after the user approved the change.",
    input_schema: {
      type: "object",
      properties: { workflow_id: { type: "string" }, name: { type: "string" }, graph: { type: "object" } },
      required: ["workflow_id", "graph"],
    },
  },
];

type AssistantAction = { type: "workflow_created" | "workflow_updated"; workflowId: string; name?: string };

const truncate = (value: unknown) => {
  const text = JSON.stringify(value ?? null);
  return text.length > 3000 ? `${text.slice(0, 3000)}…` : value;
};

async function runTool(name: string, input: Record<string, any>, userId: string, actions: AssistantAction[]): Promise<unknown> {
  switch (name) {
    case "list_workflows": {
      const rows = await query(
        `SELECT w.id, w.name, w.active, w.trigger_type,
           (SELECT status FROM executions e WHERE e.workflow_id = w.id ORDER BY started_at DESC LIMIT 1) AS last_status
         FROM workflows w WHERE w.user_id = $1 ORDER BY w.updated_at DESC LIMIT 50`,
        [userId],
      );
      return rows.map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active), trigger: r.trigger_type, lastStatus: r.last_status }));
    }
    case "get_workflow": {
      const row = await one("SELECT id, name, active, graph FROM workflows WHERE id = $1 AND user_id = $2", [input.workflow_id, userId]);
      if (!row) throw new Error("Workflow not found");
      return { id: row.id, name: row.name, active: Boolean(row.active), graph: parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }) };
    }
    case "get_recent_executions": {
      const owned = await one("SELECT 1 AS ok FROM workflows WHERE id = $1 AND user_id = $2", [input.workflow_id, userId]);
      if (!owned) throw new Error("Workflow not found");
      const limit = Math.min(Math.max(Number(input.limit) || 3, 1), 5);
      const rows = await query("SELECT * FROM executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2", [input.workflow_id, limit]);
      return rows.map((row) => {
        const execution = executionFromRow(row);
        return {
          id: execution.id,
          status: execution.status,
          mode: execution.mode,
          startedAt: execution.startedAt,
          error: execution.error,
          steps: execution.steps.map((s) => ({
            nodeId: s.nodeId,
            name: s.name,
            status: s.status,
            error: s.error,
            input: truncate(s.input),
            output: truncate(s.output),
          })),
        };
      });
    }
    case "list_credentials":
      return query("SELECT id, type, name FROM credentials WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    case "create_workflow": {
      const workflowName = String(input.name || "سيناريو جديد").slice(0, 120);
      const id = await insertWorkflow(userId, workflowName, sanitizeGraph(input.graph));
      actions.push({ type: "workflow_created", workflowId: id, name: workflowName });
      return { created: true, id };
    }
    case "update_workflow":
      await updateInactiveWorkflow(userId, String(input.workflow_id), input.graph, input.name);
      actions.push({ type: "workflow_updated", workflowId: String(input.workflow_id) });
      return { updated: true };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

async function chat(userId: string, history: ChatMessage[], workflowId?: string) {
  const client = new Anthropic({ apiKey: config.assistantApiKey, maxRetries: 2 });
  const trimmed = history.filter((m) => m.text?.trim()).slice(-30);
  const firstUser = trimmed.findIndex((m) => m.role === "user");
  const messages: Anthropic.MessageParam[] = trimmed.slice(Math.max(firstUser, 0)).map((m) => ({ role: m.role, content: m.text }));
  if (!messages.length || messages[messages.length - 1].role !== "user") throw httpError(400, "ابعت رسالة الأول");
  if (workflowId) {
    const last = messages[messages.length - 1];
    last.content = `(المستخدم فاتح دلوقتي السيناريو رقم ${workflowId} في المحرر)\n\n${last.content as string}`;
  }

  // Stable prefix (instructions + node catalog) is cached across requests.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: `${INSTRUCTIONS}\n\n# كتالوج الخطوات المتاحة (JSON)\n${catalog()}`, cache_control: { type: "ephemeral" } },
  ];
  const actions: AssistantAction[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: any;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system,
        messages,
        tools: TOOLS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw httpError(429, "المساعد عليه ضغط دلوقتي - جرّب كمان دقيقة");
      if (error instanceof Anthropic.AuthenticationError) throw httpError(503, "مفتاح المساعد (ANTHROPIC_API_KEY) غلط");
      if (error instanceof Anthropic.APIError) throw httpError(502, `المساعد مش متاح دلوقتي: ${error.message}`);
      throw error;
    }

    if (response.stop_reason === "refusal") {
      return { reply: "معلش، مقدرش أساعد في الطلب ده.", actions };
    }
    if (response.stop_reason === "tool_use" || response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        try {
          const output = await runTool(block.name, block.input ?? {}, userId, actions);
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
        } catch (error) {
          results.push({ type: "tool_result", tool_use_id: block.id, content: errorMessage(error), is_error: true });
        }
      }
      if (results.length) messages.push({ role: "user", content: results });
      continue;
    }
    const reply = response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text as string)
      .join("\n")
      .trim();
    return { reply: reply || "خلصت.", actions };
  }
  return { reply: "الطلب ده طوّل أكتر من اللازم - جرّب تقسّمه لخطوات أصغر.", actions };
}

export async function assistantRoutes(app: FastifyInstance) {
  app.get("/api/assistant/status", async (req) => {
    const access = await assistantAccess(req);
    return access.ok ? { available: true } : { available: false, reason: access.reason };
  });

  app.post("/api/assistant/chat", async (req) => {
    const access = await assistantAccess(req);
    if (!access.ok) {
      throw httpError(403, access.reason === "plan" ? "المساعد الذكي متاح في الباقة الاحترافية" : "المساعد الذكي مش متضبط على المنصة");
    }
    const body = (req.body ?? {}) as { messages?: ChatMessage[]; workflowId?: string };
    if (!Array.isArray(body.messages)) throw httpError(400, "messages مطلوبة");
    return chat(req.user.id, body.messages, typeof body.workflowId === "string" ? body.workflowId : undefined);
  });
}
