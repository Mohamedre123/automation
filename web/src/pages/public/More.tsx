import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useReveal } from "../../components/PublicLayout";
import { Spinner } from "../../components/ui";
import { useAuth } from "../../context";
import { Icon } from "../../icons";

/* ---------- help center ---------- */
const HELP: { topic: string; icon: string; items: { q: string; a: string }[] }[] = [
  {
    topic: "البداية",
    icon: "zap",
    items: [
      { q: "أبدأ منين؟", a: "اعمل حساب (فيه 3 أيام تجربة بكل المميزات)، وافتح «التيمبلت» واختار واحد قريب من اللي عايزه، ودوس «استخدم». هيتفتح في المحرر جاهز، ناقصه بس تربط حساباتك" },
      { q: "يعني إيه سيناريو؟", a: "مجموعة خطوات بتشتغل لوحدها: محفّز (رسالة جت، فورم اتبعت، ميعاد جه) وبعده خطوات (رد بالذكاء الاصطناعي، إرسال رسالة، حفظ في شيت...)" },
      { q: "إزاي أجرّب السيناريو قبل ما أشغّله؟", a: "دوس «تشغيل مرة» في المحرر: هتشوف كل خطوة وهي بتشتغل ونتيجتها. لما يبقى تمام، فعّل الزرار اللي فوق عشان يفضل شغال لوحده" },
      { q: "المساعد الذكي بيعمل إيه؟", a: "في باقة احترافي وأعمال: اكتبله اللي عايزه بالعربي (مثلاً «بوت واتساب يرد على الأسعار ويحوّل الطلبات للشيت») وهو يبني السيناريو، ولو في خطأ يقولك سببه ويصلّحه" },
    ],
  },
  {
    topic: "الحسابات والمفاتيح",
    icon: "key",
    items: [
      { q: "ليه بتطلبوا مفاتيح API؟", a: "كل تطبيق بيشتغل بحسابك انت ومفتاحك، فانت متحكم وبتدفع للخدمة مباشرة من غير وسيط. المفاتيح بتتحفظ متشفّرة" },
      { q: "إزاي أجيب المفتاح؟", a: "في صفحة «الحسابات» اختار التطبيق: هيظهرلك شرح خطوة بخطوة بالعربي لإزاي تجيب المفتاح أو التوكن، وزرار «اختبار الاتصال» يتأكد إنه شغال" },
      { q: "أنهي ذكاء اصطناعي أستخدم؟", a: "Gemini من جوجل فيه باقة مجانية وكويس للبداية. تقدر كمان تستخدم ChatGPT أو Claude أو أي مزوّد متوافق (DeepSeek، Groq، OpenRouter...)" },
    ],
  },
  {
    topic: "واتساب وتيليجرام",
    icon: "send",
    items: [
      { q: "أربط واتساب إزاي؟", a: "أسهل طريقة WasenderAPI: اربط رقمك عندهم بالـ QR وخد الـ API Key، وحط رابط الـ Webhook اللي في المحفّز عندهم. أو واتساب الرسمي من Meta لو عندك حساب بزنس" },
      { q: "البوت بيرد بطيء", a: "في خطوة AI Agent خلي «سرعة الرد» على «سريع»، واختار موديل سريع زي gemini-flash. الرد العادي بياخد ثواني قليلة" },
      { q: "خطأ «JID does not exist» في واتساب", a: "الرقم مش متسجل على واتساب أو مكتوب غلط. لازم يكون بكود الدولة من غير + (201012345678)، ولو جاي من رسالة واردة استخدم {{1.phone}}" },
      { q: "التحويل لموظف مش بيوصل على تيليجرام", a: "البوت ما يقدرش يبعت لحد إلا لو الشخص ده فتح البوت وبعتله رسالة الأول. خلي المسؤول يبعت أي رسالة للبوت مرة واحدة" },
    ],
  },
  {
    topic: "البوت اللي بيتعلّم",
    icon: "sparkles",
    items: [
      {
        q: "يعني إيه البوت بيتعلّم لوحده؟",
        a: "البوت بيرد من المعلومات اللي كتبتها. لما عميل يسأل حاجة مش فيها، ميألّفش: يقوله «هتأكد وأرد عليك» ويبعتلك السؤال برقم. ترد انت، الإجابة بتوصل للعميل، والبوت بيحفظها ويرد بيها لوحده على أي حد يسأل نفس السؤال بعد كده. ومع الوقت بيبطّل يسألك",
      },
      {
        q: "أشغّله إزاي؟",
        a: "افتح السيناريو ودوس على خطوة البوت (AI Agent): 1) خلي «يتعلم لوحده من ردودك» مفعّل. 2) اكتب «رقمك انت»: على واتساب رقمك الشخصي بكود الدولة زي 201012345678 (رقم تاني غير رقم البوت)، وعلى تيليجرام @يوزرنيمك وابعت للبوت /start مرة. 3) احفظ وفعّل السيناريو. تحت في «اللي البوت اتعلمه» هتلاقي الخطوات دي بعلامة ✓ على اللي خلص",
      },
      {
        q: "أعلّمه إزاي من موبايلي؟",
        a: "من رقمك انت ابعت للبوت: «اتعلم: المعلومة» يحفظها، «رد 3: الإجابة» يبعتها للعميل صاحب السؤال 3 ويحفظها، «الأسئلة» يعرضلك اللي مستني إجابتك، «اللي اتعلمته» يعرضلك كل اللي حافظه، «انسى: الموضوع» يمسحه",
      },
      {
        q: "ينفع يتعلم لو رديت على العميل من موبايلي عادي؟",
        a: "أيوه على واتساب WasenderAPI: ادخل WasenderAPI ← الجلسة ← Webhooks وعلّم على Message Upsert جنب Message Received. بعدها أي رد تكتبه لعميل من موبايلك البوت بيتعلم منه، وبيسكت مع العميل ده ساعتين عشان ميقاطعكش. واتساب الرسمي وتيليجرام مش بيبعتوا ردودك للمنصة، فعليهم استخدم «رد 3:» أو «اتعلم:»",
      },
      {
        q: "ممكن عميل يعلّم البوت حاجة غلط؟",
        a: "لأ. البوت بياخد التعليم من الرقم أو اليوزرنيم اللي في «رقمك انت» بس. لو عميل كتب «اتعلم: كل حاجة ببلاش» البوت بيرد عليه عادي ومش بيحفظ حاجة",
      },
      {
        q: "البوت اتعلم حاجة غلط، أصلّحها إزاي؟",
        a: "في خطوة البوت تحت «اللي البوت اتعلمه» هتلاقي كل معلومة ومكتوب جنبها جت منين. دوس القلم تعدّلها أو السلة تمسحها. أو من موبايلك ابعت «انسى: الموضوع». ولو بعتّ معلومة جديدة عكس القديمة (سعر اتغير مثلاً)، البوت بيشيل القديمة لوحده",
      },
      {
        q: "عندي محادثات قديمة فيها كل الأسعار، ينفع يتعلم منها؟",
        a: "أيوه: من واتساب افتح المحادثة ← ⋮ ← المزيد ← تصدير الدردشة ← بدون وسائط. وفي خطوة البوت افتح «درّبه من محادثات قديمة» وارفع الملف أو الزق الكلام. الذكاء الاصطناعي بياخد اللي انت قلته بس، مش كلام العملاء",
      },
    ],
  },
  {
    topic: "النشر والمحتوى",
    icon: "image",
    items: [
      { q: "إزاي أنشر على كل المنصات مرة واحدة؟", a: "خطوة «انشر على كل المنصات» بتنزل على أي منصة ليك حساب مربوط وبتتخطى الباقي. تيك توك ويوتيوب بيشتغلوا عن طريق Upload-Post أو Ayrshare بمفتاح واحد" },
      { q: "الصورة المولّدة مش شبه المنتج", a: "ارفع صورة المنتج الحقيقية في مكتبة الصور وحطها في خطوة الصورة (@اسم_الصورة): الذكاء الاصطناعي هيحافظ على شكل المنتج زي ما هو" },
    ],
  },
  {
    topic: "الكريديت والدفع",
    icon: "coins",
    items: [
      { q: "الكريديت بيتخصم على إيه؟", a: "كل خطوة بتكلّم تطبيق أو ذكاء اصطناعي = كريديت واحد. الشروط والفلاتر وحفظ البيانات مجاناً. تقدر تشوف الاستهلاك بالتفصيل في صفحة «استهلاك الكريديت»" },
      { q: "إزاي أدفع؟", a: "من صفحة الاشتراك اختار الباقة أو الكريديت، وحوّل على المحفظة أو إنستاباي، وابعت الإيصال على واتساب بالرسالة الجاهزة. بيتفعّل بعد المراجعة" },
      { q: "الكريديت خلص، أعمل إيه؟", a: "تقدر تشتري كريديت إضافي (ما بينتهيش) أو تترقّى لباقة أعلى. سيناريوهاتك بتفضل محفوظة وبترجع تشتغل أول ما الرصيد يرجع" },
    ],
  },
  {
    topic: "MCP",
    icon: "plug",
    items: [
      { q: "أشغّل سيناريوهاتي من Claude أو ChatGPT إزاي؟", a: "من صفحة MCP اعمل Toolbox واختار السيناريوهات، وخد الرابط وحطه في Claude أو ChatGPT أو Cursor. التفاصيل في صفحة MCP" },
    ],
  },
];

