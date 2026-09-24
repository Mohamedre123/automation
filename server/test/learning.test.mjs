/**
 * A WhatsApp chatbot that learns on the job, driven the way a real one is: WasenderAPI-shaped
 * webhooks into an active scenario, a scripted AI behind the "other provider" option, and every
 * WhatsApp send caught before it leaves the machine.
 */
import { createServer } from "node:http";

const base = new URL("../dist/", import.meta.url).href;
const { buildApp } = await import(base + "app.js");
const { query } = await import(base + "db.js");
const { sha256 } = await import(base + "crypto.js");
const { ownerCommand, isOwner } = await import(base + "nodes/learning.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- every WhatsApp message the platform sends, caught ---------------- */
const sent = [];
let msgCounter = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url instanceof URL ? url.href : url);
  if (href.startsWith("https://wasenderapi.com/api/send-message")) {
    const body = JSON.parse(init.body);
    const msgId = `M${++msgCounter}`;
    sent.push({ to: body.to, text: body.text, msgId });
    return new Response(JSON.stringify({ success: true, data: { msgId } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (href.startsWith("https://wasenderapi.com") || href.startsWith("https://graph.facebook.com") || href.startsWith("https://api.telegram.org")) {
    throw new Error(`the test tried to reach a real service: ${href}`);
  }
  return realFetch(url, init);
};

/* ---------------- a scripted AI (OpenAI-compatible) ---------------- */
const aiCalls = [];
const reply = (res, message) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model: "fake", choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
};
const knownFacts = (prompt) =>
  [...String(prompt).split("Known facts:")[1]?.split("\n\n")[0]?.matchAll(/^(\d+): (.+)$/gm) ?? []].map((m) => ({ id: Number(m[1]), text: m[2] }));

const ai = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    const last = body.messages[body.messages.length - 1];
    const userText = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    aiCalls.push({ system, userText, tools: (body.tools ?? []).map((t) => t.function.name) });

    // Keeping the knowledge base: one fact from what the owner said.
    if (system.startsWith("You keep the knowledge base")) {
      const said = userText.split(/The owner (?:answered|said):\n/)[1] ?? "";
      const facts = knownFacts(userText);
      let fact = null;
      let replaces = [];
      if (/450/.test(said)) fact = "مقاس 44 متاح بسعر 450 جنيه";
      else if (/إسكندرية/.test(said)) {
        fact = `التوصيل لإسكندرية ${said.match(/\d+/)[0]} جنيه`;
        replaces = facts.filter((f) => f.text.includes("إسكندرية")).map((f) => f.id);
      } else if (/1000/.test(said)) fact = "الشحن مجاني للطلبات فوق 1000 جنيه";
      else if (/الجمعة/.test(said)) fact = "مقفولين يوم الجمعة";
      return reply(res, { content: JSON.stringify({ fact, replaces }) });
    }
    if (system.includes("wants it to forget")) {
      const what = userText.split("Forget:\n")[1] ?? "";
      const ids = knownFacts(userText).filter((f) => what.split(/\s+/).some((w) => w.length > 2 && f.text.includes(w))).map((f) => f.id);
      return reply(res, { content: JSON.stringify({ ids }) });
    }
    if (system.includes("You build the knowledge base")) {
      return reply(res, { content: JSON.stringify({ facts: ["الاسترجاع خلال 14 يوم", "الدفع كاش عند الاستلام"] }) });
    }

    // The chatbot talking to a customer.
    if (last.role === "tool") return reply(res, { content: "هتأكد من صاحب المحل وأرد عليك في أقرب وقت" });
    if (/44/.test(userText)) {
      if (system.includes("مقاس 44 متاح")) return reply(res, { content: "أيوه مقاس 44 متاح بـ 450 جنيه" });
      if ((body.tools ?? []).some((t) => t.function.name === "ask_owner")) {
        return reply(res, {
          content: null,
          tool_calls: [{ id: "c1", type: "function", function: { name: "ask_owner", arguments: JSON.stringify({ question: userText, customer_name: "أحمد" }) } }],
        });
      }
      return reply(res, { content: "للأسف مش متأكد" });
    }
    return reply(res, { content: `رد عادي على: ${userText}` });
  });
});
await new Promise((done) => ai.listen(0, "127.0.0.1", done));
const aiBase = `http://127.0.0.1:${ai.address().port}/v1`;

