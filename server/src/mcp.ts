import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { randomToken, sha256 } from "./crypto.js";
import { newId, now, one, parseJson, query, run } from "./db.js";
import { executeWorkflow } from "./engine/executor.js";
import type { WebhookResponse, WorkflowGraph } from "./engine/types.js";
import { httpError, requireString } from "./errors.js";
import { errorMessage, keyValueRows } from "./nodes/util.js";
import { rateLimit } from "./protection.js";
import { rowToWorkflow, triggerInfo } from "./triggers/manager.js";

/*
 * MCP server (Streamable HTTP, JSON responses). A toolbox is a named set of the customer's scenarios with
 * its own secret URL; AI clients (Claude, ChatGPT, Cursor...) list them as tools and run them.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const RUNNABLE = ["trigger.webhook", "trigger.form", "trigger.manual"];
export const mcpUrl = (token: string) => `${config.publicUrl}/mcp/${token}`;

interface ToolboxRow {
  id: string;
  user_id: string;
  name: string;
  token_hint: string;
  workflow_ids: string;
  created_at: string;
  last_used_at: string | null;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  workflowId: string;
}

/** Scenarios in the toolbox that an AI client can start: webhook, form or manual trigger. */
async function toolboxTools(toolbox: ToolboxRow): Promise<Tool[]> {
  const ids = parseJson<string[]>(toolbox.workflow_ids, []);
  if (!ids.length) return [];
  const rows = await query("SELECT * FROM workflows WHERE user_id = $1 AND id = ANY($2::text[])", [toolbox.user_id, ids]);
  const tools: Tool[] = [];
  for (const row of rows) {
    const workflow = rowToWorkflow(row);
    const info = triggerInfo(workflow.graph);
    if (!info || !RUNNABLE.includes(info.node.type)) continue;
    let inputSchema: Record<string, unknown>;
    if (info.node.type === "trigger.form") {
      const fields = keyValueRows(info.node.params?.formFields);
      inputSchema = {
        type: "object",
        properties: Object.fromEntries(fields.map((f) => [f.key, { type: "string", description: String(f.value || f.key) }])),
      };
    } else {
      inputSchema = { type: "object", description: "البيانات اللي السيناريو محتاجها (أي حقول)", additionalProperties: true };
    }
    tools.push({
      name: `scenario_${workflow.id.replace(/-/g, "").slice(0, 12)}`,
      title: workflow.name,
      description: `${workflow.name}${row.description ? ` - ${row.description}` : ""}`.slice(0, 900),
      inputSchema,
      workflowId: workflow.id,
    });
  }
  return tools;
}

async function runTool(toolbox: ToolboxRow, tool: Tool, args: Record<string, unknown>) {
  const row = await one("SELECT * FROM workflows WHERE id = $1 AND user_id = $2", [tool.workflowId, toolbox.user_id]);
  if (!row) throw new Error("السيناريو اتمسح");
  const workflow = rowToWorkflow(row);
  const info = triggerInfo(workflow.graph)!;
  const request = { method: "POST", headers: { "content-type": "application/json" }, query: {}, body: args };
  let triggerOutput: unknown;
  if (info.node.type === "trigger.manual") triggerOutput = { triggeredAt: now(), data: args };
  else if (info.def.webhook) triggerOutput = info.def.webhook.parse(request, { params: info.node.params ?? {}, secretToken: "" } as any)[0];
  else triggerOutput = request;

  let responded: WebhookResponse | undefined;
  const record = await executeWorkflow({ workflow, triggerOutput, mode: "manual", respond: (response) => (responded = response) });
  if (record.status === "error") return { isError: true, text: record.error ?? "السيناريو فشل" };
  const last = [...record.steps].reverse().find((s) => s.status === "success");
  const result = responded?.body ?? last?.output ?? { done: true };
  return { isError: false, text: typeof result === "string" ? result : JSON.stringify(result, null, 2), structured: typeof result === "object" ? result : undefined };
}

type RpcMessage = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

async function handleRpc(toolbox: ToolboxRow, message: RpcMessage) {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id ?? null, result });
  const fail = (code: number, text: string) => ({ jsonrpc: "2.0", id: message.id ?? null, error: { code, message: text } });
  switch (message.method) {
    case "initialize": {
      const requested = String(message.params?.protocolVersion ?? "");
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tadfuq", title: `تدفّق - ${toolbox.name}`, version: "1.0.0" },
        instructions: "كل أداة هنا سيناريو أتمتة على منصة تدفّق. ابعت البيانات المطلوبة وهيرجعلك ناتج التشغيل",
      });
    }
    case "ping":
      return reply({});
    case "tools/list": {
      const tools = await toolboxTools(toolbox);
      return reply({ tools: tools.map(({ workflowId, ...tool }) => tool) });
    }
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const tool = (await toolboxTools(toolbox)).find((t) => t.name === name);
      if (!tool) return fail(-32602, `مفيش أداة اسمها ${name}`);
      const args = message.params?.arguments && typeof message.params.arguments === "object" ? message.params.arguments : {};
      try {
        const out = await runTool(toolbox, tool, args);
        return reply({
          content: [{ type: "text", text: out.text }],
          ...(out.structured && !Array.isArray(out.structured) ? { structuredContent: out.structured } : {}),
          isError: out.isError,
        });
      } catch (error) {
        return reply({ content: [{ type: "text", text: errorMessage(error) }], isError: true });
      }
    }
    default:
      return message.method?.startsWith("notifications/") ? null : fail(-32601, `Method not found: ${message.method}`);
  }
}