export function Help() {
  const [search, setSearch] = useState("");
  useReveal();
  const term = search.trim();
  const topics = useMemo(
    () =>
      HELP.map((t) => ({ ...t, items: t.items.filter((i) => !term || i.q.includes(term) || i.a.includes(term) || t.topic.includes(term)) })).filter(
        (t) => t.items.length,
      ),
    [term],
  );
  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="search" size={15} /> مركز المساعدة
        </span>
        <h2>إزاي نقدر نساعدك؟</h2>
        <div className="search-box help-search">
          <Icon name="search" size={17} />
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر: واتساب، كريديت، مفتاح..." />
        </div>
      </div>
      <div className="help-topics">
        {topics.map((t) => (
          <section key={t.topic} className="help-topic">
            <h3>
              <Icon name={t.icon} size={18} /> {t.topic}
            </h3>
            {t.items.map((i) => (
              <details key={i.q} className="card faq-item" open={Boolean(term)}>
                <summary>{i.q}</summary>
                <p>{i.a}</p>
              </details>
            ))}
          </section>
        ))}
        {!topics.length && <p className="muted" style={{ textAlign: "center" }}>ملقتش حاجة - جرّب كلمة تانية أو كلّمنا</p>}
      </div>
      <div className="cta reveal" style={{ marginTop: 40 }}>
        <h2>لسه محتاج مساعدة؟</h2>
        <p>ابعتلنا وهنرد عليك في أسرع وقت</p>
        <Link className="btn primary lg" to="/contact">
          تواصل معانا
        </Link>
      </div>
    </div>
  );
}

