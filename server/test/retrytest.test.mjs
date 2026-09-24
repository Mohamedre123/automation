/**
 * Retry and wait, exercised the way a customer's scenario would: a real HTTP step against a
 * real server that is down for a moment, a wrong key that must not be retried, a cancelled
 * run, and the wait step actually waiting.
 */
import { createServer } from "node:http";

const base = new URL("../dist/", import.meta.url).href;
const { executeWorkflow } = await import(base + "engine/executor.js");
const { nodeDefinitions } = await import(base + "nodes/index.js");
const { query } = await import(base + "db.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

/* The service the scenario calls: we decide how many times it is "down" before it answers. */
let calls = 0;
let downFor = 0;
let downStatus = 503;
const server = createServer((req, res) => {
  calls++;
  if (downFor-- > 0) {
    res.writeHead(downStatus, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not now" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, calls }));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/thing`;

/* A run is written to the database, so the account and the scenario have to really exist. */
const stamp = new Date().toISOString();
await query("DELETE FROM users WHERE email = $1", ["retrytest@local.test"]);
await query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [
  "u-retry",
  "retrytest@local.test",
  "تجربة",
  "x",
  stamp,
]);
await query("INSERT INTO workflows (id, user_id, name, graph, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING", [
  "w-retry",
  "u-retry",
  "تجربة",
  JSON.stringify({ nodes: [], edges: [] }),
  stamp,
  stamp,
]);

const workflow = (node) => ({
  id: "w-retry",
  userId: "u-retry",
  name: "تجربة",
  graph: {
    nodes: [
      { id: "1", type: "trigger.manual", name: "يدوي", position: { x: 0, y: 0 }, params: {} },
      { id: "2", name: "الخطوة", position: { x: 280, y: 0 }, params: {}, ...node },
    ],
    edges: [{ id: "e1-2", source: "1", target: "2", sourceHandle: null }],
  },
});
const http = (extra = {}) => ({ type: "http.request", params: { method: "GET", url, timeoutSeconds: 5 }, ...extra });
const step2 = (run) => run.steps.find((s) => s.nodeId === "2");

/* A service that is down for a moment: the step tries again and gets there. */
{
  calls = 0;
  downFor = 2;
  const run = await executeWorkflow({ workflow: workflow(http({ retries: 3, retryWaitSeconds: 1 })), mode: "manual" });
  const s = step2(run);
  check(s.status === "success", `a step that failed twice ends up succeeding (${s.status}: ${s.error ?? ""})`);
  check(calls === 3, `the service was really called three times (${calls})`);
  check(s.attempts === 3, `and the log says how many tries it took (attempts: ${s.attempts})`);
  check(s.output?.data?.ok === true, "and the answer it kept is the good one");
}

/* Down for good: it fails in the end, and the log shows what it cost. */
{
  calls = 0;
  downFor = 99;
  const run = await executeWorkflow({ workflow: workflow(http({ retries: 2, retryWaitSeconds: 1 })), mode: "manual" });
  const s = step2(run);
  check(s.status === "error", "a service that never answers fails in the end");
  check(calls === 3, `it stopped when the tries ran out (${calls})`);
  check(s.attempts === 3, `and the log counts them (attempts: ${s.attempts})`);
  check(/503/.test(s.error ?? ""), `and says what the service said (${(s.error ?? "").slice(0, 60)})`);
}

/* A wrong key fails the same way every time - retrying it only makes the user wait. */
{
  calls = 0;
  downFor = 99;
  downStatus = 401;
  const started = Date.now();
  const run = await executeWorkflow({ workflow: workflow(http({ retries: 5, retryWaitSeconds: 20 })), mode: "manual" });
  check(step2(run).status === "error", "a wrong key still fails");
  check(calls === 1, `and it was not retried (${calls} call/s)`);
  check(Date.now() - started < 5000, `so nobody waits for nothing (${Date.now() - started}ms)`);
  downStatus = 503;
}

/* Nothing set = exactly what happened before this feature existed. */
{
  calls = 0;
  downFor = 99;
  const run = await executeWorkflow({ workflow: workflow(http()), mode: "manual" });
  check(step2(run).status === "error" && calls === 1, `without retries a step runs once (${calls})`);
  check(step2(run).attempts === undefined, "and the log stays as clean as it was");
}

/* Cancelling a run does not leave it sitting there retrying. */
{
  calls = 0;
  downFor = 99;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const started = Date.now();
  await executeWorkflow({ workflow: workflow(http({ retries: 5, retryWaitSeconds: 30 })), mode: "manual", signal: controller.signal });
  check(Date.now() - started < 6000, `cancelling stops the retries (${Date.now() - started}ms)`);
}

/* The wait step: it waits, and it is honest about how long. */
{
  const started = Date.now();
  const run = await executeWorkflow({ workflow: workflow({ type: "logic.delay", params: { seconds: 2 } }), mode: "manual" });
  const elapsed = Date.now() - started;
  const s = step2(run);
  check(s.status === "success", `the wait step runs (${s.error ?? ""})`);
  check(s.output?.waitedSeconds === 2, `and reports the wait (${JSON.stringify(s.output)})`);
  check(elapsed >= 1900 && elapsed < 6000, `and really waited (${elapsed}ms)`);
}

/* Nobody can make a scenario sit for an hour, whatever they type in the box. */
{
  const def = nodeDefinitions.find((d) => d.type === "logic.delay");
  check(def.timeoutMs <= 150_000, `the wait step cannot outlive the run (${def.timeoutMs}ms)`);
  const zero = await def.run({ params: { seconds: 0 } });
  check(zero.output.waitedSeconds === 0, `zero means no wait (${zero.output.waitedSeconds})`);
  const huge = await def.run({ params: { seconds: 99999 }, signal: AbortSignal.timeout(500) }).catch((e) => e);
  check(huge instanceof Error, "and a silly number is cut off, not honoured");
}

server.close();
console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
