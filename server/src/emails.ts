import { config } from "./config.js";

/*
 * Every email the platform sends, in one place: same layout, same voice, same colours as the site.
 * Each one is a plain function of its variables, so it can be read, changed and tested on its own.
 */

export interface Mail {
  subject: string;
  html: string;
  text: string;
}

const esc = (text: unknown) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const site = () => config.publicUrl;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "بيك";

/** "21 أكتوبر 2026" - Arabic month, Western digits, to match the numbers everywhere else. */
export const arabicDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(date);
};

export const arabicNumber = (value: number) => new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));

interface Block {
  /** A line of the message. */
  p?: string;
  /** A boxed fact: label on the right, value on the left. */
  rows?: [string, string][];
  /** A big quiet note under everything. */
  note?: string;
}

/**
 * The shell every message shares. Nothing here is decoration for its own sake: a header that
 * says who is writing, the message, one clear button, and a footer that says how to reach a human.
 */
function shell(options: { title: string; preheader: string; heading: string; blocks: Block[]; cta?: { label: string; href: string }; tone?: "normal" | "warn" }): string {
  const accent = options.tone === "warn" ? "#b45309" : "#ea580c";
  const body = options.blocks
    .map((block) => {
      if (block.rows) {
        const rows = block.rows
          .filter(([, value]) => String(value ?? "").trim())
          .map(
            ([label, value]) =>
              `<tr><td style="padding:7px 0;font-size:14px;color:#8a7461;">${esc(label)}</td>` +
              `<td align="left" style="padding:7px 0;font-size:14px;font-weight:bold;color:#2b1d12;">${esc(value)}</td></tr>`,
          )
          .join("");
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6f0;border:1px solid #f1e4d6;border-radius:12px;padding:10px 16px;margin:16px 0;">${rows}</table>`;
      }
      if (block.note) return `<p style="margin:16px 0 0;font-size:13.5px;line-height:1.9;color:#8a7461;">${esc(block.note)}</p>`;
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.95;color:#5b4a3c;">${esc(block.p)}</p>`;
    })
    .join("");

  const button = options.cta
    ? `<tr><td align="center" style="padding:6px 28px 26px;">
          <a href="${esc(options.cta.href)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 30px;border-radius:12px;">${esc(options.cta.label)}</a>
        </td></tr>`
    : "";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(options.title)}</title></head>
<body style="margin:0;padding:0;background:#f5efe8;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(options.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(120,60,20,0.12);">
        <tr><td style="background:${accent};padding:24px 28px;text-align:center;">
          <img src="${site()}/logo.png" alt="" width="40" height="40" style="display:inline-block;vertical-align:middle;border:0;">
          <span style="display:inline-block;vertical-align:middle;color:#ffffff;font-size:24px;font-weight:bold;margin-right:10px;">تدفّق</span>
        </td></tr>
        <tr><td style="padding:28px 28px 6px;text-align:right;color:#2b1d12;direction:rtl;">
          <p style="margin:0 0 14px;font-size:19px;font-weight:bold;line-height:1.5;">${esc(options.heading)}</p>
          ${body}
        </td></tr>
        ${button}
        <tr><td style="background:#fbf6f0;padding:18px 28px;text-align:center;border-top:1px solid #f1e4d6;">
          <p style="margin:0 0 6px;font-size:13px;color:#8a7461;">تدفّق - أتمت شغلك كله من غير كود</p>
          <a href="${site()}" style="font-size:13px;color:${accent};text-decoration:none;">افتح لوحة التحكم</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The same message as plain text, for mail apps that will not show HTML. */
function plain(heading: string, blocks: Block[], cta?: { label: string; href: string }) {
  const lines = [heading, ""];
  for (const block of blocks) {
    if (block.rows) for (const [label, value] of block.rows) if (String(value ?? "").trim()) lines.push(`${label}: ${value}`);
    else if (block.note) lines.push("", block.note);
    else if (block.p) lines.push(block.p);
    lines.push("");
  }
  if (cta) lines.push(`${cta.label}: ${cta.href}`, "");
  lines.push(`تدفّق - ${site()}`);
  return lines.join("\n");
}