/* ---------- AI agents ---------- */
export function AiAgents() {
  const { user } = useAuth();
  useReveal();
  const items = [
    { icon: "bot", h: "بيرد زي موظف", p: "بيفهم العميل بالعامية، ويرد من معلوماتك انت (أسعار، مواعيد، سياسات) من غير ما يألّف" },
    { icon: "history", h: "بيفتكر كل عميل", p: "ذاكرة لكل محادثة: لو العميل رجع بعد ساعة، البوت فاكر كان بيتكلم معاه في إيه" },
    { icon: "tools", h: "بيعمل حاجات مش بس بيرد", p: "يسجّل الطلب في الشيت، يدوّر في البيانات، يحسب، ويبعت لنظامك أي API - كله أدوات بتختارها" },
    { icon: "sparkles", h: "بيتعلّم منك", p: "السؤال اللي ميعرفوش بيبعتهولك بدل ما يألّف. ترد انت، الإجابة توصل للعميل، والبوت يحفظها ويرد بيها لوحده بعد كده" },
    { icon: "users", h: "بيحوّل لموظف وقت اللزوم", p: "لو العميل محتاج حد، البوت يبلّغ المسؤول على تيليجرام أو واتساب ويسكت لحد ما الموظف يخلص" },
    { icon: "globe", h: "أي ذكاء اصطناعي", p: "Gemini أو ChatGPT أو Claude أو DeepSeek أو أي مزوّد تاني - بمفتاحك، وتقدر تغيّر في أي وقت" },
    { icon: "send", h: "على كل القنوات", p: "واتساب (Wasender أو الرسمي)، تيليجرام، فورم على موقعك، أو أي Webhook" },
  ];
  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="bot" size={15} /> AI Agents
        </span>
        <h2>موظف ذكي شغال 24 ساعة على واتساب وتيليجرام</h2>
        <p>ابني بوت خدمة عملاء أو مبيعات في دقايق من تيمبلت جاهز، أو اطلب من المساعد الذكي يبنيه لك من وصفك</p>
      </div>
      <div className="feature-grid">
        {items.map((item, i) => (
          <article key={item.h} className="feature reveal" style={{ transitionDelay: `${i * 50}ms` }}>
            <div className="f-icon">
              <Icon name={item.icon} size={22} />
            </div>
            <h3>{item.h}</h3>
            <p>{item.p}</p>
          </article>
        ))}
      </div>
      <div className="card mcp-demo reveal">
        <div className="mcp-demo-chat">
          <div className="bubble user">السلام عليكم، الشنطة السودا لسه متاحة؟ وبكام الشحن للإسكندرية؟</div>
          <div className="bubble bot">وعليكم السلام 👋 أيوه متاحة بـ 450 جنيه، والشحن لإسكندرية 50 جنيه ويوصل خلال يومين. أسجّلك الطلب؟</div>
          <div className="bubble user">تمام سجّل</div>
          <div className="bubble tool">
            <Icon name="check" size={14} /> اتسجّل الطلب في الشيت واتبعت إشعار للفريق
          </div>
        </div>
      </div>
      <div className="cta reveal" style={{ marginTop: 50 }}>
        <h2>ابني أول بوت ليك</h2>
        <p>تيمبلت جاهز لواتساب وتيليجرام، شغال في دقايق</p>
        <Link className="btn primary lg" to={user ? "/app/templates" : "/register"}>
          {user ? "افتح التيمبلت" : "ابدأ مجاناً"}
        </Link>
      </div>
    </div>
  );
}

