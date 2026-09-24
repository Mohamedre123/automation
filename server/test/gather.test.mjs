/**
 * Waiting: two branches that meet again, and a loop whose rounds get collected.
 * Run through the real executor, on real scenarios, so the order and the counts are the real ones.
 */
const base = new URL("../dist/", import.meta.url).href;
const { executeWorkflow } = await import(base + "engine/executor.js");
const { query } = await import(base + "db.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const stamp = new Date().toISOString();
await query("DELETE FROM users WHERE email = $1", ["gather@local.test"]);
await query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [
  "u-gather",
  "gather@local.test",
  "تجربة",
  "x",
  stamp,
]);
await query("INSERT INTO workflows (id, user_id, name, graph, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)", [
  "w-gather",
  "u-gather",
  "تجربة",
  JSON.stringify({ nodes: [], edges: [] }),
  stamp,
  stamp,
]);

const edge = (s, t, h = null) => ({ id: `e${s}-${t}${h ?? ""}`, source: s, target: t, sourceHandle: h });
const go = async (nodes, edges) => {
  const run = await executeWorkflow({
    workflow: { id: "w-gather", userId: "u-gather", name: "تجربة", graph: { nodes, edges } },
    mode: "manual",
  });
  return run;
};
const at = (run, id) => run.steps.filter((s) => s.nodeId === id);
const text = (id, value) => ({ id, type: "logic.set", name: `ثابت ${id}`, position: { x: 0, y: 0 }, params: { values: [{ key: "text", value }] } });

/* What "logic.set" gives back, so the test reads what the platform really produces. */
{
  const run = await go([{ id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} }, text("2", "مرحبا")], [edge("1", "2")]);
  check(run.status === "success", `a plain scenario runs (${run.error ?? ""})`);
  check(at(run, "2")[0]?.output?.text === "مرحبا", `and a value step gives its value (${JSON.stringify(at(run, "2")[0]?.output)})`);
}

/* ---- Two branches that meet again ---- */

/* Without waiting, the step after two branches runs twice. That is the problem being fixed. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      text("2", "فرع أول"),
      text("3", "فرع تاني"),
      text("4", "بعدهم"),
    ],
    [edge("1", "2"), edge("1", "3"), edge("2", "4"), edge("3", "4")],
  );
  check(at(run, "4").length === 2, `today a plain step after two branches runs twice (${at(run, "4").length})`);
}

/* With the waiting step, it runs once - and knows what both branches said. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      text("2", "فرع أول"),
      text("3", "فرع تاني"),
      { id: "4", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {} },
      text("5", "بعد ما الاتنين خلصوا"),
    ],
    [edge("1", "2"), edge("1", "3"), edge("2", "4"), edge("3", "4"), edge("4", "5")],
  );
  check(run.status === "success", `the scenario runs (${run.error ?? ""})`);
  const merge = at(run, "4");
  check(merge.length === 1, `the waiting step runs exactly once (${merge.length})`);
  check(merge[0].output.count === 2, `and it waited for both branches (${merge[0].output.count})`);
  const said = merge[0].output.items.map((i) => i?.text);
  check(said.includes("فرع أول") && said.includes("فرع تاني"), `and has what each branch said (${JSON.stringify(said)})`);
  check(at(run, "5").length === 1, `so the step after it runs once, not twice (${at(run, "5").length})`);
}

/* Three branches, to prove it is not hard-coded to two. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      text("2", "أ"),
      text("3", "ب"),
      text("4", "ج"),
      { id: "5", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {} },
    ],
    [edge("1", "2"), edge("1", "3"), edge("1", "4"), edge("2", "5"), edge("3", "5"), edge("4", "5")],
  );
  check(at(run, "5").length === 1 && at(run, "5")[0].output.count === 3, `three branches, one run (${at(run, "5")[0]?.output?.count})`);
}

/* A branch that is never taken must not hang the scenario forever. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      {
        id: "2",
        type: "logic.if",
        name: "سؤال",
        position: { x: 0, y: 0 },
        params: { conditions: [{ left: "a", op: "equals", right: "a" }] },
      },
      text("3", "فرع أيوه"),
      text("4", "فرع لأ"),
      { id: "5", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {} },
    ],
    [edge("1", "2"), edge("2", "3", "true"), edge("2", "4", "false"), edge("3", "5"), edge("4", "5")],
  );
  check(run.status === "success", `a scenario with an untaken branch still finishes (${run.error ?? ""})`);
  check(at(run, "4").length === 0, "the branch that was not taken did not run");
  check(at(run, "5").length === 1, `and the waiting step still ran (${at(run, "5").length})`);
  check(at(run, "5")[0].output.count === 1, `with the one branch that did arrive (${at(run, "5")[0].output.count})`);
}

/* A branch that fails must not hang it either. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      text("2", "الفرع السليم"),
      {
        id: "3",
        type: "http.request",
        name: "فرع بيفشل",
        position: { x: 0, y: 0 },
        params: { method: "GET", url: "http://127.0.0.1:1/nope", timeoutSeconds: 3 },
        continueOnFail: false,
      },
      { id: "4", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {} },
    ],
    [edge("1", "2"), edge("1", "3"), edge("2", "4"), edge("3", "4")],
  );
  check(run.status === "error", "a failing branch still fails the run, as it should");
  check(at(run, "3")[0]?.status === "error", "and the failure is recorded on the step that failed");
}

/* ---- A loop whose rounds are collected ---- */

