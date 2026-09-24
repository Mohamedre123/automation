/** Swapping a bot or a trigger re-points the reply, and a template's own number is never touched. */
const server = new URL("../dist/", import.meta.url).href;
const { getNode } = await import(server + "nodes/index.js");
const { wireGraph } = await import(server + "engine/autofill.js");
const { templates } = await import(server + "templates.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

/* The editor's own wiring, read from the web source so both stay honest about the same rules. */
const { readFileSync } = await import("node:fs");
const graphSource = readFileSync("E:/شغل/شغل خارجي لسابقة اعمالي/موقع نظام الاتمته/web/src/editor/graph.ts", "utf8");
check(graphSource.includes('case "replyTo"'), "the editor knows how to work out a recipient");
check(graphSource.includes("wasender.trigger"), "a WhatsApp trigger is a source for it");
check(graphSource.includes("telegram.trigger"), "a Telegram trigger is a source for it");
check(graphSource.includes("FORM_PHONE"), "a form's phone field is a source for it");

/* Every step that sends to somebody knows its recipient box. */
for (const [type, key] of [
  ["wasender.send", "to"],
  ["whatsapp.send", "to"],
  ["telegram.sendMessage", "chatId"],
  ["telegram.sendPhoto", "chatId"],
  ["telegram.sendAlbum", "chatId"],
  ["telegram.sendVideo", "chatId"],
]) {
  check(getNode(type).fields.find((f) => f.key === key)?.autoFill === "replyTo", `${type}.${key} is a recipient`);
}

/* The server must never fill it: a template leaves that box empty on purpose - it is the owner's number. */
{
  const graph = {
    nodes: [
      {
        id: "1",
        type: "trigger.form",
        position: { x: 0, y: 0 },
        params: { formFields: [{ key: "phone", value: "رقم الواتساب" }] },
      },
      { id: "2", type: "wasender.send", position: { x: 280, y: 0 }, params: { to: "", messageType: "text", text: "نبّهني" } },
    ],
    edges: [{ id: "e1-2", source: "1", target: "2", sourceHandle: null }],
  };
  const wired = wireGraph(graph, getNode).nodes[1].params;
  check(wired.to === "", `the owner's own number is left empty (got "${wired.to}")`);
  check(wired.text === "نبّهني", "the message is untouched");
}

/* And the templates that alert the owner still have an empty recipient after wiring. */
{
  const lead = templates.find((t) => t.id === "lead-followup-agent");
  const alert = wireGraph(structuredClone(lead.graph), getNode).nodes.find((n) => n.name === "نبّهني أنا");
  check(alert?.params.to === "", `lead template: the alert still goes to whoever you put (got "${alert?.params.to}")`);
  const reply = wireGraph(structuredClone(lead.graph), getNode).nodes.find((n) => n.name === "رد للعميل");
  check(reply?.params.to === "{{1.data.phone}}", "lead template: the customer reply still goes to the customer");
}

/* The competitor report leaves as a real Word file. */
{
  const watch = templates.find((t) => t.id === "competitor-watch");
  const send = watch.graph.nodes.find((n) => n.type === "wasender.send");
  check(send.params.messageType === "document", "the report is sent as a document");
  check(send.params.mediaUrl === "{{5.wordUrl}}", `the document is the Word file (got ${send.params.mediaUrl})`);
  check(/\.docx$/.test(send.params.fileName), "it arrives with a .docx name");
  check(send.params.text.includes("{{5.url}}"), "the page is offered too");

  const research = watch.graph.nodes.find((n) => n.name === "البحث في النت");
  check(research.params.search === true, "the research step searches the web");
  for (const topic of ["الأسعار", "السوشيال ميديا", "الموقع الإلكتروني", "رأي العملاء"]) {
    check(research.params.system.includes(topic), `research covers: ${topic}`);
  }
  const write = watch.graph.nodes.find((n) => n.name === "كتابة التقرير");
  for (const section of ["## الأسعار", "## السوشيال ميديا", "## المواقع والتجربة", "## العملاء بيقولوا إيه", "## خطة 30 يوم"]) {
    check(write.params.system.includes(section), `report has a section: ${section}`);
  }
  check(write.params.maxTokens >= 20000, `the report has room to be long (got ${write.params.maxTokens})`);
}

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
