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

/*
 * Every MCP server hands a picture back its own way: an image block, a link in the text, or a
 * field in structured output that somebody called url or output or result. We look in all three
 * so a customer can connect an image service and just publish what it made.
 */
const LINK = /https?:\/\/[^\s"'<>)\]]+/g;
const MEDIA_KEY = /^(url|uri|link|src|image|image_?url|images|video|video_?url|audio_?url|output|outputs|result|results|data|file_?url|download_?url)$/i;

function mediaUrls(content: any[], structured: unknown, text: string): string[] {
  const found: string[] = [];
  const add = (value: unknown) => {
    const url = String(value ?? "").trim();
    if (/^(https?:\/\/|data:)/.test(url) && !found.includes(url)) found.push(url);
  };

  // An image or audio block: either a link to it, or the bytes inline.
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "image" || item.type === "audio") {
      if (item.data) add(`data:${item.mimeType ?? "image/png"};base64,${item.data}`);
      add(item.uri ?? item.url);
    }
    if (item.type === "resource_link") add(item.uri ?? item.url);
    if (item.type === "resource" && item.resource) add(item.resource.uri ?? item.resource.url);
  }

  // Structured output, whatever they named the field. Two levels down is as deep as it gets.
  const walk = (value: unknown, depth: number) => {
    if (depth > 3 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) (typeof item === "string" ? add(item) : walk(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (typeof inner === "string") {
        if (MEDIA_KEY.test(key)) add(inner);
      } else walk(inner, depth + 1);
    }
  };
  walk(structured, 0);

  // Last resort: a link written in the reply.
  if (!found.length) for (const match of text.match(LINK) ?? []) add(match);
  return found;
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
    {
      key: "returns",
      label: "الأداة دي بترجّع إيه؟",
      type: "select",
      default: "text",
      showIf: { field: "operation", values: ["call"] },
      options: [
        { value: "text", label: "كلام" },
        { value: "image", label: "صورة" },
        { value: "video", label: "فيديو" },
      ],
      help: "لو اخترت صورة أو فيديو، خطوة النشر أو الإرسال اللي بعدها هتاخد الناتج لوحدها من غير ما تكتب حاجة",
    },
  ],
  sampleOutput: {
    text: "نتيجة الأداة...",
    url: "https://example.com/result.png",
    urls: ["https://example.com/result.png"],
    content: [{ type: "text", text: "نتيجة الأداة..." }],
    structured: null,
    isError: false,
  },
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
    const urls = mediaUrls(content, result.structuredContent, text);
    const wants = String(params.returns ?? "text");
    if (wants !== "text" && !urls.length) {
      throw new Error(
        `الأداة «${name}» مرجّعتش رابط ${wants === "video" ? "فيديو" : "صورة"}. شغّل «اعرض الأدوات المتاحة» وشوف الأداة الصح، ` +
          `أو غيّر «الأداة دي بترجّع إيه؟» لـ «كلام». اللي رجع: ${(text || JSON.stringify(result.structuredContent ?? {})).slice(0, 200)}`,
      );
    }
    return { output: { text, url: urls[0] ?? "", urls, content, structured: result.structuredContent ?? null, isError: false } };
  },
};