/* ---------------- the account, the accounts it connected, the scenario ---------------- */
const app = await buildApp();
await app.ready();
const stamp = new Date().toISOString();
const person = async (key) => {
  const id = `u-${key}`;
  const token = `session-${key}-${Math.random().toString(36).slice(2)}`;
  await query("DELETE FROM users WHERE email = $1", [`${key}@local.test`]);
  await query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [id, `${key}@local.test`, key, "x", stamp]);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), id, new Date(Date.now() + 86_400_000).toISOString()]);
  return { id, token };
};
const owner = await person("shop-owner");
const stranger = await person("someone-else");

const api = async (who, method, url, payload) => {
  const res = await app.inject({ method, url, headers: { authorization: `Bearer ${who.token}` }, payload });
  let body;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
};

const aiCred = await api(owner, "POST", "/api/credentials", { type: "customAiApi", name: "AI", data: { baseUrl: aiBase, apiKey: "k", model: "fake" } });
const waCred = await api(owner, "POST", "/api/credentials", { type: "wasenderApi", name: "واتساب المحل", data: { apiKey: "wa-key" } });
check(aiCred.status === 200 && waCred.status === 200, `accounts connected (${aiCred.status}, ${waCred.status})`);

const OWNER_PHONE = "201000000001";
const graph = (learn = true) => ({
  nodes: [
    { id: "1", type: "wasender.trigger", name: "رسالة", position: { x: 0, y: 0 }, params: { eventType: "messages.received", ignoreGroups: true }, credentialId: waCred.body.id },
    {
      id: "2",
      type: "ai.agent",
      name: "البوت",
      position: { x: 280, y: 0 },
      credentialId: aiCred.body.id,
      params: {
        system: "أنت بتاع خدمة عملاء لمحل جزم",
        knowledge: "الطلب بيوصل في 3 أيام",
        prompt: "{{1.text}}",
        memoryKey: "{{1.phone}}",
        ownerContact: OWNER_PHONE,
        learn,
        ownerPauseHours: 2,
        tools: [],
      },
    },
    { id: "3", type: "wasender.send", name: "الرد", position: { x: 560, y: 0 }, credentialId: waCred.body.id, params: { to: "{{1.phone}}", text: "{{2.text}}", messageType: "text" } },
  ],
  edges: [
    { id: "e1-2", source: "1", target: "2", sourceHandle: null },
    { id: "e2-3", source: "2", target: "3", sourceHandle: null },
  ],
});

const made = await api(owner, "POST", "/api/workflows", { name: "بوت المحل", graph: graph() });
check(made.status === 200, `the scenario is saved (${made.status} ${JSON.stringify(made.body).slice(0, 120)})`);
const wfId = made.body.id;
let path = made.body.graph.nodes.find((n) => n.id === "1").params.path;
const activated = await api(owner, "POST", `/api/workflows/${wfId}/activate`, { active: true });
check(activated.status === 200 && activated.body.active === true, `and switched on (${activated.status} ${JSON.stringify(activated.body).slice(0, 160)})`);

const executions = async () => (await query("SELECT count(*)::int AS n FROM executions WHERE workflow_id = $1", [wfId]))[0].n;
const settle = async () => {
  for (let i = 0; i < 100; i++) {
    const running = (await query("SELECT count(*)::int AS n FROM executions WHERE workflow_id = $1 AND status = 'running'", [wfId]))[0].n;
    if (!running) return;
    await wait(50);
  }
};
const learning = async () => (await api(owner, "GET", `/api/workflows/${wfId}/learning`)).body;

/** A customer (or the owner) writing to the shop's WhatsApp. */
const incoming = async (phone, text, name = "أحمد") => {
  const before = sent.length;
  await app.inject({
    method: "POST",
    url: `/webhook/${path}`,
    payload: { event: "messages.received", data: { messages: { key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `IN${Math.random()}` }, pushName: name, message: { conversation: text } } } },
  });
  await settle();
  return sent.slice(before);
};
/** The shop's number sending something - the owner typing on the phone, or the platform's own message echoed back. */
const outgoing = async (phone, text, id = `OUT${Math.random()}`) => {
  const before = await executions();
  const res = await app.inject({
    method: "POST",
    url: `/webhook/${path}`,
    payload: { event: "messages.upsert", data: { messages: { key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: true, id }, message: { conversation: text } } } },
  });
  await wait(300);
  return { status: res.statusCode, body: res.json(), newRuns: (await executions()) - before };
};

