import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppBadge } from "../components/AppBadge";
import { money } from "../components/PlanCards";
import { useAuth } from "../context";
import { Icon } from "../icons";
import type { PlanDef } from "../types";

/* ---------- hero: an editor window running a real scenario ---------- */
const RUN = [
  { app: "whatsapp", title: "رسالة واتساب جديدة", note: "منى: الشنطة السودا لسه متاحة؟" },
  { app: "agent", title: "AI Agent", note: "بيرد من الأسعار والمخزون بتاعك" },
  { app: "sheets", title: "Google Sheets", note: "سجّل الطلب في شيت الطلبات" },
  { app: "whatsapp", title: "إرسال رد", note: "«أيوه متاحة بـ 450 جنيه، أسجّلك الطلب؟»" },
];
const LOG = [
  ["14:02:11", "trigger", "whatsapp.message", ""],
  ["14:02:12", "ai.agent", "gemini-flash", "0.8s"],
  ["14:02:12", "sheets.append", "row added", "0.3s"],
  ["14:02:13", "whatsapp.send", "delivered", "0.4s"],
];

function ProductWindow() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((s) => (s + 1) % (RUN.length + 3)), 1100);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="pw" aria-hidden="true">
      <div className="pw-bar">
        <div className="pw-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="pw-title">بوت الطلبات على واتساب</div>
        <span className="pw-live">شغال</span>
      </div>
      <div className="pw-body">
        <div className="pw-canvas">
          {RUN.map((node, i) => (
            <div key={i} style={{ display: "contents" }}>
              {i > 0 && <div className={`pw-link ${step >= i ? "lit" : ""}`} />}
              <div className={`pw-node ${step === i ? "running" : step > i ? "done" : ""}`}>
                <AppBadge app={node.app} size={32} />
                <div style={{ minWidth: 0 }}>
                  <strong>{node.title}</strong>
                  <small>{node.note}</small>
                </div>
                <span className="pw-state">{step > i ? "✓" : step === i ? "…" : ""}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="pw-log">
          {LOG.map((line, i) => (
            <div key={i} style={{ opacity: step > i ? 1 : 0.18, transition: "opacity .3s" }}>
              <span>{line[0]}</span> <span className="acc">{line[1]}</span> {line[2]} <span className="ok">{line[3]}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, opacity: step >= RUN.length ? 1 : 0, transition: "opacity .3s" }}>
            <span className="ok">✓ run finished in 1.5s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- data ---------- */
const LOGOS = [
  ["whatsapp", "WhatsApp"],
  ["telegram", "Telegram"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["gemini", "Gemini"],
  ["openai", "ChatGPT"],
  ["anthropic", "Claude"],
  ["sheets", "Google Sheets"],
  ["shopify", "Shopify"],
  ["salla", "سلة"],
  ["zid", "زد"],
  ["wordpress", "WordPress"],
  ["notion", "Notion"],
  ["slack", "Slack"],
  ["stripe", "Stripe"],
];

const CASES = [
  {
    key: "stores",
    tab: "المتاجر",
    title: "كل طلب يتأكد ويتسجل من غير ما تلمسه",
    text: "أول ما طلب ينزل على متجرك، العميل يوصله تأكيد على واتساب باسمه ورقم طلبه، والفريق يتبلّغ، والطلب يتسجل في الشيت.",
    points: ["سلة وزد وShopify وWooCommerce", "رسالة تأكيد باسم العميل وتفاصيل طلبه", "تحديث حالة الطلب في المتجر تلقائي"],
    chain: [
      ["salla", "طلب جديد في سلة", "المحفّز"],
      ["whatsapp", "تأكيد للعميل على واتساب", "رسالة"],
      ["telegram", "إشعار للفريق", "تيليجرام"],
      ["sheets", "صف في شيت الطلبات", "حفظ"],
    ],
  },
  {
    key: "support",
    tab: "خدمة العملاء",
    title: "بوت بيرد زي أحسن موظف عندك، 24 ساعة",
    text: "بيفهم العميل بالعامية ويرد من معلوماتك انت بس، وبيفتكر المحادثة، ولو المشكلة محتاجة حد بيحوّلها ليك ويسكت لحد ما تخلص.",
    points: ["واتساب وتيليجرام وأي قناة بـ Webhook", "ذاكرة لكل عميل", "تحويل لموظف بإشعار فوري"],
    chain: [
      ["whatsapp", "رسالة من عميل", "المحفّز"],
      ["agent", "AI Agent بيرد من معلوماتك", "ذكاء اصطناعي"],
      ["telegram", "تحويل لموظف لو محتاج", "عند اللزوم"],
      ["whatsapp", "الرد للعميل", "رسالة"],
    ],
  },
  {
    key: "content",
    tab: "صناعة المحتوى",
    title: "بوست كل يوم بصورة وكابشن، في ميعاده",
    text: "ارفع صور منتجاتك مرة واحدة، وكل يوم في الميعاد اللي تحدده الذكاء الاصطناعي يكتب الكابشن ويعمل التصميم وينزل على كل منصاتك.",
    points: ["إنستجرام وفيسبوك وتيك توك وLinkedIn وX", "الصورة بتحافظ على شكل منتجك الحقيقي", "CTA وهاشتاجات مظبوطة لكل منصة"],
    chain: [
      ["schedule", "كل يوم الساعة 6", "جدولة"],
      ["media", "صورة من مكتبتك", "منتجاتك"],
      ["ai", "كابشن وتصميم", "ذكاء اصطناعي"],
      ["instagram", "نشر على كل المنصات", "نشر"],
    ],
  },
  {
    key: "teams",
    tab: "الفرق والوكالات",
    title: "العملاء المحتملين يوصلوا لمكانهم الصح",
    text: "أي فورم أو إعلان بيجيب عميل، يتقيّم بالذكاء الاصطناعي ويتسجل في أداتك، والشخص المسؤول يتبلّغ في نفس اللحظة.",
    points: ["فورمات جاهزة برابط مباشر", "تقييم وتصنيف تلقائي", "Notion وHubSpot وSlack"],
    chain: [
      ["form", "فورم عميل جديد", "المحفّز"],
      ["ai", "تقييم العميل", "ذكاء اصطناعي"],
      ["notion", "صفحة في Notion", "حفظ"],
      ["slack", "رسالة للمسؤول", "Slack"],
    ],
  },
];

const LOCAL = [
  { icon: "whatsapp", h: "واتساب في دقايق", p: "اربط رقمك بـ QR من غير موافقات Meta الطويلة، أو استخدم واتساب الرسمي لو عندك حساب بزنس." },
  { icon: "coins", h: "ادفع بالطريقة اللي تناسبك", p: "محفظة إلكترونية أو إنستاباي، والفاتورة على قد استخدامك - الذكاء الاصطناعي بمفتاحك من غير وسيط." },
  { icon: "templates", h: "سلة وزد جاهزين", p: "متاجر المنطقة متربطة من الأول، مش مجرد Shopify وخلاص." },
  { icon: "sparkles", h: "مساعد بيفهم كلامك", p: "اكتب اللي عايزه بالعامية، والمساعد يبني السيناريو ويقولك سبب أي خطأ بالعربي." },
  { icon: "key", h: "مفاتيحك في إيدك", p: "كل حساب بتربطه متشفّر، وتقدر تمسحه أو تغيّره في أي وقت." },
  { icon: "send", h: "دعم بيرد عليك فعلاً", p: "كلّمنا على واتساب، هترد عليك حد من الفريق مش بوت." },
];

const FAQ = [
  { q: "محتاج أعرف برمجة؟", a: "لا. بتبني السيناريو بالسحب والتوصيل، أو تبدأ من تيمبلت جاهز، أو تقول للمساعد الذكي اللي عايزه ويبنيه لك." },
  { q: "الذكاء الاصطناعي بيتحسب عليّ إزاي؟", a: "بتربط مفتاحك (Gemini فيه باقة مجانية، أو ChatGPT أو Claude) وبتدفع للخدمة مباشرة. إحنا بنحسب كريديت بسيط لتشغيل المنصة بس." },
  { q: "أقدر أربط واتساب من غير حساب بزنس؟", a: "أيوه، عن طريق WasenderAPI بتربط رقمك العادي بـ QR. ولو عندك واتساب بزنس الرسمي تقدر تستخدمه برضو." },
  { q: "بياناتي في أمان؟", a: "المفاتيح والتوكنات بتتشفّر قبل ما تتحفظ، والاتصال كله مشفّر، ومحدش بيشوف بياناتك غير الخدمات اللي انت ربطتها." },
  { q: "لو الكريديت خلص إيه اللي بيحصل؟", a: "السيناريوهات بتقف لحد ما يتجدد أو تشتري كريديت إضافي، وكل حاجة بتفضل محفوظة زي ما هي." },
  { q: "في تجربة مجانية؟", a: "أيوه، 3 أيام بكل مميزات الاحترافي من غير بطاقة، وبعدها تكمّل على الباقة المجانية أو تشترك." },
];

export function Landing() {
  const { user, loading } = useAuth();
  const [caseKey, setCaseKey] = useState(CASES[0].key);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const appHref = user ? "/app" : "/register";
  const active = CASES.find((c) => c.key === caseKey) ?? CASES[0];

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((res: { plans: PlanDef[] }) => setPlans(res.plans))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="lp-wrap">
        <section className="lp-hero">
          <div>
            <span className="kicker">منصة أتمتة عربية</span>
            <h1>
              شغلك المتكرر
              <br />
              <em>يشتغل لوحده.</em>
            </h1>
            <p className="lp-lead">
              تدفّق بتربط واتساب ومتجرك والسوشيال ميديا وأي API ببعض، والذكاء الاصطناعي يرد على عملاءك ويسجّل طلباتهم وينشر محتواك وانت بتعمل حاجة تانية.
            </p>
            <div className="lp-actions">
              {!loading && (
                <Link className="btn primary lg" to={appHref}>
                  {user ? "افتح لوحة التحكم" : "ابدأ مجاناً"}
                </Link>
              )}
              <Link className="btn lg" to="/templates">
                شوف التيمبلت الجاهزة
              </Link>
            </div>
            <p className="lp-note">3 أيام تجربة بكل المميزات · من غير بطاقة</p>
          </div>
          <ProductWindow />
        </section>
      </div>

      <div className="lp-logos" aria-label="تطبيقات بتتربط">
        <div className="lp-logos-track">
          {[...LOGOS, ...LOGOS].map(([key, name], i) => (
            <span className="lp-logo" key={`${key}-${i}`}>
              <Icon name={key} size={18} /> {name}
            </span>
          ))}
        </div>
      </div>

      <div className="lp-wrap">
        <section className="lp-section">
          <div className="lp-head">
            <h2>من أول رسالة لحد آخر طلب.</h2>
            <p>اختار نوع شغلك وشوف سيناريو حقيقي بيشتغل عند ناس زيك - كلها موجودة كتيمبلت تبدأ منها في دقيقة.</p>
          </div>
          <div className="lp-tabs" role="tablist">
            {CASES.map((c) => (
              <button key={c.key} role="tab" aria-selected={c.key === caseKey} className={`lp-tab ${c.key === caseKey ? "on" : ""}`} onClick={() => setCaseKey(c.key)}>
                {c.tab}
              </button>
            ))}
          </div>
          <div className="lp-case">
            <div>
              <h3>{active.title}</h3>
              <p>{active.text}</p>
              <ul>
                {active.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <Link className="btn" to="/templates">
                التيمبلت الجاهزة
              </Link>
            </div>
            <div className="card lp-chain">
              {active.chain.map(([app, title, note], i) => (
                <div className="lp-chain-step" key={title}>
                  <AppBadge app={app} size={34} />
                  <div>
                    <strong style={{ fontSize: 14 }}>{title}</strong>
                    <small>{note}</small>
                  </div>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-head">
            <h2>مبني للي بيشغّل بيزنس، مش للي بيحب الأدوات.</h2>
            <p>كل حاجة معمولة عشان توصل لنتيجة بسرعة، وتعرف بالظبط إيه اللي حصل لما حاجة ما تمشيش.</p>
          </div>
          <div className="lp-bento">
            <article className="card lp-tile w4">
              <h3>كل تشغيلة مكشوفة قدامك</h3>
              <p>بتشوف كل خطوة وهي بتشتغل، وإيه اللي دخلها وطلع منها. ولو خطوة وقعت، بتعرف السبب بالعربي وتعيد التشغيل.</p>
              <div className="lp-tile-visual mini-log">
                <div>
                  <b>✓</b> trigger.webhook · 0ms
                </div>
                <div>
                  <b>✓</b> ai.generate · gemini · 812ms
                </div>
                <div>
                  <i>✕</i> instagram.post · image URL missing
                </div>
                <div>
                  <b>↻</b> retried · published · 1.2s
                </div>
              </div>
            </article>
            <article className="card lp-tile w2">
              <h3>بوتات بتفتكر</h3>
              <p>كل عميل ليه ذاكرة لوحده.</p>
              <div className="lp-tile-visual mini-chat">
                <span className="in">أنا اللي سألت إمبارح على المقاس</span>
                <span className="out">أيوه يا أحمد، المقاس L رجع تاني ✓</span>
              </div>
            </article>
            <article className="card lp-tile w2">
              <h3>جدولة مظبوطة</h3>
              <p>كل يوم، أيام معينة، أو كل كام دقيقة.</p>
              <div className="lp-tile-visual mini-cal">
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} className={[1, 3, 5, 8, 10, 12].includes(i) ? "on" : ""} />
                ))}
              </div>
            </article>
            <article className="card lp-tile w2">
              <h3>من Claude وChatGPT</h3>
              <p>شغّل سيناريوهاتك بالكلام عن طريق MCP.</p>
              <div className="lp-tile-visual mini-code">{`${window.location.host}/mcp/tdq_••••`}</div>
            </article>
            <article className="card lp-tile w2">
              <h3>أي API في العالم</h3>
              <p>Webhook بيستقبل، وطلب HTTP بيبعت.</p>
              <div className="lp-tile-visual mini-code">POST /webhook/orders → 200</div>
            </article>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-head">
            <h2>معمولة لسوقنا.</h2>
            <p>مش ترجمة لأداة أجنبية - تفاصيل صغيرة كتير بتفرق مع أي حد شغال في مصر والخليج.</p>
          </div>
          <div className="lp-local">
            {LOCAL.map((item) => (
              <div className="lp-local-item" key={item.h}>
                <span className="lp-local-icon">
                  <Icon name={item.icon} size={19} />
                </span>
                <div>
                  <h3>{item.h}</h3>
                  <p>{item.p}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {plans.length > 0 && (
          <section className="lp-section">
            <div className="lp-head">
              <h2>أسعار على قد شغلك.</h2>
              <p>
                ابدأ مجاناً، وادفع لما شغلك يكبر. <Link to="/pricing">قارن الباقات بالتفصيل</Link>
              </p>
            </div>
            <div className="lp-prices">
              {plans.map((plan) => (
                <div key={plan.key} className={`lp-price ${plan.key === "pro" ? "pick" : ""}`}>
                  <h3>{plan.name}</h3>
                  <div className="amount">
                    {money(plan.price.monthly)} <small>/ شهرياً</small>
                  </div>
                  <p>{plan.tagline}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="lp-section">
          <div className="lp-head">
            <h2>أسئلة بتتسأل كتير.</h2>
            <p>
              لو سؤالك مش هنا، <Link to="/help">مركز المساعدة</Link> أو <Link to="/contact">كلّمنا مباشرة</Link>.
            </p>
          </div>
          <div className="lp-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <h2>أول سيناريو ليك ممكن يبقى شغال قبل ما تخلص قهوتك.</h2>
          <div className="lp-actions">
            <Link className="btn primary lg" to={appHref}>
              {user ? "افتح لوحة التحكم" : "ابدأ مجاناً"}
            </Link>
            <Link className="btn lg" to="/contact">
              كلّمنا
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