/** Public endpoint the AI clients talk to. The secret in the URL identifies the toolbox. */
export async function mcpServerRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/:token",
    handler: async (req, reply) => {
      const { token } = req.params as { token: string };
      const toolbox = await one<ToolboxRow>("SELECT * FROM mcp_toolboxes WHERE token_hash = $1", [sha256(token)]);
      if (!toolbox) return reply.status(404).send({ error: "رابط MCP غلط أو اتلغى" });
      // No server-initiated stream: plain request/response only.
      if (req.method === "GET") return reply.status(405).header("allow", "POST").send();
      if (req.method === "DELETE") return reply.status(200).send();
      await rateLimit(`mcp:${toolbox.id}`, 120, 60);
      void run("UPDATE mcp_toolboxes SET last_used_at = $1 WHERE id = $2", [now(), toolbox.id]).catch(() => undefined);

      const body = req.body as RpcMessage | RpcMessage[] | undefined;
      if (!body || typeof body !== "object") return reply.status(400).send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      const messages = Array.isArray(body) ? body : [body];
      const results = (await Promise.all(messages.map((m) => handleRpc(toolbox, m)))).filter(Boolean);
      if (!results.length) return reply.status(202).send();
      reply.header("content-type", "application/json");
      return reply.send(Array.isArray(body) ? results : results[0]);
    },
  });
}

/* ---------- toolbox management (logged in) ---------- */
const toToolbox = (row: ToolboxRow) => ({
  id: row.id,
  name: row.name,
  tokenHint: row.token_hint,
  workflowIds: parseJson<string[]>(row.workflow_ids, []),
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const newToken = () => `tdq_${randomToken(24)}`;

export async function mcpToolboxRoutes(app: FastifyInstance) {
  const owned = async (userId: string, id: string) => {
    const row = await one<ToolboxRow>("SELECT * FROM mcp_toolboxes WHERE id = $1 AND user_id = $2", [id, userId]);
    if (!row) throw httpError(404, "الـ Toolbox مش موجود");
    return row;
  };
  const cleanIds = async (userId: string, value: unknown) => {
    const ids = Array.isArray(value) ? value.map(String).slice(0, 50) : [];
    if (!ids.length) return [];
    const rows = await query<{ id: string; graph: string }>("SELECT id, graph FROM workflows WHERE user_id = $1 AND id = ANY($2::text[])", [userId, ids]);
    return rows.filter((r) => RUNNABLE.includes(triggerInfo(parseJson<WorkflowGraph>(r.graph, { nodes: [], edges: [] }))?.node.type ?? "")).map((r) => r.id);
  };

  app.get("/api/mcp/toolboxes", async (req) => {
    const rows = await query<ToolboxRow>("SELECT * FROM mcp_toolboxes WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
    const workflows = await query<{ id: string; name: string; graph: string; active: number }>(
      "SELECT id, name, graph, active FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC",
      [req.user.id],
    );
    return {
      toolboxes: rows.map(toToolbox),
      scenarios: workflows.map((w) => {
        const type = triggerInfo(parseJson<WorkflowGraph>(w.graph, { nodes: [], edges: [] }))?.node.type ?? "";
        return { id: w.id, name: w.name, trigger: type, usable: RUNNABLE.includes(type) };
      }),
      baseUrl: `${config.publicUrl}/mcp/`,
    };
  });

  app.post("/api/mcp/toolboxes", async (req) => {
    const body = (req.body ?? {}) as { name?: string; workflowIds?: unknown };
    const name = requireString(body.name, "اسم الـ Toolbox", 80);
    const count = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM mcp_toolboxes WHERE user_id = $1", [req.user.id]);
    if ((count?.n ?? 0) >= 20) throw httpError(400, "وصلت للحد الأقصى (20 Toolbox)");
    const token = newToken();
    const id = newId();
    await run(
      "INSERT INTO mcp_toolboxes (id, user_id, name, token_hash, token_hint, workflow_ids, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, req.user.id, name, sha256(token), token.slice(-4), JSON.stringify(await cleanIds(req.user.id, body.workflowIds)), now()],
    );
    return { toolbox: toToolbox(await owned(req.user.id, id)), url: mcpUrl(token) };
  });

  app.put("/api/mcp/toolboxes/:id", async (req) => {
    const row = await owned(req.user.id, (req.params as { id: string }).id);
    const body = (req.body ?? {}) as { name?: string; workflowIds?: unknown };
    const name = body.name === undefined ? row.name : requireString(body.name, "اسم الـ Toolbox", 80);
    const ids = body.workflowIds === undefined ? parseJson<string[]>(row.workflow_ids, []) : await cleanIds(req.user.id, body.workflowIds);
    await run("UPDATE mcp_toolboxes SET name = $1, workflow_ids = $2 WHERE id = $3", [name, JSON.stringify(ids), row.id]);
    return { toolbox: toToolbox(await owned(req.user.id, row.id)) };
  });

  /** New secret URL: the old one stops working immediately. */
  app.post("/api/mcp/toolboxes/:id/rotate", async (req) => {
    const row = await owned(req.user.id, (req.params as { id: string }).id);
    const token = newToken();
    await run("UPDATE mcp_toolboxes SET token_hash = $1, token_hint = $2 WHERE id = $3", [sha256(token), token.slice(-4), row.id]);
    return { toolbox: toToolbox(await owned(req.user.id, row.id)), url: mcpUrl(token) };
  });

  app.delete("/api/mcp/toolboxes/:id", async (req) => {
    const row = await owned(req.user.id, (req.params as { id: string }).id);
    await run("DELETE FROM mcp_toolboxes WHERE id = $1", [row.id]);
    return { ok: true };
  });
}
