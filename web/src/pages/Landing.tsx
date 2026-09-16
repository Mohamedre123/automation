import { Fragment } from "react";
import { Link } from "react-router-dom";
import { AppBadge } from "../components/AppBadge";
import { useReveal } from "../components/PublicLayout";
import { useAuth } from "../context";
import { Icon } from "../icons";

const HIGHLIGHTS = [
  { icon: "flows", title: "محرر مرئي", text: "اسحب واربط الخطوات وشوف نتيجة كل خطوة لحظة ما تشتغل." },
  { icon: "bot", title: "AI Agent", text: "وكيل ذكي يرد على عملاءك ويفتكر محادثاتهم ويستخدم أدوات." },
  { icon: "whatsapp", title: "واتساب وتيليجرام", text: "بوتات ترد 24 ساعة وتستقبل الطلبات وتحوّل العميل ليك." },
  { icon: "instagram", title: "نشر وصور بالـ AI", text: "بوست واحد ينزل على كل المنصات بصورة متولّدة." },
];

const STEPS = [
  { title: "اختار المحفّز", text: "رسالة واتساب، فورم، ميعاد محدد، أو أي حدث من تطبيق." },
  { title: "ضيف الخطوات", text: "ذكاء اصطناعي، شروط، نداء أي API، حفظ بيانات، ونشر." },
  { title: "فعّله وسيبه يشتغل", text: "جرّبه مرة، وبعدين فعّله وتابع كل تشغيل من السجل." },
];

const TEASER_APPS = ["whatsapp", "telegram", "instagram", "facebook", "gemini", "openai", "anthropic", "webhook", "http", "schedule"];

export function Landing() {
  const { user, loading } = useAuth();
  useReveal();
  const appHref = user ? "/app" : "/register";

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Icon name="sparkles" size={15} /> منصة أتمتة عربية بالكامل
          </span>
          <h1>
            أتمت شغلك كله <span className="gradient-text">من غير كود</span>
          </h1>
          <p className="lead">
            اربط واتساب وتيليجرام والسوشيال ميديا وأي API ببعض، وخلي الذكاء الاصطناعي يرد على عملاءك وينشر محتواك ويشتغل لوحده
            24 ساعة.
          </p>
          <div className="hero-actions">
            {!loading && (
              <Link className="btn primary lg" to={appHref}>
                <Icon name="zap" size={18} /> {user ? "افتح لوحة التحكم" : "ابدأ مجاناً دلوقتي"}
              </Link>
            )}
            <Link className="btn lg" to="/templates">
              تصفّح التيمبلت
            </Link>
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

        <div className="flow-preview" aria-hidden="true">
          <div className="flow-row">
            {[
              ["whatsapp", "رسالة عميل"],
              ["agent", "AI Agent"],
              ["datastore", "حفظ الطلب"],
              ["telegram", "إشعار ليك"],
            ].map(([app, label], i) => (
              <Fragment key={app}>
                {i > 0 && <span className="flow-line" style={{ ["--delay" as string]: `${i * 0.8}s` }} />}
                <div className="flow-step" style={{ animationDelay: `${i * 0.15}s` }}>
                  <AppBadge app={app} size={54} />
                  <span>{label}</span>
                </div>
              </Fragment>
            ))}
          </div>
          <div className="result">
            <strong style={{ color: "var(--success)" }}>✓ اتشغل بنجاح</strong> · العميل استلم رده في 3 ثواني، والطلب اتسجل،
            والإشعار وصلك.
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head reveal">
          <h2>كل اللي محتاجه عشان تأتمت شغلك</h2>
          <p>منصة واحدة بتربط تطبيقاتك ببعض وبالذكاء الاصطناعي، وبتشتغل لوحدها.</p>
        </div>
        <div className="feature-grid">
          {HIGHLIGHTS.map((item, i) => (
            <article className="feature reveal" key={item.title} style={{ transitionDelay: `${i * 60}ms` }}>
              <div className="f-icon">
                <Icon name={item.icon} size={22} />
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
        <div className="center-link reveal">
          <Link className="btn" to="/features">
            كل المميزات <Icon name="arrowRight" size={15} style={{ transform: "scaleX(-1)" }} />
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section-head reveal">
          <h2>يربط التطبيقات اللي بتشتغل عليها</h2>
          <p>وأي خدمة تانية عندها API - تضيفها في خطوة واحدة.</p>
        </div>
        <div className="apps-strip reveal">
          {TEASER_APPS.map((app) => (
            <AppBadge key={app} app={app} size={52} />
          ))}
        </div>
        <div className="center-link reveal">
          <Link className="btn" to="/integrations">
            كل التطبيقات <Icon name="arrowRight" size={15} style={{ transform: "scaleX(-1)" }} />
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section-head reveal">
          <h2>تلات خطوات وخلاص</h2>
          <p>من فكرة لسيناريو شغال في دقايق.</p>
        </div>
        <div className="steps-grid">
          {STEPS.map((step, i) => (
            <div className="step-card reveal" key={step.title} style={{ transitionDelay: `${i * 80}ms` }}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
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
    </>
  );
}
