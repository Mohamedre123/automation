/** Matching columns to incoming data by name. */
const base = new URL("../dist/", import.meta.url).href;
const { matchByName, nameKey, flatten, cell, asRecord } = await import(base + "nodes/mapping.js");
const { getNode } = await import(base + "nodes/index.js");
const { wireGraph } = await import(base + "engine/autofill.js");
const { resolveParams } = await import(base + "engine/expressions.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

/* Names match past case, spaces, underscores and the usual Arabic spellings. */
check(nameKey("Full Name") === nameKey("full_name"), "spaces and underscores");
check(nameKey("التليفون") === nameKey(" التليفون "), "surrounding spaces");
check(nameKey("أحمد") === nameKey("احمد"), "hamza");
check(nameKey("قناه") === nameKey("قناة"), "ta marbuta");
check(nameKey("مستوي") === nameKey("مستوى"), "alef maqsura");
check(nameKey("Email") !== nameKey("Emails"), "different names stay different");

/* A form's answers sit one level down and still find their column. */
{
  const record = { data: { الاسم: "أحمد", التليفون: "01000000000" }, submittedAt: "2026-01-01" };
  const m = matchByName(["الاسم", "التليفون", "submittedAt"], record);
  check(m.values["الاسم"] === "أحمد", `nested name (got ${m.values["الاسم"]})`);
  check(m.values["التليفون"] === "01000000000", "nested phone");
  check(m.values.submittedAt === "2026-01-01", "top level value");
  check(m.missing.length === 0, `nothing missing (got ${m.missing})`);
}

/* A column with nothing to fill it is reported, not silently blank. */
{
  const m = matchByName(["الاسم", "المدينة"], { الاسم: "منى", ملاحظات: "عميل قديم" });
  check(m.values["المدينة"] === "", "unmatched column is empty");
  check(m.missing.includes("المدينة"), "the empty column is named");
  check(m.unused.includes(nameKey("ملاحظات")), `data with no column is named (got ${m.unused})`);
}

/* Values that are not text still read properly in a cell. */
check(cell(["أحمر", "أزرق"]) === "أحمر, أزرق", "a list becomes text");
check(cell(42) === "42" && cell(true) === "true", "numbers and yes/no");
check(cell(null) === "" && cell(undefined) === "", "nothing becomes empty");
check(cell({ a: 1 }) === '{"a":1}', "an object keeps its shape");

/* Private keys never become columns. */
check(!flatten({ _row: 2, name: "x" }).has(nameKey("_row")), "internal keys skipped");

/* Text that holds JSON is accepted too. */
check(asRecord('{"a":1}')?.a === 1, "JSON text");
check(asRecord("just text") === null, "plain text is not a record");
check(asRecord([1, 2]) === null, "a list is not a record");

/* The three steps offer the choice, default to automatic, and take the data by themselves. */
for (const [type, dataKey] of [["sheets.append", "record"], ["airtable.create", "record"], ["notion.createPage", "record"]]) {
  const def = getNode(type);
  const mode = def.fields.find((f) => f.key === "mode");
  check(mode?.default === "auto", `${type}: automatic by default`);
  check(def.fields.find((f) => f.key === dataKey)?.autoFill === "record", `${type}: takes the previous result`);
}

/* Wiring writes the previous step into the data box, and the engine resolves it to the object. */
{
  const graph = {
    nodes: [
      { id: "1", type: "trigger.form", position: { x: 0, y: 0 }, params: { formFields: [{ key: "name", value: "الاسم" }] } },
      { id: "2", type: "sheets.append", position: { x: 280, y: 0 }, params: { spreadsheetId: "x", sheet: "Sheet1", mode: "auto" } },
    ],
    edges: [{ id: "e1-2", source: "1", target: "2", sourceHandle: null }],
  };
  const wired = wireGraph(graph, getNode).nodes[1];
  check(wired.params.record === "{{1}}", `data box wired (got ${wired.params.record})`);

  const scope = { outputs: { 1: { data: { name: "أحمد" }, submittedAt: "2026-01-01" } }, vars: {} };
  const resolved = resolveParams(getNode("sheets.append").fields, wired.params, scope);
  check(resolved.record?.data?.name === "أحمد", `the whole result arrives as an object (got ${JSON.stringify(resolved.record)})`);
}

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
