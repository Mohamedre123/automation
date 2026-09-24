/**
 * The MCP link, driven through the real HTTP routes in-process:
 *  - one account's link can never see, change, run or start another account's scenarios
 *  - a graph an agent sends without arrows, or with every step on one spot, arrives joined and spread out
 *  - "try again if it fails" survives a save from the editor and from an agent
 */
import { createServer } from "node:http";

const base = new URL("../dist/", import.meta.url).href;
const { buildApp } = await import(base + "app.js");
const { query } = await import(base + "db.js");
const { sha256 } = await import(base + "crypto.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const app = await buildApp();
await app.ready();

/* Two separate customers, each signed in. */
const stamp = new Date().toISOString();
const later = new Date(Date.now() + 86_400_000).toISOString();
const person = async (key) => {
  const id = `u-${key}`;
  const token = `session-${key}-${Math.random().toString(36).slice(2)}`;
  await query("DELETE FROM users WHERE email = $1", [`${key}@local.test`]);
  await query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [id, `${key}@local.test`, key, "x", stamp]);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), id, later]);
  return { id, token };
};
const A = await person("owner-a");
const B = await person("owner-b");

const api = async (who, method, url, payload) => {
  const res = await app.inject({ method, url, headers: who ? { authorization: `Bearer ${who.token}` } : {}, payload });
  let body;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
};

/* Each makes their own MCP link. */
const link = async (who) => {
  const made = await api(who, "POST", "/api/mcp/toolboxes", { name: "تدفّق", mode: "build" });
  if (made.status !== 200) throw new Error(`cannot make a link: ${JSON.stringify(made.body)}`);
  return new URL(made.body.url).pathname;
};
const linkA = await link(A);
const linkB = await link(B);
check(linkA !== linkB, "two accounts get two different links");

let rpcId = 0;
const tool = async (path, name, args = {}) => {
  const res = await app.inject({ method: "POST", url: path, payload: { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } } });
  const out = res.json();
  const text = out?.result?.content?.[0]?.text ?? JSON.stringify(out?.error ?? "");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { isError: out?.result?.isError === true || Boolean(out?.error), data, text, status: res.statusCode };
};

const manual = { id: "1", type: "trigger.manual", name: "يدوي", position: { x: 0, y: 0 }, params: {} };
const set = (id, value, position = { x: 0, y: 0 }) => ({ id, type: "logic.set", name: `خطوة ${id}`, position, params: { values: [{ key: "text", value }] } });

/* ================= Isolation ================= */

const createdByA = await tool(linkA, "create_scenario", {
  name: "سيناريو العميل أ",
  graph: { nodes: [manual, set("2", "أ", { x: 280, y: 0 })], edges: [{ id: "e1-2", source: "1", target: "2", sourceHandle: null }] },
});
check(!createdByA.isError && createdByA.data.created, `A's agent builds a scenario (${createdByA.text.slice(0, 100)})`);
const idA = createdByA.data.id;

{
  const mineA = await tool(linkA, "list_scenarios");
  check(mineA.data.some((w) => w.id === idA), "it shows up in A's agent's list");
  const appA = await api(A, "GET", "/api/workflows");
  check(JSON.stringify(appA.body).includes(idA), "and in A's account in the app");

  const mineB = await tool(linkB, "list_scenarios");
  check(Array.isArray(mineB.data), `B's list is a real list (${typeof mineB.data})`);
  check(!mineB.data.some((w) => w.id === idA), "it does NOT show up in B's agent's list");
  const appB = await api(B, "GET", "/api/workflows");
  check(!JSON.stringify(appB.body).includes(idA), "and NOT in B's account in the app");
}

/* B's agent tries everything it can on A's scenario. */
for (const [name, args] of [
  ["get_scenario", { scenario_id: idA }],
  ["update_scenario", { scenario_id: idA, name: "اتسرق", graph: { nodes: [manual], edges: [] } }],
  ["set_scenario_active", { scenario_id: idA, active: true }],
  ["run_scenario", { scenario_id: idA }],
  ["get_runs", { scenario_id: idA }],
]) {
  const tried = await tool(linkB, name, args);
  check(tried.isError, `B's agent cannot ${name} A's scenario (${tried.text.slice(0, 60)})`);
}
{
  const still = await tool(linkA, "get_scenario", { scenario_id: idA });
  check(still.data.name === "سيناريو العميل أ", `A's scenario kept its name after B's attempts (${still.data.name})`);
  check(still.data.graph.nodes.length === 2, "and its steps");
  check(still.data.active === false, "and B could not switch it on");
  const runs = await query("SELECT count(*)::int AS n FROM executions WHERE workflow_id = $1", [idA]);
  check(runs[0].n === 0, `and B could not run it (${runs[0].n} runs)`);
}