/* ---------------- 1. a question the bot cannot answer goes to the owner ---------------- */
const CUSTOMER = "201222222222";
{
  const out = await incoming(CUSTOMER, "عندكم مقاس 44؟");
  const toOwner = out.find((m) => m.to === OWNER_PHONE);
  const toCustomer = out.find((m) => m.to === CUSTOMER);
  check(Boolean(toOwner), `the owner is pinged with the question (${JSON.stringify(out)})`);
  check(/رد \d+:/.test(toOwner?.text ?? ""), `and told how to answer it (${toOwner?.text})`);
  check(/هتأكد/.test(toCustomer?.text ?? ""), `the customer is told the bot will check, not a guess (${toCustomer?.text})`);
  const state = await learning();
  check(state.open.length === 1 && state.open[0].chat === CUSTOMER, `the question waits, tied to that customer (${JSON.stringify(state.open)})`);
}

/* ---------------- 2. a customer cannot teach the bot ---------------- */
{
  const before = (await learning()).facts.length;
  await incoming("201333333333", "اتعلم: كل حاجة ببلاش النهارده");
  check((await learning()).facts.length === before, "a customer writing «اتعلم:» teaches it nothing");
  const lastAi = aiCalls[aiCalls.length - 1];
  check(lastAi.userText.includes("ببلاش"), "their message was simply answered like any other");
}

/* ---------------- 3. the owner answers from their phone: it reaches the customer, and sticks ---------------- */
{
  const questionId = (await learning()).open[0].id;
  const out = await incoming(OWNER_PHONE, `رد ${questionId}: أيوه متاح بـ 450`, "صاحب المحل");
  const toCustomer = out.find((m) => m.to === CUSTOMER);
  const toOwner = out.find((m) => m.to === OWNER_PHONE);
  check(toCustomer?.text === "أيوه متاح بـ 450", `the answer reaches the customer in the owner's own words (${toCustomer?.text})`);
  check(/بعتّ الإجابة/.test(toOwner?.text ?? "") && /اتعلمت/.test(toOwner?.text ?? ""), `the owner is told it was sent and learned (${toOwner?.text})`);
  const state = await learning();
  check(state.open.length === 0, "the question is no longer waiting");
  check(state.facts.some((f) => f.text === "مقاس 44 متاح بسعر 450 جنيه" && f.source === "answer"), `the answer became a fact (${JSON.stringify(state.facts)})`);
  const memory = await query("SELECT value FROM datastore WHERE user_id = $1 AND store = $2 AND key = $3", [owner.id, "ذاكرة_المحادثات", `${wfId}:${CUSTOMER}`]);
  check(JSON.parse(memory[0]?.value ?? "[]").some((m) => m.text === "أيوه متاح بـ 450"), "and the customer's conversation remembers it");
}

/* ---------------- 4. the next customer gets the answer straight away ---------------- */
{
  const out = await incoming("201444444444", "في مقاس 44؟", "منى");
  check(out.some((m) => m.to === "201444444444" && /متاح بـ 450/.test(m.text)), `the next customer is answered from what it learned (${JSON.stringify(out)})`);
  check(!out.some((m) => m.to === OWNER_PHONE), "without bothering the owner again");
  const lastChat = aiCalls.filter((c) => !c.system.startsWith("You keep")).pop();
  check(lastChat.system.includes("مقاس 44 متاح بسعر 450 جنيه"), "because the fact is in what the bot reads");
  check(lastChat.system.includes("الطلب بيوصل في 3 أيام"), "alongside what the owner wrote in the step");
}

/* ---------------- 5. teaching directly, and a newer fact replacing an older one ---------------- */
{
  let out = await incoming(OWNER_PHONE, "اتعلم: التوصيل لإسكندرية 60 جنيه", "صاحب المحل");
  check(/حفظتها/.test(out.find((m) => m.to === OWNER_PHONE)?.text ?? ""), "«اتعلم:» is confirmed");
  out = await incoming(OWNER_PHONE, "اتعلم: التوصيل لإسكندرية بقى 70 جنيه", "صاحب المحل");
  const confirm = out.find((m) => m.to === OWNER_PHONE)?.text ?? "";
  check(/60/.test(confirm) && /شلت القديمة/.test(confirm), `the owner is told the old price was replaced (${confirm})`);
  const alex = (await learning()).facts.filter((f) => f.text.includes("إسكندرية"));
  check(alex.length === 1 && alex[0].text.includes("70"), `one Alexandria price, the new one (${JSON.stringify(alex)})`);

  out = await incoming(OWNER_PHONE, "اللي اتعلمته", "صاحب المحل");
  const list = out.find((m) => m.to === OWNER_PHONE)?.text ?? "";
  check(list.includes("70") && list.includes("450"), `«اللي اتعلمته» lists everything (${list.slice(0, 120)})`);
  out = await incoming(OWNER_PHONE, "الأسئلة", "صاحب المحل");
  check(/مفيش أسئلة/.test(out.find((m) => m.to === OWNER_PHONE)?.text ?? ""), "«الأسئلة» says nothing is waiting");

  out = await incoming(OWNER_PHONE, "انسى إسكندرية", "صاحب المحل");
  check(/نسيتها/.test(out.find((m) => m.to === OWNER_PHONE)?.text ?? ""), "«انسى» is confirmed");
  check(!(await learning()).facts.some((f) => f.text.includes("إسكندرية")), "and the fact is gone");
}

