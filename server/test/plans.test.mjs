/**
 * Trials and subscriptions end when they say they end - for everyone, not only for the accounts
 * whose owner happens to open the app. Driven through the real routes and the real scheduler tick.
 */
process.env.EXTRA_ADMIN_EMAILS = "boss@local.test";
process.env.CRON_SECRET = "tick-secret";

const base = new URL("../dist/", import.meta.url).href;
const { buildApp } = await import(base + "app.js");
const { query } = await import(base + "db.js");
const { sha256 } = await import(base + "crypto.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

/* Every platform email, caught before it leaves. */
const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url instanceof URL ? url.href : url);
  if (href.startsWith("https://api.resend.com")) {
    const body = JSON.parse(init.body);
    mails.push({ to: [].concat(body.to)[0], subject: body.subject });
    return new Response(JSON.stringify({ id: `mail-${mails.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};

const app = await buildApp();
await app.ready();
const day = 86_400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const person = async (key, plan = {}) => {
  const id = `u-${key}`;
  const token = `session-${key}-${Math.random().toString(36).slice(2)}`;
  await query("DELETE FROM users WHERE email = $1", [`${key}@local.test`]);
  await query("INSERT INTO users (id, email, name, password_hash, created_at, email_verified) VALUES ($1, $2, $3, $4, $5, 1)", [
    id,
    `${key}@local.test`,
    key,
    "x",
    iso(-5 * day),
  ]);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), id, iso(day)]);
  await query(
    `UPDATE users SET plan = $1, trial_ends_at = $2, plan_expires_at = $3, credits = 1000, assistant_credits = 50,
       credits_reset_at = $4, plan_notice = '' WHERE id = $5`,
    [plan.plan ?? "trial", plan.trialEnds ?? null, plan.expires ?? null, plan.trialEnds ?? iso(30 * day), id],
  );
  return { id, token };
};
const api = async (who, method, url, payload) => {
  const res = await app.inject({ method, url, headers: who ? { authorization: `Bearer ${who.token}` } : {}, payload });
  return { status: res.statusCode, body: res.json() };
};
const planOf = async (id) => (await query("SELECT plan FROM users WHERE id = $1", [id]))[0].plan;
const tick = () => app.inject({ method: "POST", url: "/api/cron/tick", headers: { authorization: "Bearer tick-secret" } });

const boss = await person("boss", { plan: "free" });

/* The platform's own email, pointed at Resend (the send itself is caught above). */
{
  const saved = await api(boss, "PUT", "/api/admin/mail", { provider: "resend", apiKey: "re_test", fromEmail: "hello@tadfuqai.com", fromName: "تدفّق" });
  check(saved.status === 200, `the platform email is set up for the test (${saved.status} ${JSON.stringify(saved.body).slice(0, 100)})`);
}

/* ---- What was reported: a trial that ended days ago, whose owner has not been back ---- */
const expired = await person("trial-over", { trialEnds: iso(-2 * day) });
const current = await person("trial-now", { trialEnds: iso(day) });
{
  check((await planOf(expired.id)) === "trial", "set-up: the ended trial is still marked as a trial in the database");
  const list = await api(boss, "GET", "/api/admin/users");
  const row = list.body.users.find((u) => u.id === expired.id);
  check(row?.plan.key === "free", `the admin console no longer calls an ended trial a trial (${row?.plan.key}, ends ${row?.trialEndsAt})`);
  const live = list.body.users.find((u) => u.id === current.id);
  check(live?.plan.key === "trial", `a trial that has not ended is still a trial (${live?.plan.key})`);
  check((await planOf(expired.id)) === "free", "and the database says so too");
}

/* ---- The scheduler ends plans on its own, with nobody opening anything ---- */
const expired2 = await person("trial-over-2", { trialEnds: iso(-60_000) });
const paidOver = await person("paid-over", { plan: "pro", expires: iso(-3_600_000) });
{
  const before = mails.length;
  const res = await tick();
  check(res.statusCode === 200, `the scheduler tick runs (${res.statusCode})`);
  check((await planOf(expired2.id)) === "free", "a trial that ended a minute ago is ended by the tick");
  check((await planOf(paidOver.id)) === "free", "a subscription that ran out is ended by the tick");
  const sent = mails.slice(before);
  check(sent.filter((m) => m.to === "paid-over@local.test").length === 1, `the paid customer is emailed that it ended (${JSON.stringify(sent)})`);
  check(!sent.some((m) => m.to === "trial-over-2@local.test"), "a trial ending does not send the paid «subscription ended» email");

  await tick();
  await api(paidOver, "GET", "/api/billing");
  check(mails.filter((m) => m.to === "paid-over@local.test").length === 1, "and only once, however many times it is checked");
}

/* ---- The owner opening the app first still works, and still gets the email ---- */
{
  const paid2 = await person("paid-over-2", { plan: "core", expires: iso(-60_000) });
  const before = mails.length;
  const billing = await api(paid2, "GET", "/api/billing");
  check(billing.body.account.plan.key === "free", `opening the app after it ended shows free (${billing.body.account.plan.key})`);
  check(mails.slice(before).filter((m) => m.to === "paid-over-2@local.test").length === 1, "and that path sends the email too - it used to be skipped");
}

/* ---- The trial's allowances stop with it ---- */
{
  const owner = await person("fast-schedule", { trialEnds: iso(day) });
  const made = await api(owner, "POST", "/api/workflows", {
    name: "كل دقيقة",
    graph: {
      nodes: [{ id: "1", type: "trigger.schedule", name: "كل دقيقة", position: { x: 0, y: 0 }, params: { mode: "interval", minutes: 1 } }],
      edges: [],
    },
  });
  const on = await api(owner, "POST", `/api/workflows/${made.body.id}/activate`, { active: true });
  check(on.status === 200, `during the trial a scenario may run every minute (${on.status} ${JSON.stringify(on.body).slice(0, 120)})`);

  // The trial ends, and the scenario is due.
  await query("UPDATE users SET trial_ends_at = $1 WHERE id = $2", [iso(-1000), owner.id]);
  await query("UPDATE workflows SET next_run_at = $1 WHERE id = $2", [iso(-1000), made.body.id]);
  await tick();
  const next = Date.parse((await query("SELECT next_run_at FROM workflows WHERE id = $1", [made.body.id]))[0].next_run_at);
  check(next - Date.now() > 14 * 60_000, `after the trial it runs every 15 minutes like the free plan, not every minute (next in ${Math.round((next - Date.now()) / 60_000)} min)`);

  const pro = await person("pro-schedule", { plan: "pro", expires: iso(20 * day) });
  const made2 = await api(pro, "POST", "/api/workflows", {
    name: "كل دقيقة",
    graph: { nodes: [{ id: "1", type: "trigger.schedule", name: "كل دقيقة", position: { x: 0, y: 0 }, params: { mode: "interval", minutes: 1 } }], edges: [] },
  });
  await api(pro, "POST", `/api/workflows/${made2.body.id}/activate`, { active: true });
  await query("UPDATE workflows SET next_run_at = $1 WHERE id = $2", [iso(-1000), made2.body.id]);
  await tick();
  const next2 = Date.parse((await query("SELECT next_run_at FROM workflows WHERE id = $1", [made2.body.id]))[0].next_run_at);
  check(next2 - Date.now() < 2 * 60_000, `a paid plan that allows every minute keeps every minute (next in ${Math.round((next2 - Date.now()) / 1000)}s)`);

  const assistant = await api(owner, "GET", "/api/billing");
  check(assistant.body.account.plan.assistant === false, "and the assistant is locked once the trial is over");
}

await app.close();
globalThis.fetch = realFetch;
console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