const compose = (subject: string, preheader: string, heading: string, blocks: Block[], cta?: { label: string; href: string }, tone?: "normal" | "warn"): Mail => ({
  subject,
  html: shell({ title: subject, preheader, heading, blocks, cta, tone }),
  text: plain(heading, blocks, cta),
});

/* ---------------------------------------------------------------- *
 * The verification code stands apart on purpose: the code has to be
 * the ONLY number in the whole message - subject, body and text part -
 * so Gmail's "copy code" and the reader both pick exactly those digits.
 * ---------------------------------------------------------------- */
export function codeEmail(code: string, name: string, purpose: "register" | "login"): Mail {
  const who = esc(name.trim() || "بيك");
  const intro =
    purpose === "register"
      ? "أهلاً بيك في تدفّق! عشان نفعّل حسابك، اكتب الكود ده في صفحة التسجيل:"
      : "حد (غالباً انت) بيحاول يدخل حسابك في تدفّق. اكتب الكود ده عشان تكمّل:";
  const subject = `${code} هو كود التحقق بتاعك في تدفّق`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f5efe8;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">كود التحقق بتاعك: ${code}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(120,60,20,0.12);">
        <tr><td style="background:#ea580c;padding:26px 28px;text-align:center;">
          <img src="${site()}/logo.png" alt="" width="44" height="44" style="display:inline-block;vertical-align:middle;border:0;">
          <span style="display:inline-block;vertical-align:middle;color:#ffffff;font-size:26px;font-weight:bold;margin-right:10px;">تدفّق</span>
        </td></tr>
        <tr><td style="padding:30px 28px 10px;text-align:right;color:#2b1d12;direction:rtl;">
          <p style="margin:0 0 8px;font-size:18px;font-weight:bold;">أهلاً ${who} 👋</p>
          <p style="margin:0;font-size:15px;line-height:1.9;color:#5b4a3c;">${intro}</p>
        </td></tr>
        <tr><td align="center" style="padding:18px 28px 8px;">
          <div dir="ltr" style="display:inline-block;background:#fff7ed;border:2px dashed #fb923c;border-radius:14px;padding:16px 26px;font-family:'Courier New',Consolas,monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#c2410c;">${code}</div>
        </td></tr>
        <tr><td style="padding:10px 28px 26px;text-align:right;direction:rtl;">
          <p style="margin:0 0 6px;font-size:13.5px;color:#8a7461;">الكود صالح لمدة عشر دقائق بس، ومتقولوش لأي حد - فريق تدفّق عمره ما هيطلبه منك</p>
          <p style="margin:0;font-size:13.5px;color:#8a7461;">لو مش انت اللي طلبته، تجاهل الإيميل ده وحسابك في أمان</p>
        </td></tr>
        <tr><td style="background:#fbf6f0;padding:18px 28px;text-align:center;border-top:1px solid #f1e4d6;">
          <p style="margin:0 0 4px;font-size:13px;color:#8a7461;">تدفّق - أتمت شغلك كله من غير كود</p>
          <a href="${site()}" style="font-size:13px;color:#ea580c;text-decoration:none;">افتح تدفّق</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    `أهلاً ${name.trim() || "بيك"}،`,
    "",
    purpose === "register" ? "كود تفعيل حسابك في تدفّق:" : "كود الدخول لحسابك في تدفّق:",
    "",
    code,
    "",
    "الكود صالح لمدة عشر دقائق بس. لو مش انت اللي طلبته تجاهل الإيميل ده",
    "",
    // No site address here on purpose: a domain with digits in it (or a port) would put a second
    // number in the message, and then "copy code" picks the wrong one.
    "تدفّق",
  ].join("\n");
  return { subject, html, text };
}

/* ---------------------------------------------------------------- *
 * The account's life: welcome, money, plan.
 * ---------------------------------------------------------------- */

