/**
 * Signing up with an email that already has an account: a clear message, never a silent failure.
 * Run with the platform email switched on, so codes really go out (caught before they leave).
 */
process.env.EXTRA_ADMIN_EMAILS = "boss@local.test";

const base = new URL("../dist/", import.meta.url).href;
const { buildApp } = await import(base + "app.js");
const { query } = await import(base + "db.js");
const { sha256 } = await import(base + "crypto.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url instanceof URL ? url.href : url);
  if (href.startsWith("https://api.resend.com")) {
    const body = JSON.parse(init.body);
    mails.push({ to: [].concat(body.to)[0], text: body.text ?? "" });
    return new Response(JSON.stringify({ id: `mail-${mails.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};

const app = await buildApp();
await app.ready();
const post = async (url, payload, headers = {}) => {
  const res = await app.inject({ method: "POST", url, payload, headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers } });
  return { status: res.statusCode, body: res.json() };
};

/* The platform email on, as it is live. */
{
  const token = "boss-session";
  await query("DELETE FROM users WHERE email = $1", ["boss@local.test"]);
  await query("INSERT INTO users (id, email, name, password_hash, created_at, email_verified) VALUES ('u-boss', 'boss@local.test', 'boss', 'x', $1, 1)", [
    new Date().toISOString(),
  ]);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, 'u-boss', $2)", [sha256(token), new Date(Date.now() + 86_400_000).toISOString()]);
  const res = await app.inject({
    method: "PUT",
    url: "/api/admin/mail",
    headers: { authorization: `Bearer ${token}` },
    payload: { provider: "resend", apiKey: "re_test", fromEmail: "no-reply@tadfuqai.com", fromName: "تدفّق" },
  });
  check(res.statusCode === 200, `platform email switched on (${res.statusCode})`);
}

const email = "new.customer@local.test";
await query("DELETE FROM users WHERE email = $1", [email]);

/* A brand-new sign-up: a code goes out, no session yet. */
{
  const first = await post("/api/auth/register", { name: "عميل", email, password: "password-1" });
  check(first.status === 200 && first.body.verify === true, `a new sign-up is asked for its code (${first.status} ${JSON.stringify(first.body)})`);
  check(mails.filter((m) => m.to === email).length === 1, "and the code is emailed");
}

/* Pressing sign up again a moment later: back to the code screen, not an error - the code already sent still works. */
{
  const again = await post("/api/auth/register", { name: "عميل", email, password: "password-2" });
  check(again.status === 200 && again.body.verify === true, `signing up twice in a minute goes to the code screen (${again.status} ${JSON.stringify(again.body)})`);
  check(mails.filter((m) => m.to === email).length === 1, "without flooding the inbox with a second code");
}

/* Coming back later, still unconfirmed: a fresh code. */
{
  await query("UPDATE email_codes SET sent_at = $1 WHERE email = $2", [new Date(Date.now() - 120_000).toISOString(), email]);
  const later = await post("/api/auth/register", { name: "عميل", email, password: "password-2" });
  check(later.status === 200 && later.body.verify === true, `coming back later sends a new code (${later.status})`);
  check(mails.filter((m) => m.to === email).length === 2, "a second code goes out");
}

/* Confirm it, then sign up again with the same email: told plainly that it exists. */
{
  const code = mails.filter((m) => m.to === email).pop().text.match(/\b\d{6}\b/)?.[0];
  const verified = await post("/api/auth/verify", { email, code });
  check(verified.status === 200 && Boolean(verified.body.token), `the account is confirmed with the code (${verified.status})`);

  const before = mails.length;
  const dup = await post("/api/auth/register", { name: "حد تاني", email, password: "password-3" });
  check(dup.status === 409, `signing up with a confirmed email is refused (${dup.status})`);
  check(dup.body.error === "الإيميل ده متسجل قبل كده - سجّل دخول", `with a message that says so (${dup.body.error})`);
  check(mails.length === before, "and no email is sent to the owner of that account");

  const upper = await post("/api/auth/register", { name: "حد تاني", email: "  New.Customer@LOCAL.test ", password: "password-3" });
  check(upper.status === 409, `the same email in capitals or with spaces is the same account (${upper.status} ${JSON.stringify(upper.body)})`);

  const login = await post("/api/auth/login", { email, password: "password-2" });
  check(login.status === 200 && Boolean(login.body.token), "and the real owner still signs in with their own password");
  const hijack = await post("/api/auth/login", { email, password: "password-3" });
  check(hijack.status === 401, "the password from the refused sign-up does not work");
}

await app.close();
globalThis.fetch = realFetch;
console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
