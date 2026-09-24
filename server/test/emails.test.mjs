/** Every platform email: it builds, it says the right things, and the code email stays code-only. */
const base = new URL("../dist/", import.meta.url).href;
const E = await import(base + "emails.js");
const { isConfigured } = await import(base + "mailer.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

const wellFormed = (mail, label) => {
  check(Boolean(mail.subject?.trim()), `${label}: has a subject`);
  check(mail.html.startsWith("<!doctype html>"), `${label}: is a whole document`);
  check(mail.html.includes('dir="rtl"'), `${label}: reads right to left`);
  check(mail.text.trim().length > 20, `${label}: has a text part`);
  check(!/undefined|NaN|\[object/.test(mail.html), `${label}: no leaked placeholders in the html`);
  check(!/undefined|NaN|\[object/.test(mail.text), `${label}: no leaked placeholders in the text`);
  check(!/<script/i.test(mail.html), `${label}: no scripts`);
};

/* The verification code: the ONLY number anywhere, so "copy code" picks the right six digits. */
{
  const mail = E.codeEmail("482913", "أحمد محمد", "register");
  wellFormed(mail, "code");
  const digits = (text) => (text.match(/\d+/g) ?? []).filter((run) => !/^\d{1,2}$/.test(run) === false || true);
  const bodyText = mail.html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
  const numbersInSubject = mail.subject.match(/\d+/g) ?? [];
  check(numbersInSubject.length === 1 && numbersInSubject[0] === "482913", `code subject holds only the code (${numbersInSubject})`);
  const numbersInBody = bodyText.match(/\d+/g) ?? [];
  check(numbersInBody.every((n) => n === "482913"), `code body holds only the code (${[...new Set(numbersInBody)]})`);
  const numbersInText = mail.text.match(/\d+/g) ?? [];
  check(numbersInText.every((n) => n === "482913"), `code text part holds only the code (${[...new Set(numbersInText)]})`);
  check(digits(mail.text).length > 0, "code is in the text part");
  check(E.codeEmail("111111", "", "login").html.includes("111111"), "works without a name");
}

/* The rest of the family. */
wellFormed(E.welcomeEmail("منى"), "welcome");
wellFormed(E.paymentReceivedEmail("منى", "باقة احترافي (شهري)", "$10"), "payment received");
wellFormed(
  E.planActivatedEmail("منى", { name: "احترافي", period: "monthly", expiresAt: "2026-10-21T00:00:00.000Z", credits: 12000, assistantCredits: 200 }),
  "plan activated",
);
wellFormed(E.creditsAddedEmail("منى", { credits: 5000, assistantCredits: 0 }, { credits: 17000, assistantCredits: 200 }), "credits added");
wellFormed(E.requestRejectedEmail("منى", "باقة احترافي", "التحويل مظهرش"), "rejected");
wellFormed(E.planExpiringEmail("منى", { name: "احترافي", expiresAt: "2026-10-21T00:00:00.000Z", daysLeft: 3 }), "expiring");
wellFormed(E.planEndedEmail("منى", "احترافي"), "ended");
wellFormed(E.newRequestEmail({ name: "منى", email: "m@x.com", id: "abc-123" }, "باقة احترافي", "$10"), "new request");
wellFormed(E.testEmail(), "test");

/* Numbers and dates read the way a person writes them. */
check(E.arabicNumber(12000) === "12,000", `thousands separator (got ${E.arabicNumber(12000)})`);
check(E.arabicDate("2026-10-21T00:00:00.000Z").includes("2026"), `a real date (got ${E.arabicDate("2026-10-21T00:00:00.000Z")})`);
check(E.arabicDate(null) === "" && E.arabicDate("nonsense") === "", "no date, no noise");

/* A row with no value is left out instead of showing an empty line. */
{
  const noAssistant = E.planActivatedEmail("منى", { name: "انطلاقة", period: "yearly", expiresAt: null, credits: 5000, assistantCredits: 0 });
  check(!noAssistant.html.includes("كريديت المساعد الذكي"), "a plan without an assistant does not mention one");
  check(noAssistant.html.includes("سنوي"), "yearly is named");
}

/* Anything a customer typed is escaped, never rendered. */
{
  const nasty = E.welcomeEmail('<img src=x onerror="alert(1)">');
  check(!nasty.html.includes("<img src=x"), "a name cannot inject html");
  check(nasty.html.includes("&lt;img"), "it is shown as text instead");
}

/* What counts as ready to send. */
check(!isConfigured(null), "nothing configured is not ready");
check(!isConfigured({ provider: "resend", apiKey: "", fromEmail: "a@b.com" }), "resend needs a key");
check(!isConfigured({ provider: "resend", apiKey: "re_x", fromEmail: "" }), "resend needs a sender");
check(isConfigured({ provider: "resend", apiKey: "re_x", fromEmail: "a@b.com" }), "resend with both is ready");
check(!isConfigured({ provider: "smtp", host: "h", user: "u", password: "" }), "smtp needs a password");
check(isConfigured({ provider: "smtp", host: "h", user: "u", password: "p" }), "smtp with all three is ready");

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