export const welcomeEmail = (name: string): Mail =>
  compose(
    "أهلاً بيك في تدفّق 🎉",
    "حسابك اتفعّل - ابدأ بأول سيناريو",
    `أهلاً ${firstName(name)}، حسابك جاهز`,
    [
      { p: "من دلوقتي تقدر تخلي شغلك المتكرر يشتغل لوحده: بوت بيرد على عملاءك، طلبات بتتسجل، وبوستات بتنزل في ميعادها" },
      { p: "أسرع طريقة تبدأ بيها: افتح «التيمبلت» واختار واحدة جاهزة - هتلاقي جواها شرح بالخطوات، وكل خطوة مربوطة باللي قبلها" },
      { note: "عندك 3 أيام تجربة بكل مميزات الاحترافي من غير بطاقة. لو احتجت أي حاجة، رد على الإيميل ده أو كلّمنا على واتساب" },
    ],
    { label: "ابدأ من تيمبلت جاهز", href: `${site()}/app/templates` },
  );

export const paymentReceivedEmail = (name: string, what: string, amount: string): Mail =>
  compose(
    "استلمنا طلبك وبنراجع التحويل",
    `طلبك: ${what}`,
    `وصلنا طلبك يا ${firstName(name)}`,
    [
      { p: "استلمنا طلبك، وبنراجع التحويل دلوقتي. أول ما نتأكد هنفعّله على حسابك ونبعتلك إيميل تاني" },
      { rows: [["الطلب", what], ["المبلغ", amount], ["الحالة", "تحت المراجعة"]] },
      { note: "المراجعة عادة بتاخد ساعات قليلة. لو عدّى يوم من غير رد، كلّمنا على واتساب ومعاك صورة الإيصال" },
    ],
    { label: "تابع حالة الطلب", href: `${site()}/app/billing` },
  );

export const planActivatedEmail = (
  name: string,
  plan: { name: string; period: "monthly" | "yearly"; expiresAt: string | null; credits: number; assistantCredits: number },
): Mail =>
  compose(
    `باقة «${plan.name}» اتفعّلت على حسابك ✓`,
    `الباقة شغالة لحد ${arabicDate(plan.expiresAt) || "إشعار آخر"}`,
    `تم يا ${firstName(name)} - باقتك شغالة`,
    [
      { p: "راجعنا التحويل وفعّلنا الباقة على حسابك. كل مميزاتها مفتوحة من دلوقتي" },
      {
        rows: [
          ["الباقة", plan.name],
          ["نوع الاشتراك", plan.period === "yearly" ? "سنوي" : "شهري"],
          ["كريديت التشغيل", `${arabicNumber(plan.credits)} في الشهر`],
          ...(plan.assistantCredits ? ([["كريديت المساعد الذكي", `${arabicNumber(plan.assistantCredits)} في الشهر`]] as [string, string][]) : []),
          ["شغالة لحد", arabicDate(plan.expiresAt)],
        ],
      },
      { note: "الكريديت بيتجدد كل شهر بقيمة الباقة. وهنبعتلك تنبيه قبل ما الاشتراك يخلص بكام يوم" },
    ],
    { label: "افتح لوحة التحكم", href: `${site()}/app` },
  );

export const creditsAddedEmail = (name: string, added: { credits: number; assistantCredits: number }, total: { credits: number; assistantCredits: number }): Mail =>
  compose(
    "الكريديت اتضاف لحسابك ✓",
    `اتضاف ${arabicNumber(added.credits)} كريديت`,
    `تم يا ${firstName(name)} - الكريديت في حسابك`,
    [
      { p: "راجعنا التحويل وضفنا الكريديت. الكريديت اللي بتشتريه ده ما بينتهيش، وبيتصرف بعد كريديت الشهر" },
      {
        rows: [
          ["كريديت تشغيل اتضاف", arabicNumber(added.credits)],
          ...(added.assistantCredits ? ([["كريديت مساعد اتضاف", arabicNumber(added.assistantCredits)]] as [string, string][]) : []),
          ["رصيدك دلوقتي", arabicNumber(total.credits)],
          ...(total.assistantCredits ? ([["رصيد المساعد", arabicNumber(total.assistantCredits)]] as [string, string][]) : []),
        ],
      },
    ],
    { label: "شوف رصيدك", href: `${site()}/app/billing` },
  );