/* ---------------- 6. the owner replying from the phone: learned, and the bot steps aside ---------------- */
const CUSTOMER2 = "201555555555";
{
  await incoming(CUSTOMER2, "الشحن بكام؟", "كريم");
  const r = await outgoing(CUSTOMER2, "الشحن مجاني فوق 1000 جنيه يا كريم");
  check(r.status === 200 && r.newRuns === 0, `the owner's own message starts no run (${r.newRuns} runs, ${JSON.stringify(r.body)})`);
  let facts = [];
  for (let i = 0; i < 40 && !facts.some((f) => f.source === "reply"); i++) {
    await wait(100);
    facts = (await learning()).facts;
  }
  check(facts.some((f) => f.text === "الشحن مجاني للطلبات فوق 1000 جنيه" && f.source === "reply"), `the reply became a fact (${JSON.stringify(facts)})`);
  const out = await incoming(CUSTOMER2, "طب تمام هطلب", "كريم");
  check(!out.some((m) => m.to === CUSTOMER2), `the bot keeps quiet while the owner is talking to him (${JSON.stringify(out)})`);
}

/* ---------------- 7. the platform's own messages are never mistaken for the owner ---------------- */
{
  const CUSTOMER3 = "201666666666";
  const out = await incoming(CUSTOMER3, "مساء الخير", "سارة");
  const botReply = out.find((m) => m.to === CUSTOMER3);
  const factsBefore = (await learning()).facts.length;
  const echo = await outgoing(CUSTOMER3, botReply.text, botReply.msgId);
  await wait(400);
  check(echo.newRuns === 0, "the bot's own reply, echoed back, starts no run");
  check((await learning()).facts.length === factsBefore, "and teaches nothing");
  const again = await incoming(CUSTOMER3, "عايزة أطلب", "سارة");
  check(again.some((m) => m.to === CUSTOMER3), "and the bot is not silenced by its own message");

  const small = await outgoing("201777777777", "تمام");
  await wait(400);
  check(small.newRuns === 0 && (await learning()).facts.length === factsBefore, "a bare «تمام» from the owner is not a fact");
}

/* ---------------- 8. messages that are nothing to act on cost nothing ---------------- */
{
  const before = await executions();
  await app.inject({
    method: "POST",
    url: `/webhook/${path}`,
    payload: { event: "messages.received", data: { messages: { key: { remoteJid: "120363000000@g.us", fromMe: false }, message: { conversation: "رسالة في جروب" } } } },
  });
  await app.inject({ method: "POST", url: `/webhook/${path}`, payload: { event: "messages.update", data: { status: "read" } } });
  await wait(300);
  check((await executions()) === before, `a group message and a read receipt start no run and cost nothing (${(await executions()) - before} new)`);
}