const listScenario = (collectParams) => [
  { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
  {
    id: "2",
    type: "logic.iterator",
    name: "تكرار",
    position: { x: 0, y: 0 },
    params: { list: JSON.stringify([{ name: "أحمد" }, { name: "سارة" }, { name: "محمد" }]), limit: 100 },
  },
  { id: "3", type: "logic.set", name: "لكل واحد", position: { x: 0, y: 0 }, params: { values: [{ key: "line", value: "أهلاً {{2.name}}" }] } },
  { id: "4", type: "logic.collect", name: "اجمع", position: { x: 0, y: 0 }, params: collectParams },
];
const listEdges = [edge("1", "2"), edge("2", "3"), edge("3", "4")];

/* The loop body runs per item; the collecting step runs once, at the end, with all of them. */
{
  const run = await go(listScenario({ field: "line", separator: "lines" }), listEdges);
  check(run.status === "success", `the loop runs (${run.error ?? ""})`);
  check(at(run, "3").length === 3, `the body ran once per item (${at(run, "3").length})`);
  const collect = at(run, "4");
  check(collect.length === 1, `the collecting step ran once, not once per item (${collect.length})`);
  check(collect[0].output.count === 3, `and it has all three rounds (${collect[0].output.count})`);
  check(
    collect[0].output.text === "أهلاً أحمد\nأهلاً سارة\nأهلاً محمد",
    `and they are in the loop's own order (${JSON.stringify(collect[0].output.text)})`,
  );
}

/* It comes last: nothing after the loop is left half-done when it fires. */
{
  const run = await go(listScenario({ field: "line" }), listEdges);
  const order = run.steps.map((s) => s.nodeId).join("");
  check(order === "1233234" || order === "1232334" || /4$/.test(order), `it fires after every round (order: ${order})`);
}

/* The other ways to write the list out. */
{
  for (const [separator, expected] of [
    ["bullets", "- أهلاً أحمد\n- أهلاً سارة\n- أهلاً محمد"],
    ["numbered", "1. أهلاً أحمد\n2. أهلاً سارة\n3. أهلاً محمد"],
    ["comma", "أهلاً أحمد، أهلاً سارة، أهلاً محمد"],
  ]) {
    const run = await go(listScenario({ field: "line", separator }), listEdges);
    check(at(run, "4")[0].output.text === expected, `${separator}: ${JSON.stringify(at(run, "4")[0].output.text)}`);
  }
}

/* No field named: the whole result of each round is kept. */
{
  const run = await go(listScenario({}), listEdges);
  const items = at(run, "4")[0].output.items;
  check(items.length === 3 && items[0].line === "أهلاً أحمد", `without a field it keeps each round whole (${JSON.stringify(items[0])})`);
}

/* A loop over nothing does not break the step after it. */
{
  const nodes = listScenario({ field: "line" });
  nodes[1].params.list = "[]";
  const run = await go(nodes, listEdges);
  check(run.status === "success", `an empty list is not an error (${run.error ?? ""})`);
  check(at(run, "3").length === 0, "the body did not run");
  check(at(run, "4").length === 0, "and nothing was collected, so the step never fired");
}

/* Collecting, then using what was collected. */
{
  const nodes = [...listScenario({ field: "line" }), { id: "5", type: "logic.set", name: "بعد الجمع", position: { x: 0, y: 0 }, params: { values: [{ key: "all", value: "{{4.text}}" }] } }];
  const run = await go(nodes, [...listEdges, edge("4", "5")]);
  check(at(run, "5").length === 1, `the step after the collecting step runs once (${at(run, "5").length})`);
  check(at(run, "5")[0].output.all.includes("أهلاً سارة"), `and can read what was collected (${at(run, "5")[0].output.all})`);
}

/* Both at once: a loop that collects, inside a scenario that also merges branches. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      { id: "2", type: "logic.iterator", name: "تكرار", position: { x: 0, y: 0 }, params: { list: JSON.stringify(["أ", "ب"]), limit: 10 } },
      { id: "3", type: "logic.set", name: "لكل واحد", position: { x: 0, y: 0 }, params: { values: [{ key: "line", value: "عنصر {{2.value}}" }] } },
      { id: "4", type: "logic.collect", name: "اجمع", position: { x: 0, y: 0 }, params: { field: "line" } },
      text("5", "الفرع التاني"),
      { id: "6", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {} },
    ],
    [edge("1", "2"), edge("1", "5"), edge("2", "3"), edge("3", "4"), edge("4", "6"), edge("5", "6")],
  );
  check(run.status === "success", `both together run (${run.error ?? ""})`);
  check(at(run, "4").length === 1 && at(run, "4")[0].output.count === 2, `the loop collected its rounds (${at(run, "4")[0]?.output?.count})`);
  check(at(run, "6").length === 1 && at(run, "6")[0].output.count === 2, `and the merge waited for both (${at(run, "6")[0]?.output?.count})`);
}

/* A waiting step that is switched off is skipped like any other. */
{
  const run = await go(
    [
      { id: "1", type: "trigger.manual", position: { x: 0, y: 0 }, params: {} },
      text("2", "أ"),
      { id: "3", type: "logic.merge", name: "استنى", position: { x: 0, y: 0 }, params: {}, disabled: true },
    ],
    [edge("1", "2"), edge("2", "3")],
  );
  check(at(run, "3")[0]?.status === "skipped", `a switched-off waiting step is skipped (${at(run, "3")[0]?.status})`);
  check(run.status === "success", "and does not hang the run");
}

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