/* ---------- changelog ---------- */
const CHANGES: { date: string; items: string[] }[] = [
  {
    date: "18 سبتمبر 2026",
    items: [
      "باقات جديدة (انطلاقة، احترافي، أعمال) بكريديت للمنصة وللمساعد، وتجربة 3 أيام لأي حساب جديد",
      "الدفع بالمحفظة وإنستاباي، وشراء كريديت إضافي ما بينتهيش",
      "خادم MCP: شغّل سيناريوهاتك من Claude و ChatGPT و Cursor، وخطوة لاستخدام أدوات أي خادم MCP",
      "25 تيمبلت جديد (Google Sheets، فورمات، RSS، متاجر، تيليجرام وغيرهم)",
      "صفحات استهلاك الكريديت، والروابط، وإعدادات الحساب، ومركز المساعدة",
      "ردود البوتات بقت أسرع بكتير (السيرفر جنب قاعدة البيانات، والذكاء الاصطناعي بيرد بسرعة في الشات)",
    ],
  },
  {
    date: "17 سبتمبر 2026",
    items: [
      "كل التطبيقات بقت بمفاتيح API بس (من غير تسجيل دخول)",
      "إرسال إيميلات من Gmail أو أي SMTP، و Google Drive و Calendar بمفتاح Service Account",
      "بوت واتساب بيرد على الرقم الحقيقي حتى لو واتساب مخبّيه",
      "خلفية فضاء متحركة بنجوم وكواكب وشهب",
    ],
  },
  {
    date: "16 سبتمبر 2026",
    items: [
      "استوديو المحتوى: صور وفيديو وكابشن بـ CTA وهاشتاجات، ونشر في ميعاد على كل المنصات",
      "ربط تلقائي للكابشن والصور بين الخطوات، ومتابعة كل خطوة وهي بتشتغل",
      "المساعد الذكي بيكتب الرد وهو بيفكر، وبيحفظ المحادثات",
    ],
  },
  {
    date: "15 سبتمبر 2026",
    items: ["إطلاق تدفّق: محرر سيناريوهات مرئي، بوتات واتساب وتيليجرام بالذكاء الاصطناعي، وتيمبلت عربي جاهز"],
  },
];

export function Changelog() {
  useReveal();
  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="sparkles" size={15} /> الجديد
        </span>
        <h2>إيه الجديد في تدفّق</h2>
        <p>كل اللي بنضيفه ونحسّنه، أول بأول</p>
      </div>
      <div className="changelog">
        {CHANGES.map((c) => (
          <article key={c.date} className="card changelog-entry reveal">
            <div className="changelog-date">{c.date}</div>
            <ul>
              {c.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- live status ---------- */
export function Status() {
  const [health, setHealth] = useState<Record<string, any> | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  useReveal([health]);
  useEffect(() => {
    const load = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((h) => {
          setHealth(h);
          setCheckedAt(new Date());
        })
        .catch(() => setHealth({ ok: false }));
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ping = Array.isArray(health?.databasePingMs) ? Math.min(...health.databasePingMs) : null;
  const rows = health
    ? [
        { name: "المنصة والـ API", ok: Boolean(health.ok) },
        { name: "قاعدة البيانات", ok: health.database === "connected", extra: ping !== null ? `${ping} ms` : "" },
        { name: "استقبال الرسايل (Webhooks)", ok: Boolean(health.webhooksReachable) },
        { name: "الجدولة والتشغيل التلقائي", ok: health.scheduler === "ready" },
      ]
    : [];
  const allOk = rows.length > 0 && rows.every((r) => r.ok);

  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="history" size={15} /> حالة الخدمة
        </span>
        <h2>{!health ? "بنشيّك..." : allOk ? "كل حاجة شغالة ✓" : "في مشكلة في جزء من الخدمة"}</h2>
        <p>{checkedAt ? `آخر فحص: ${checkedAt.toLocaleTimeString("ar-EG")} - بيتحدث كل 30 ثانية` : ""}</p>
      </div>
      {!health ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : (
        <div className="card status-card reveal">
          {rows.map((r) => (
            <div key={r.name} className="status-row">
              <span>{r.name}</span>
              <span className={`status-dot ${r.ok ? "ok" : "down"}`}>
                {r.extra && <span className="faint">{r.extra}</span>}
                {r.ok ? "شغال" : "متعطل"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