/* ---------------- 9. the owner's screen in the app ---------------- */
{
  let r = await api(owner, "POST", `/api/workflows/${wfId}/learning/facts`, { text: "مقفولين يوم الجمعة" });
  check(r.status === 200 && r.body.facts.some((f) => f.text === "مقفولين يوم الجمعة" && f.source === "app"), "a fact written in the app is kept as written");
  const id = r.body.facts.find((f) => f.text === "مقفولين يوم الجمعة").id;
  r = await api(owner, "PUT", `/api/workflows/${wfId}/learning/facts/${id}`, { text: "مقفولين يوم الجمعة لحد الساعة 2" });
  check(r.body.facts.some((f) => f.id === id && f.text.endsWith("الساعة 2")), "it can be corrected");
  r = await api(owner, "DELETE", `/api/workflows/${wfId}/learning/facts/${id}`);
  check(!r.body.facts.some((f) => f.id === id), "and deleted");

  r = await api(owner, "POST", `/api/workflows/${wfId}/learning/import`, { text: "زبون: ينفع أرجع؟\nأنا: أيوه خلال 14 يوم\nزبون: بتاخدوا كاش؟\nأنا: أيوه عند الاستلام" });
  check(r.status === 200 && r.body.added === 2, `old conversations pasted in the app become facts (${r.status} ${r.body.added})`);
  check(r.body.facts.filter((f) => f.source === "import").length === 2, "marked as coming from them");

  // A question answered from the app instead of the phone.
  await incoming("201888888888", "عندكم مقاس 44 أسود؟", "هاني");
  // (the fake AI now knows 44 - so ask a question it cannot answer by clearing that fact first)
}
{
  const state = await learning();
  for (const f of state.facts.filter((f) => f.text.includes("44"))) await api(owner, "DELETE", `/api/workflows/${wfId}/learning/facts/${f.id}`);
  await incoming("201999999999", "عندكم 44 بني؟", "ياسر");
  const q = (await learning()).open.find((o) => o.chat === "201999999999");
  check(Boolean(q), "a new question is waiting");
  const before = sent.length;
  const r = await api(owner, "POST", `/api/workflows/${wfId}/learning/open/${q.id}/answer`, { text: "أيوه البني متاح بـ 450" });
  check(r.status === 200 && /بعتّ الإجابة/.test(r.body.message), `answering from the app works (${r.body.message})`);
  check(sent.slice(before).some((m) => m.to === "201999999999" && m.text === "أيوه البني متاح بـ 450"), "and the customer receives it");
  check(!r.body.open.some((o) => o.id === q.id), "and it stops waiting");
}

/* ---------------- 10. nobody else can see or touch it ---------------- */
{
  const peek = await api(stranger, "GET", `/api/workflows/${wfId}/learning`);
  check(peek.status === 404, `another account cannot read what the bot learned (${peek.status})`);
  const poke = await api(stranger, "POST", `/api/workflows/${wfId}/learning/facts`, { text: "كل حاجة ببلاش" });
  check(poke.status === 404, `or add to it (${poke.status})`);
}

/* ---------------- 11. switched off, it is the bot it was before ---------------- */
{
  await api(owner, "POST", `/api/workflows/${wfId}/activate`, { active: false });
  const saved = await api(owner, "PUT", `/api/workflows/${wfId}`, { graph: graph(false) });
  check(saved.status === 200, "learning can be switched off");
  // Saved without its link (the way an agent might send it): the link pasted into WasenderAPI must survive.
  const pathAfter = saved.body.graph.nodes.find((n) => n.id === "1").params.path;
  check(pathAfter === path, `saving without the webhook link keeps the old link (${path} -> ${pathAfter})`);
  path = pathAfter;
  await api(owner, "POST", `/api/workflows/${wfId}/activate`, { active: true });
  const factsBefore = (await learning()).facts.length;
  const out = await incoming(OWNER_PHONE, "اتعلم: حاجة جديدة", "صاحب المحل");
  check((await learning()).facts.length === factsBefore, "then the owner's «اتعلم:» is just a message");
  check(out.some((m) => m.to === OWNER_PHONE && /رد عادي/.test(m.text)), "answered like any other");
  const lastChat = aiCalls.filter((c) => !c.system.startsWith("You keep")).pop();
  check(!lastChat.tools.includes("ask_owner"), "the bot is not given the ask-the-owner tool");
  check(!lastChat.system.includes("اتعلمتها من صاحب المشروع"), "and reads nothing it learned");
}

/* ---------------- the pieces on their own ---------------- */
{
  check(ownerCommand("رد ٣: أيوه")?.id === 3, "Arabic digits work in «رد ٣:»");
  check(ownerCommand("#اتعلم التوصيل مجاني")?.kind === "teach", "«#اتعلم» without a colon works");
  check(ownerCommand("عايز أتعلم برمجة") === null, "a sentence that merely contains the word is not a command");
  check(isOwner({ id: "201012345678" }, "01012345678"), "a local number matches the same number with the country code");
  check(!isOwner({ id: "201012345679" }, "01012345678"), "a different number does not");
  check(!isOwner({ id: "201012345678" }, ""), "with no owner written, nobody is the owner");
  check(isOwner({ id: "55", username: "Shop_Owner" }, "@shop_owner"), "a Telegram owner matches by username");
  check(isOwner({ id: "201012345678" }, "01111111111, 01012345678"), "several owners can be written");
}

await app.close();
ai.close();
globalThis.fetch = realFetch;
console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
