import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context";
import { AppGlyph, Icon } from "../icons";

const APPS: { key: string; name: string; color: string }[] = [
  { key: "whatsapp", name: "واتساب", color: "#25d366" },
  { key: "telegram", name: "تيليجرام", color: "#229ed9" },
  { key: "instagram", name: "إنستجرام", color: "#e1306c" },
  { key: "facebook", name: "فيسبوك", color: "#1877f2" },
  { key: "gemini", name: "Gemini", color: "#4285f4" },
  { key: "openai", name: "ChatGPT", color: "#10a37f" },
  { key: "anthropic", name: "Claude", color: "#d97757" },
  { key: "webhook", name: "Webhooks", color: "#e5487a" },
  { key: "http", name: "أي API", color: "#2563eb" },
  { key: "schedule", name: "جدولة", color: "#7c5cff" },
  { key: "datastore", name: "مخزن بيانات", color: "#0284c7" },
  { key: "agent", name: "AI Agent", color: "#9333ea" },
];

const FEATURES = [
  {
    icon: "flows",
    title: "محرر مرئي بالسحب والإفلات",
    text: "اربط الخطوات ببعضها على لوحة واحدة، وشوف نتيجة كل خطوة لحظة ما تشتغل - من غير سطر كود.",
  },
  {
    icon: "bot",
    title: "AI Agent بيفكر ويشتغل",
    text: "وكيل ذكي بيرد على عملاءك، يفتكر كل محادثة، ويستخدم أدوات زي حفظ البيانات واستدعاء أي API.",
  },
  {
    icon: "sparkles",
    title: "اختار مزوّد الذكاء الاصطناعي",
    text: "Gemini أو ChatGPT أو Claude - كل عميل بيحط مفتاحه، والسيناريو يشتغل زي ما هو بأي واحد فيهم.",
  },
  {
    icon: "whatsapp",
    title: "واتساب وتيليجرام",
    text: "بوتات ترد على العملاء 24 ساعة، وتستقبل الطلبات وتحفظها وتبعتلك إشعار فوري.",
  },
  {
    icon: "instagram",
    title: "نشر على السوشيال + صور AI",
    text: "بوست واحد ينزل على فيسبوك وإنستجرام وتيليجرام، والصورة نفسها بتتولّد بالذكاء الاصطناعي.",
  },
  {
    icon: "clock",
    title: "جدولة وسجل تشغيل كامل",
    text: "شغّل سيناريوهاتك كل دقيقة أو في ميعاد ثابت، وراجع كل تشغيل خطوة خطوة بمدخلاته ومخرجاته.",
  },
];

const STEPS = [
  { title: "اختار المحفّز", text: "رسالة واتساب، طلب على Webhook، أو ميعاد محدد - ده اللي بيشغّل السيناريو." },
  { title: "ضيف الخطوات", text: "ذكاء اصطناعي، شروط وتفريعات، نداء لأي API، حفظ بيانات، ونشر على المنصات." },
  { title: "فعّله وسيبه يشتغل", text: "جرّبه مرة، وبعدين فعّله وهو هيشتغل لوحده على مدار الساعة وانت متابع من السجل." },
];

const SHOWCASE = [
  { name: "بوت واتساب يرد على العملاء", apps: ["whatsapp", "agent"] },
  { name: "بوست ينشر على كل المنصات", apps: ["webhook", "ai", "instagram", "facebook"] },
  { name: "تقييم العملاء المحتملين", apps: ["webhook", "ai", "telegram"] },
  { name: "تقرير يومي على تيليجرام", apps: ["schedule", "http", "ai", "telegram"] },
];

const colorOf = (key: string) => APPS.find((a) => a.key === key)?.color ?? "#7c5cff";

function AppBadge({ app, size = 34 }: { app: string; size?: number }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, background: colorOf(app) }}>
      <AppGlyph app={app} size={Math.round(size * 0.52)} />
    </span>
  );
}