/* B's own template lands in B's account only. */
{
  const templates = await tool(linkB, "list_templates");
  const made = await tool(linkB, "use_template", { template_id: templates.data[0].id });
  check(!made.isError, "B's agent can use a template");
  const owner = await query("SELECT user_id FROM workflows WHERE id = $1", [made.data.id]);
  check(owner[0]?.user_id === B.id, `and it lands in B's account (${owner[0]?.user_id})`);
  const mineA = await tool(linkA, "list_scenarios");
  check(!mineA.data.some((w) => w.id === made.data.id), "not in A's");
}

/* An agent cannot borrow another account's connected service by guessing its id. */
{
  let seenAuth = [];
  const service = createServer((req, res) => {
    seenAuth.push(req.headers.authorization ?? "");
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise((done) => service.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${service.address().port}/`;

  const secret = await api(B, "POST", "/api/credentials", { type: "httpBearer", name: "مفتاح B", data: { token: "B-SECRET-TOKEN" } });
  check(secret.status === 200, `B connects a service (${secret.status})`);
  const credB = secret.body.id;

  const accountsA = await tool(linkA, "list_accounts");
  check(!JSON.stringify(accountsA.data).includes(credB), "A's agent does not see B's accounts");
  const accountsB = await tool(linkB, "list_accounts");
  check(JSON.stringify(accountsB.data).includes(credB), "B's agent sees B's own account");
  check(!JSON.stringify(accountsB.data).includes("B-SECRET-TOKEN"), "and never the secret itself");

  const stolen = await tool(linkA, "create_scenario", {
    name: "محاولة",
    graph: {
      nodes: [
        manual,
        { id: "2", type: "http.request", name: "طلب", position: { x: 280, y: 0 }, params: { method: "GET", url }, credentialId: credB },
      ],
      edges: [{ id: "e1-2", source: "1", target: "2", sourceHandle: null }],
    },
  });
  const ran = await tool(linkA, "run_scenario", { scenario_id: stolen.data.id });
  check(ran.data.status === "error", `running with B's account id fails for A (${ran.data.status})`);
  check(/اتمسح|الحساب/.test(ran.data.error ?? ""), `and it fails because the account is not A's (${ran.data.error})`);
  check(!seenAuth.some((h) => h.includes("B-SECRET-TOKEN")), `and B's secret never left the platform (${JSON.stringify(seenAuth)})`);
  service.close();
}

/* A link that was replaced stops working at once. */
{
  const boxes = await api(A, "GET", "/api/mcp/toolboxes");
  const box = (boxes.body.toolboxes ?? boxes.body)[0];
  const rotated = await api(A, "POST", `/api/mcp/toolboxes/${box.id}/rotate`);
  check(rotated.status === 200, "A can replace the link");
  const old = await app.inject({ method: "POST", url: linkA, payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  check(old.statusCode === 404, `the old link is dead (${old.statusCode})`);
}

/* ================= Arranging what an agent sends ================= */

const linkA2 = await link(A);
const arrows = (g) => g.edges.map((e) => `${e.source}>${e.target}${e.sourceHandle ? ":" + e.sourceHandle : ""}`).sort().join(" ");
const spread = (g) => {
  const seen = new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`));
  return seen.size === g.nodes.length;
};

/* The ChatGPT case: steps, no arrows, all at 0,0. */
{
  const made = await tool(linkA2, "create_scenario", {
    name: "بدون أسهم",
    graph: { nodes: [manual, set("2", "أ"), set("3", "ب"), set("4", "ج")], edges: [] },
  });
  check(!made.isError, `a scenario with no arrows is accepted (${made.text.slice(0, 80)})`);
  check(Array.isArray(made.data.tidied) && made.data.tidied.length === 2, `and the agent is told what was fixed (${JSON.stringify(made.data.tidied)})`);
  const back = (await tool(linkA2, "get_scenario", { scenario_id: made.data.id })).data.graph;
  check(arrows(back) === "1>2 2>3 3>4", `the steps are joined in the order written (${arrows(back)})`);
  check(spread(back), `and no two steps share a spot (${back.nodes.map((n) => n.position.x + "," + n.position.y).join(" | ")})`);
  const xs = ["1", "2", "3", "4"].map((id) => back.nodes.find((n) => n.id === id).position.x);
  check(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3], `left to right in order (${xs.join(", ")})`);

  const run = await tool(linkA2, "run_scenario", { scenario_id: made.data.id });
  check(run.data.status === "success" && run.data.steps.length === 4, `and it actually runs every step now (${run.data.steps?.length} steps)`);
}

/* A question with no arrows: the step after it goes on its first free exit. */
{
  const made = await tool(linkA2, "create_scenario", {
    name: "سؤال",
    graph: {
      nodes: [
        manual,
        { id: "2", type: "logic.if", name: "سؤال", position: { x: 0, y: 0 }, params: { conditions: [{ left: "a", op: "equals", right: "a" }] } },
        set("3", "أيوه"),
      ],
      edges: [],
    },
  });
  const back = (await tool(linkA2, "get_scenario", { scenario_id: made.data.id })).data.graph;
  check(arrows(back) === "1>2 2>3:true", `a question's next step hangs off its "yes" exit (${arrows(back)})`);
}

/* Only the missing arrow is added; the agent's own arrows stay. */
{
  const made = await tool(linkA2, "create_scenario", {
    name: "ناقص سهم",
    graph: {
      nodes: [manual, set("2", "أ", { x: 280, y: 0 }), set("3", "ب", { x: 560, y: 0 }), set("4", "ج", { x: 840, y: 0 })],
      edges: [
        { id: "e1-2", source: "1", target: "2", sourceHandle: null },
        { id: "e1-3", source: "1", target: "3", sourceHandle: null },
      ],
    },
  });
  const back = (await tool(linkA2, "get_scenario", { scenario_id: made.data.id })).data.graph;
  check(arrows(back) === "1>2 1>3 3>4", `only the missing arrow is added (${arrows(back)})`);
  check(made.data.tidied?.length === 1, `and the note says only that (${JSON.stringify(made.data.tidied)})`);
}

/* A graph the agent got right is left exactly as it was. */
{
  const right = {
    nodes: [manual, set("2", "أ", { x: 280, y: -160 }), set("3", "ب", { x: 280, y: 160 })],
    edges: [
      { id: "e1-2", source: "1", target: "2", sourceHandle: null },
      { id: "e1-3", source: "1", target: "3", sourceHandle: null },
    ],
  };
  const made = await tool(linkA2, "create_scenario", { name: "صح", graph: right });
  check(made.data.tidied === undefined, "a correct graph gets no 'tidied' note");
  const back = (await tool(linkA2, "get_scenario", { scenario_id: made.data.id })).data.graph;
  check(arrows(back) === "1>2 1>3", "its arrows are untouched");
  check(back.nodes.find((n) => n.id === "2").position.y === -160, "and so are its positions");
}

/* Branches that meet again: the meeting step sits after both of them, not beside one. */
{
  const made = await tool(linkA2, "create_scenario", {
    name: "فرعين",
    graph: {
      nodes: [manual, set("2", "أ"), set("3", "ب"), set("4", "طويل"), { id: "5", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {} }],
      edges: [
        { id: "a", source: "1", target: "2", sourceHandle: null },
        { id: "b", source: "1", target: "3", sourceHandle: null },
        { id: "c", source: "3", target: "4", sourceHandle: null },
        { id: "d", source: "2", target: "5", sourceHandle: null },
        { id: "e", source: "4", target: "5", sourceHandle: null },
      ],
    },
  });
  const back = (await tool(linkA2, "get_scenario", { scenario_id: made.data.id })).data.graph;
  const x = (id) => back.nodes.find((n) => n.id === id).position.x;
  check(x("5") > x("4") && x("4") > x("3"), `the meeting step comes after the longer branch (${[2, 3, 4, 5].map((i) => x(String(i))).join(", ")})`);
  check(spread(back), "and nothing overlaps");
}

/* ================= "Try again if it fails" survives saving ================= */
{
  const withRetry = {
    nodes: [manual, { ...set("2", "أ", { x: 280, y: 0 }), retries: 3, retryWaitSeconds: 7 }],
    edges: [{ id: "e1-2", source: "1", target: "2", sourceHandle: null }],
  };
  const made = await tool(linkA2, "create_scenario", { name: "إعادة", graph: withRetry });
  const back = (await tool(linkA2, "get_scenario", { scenario_id: made.data.id })).data.graph.nodes.find((n) => n.id === "2");
  check(back.retries === 3 && back.retryWaitSeconds === 7, `an agent's retry setting is kept (${back.retries}/${back.retryWaitSeconds})`);

  const saved = await api(A, "PUT", `/api/workflows/${made.data.id}`, { graph: withRetry });
  check(saved.status === 200, `the editor saves it (${saved.status})`);
  const afterEditor = saved.body.graph.nodes.find((n) => n.id === "2");
  check(afterEditor.retries === 3 && afterEditor.retryWaitSeconds === 7, `and the editor's save keeps it too (${afterEditor.retries}/${afterEditor.retryWaitSeconds})`);

  const silly = await api(A, "PUT", `/api/workflows/${made.data.id}`, {
    graph: { ...withRetry, nodes: [manual, { ...set("2", "أ", { x: 280, y: 0 }), retries: 99, retryWaitSeconds: 99999 }] },
  });
  const capped = silly.body.graph.nodes.find((n) => n.id === "2");
  check(capped.retries === 5 && capped.retryWaitSeconds === 120, `silly numbers are capped (${capped.retries}/${capped.retryWaitSeconds})`);

  const none = await api(A, "PUT", `/api/workflows/${made.data.id}`, { graph: { ...withRetry, nodes: [manual, set("2", "أ", { x: 280, y: 0 })] } });
  const clean = none.body.graph.nodes.find((n) => n.id === "2");
  check(clean.retries === undefined && clean.retryWaitSeconds === undefined, "and a step without it saves exactly as before");
}

await app.close();
console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
