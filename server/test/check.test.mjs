/** Sanity checks over the built server: every template step exists and every guide is reachable. */
import { templates } from "../dist/templates.js";
import { nodeDefinitions, credentialTypes, getNode } from "../dist/nodes/index.js";

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const credKeys = new Set(credentialTypes.map((c) => c.key));

// Every step in every template is a real step, with real credential types.
for (const t of templates) {
  check(typeof t.id === "string" && t.id.length > 2, `template id: ${t.id}`);
  check(t.graph.nodes.length > 0, `${t.id}: has steps`);
  for (const node of t.graph.nodes) {
    const def = getNode(node.type);
    check(Boolean(def), `${t.id}: unknown step ${node.type}`);
    for (const key of def?.credentialTypes ?? []) check(credKeys.has(key), `${t.id}: unknown account type ${key}`);
    for (const key of Object.keys(node.params ?? {})) {
      const known = def?.fields.some((f) => f.key === key);
      check(known, `${t.id}/${node.type}: unknown setting ${key}`);
    }
  }
  // Edges point at steps that exist.
  const ids = new Set(t.graph.nodes.map((n) => n.id));
  for (const e of t.graph.edges) check(ids.has(e.source) && ids.has(e.target), `${t.id}: edge ${e.source}->${e.target}`);
}
check(new Set(templates.map((t) => t.id)).size === templates.length, "template ids are unique");
check(templates.filter((t) => t.category === "النشر").length >= 8, "publishing templates are there");

// No customer-facing placeholder still shows raw {{...}} syntax.
for (const def of nodeDefinitions) {
  for (const field of def.fields) {
    check(!/\{\{/.test(field.placeholder ?? ""), `${def.type}.${field.key}: placeholder still shows an expression`);
    check(!/\.$/.test((field.help ?? "").trim()), `${def.type}.${field.key}: help ends with a full stop`);
  }
  check(!/\.$/.test(def.description.trim()), `${def.type}: description ends with a full stop`);
}

// The new steps exist.
for (const type of ["instagram.post", "facebook.post", "telegram.sendAlbum", "social.publishAll"]) {
  check(Boolean(getNode(type)), `step ${type} exists`);
}
const ig = credentialTypes.find((c) => c.key === "instagramBusiness");
check(ig?.fields.find((f) => f.key === "igUserId")?.required !== true, "Instagram id is optional now");
check((ig?.steps?.length ?? 0) >= 8, "Instagram has a full setup guide");

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