export function Landing() {
  const { user } = useAuth();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const items = root.current?.querySelectorAll(".reveal") ?? [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "-40px" },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const appHref = user ? "/app" : "/register";

  return (
    <div className="landing" ref={root}>
      <div className="landing-bg" aria-hidden="true">
        <span className="orb a" />
        <span className="orb b" />
        <span className="orb c" />
      </div>

      <div className="landing-inner">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Icon name="zap" size={19} />
            </span>
            تدفّق
          </Link>
          <div className="nav-links" style={{ justifyContent: "center" }}>
            <a className="nav-link" href="#features">
              المميزات
            </a>
            <a className="nav-link" href="#apps">
              التطبيقات
            </a>
            <a className="nav-link" href="#how">
              إزاي تشتغل
            </a>
          </div>
          <div className="nav-side">
            {user ? (
              <Link className="btn primary sm" to="/app">
                لوحة التحكم
              </Link>
            ) : (
              <>
                <Link className="btn ghost sm" to="/login">
                  دخول
                </Link>
                <Link className="btn primary sm" to="/register">
                  ابدأ مجاناً
                </Link>
              </>
            )}
          </div>
        </header>

        <section className="hero">
          <div>
            <span className="eyebrow">
              <Icon name="sparkles" size={15} /> منصة أتمتة عربية بالكامل
            </span>
            <h1>
              أتمت شغلك كله <span className="gradient-text">من غير كود</span>
            </h1>
            <p className="lead">
              اربط واتساب وتيليجرام والسوشيال ميديا وأي API ببعض، وخلي الذكاء الاصطناعي يرد على عملاءك وينشر محتواك ويشتغل
              لوحده 24 ساعة.
            </p>
            <div className="hero-actions">
              <Link className="btn primary lg" to={appHref}>
                <Icon name="zap" size={18} /> {user ? "افتح لوحة التحكم" : "ابدأ مجاناً دلوقتي"}
              </Link>
              <a className="btn lg" href="#how">
                شوف إزاي بيشتغل
              </a>
            </div>
            <div className="hero-points">
              <span>
                <Icon name="check" size={15} style={{ color: "var(--success)" }} /> من غير بطاقة ائتمان
              </span>
              <span>
                <Icon name="check" size={15} style={{ color: "var(--success)" }} /> مفاتيحك متشفّرة
              </span>
              <span>
                <Icon name="check" size={15} style={{ color: "var(--success)" }} /> بالعربي بالكامل
              </span>
            </div>
          </div>

          <div className="flow-preview">
            <div className="flow-row">
              <div className="flow-step">
                <AppBadge app="whatsapp" size={58} />
                <span>رسالة عميل</span>
              </div>
              <span className="flow-line" />
              <div className="flow-step">
                <AppBadge app="agent" size={58} />
                <span>AI Agent</span>
              </div>
              <span className="flow-line" />
              <div className="flow-step">
                <AppBadge app="datastore" size={58} />
                <span>حفظ الطلب</span>
              </div>
              <span className="flow-line" />
              <div className="flow-step">
                <AppBadge app="telegram" size={58} />
                <span>إشعار ليك</span>
              </div>
            </div>
            <div className="result">
              <strong style={{ color: "var(--success)" }}>✓ اتشغل بنجاح</strong> · العميل استلم رده في 3 ثواني، والطلب
              اتسجل، والإشعار وصلك على تيليجرام.
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="section-head reveal">
            <h2>كل اللي محتاجه عشان تأتمت شغلك</h2>
            <p>منصة واحدة بتربط تطبيقاتك ببعض وبالذكاء الاصطناعي، وبتشتغل لوحدها من غير ما تفتح جهازك.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((feature, i) => (
              <article className="feature reveal" key={feature.title} style={{ transitionDelay: `${i * 60}ms` }}>
                <div className="f-icon">
                  <Icon name={feature.icon} size={22} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="apps">
          <div className="section-head reveal">
            <h2>يربط التطبيقات اللي بتشتغل عليها</h2>
            <p>وأي خدمة تانية عندها API - تحطها بنفسك في خطوة واحدة من غير برمجة.</p>
          </div>
          <div className="apps-strip reveal">
            {APPS.map((app) => (
              <span className="app-pill" key={app.key}>
                <AppBadge app={app.key} size={30} />
                {app.name}
              </span>
            ))}
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-head reveal">
            <h2>تلات خطوات وخلاص</h2>
            <p>من فكرة في دماغك لسيناريو شغال في أقل من 5 دقايق.</p>
          </div>
          <div className="steps">
            {STEPS.map((step, i) => (
              <div className="step-card reveal" key={step.title} style={{ transitionDelay: `${i * 80}ms` }}>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-head reveal">
            <h2>تيمبلت جاهزة تبدأ بيها</h2>
            <p>سيناريوهات كاملة تشتغل بضغطة، وتعدّل عليها زي ما تحب.</p>
          </div>
          <div className="feature-grid">
            {SHOWCASE.map((item, i) => (
              <article className="feature reveal" key={item.name} style={{ transitionDelay: `${i * 60}ms` }}>
                <div className="row" style={{ gap: 8, marginBottom: 14 }}>
                  {item.apps.map((app) => (
                    <AppBadge key={app} app={app} size={34} />
                  ))}
                </div>
                <h3 style={{ fontSize: 16 }}>{item.name}</h3>
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="cta reveal">
            <h2>جاهز تبدأ؟</h2>
            <p>اعمل حسابك دلوقتي وشغّل أول سيناريو في دقايق.</p>
            <Link className="btn primary lg" to={appHref}>
              {user ? "افتح لوحة التحكم" : "إنشاء حساب مجاني"}
            </Link>
          </div>
        </section>

        <footer className="landing-footer">تدفّق · منصة أتمتة سيناريوهات العمل © {new Date().getFullYear()}</footer>
      </div>
    </div>
  );
}
