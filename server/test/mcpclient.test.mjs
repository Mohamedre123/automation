/**
 * Connecting somebody else's MCP server to a scenario - the Higgsfield case.
 * A real MCP server is stood up here (plain JSON and streamed, both), and the step talks to it
 * the way it would talk to any service on the internet.
 */
import { createServer } from "node:http";

const base = new URL("../dist/", import.meta.url).href;
const { nodeDefinitions } = await import(base + "nodes/index.js");
const { wireGraph } = await import(base + "engine/autofill.js");
const { getNode } = await import(base + "nodes/index.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const node = nodeDefinitions.find((d) => d.type === "mcp.callTool");
check(Boolean(node), "the step exists");

/* A pretend image service that speaks MCP. */
let lastAuth = "";
let lastBody = null;
let reply = () => ({});
let stream = false;
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const message = JSON.parse(raw);
    lastAuth = req.headers.authorization ?? "";
    if (message.method === "tools/call") lastBody = message;
    if (!message.id) {
      res.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "pretend-images", version: "1" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "generate_image", description: "بيعمل صورة" }, { name: "generate_video", description: "بيعمل فيديو" }] }
          : reply(message);
    const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
    if (stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "s1" });
      res.end(`event: message\ndata: ${body}\n\n`);
    } else {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
      res.end(body);
    }
  });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/mcp`;
const credential = { id: "c1", type: "mcpServer", data: { url, token: "secret-key" } };
const run = (params) => node.run({ params, credential, signal: AbortSignal.timeout(10_000) });

/* Testing the connection is what the customer presses first. */
{
  const { credentialTypes } = await import(base + "nodes/index.js");
  const type = credentialTypes.find((c) => c.key === "mcpServer");
  const message = await type.test(credential.data);
  check(/2/.test(message), `the connection test counts the tools (${message})`);
}

/* Seeing what the service can do. */
{
  const out = await run({ operation: "list" });
  check(out.output.count === 2, `the step lists the tools (${out.output.count})`);
  check(out.output.tools[0].name === "generate_image", "with their names");
  check(lastAuth === "Bearer secret-key", `and the key is sent (${lastAuth})`);
}

/* An image handed back as a link in structured output - the commonest shape. */
{
  reply = () => ({ content: [{ type: "text", text: "اتعملت" }], structuredContent: { image_url: "https://cdn.test/a.png" } });
  const out = await run({ operation: "call", tool: "generate_image", arguments: { prompt: "قطة" }, returns: "image" });
  check(out.output.url === "https://cdn.test/a.png", `the picture's link comes out ready to use (${out.output.url})`);
  check(out.output.text === "اتعملت", "and the words the service said");
  check(lastBody.params.arguments.prompt === "قطة", "and the inputs really went out");
}

/* An image handed back as an image block. */
{
  reply = () => ({ content: [{ type: "image", uri: "https://cdn.test/b.jpg", mimeType: "image/jpeg" }] });
  const out = await run({ operation: "call", tool: "generate_image", arguments: {}, returns: "image" });
  check(out.output.url === "https://cdn.test/b.jpg", `an image block works too (${out.output.url})`);
}

/* Bytes inline instead of a link. */
{
  reply = () => ({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] });
  const out = await run({ operation: "call", tool: "generate_image", arguments: {}, returns: "image" });
  check(out.output.url.startsWith("data:image/png;base64,AAAA"), `bytes come back usable (${out.output.url.slice(0, 40)})`);
}

/* A link written inside the reply, because some services just write it. */
{
  reply = () => ({ content: [{ type: "text", text: "جاهزة: https://cdn.test/c.mp4 اتفرج" }] });
  const out = await run({ operation: "call", tool: "generate_video", arguments: {}, returns: "video" });
  check(out.output.url === "https://cdn.test/c.mp4", `a link in the text is found (${out.output.url})`);
}

/* Several results: the first is the one, but all of them are kept. */
{
  reply = () => ({ content: [], structuredContent: { outputs: ["https://cdn.test/1.png", "https://cdn.test/2.png"] } });
  const out = await run({ operation: "call", tool: "generate_image", arguments: {}, returns: "image" });
  check(out.output.urls.length === 2, `all the pictures are kept (${out.output.urls.length})`);
  check(out.output.url === "https://cdn.test/1.png", "and the first is the ready one");
}

/* Asked for a picture and got words: say so instead of handing a publish step nothing. */
{
  reply = () => ({ content: [{ type: "text", text: "مش عارف أعمل صورة" }] });
  const out = await run({ operation: "call", tool: "generate_image", arguments: {}, returns: "image" }).catch((e) => e);
  check(out instanceof Error, "a tool that returns no picture is an error");
  check(/مرجّعتش رابط صورة/.test(out.message), `and the message says what to do (${out.message.slice(0, 80)})`);
}

/* Words are still words: no link needed. */
{
  reply = () => ({ content: [{ type: "text", text: "رد عادي" }] });
  const out = await run({ operation: "call", tool: "ask", arguments: {}, returns: "text" });
  check(out.output.text === "رد عادي" && out.output.url === "", "a text tool still works as it did");
}

/* The step the service answers over a stream, which half of them do. */
{
  stream = true;
  reply = () => ({ content: [{ type: "text", text: "من ستريم" }], structuredContent: { url: "https://cdn.test/s.png" } });
  const out = await run({ operation: "call", tool: "generate_image", arguments: {}, returns: "image" });
  check(out.output.url === "https://cdn.test/s.png", `a streamed answer is read (${out.output.url})`);
  stream = false;
}

/* The tool failing is the scenario failing, with the service's own words. */
{
  reply = () => ({ content: [{ type: "text", text: "الرصيد خلص" }], isError: true });
  const out = await run({ operation: "call", tool: "generate_image", arguments: {}, returns: "image" }).catch((e) => e);
  check(out instanceof Error && /الرصيد خلص/.test(out.message), `the service's own reason reaches the customer (${out.message})`);
}

/* And the whole point: the publish step after it fills itself in. */
{
  const graph = {
    nodes: [
      { id: "1", type: "trigger.manual", name: "يدوي", position: { x: 0, y: 0 }, params: {} },
      { id: "2", type: "mcp.callTool", name: "هيجزفيلد", position: { x: 280, y: 0 }, params: { operation: "call", tool: "generate_image", returns: "image" } },
      { id: "3", type: "instagram.post", name: "نشر", position: { x: 560, y: 0 }, params: {} },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2", sourceHandle: null },
      { id: "e2-3", source: "2", target: "3", sourceHandle: null },
    ],
  };
  const wired = wireGraph(graph, getNode);
  const publish = wired.nodes.find((n) => n.id === "3");
  check(publish.params.imageUrl === "{{2.url}}", `the picture wires itself into publishing (${publish.params.imageUrl})`);

  const textOnly = wireGraph(
    { ...graph, nodes: graph.nodes.map((n) => (n.id === "2" ? { ...n, params: { ...n.params, returns: "text" } } : n)) },
    getNode,
  );
  check(!textOnly.nodes.find((n) => n.id === "3").params.imageUrl, "and a text tool is not mistaken for a picture");
}

server.close();
console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