export const requestRejectedEmail = (name: string, what: string, reason: string): Mail =>
  compose(
    "محتاجين نراجع طلبك معاك",
    `بخصوص: ${what}`,
    `يا ${firstName(name)}، فيه حاجة ناقصة في طلبك`,
    [
      { p: "راجعنا الطلب ومقدرناش نفعّله دلوقتي" },
      { rows: [["الطلب", what], ["السبب", reason || "التحويل مظهرش عندنا"]] },
      { p: "لو التحويل اتعمل فعلاً، ابعتلنا صورة الإيصال على واتساب وإحنا هنراجعه تاني فوراً" },
      { note: "مفيش حاجة اتخصمت منك من ناحيتنا. لو الفلوس اتخصمت من محفظتك، الإيصال هو اللي هيوصلنا لها" },
    ],
    { label: "كلّمنا", href: `${site()}/contact` },
    "warn",
  );

export const planExpiringEmail = (name: string, plan: { name: string; expiresAt: string | null; daysLeft: number }): Mail =>
  compose(
    `باقة «${plan.name}» بتخلص بعد ${plan.daysLeft === 1 ? "يوم" : `${plan.daysLeft} أيام`}`,
    "جدّد عشان السيناريوهات ما تقفش",
    `يا ${firstName(name)}، اشتراكك قرّب يخلص`,
    [
      { p: "باقتك قرّبت تخلص. جدّدها عشان السيناريوهات تفضل شغالة من غير ما تقف" },
      { rows: [["الباقة", plan.name], ["بتخلص يوم", arabicDate(plan.expiresAt)]] },
      { note: "لو الاشتراك خلص، سيناريوهاتك وبياناتك كلها بتفضل محفوظة زي ما هي - بس بتقف عن الشغل لحد ما تجدد" },
    ],
    { label: "جدّد الاشتراك", href: `${site()}/app/billing` },
    "warn",
  );

export const planEndedEmail = (name: string, planName: string): Mail =>
  compose(
    "اشتراكك خلص - سيناريوهاتك واقفة",
    "كل حاجة محفوظة، بس محتاجة تجديد",
    `يا ${firstName(name)}، اشتراكك خلص`,
    [
      { p: `باقة «${planName}» خلصت، وحسابك رجع للباقة المجانية. السيناريوهات اللي فوق حد الباقة المجانية وقفت` },
      { p: "كل سيناريوهاتك وحساباتك وبياناتك متسجلة زي ما هي - أول ما تجدد هترجع تشتغل من غير ما تعمل حاجة" },
    ],
    { label: "رجّع اشتراكك", href: `${site()}/app/billing` },
    "warn",
  );

/** Sent to the owner, not the customer: somebody says they paid. */
export const newRequestEmail = (customer: { name: string; email: string; id: string }, what: string, amount: string): Mail =>
  compose(
    `طلب دفع جديد: ${what}`,
    `${customer.name} - ${amount}`,
    "فيه طلب مستني مراجعتك",
    [
      { p: "عميل بيقول إنه حوّل. راجع الإيصال على واتساب وبعدين فعّل أو ارفض من لوحة الأدمن" },
      {
        rows: [
          ["العميل", customer.name],
          ["الإيميل", customer.email],
          ["رقم الحساب", customer.id],
          ["الطلب", what],
          ["المبلغ", amount],
        ],
      },
    ],
    { label: "افتح لوحة الأدمن", href: `${site()}/app/admin` },
  );

export const testEmail = (): Mail =>
  compose(
    "تجربة إيميل من تدفّق ✓",
    "لو وصلك ده، الإعدادات مظبوطة",
    "الإيميل شغال",
    [
      { p: "الرسالة دي اتبعتت من لوحة الأدمن عشان تتأكد إن إعدادات الإيميل مظبوطة" },
      { p: "لو وصلك في صندوق الوارد (مش السبام)، يبقى الدومين متظبط صح وكل الإيميلات هتوصل زيه" },
    ],
    { label: "افتح لوحة التحكم", href: `${site()}/app` },
  );
