/** Every template, after wiring: no content box left empty when an earlier step can fill it. */
const base = new URL("../dist/", import.meta.url).href;
const { templates } = await import(base + "templates.js");
const { getNode } = await import(base + "nodes/index.js");
const { wireGraph } = await import(base + "engine/autofill.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));
const NOTE = /^\s*(اكتب|حدد|سيب|ضع|\(اكتب)/;
const unwired = (v) => v === undefined || v === null || (typeof v === "string" ? !v.trim() || NOTE.test(v) : Array.isArray(v) && !v.length);

const hasAncestor = (graph, id) => graph.edges.some((e) => e.target === id);
let wiredBoxes = 0;

for (const t of templates) {
  const before = t.graph;
  const after = wireGraph(structuredClone(before), getNode);
  check(after.nodes.length === before.nodes.length, `${t.id}: wiring kept every step`);

  for (const node of after.nodes) {
    const def = getNode(node.type);
    const fields = (def?.fields ?? []).filter((f) => f.autoFill);
    if (!fields.length || !hasAncestor(after, node.id)) continue;
    const old = before.nodes.find((n) => n.id === node.id);
    for (const field of fields) {
      if (unwired(old.params?.[field.key]) && !unwired(node.params?.[field.key])) wiredBoxes++;
      // What a customer had already written must never be replaced.
      const wasWritten = typeof old.params?.[field.key] === "string" && old.params[field.key].trim() && !NOTE.test(old.params[field.key]);
      if (wasWritten) check(node.params[field.key] === old.params[field.key], `${t.id}/${node.id}.${field.key}: overwrote what was already there`);
    }
  }

  // The steps that publish must end up holding a caption and something to publish.
  for (const node of after.nodes) {
    if (!["social.publishAll", "instagram.post", "facebook.post", "telegram.sendAlbum", "uploadpost.post"].includes(node.type)) continue;
    if (!hasAncestor(after, node.id)) continue;
    const def = getNode(node.type);
    const captionKey = def.fields.find((f) => f.autoFill === "caption")?.key;
    const mediaKey = def.fields.find((f) => f.autoFill === "image" || f.autoFill === "images")?.key;
    const videoKey = def.fields.find((f) => f.autoFill === "video")?.key;
    if (captionKey) check(!unwired(node.params?.[captionKey]), `${t.id}/${node.id}: no caption (${captionKey})`);
    if (mediaKey) {
      const media = !unwired(node.params?.[mediaKey]) || (videoKey && !unwired(node.params?.[videoKey]));
      check(media, `${t.id}/${node.id}: nothing to publish (${mediaKey})`);
    }
  }
}

console.log(`${pass} passed, ${fail.length} failed, ${wiredBoxes} boxes wired automatically`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
