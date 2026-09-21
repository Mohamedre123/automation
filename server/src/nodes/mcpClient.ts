import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { config } from "../config.js";
import { assertAllowedUrl, errorMessage } from "./util.js";

/* Calls tools on any remote MCP server (Streamable HTTP): initialize, then tools/list or tools/call. */

const PROTOCOL = "2025-06-18";

export const mcpServerCredential: CredentialType = {
  key: "mcpServer",
  name: "خادم MCP خارجي",
  app: "mcp",
  description: "أي خادم MCP على الإنترنت (Streamable HTTP): رابطه، ومفتاح لو محتاج",
  fields: [
    { key: "url", label: "رابط خادم MCP", required: true, placeholder: "https://example.com/mcp" },
    { key: "token", label: "مفتاح / توكن (اختياري)", secret: true, help: "بيتبعت كـ Authorization: Bearer ..." },
  ],
  steps: [
    "هات رابط خادم MCP من الخدمة اللي عايز تستخدمها (بيبقى مكتوب في صفحة الـ MCP أو الـ Integrations عندهم)",
    "لو الخدمة إدتك مفتاح أو توكن، حطه في خانة المفتاح",
    "دوس «اختبار الاتصال»: هيظهرلك عدد الأدوات المتاحة",
  ],
  async test(data) {
    const session = await mcpSession({ id: "", type: "mcpServer", data }, AbortSignal.timeout(20_000));
    const list = await session.call("tools/list", {});
    return `متصل ✓ - فيه ${(list.tools ?? []).length} أداة`;
  },
};

async function readRpc(response: Response, id: number) {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    // Streamed reply: find the JSON-RPC message with our id among the SSE events.
    const text = await response.text();
    for (const block of text.split(/\n\n/)) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const message = JSON.parse(data);
        if (message.id === id) return message;
      } catch {
        /* not JSON */
      }
    }
    throw new Error("خادم MCP مرجّعش رد");
  }
  return response.json();
}

async function mcpSession(credential: CredentialValue, signal: AbortSignal) {
  const url = String(credential.data.url ?? "").trim();
  if (!/^https?:\/\//.test(url)) throw new Error("رابط خادم MCP لازم يبدأ بـ https://");
  assertAllowedUrl(url, config.blockPrivateUrls);
  let sessionId = "";
  let nextId = 1;
  const headers = () => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
    ...(credential.data.token ? { authorization: `Bearer ${credential.data.token}` } : {}),
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  });
  const send = async (method: string, params: unknown, notify = false) => {
    const id = nextId++;
    const response = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
      signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error("خادم MCP رفض المفتاح");
    if (!response.ok && response.status !== 202) throw new Error(`خادم MCP: HTTP ${response.status}`);
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    if (notify) return undefined;
    const message = await readRpc(response, id);
    if (message.error) throw new Error(`خادم MCP: ${message.error.message ?? "خطأ"}`);
    return message.result;
  };
  await send("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "tadfuq", version: "1.0.0" } });
  await send("notifications/initialized", {}, true).catch(() => undefined);
  return { call: (method: string, params: unknown) => send(method, params) };
}

export const mcpClientNode: NodeDefinition = {
  type: "mcp.callTool",
  name: "أداة من خادم MCP",
  description: "بيشغّل أداة من أي خادم MCP (خدمات بتدعم MCP، أو Toolbox من حساب تدفّق تاني) ويرجّع نتيجتها",
  app: "mcp",
  appName: "MCP",
  color: "#0f766e",
  group: "apps",
  kind: "action",
  credentialTypes: ["mcpServer"],
  fields: [
    {
      key: "operation",
      label: "العملية",
      type: "select",
      default: "call",
      options: [
        { value: "call", label: "شغّل أداة" },
        { value: "list", label: "اعرض الأدوات المتاحة" },
      ],
    },
    { key: "tool", label: "اسم الأداة", type: "text", placeholder: "search_docs", showIf: { field: "operation", values: ["call"] }, help: "شغّل «اعرض الأدوات» مرة عشان تعرف الأسماء" },
    {
      key: "arguments",
      label: "المدخلات (JSON)",
      type: "json",
      placeholder: '{ "query": "السؤال" }',
      help: "ودوس زرار البيانات جوه الخانة عشان تحط قيمة من خطوة قبلها",
      showIf: { field: "operation", values: ["call"] },
    },
  ],
  sampleOutput: { text: "نتيجة الأداة...", content: [{ type: "text", text: "نتيجة الأداة..." }], structured: null, isError: false },
  async run({ params, credential, signal }) {
    const session = await mcpSession(credential!, signal);
    if (params.operation === "list") {
      const result = await session.call("tools/list", {});
      const tools = (result.tools ?? []).map((t: any) => ({ name: t.name, title: t.title ?? "", description: t.description ?? "" }));
      return { output: { tools, count: tools.length } };
    }
    const name = String(params.tool ?? "").trim();
    if (!name) throw new Error("اكتب اسم الأداة");
    let args: unknown = params.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = args.trim() ? JSON.parse(args) : {};
      } catch (error) {
        throw new Error(`المدخلات مش JSON صحيح: ${errorMessage(error)}`);
      }
    }
    const result = await session.call("tools/call", { name, arguments: args });
    const content: any[] = result.content ?? [];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (result.isError) throw new Error(text || "الأداة رجّعت خطأ");
    return { output: { text, content, structured: result.structuredContent ?? null, isError: false } };
  },
};
