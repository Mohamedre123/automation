import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { AppBadge } from "../../components/AppBadge";
import { useReveal } from "../../components/PublicLayout";
import { prettyPhone, useSiteContact, whatsappLink } from "../../components/siteContact";
import { Spinner, useToast } from "../../components/ui";
import { useAuth } from "../../context";
import { Icon } from "../../icons";

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  requires: string[];
  apps: { key: string; name: string }[];
  steps: number;
  starts?: string;
  howTo?: string[];
}

interface CatalogApp {
  key: string;
  name: string;
  color: string;
  group: string;
  triggers: string[];
  actions: string[];
}

function useTemplateUse() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [using, setUsing] = useState("");
  const use = async (id: string) => {
    if (!user) {
      navigate("/register");
      return;
    }
    setUsing(id);
    try {
      const res = await api<{ id: string }>(`/templates/${id}/use`, { method: "POST" });
      navigate(`/app/workflows/${res.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setUsing("");
    }
  };
  return { using, use, signedIn: Boolean(user) };
}

/* ---------- /templates/:id ---------- */
export function TemplateDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<(TemplateSummary & { flow: { app: string; appName: string; name: string; kind: string; description: string }[] }) | null | false>(null);
  const [related, setRelated] = useState<TemplateSummary[]>([]);
  const { using, use, signedIn } = useTemplateUse();
  useReveal([data]);

  useEffect(() => {
    setData(null);
    fetch(`/api/public/templates/${id}`)
      .then((r) => (r.ok ? r.json() : false))
      .then(setData)
      .catch(() => setData(false));
    fetch("/api/public/templates")
      .then((r) => r.json())
      .then(setRelated)
      .catch(() => {});
    window.scrollTo({ top: 0 });
  }, [id]);

  if (data === null) {
    return (
      <div className="empty" style={{ minHeight: "50vh" }}>
        <Spinner size={26} />
      </div>
    );
  }
  if (data === false) {
    return (
      <div className="section">
        <h2>التيمبلت ده مش موجود</h2>
        <p className="muted">
          ممكن يكون اتشال أو الرابط غلط <Link to="/templates">كل التيمبلت</Link>
        </p>
      </div>
    );
  }
  const more = related.filter((t) => t.id !== data.id && t.category === data.category).slice(0, 3);

  return (
    <div className="lp-wrap detail">
      <nav className="crumbs">
        <Link to="/templates">التيمبلت</Link> <span>/</span> <span>{data.category}</span>
      </nav>
      <div className="detail-grid">
        <div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {data.apps.map((app) => (
              <Link key={app.key} to={`/integrations/${app.key}`} className="app-chip">
                <AppBadge app={app.key} size={22} /> {app.name}
              </Link>
            ))}
          </div>
          <h1 className="detail-title">{data.name}</h1>
          <p className="lp-lead">{data.description}</p>
          <div className="lp-actions">
            <button className="btn primary lg" onClick={() => use(data.id)} disabled={Boolean(using)}>
              {using ? <Spinner size={16} /> : signedIn ? "استخدم التيمبلت ده" : "سجّل واستخدمه مجاناً"}
            </button>
            <Link className="btn lg" to="/templates">
              تيمبلت تانية
            </Link>
          </div>

          <h2 className="detail-h">الخطوات بالترتيب</h2>
          <ol className="flow-list">
            {data.flow.map((step, i) => (
              <li key={i}>
                <AppBadge app={step.app} size={34} />
                <div>
                  <strong>{step.name}</strong>
                  <span>{step.kind === "trigger" ? `بيبدأ من ${step.appName}` : step.appName}</span>
                </div>
              </li>
            ))}
          </ol>

          {data.howTo?.length ? (
            <>
              <h2 className="detail-h">إزاي تشغّله</h2>
              <ol className="howto-list">
                {data.howTo.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </>
          ) : null}
        </div>

        <aside className="card detail-side">
          <h3>محتاج إيه قبل ما تبدأ</h3>
          <ul>
            {data.requires.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {!data.requires.length && <li>مفيش - شغال على طول</li>}
          </ul>
          <div className="detail-facts">
            <div>
              <small>عدد الخطوات</small>
              <strong>{data.steps}</strong>
            </div>
            <div>
              <small>بيبدأ</small>
              <strong>{data.starts ?? "يدوي"}</strong>
            </div>
          </div>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            التيمبلت بيتنسخ في حسابك وتقدر تعدّل كل خطوة فيه
          </p>
        </aside>
      </div>

      {more.length > 0 && (
        <section className="lp-section">
          <h2 className="detail-h" style={{ marginTop: 0 }}>
            تيمبلت قريبة
          </h2>
          <div className="grid">
            {more.map((t) => (
              <Link key={t.id} to={`/templates/${t.id}`} className="card related-card">
                <div className="app-stack">
                  {t.apps.slice(0, 4).map((app) => (
                    <AppBadge key={app.key} app={app.key} size={26} />
                  ))}
                </div>
                <strong>{t.name}</strong>
                <span className="faint">{t.steps} خطوات</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- /integrations/:app ---------- */
export function IntegrationDetail() {
  const { app = "" } = useParams();
  const [catalog, setCatalog] = useState<CatalogApp[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    fetch("/api/public/catalog")
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => setCatalog([]));
    fetch("/api/public/templates")
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => {});
    window.scrollTo({ top: 0 });
  }, [app]);

  const entry = catalog?.find((a) => a.key === app);
  const using = useMemo(() => templates.filter((t) => t.apps.some((a) => a.key === app)), [templates, app]);
  const partners = useMemo(() => {
    const counts = new Map<string, { key: string; name: string; n: number }>();
    for (const t of using) for (const a of t.apps) if (a.key !== app) counts.set(a.key, { ...a, n: (counts.get(a.key)?.n ?? 0) + 1 });
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [using, app]);

  if (!catalog) {
    return (
      <div className="empty" style={{ minHeight: "50vh" }}>
        <Spinner size={26} />
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="section">
        <h2>التطبيق ده مش موجود</h2>
        <p className="muted">
          <Link to="/integrations">كل التطبيقات</Link> - ولو التطبيق عنده API تقدر تربطه بخطوة HTTP
        </p>
      </div>
    );
  }

  return (
    <div className="lp-wrap detail">
      <nav className="crumbs">
        <Link to="/integrations">التطبيقات</Link> <span>/</span> <span>{entry.name}</span>
      </nav>
      <div className="int-hero">
        <AppBadge app={entry.key} color={entry.color} size={72} />
        <div>
          <h1 className="detail-title">أتمت {entry.name} مع تدفّق</h1>
          <p className="lp-lead" style={{ marginBottom: 20 }}>
            اربط {entry.name} بباقي تطبيقاتك وبالذكاء الاصطناعي من غير كود - بمفتاحك انت، وفي دقايق
          </p>
          <div className="lp-actions">
            <Link className="btn primary lg" to={user ? "/app/scenarios" : "/register"}>
              {user ? "ابني سيناريو" : "ابدأ مجاناً"}
            </Link>
            <Link className="btn lg" to="/help">
              إزاي أربطه؟
            </Link>
          </div>
        </div>
      </div>

      <div className="int-columns">
        <section>
          <h2 className="detail-h">المحفّزات</h2>
          <p className="faint" style={{ marginTop: -6 }}>
            الحاجات اللي بتشغّل السيناريو
          </p>
          <ul className="int-list">
            {entry.triggers.map((t) => (
              <li key={t}>
                <Icon name="zap" size={15} /> {t}
              </li>
            ))}
            {!entry.triggers.length && <li className="faint">مفيش محفّزات - استخدمه كخطوة بعد أي محفّز تاني</li>}
          </ul>
        </section>
        <section>
          <h2 className="detail-h">الخطوات</h2>
          <p className="faint" style={{ marginTop: -6 }}>
            اللي السيناريو يقدر يعمله فيه
          </p>
          <ul className="int-list">
            {entry.actions.map((a) => (
              <li key={a}>
                <Icon name="play" size={13} /> {a}
              </li>
            ))}
            {!entry.actions.length && <li className="faint">بيستخدم كمحفّز بس</li>}
          </ul>
        </section>
      </div>

      {partners.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 className="detail-h">بيتربط كتير مع</h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {partners.map((p) => (
              <Link key={p.key} to={`/integrations/${p.key}`} className="app-chip">
                <AppBadge app={p.key} size={22} /> {p.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {using.length > 0 && (
        <section className="lp-section" style={{ paddingTop: 48 }}>
          <h2 className="detail-h" style={{ marginTop: 0 }}>
            تيمبلت جاهزة فيها {entry.name}
          </h2>
          <div className="grid">
            {using.slice(0, 9).map((t) => (
              <Link key={t.id} to={`/templates/${t.id}`} className="card related-card">
                <div className="app-stack">
                  {t.apps.slice(0, 4).map((a) => (
                    <AppBadge key={a.key} app={a.key} size={26} />
                  ))}
                </div>
                <strong>{t.name}</strong>
                <span className="faint">{t.steps} خطوات</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- /solutions ---------- */
const SOLUTIONS = [
  {
    id: "stores",
    title: "المتاجر الإلكترونية",
    lead: "من أول ما الطلب ينزل لحد ما يوصل للعميل - من غير ما حد يفتح لوحة المتجر",
    items: [
      "تأكيد كل طلب على واتساب باسم العميل وتفاصيل طلبه",
      "إشعار للفريق على تيليجرام أو Slack مع كل طلب",
      "تسجيل الطلبات في Google Sheets لحساباتك",
      "بوت يرد على أسئلة الأسعار والمقاسات والشحن",
      "بوست يومي لمنتج من مكتبتك بصورة وكابشن",
    ],
    apps: ["salla", "zid", "shopify", "woocommerce", "whatsapp", "sheets"],
    category: "المتاجر الإلكترونية",
  },
  {
    id: "support",
    title: "خدمة العملاء",
    lead: "رد في ثواني على كل عميل، وموظف حقيقي بس لما يكون فعلاً محتاج",
    items: [
      "AI Agent على واتساب وتيليجرام بيرد من معلوماتك",
      "ذاكرة لكل عميل، فالمحادثة بتكمّل من مكان ما وقفت",
      "تحويل تلقائي لموظف مع ملخص المشكلة",
      "تصنيف التذاكر وتنبيه للعاجل",
      "رد تلقائي على التقييمات",
    ],
    apps: ["whatsapp", "telegram", "agent", "gemini", "openai"],
    category: "خدمة العملاء",
  },
  {
    id: "content",
    title: "صناعة المحتوى",
    lead: "المحتوى بيتكتب ويتصمم وينزل في ميعاده على كل المنصات، وانت بتراجع بس",
    items: [
      "كابشن بـ CTA وهاشتاجات مكتوب لكل منصة",
      "صور بالذكاء الاصطناعي بتحافظ على شكل منتجك",
      "نشر مجدول على إنستجرام وفيسبوك وتيك توك وLinkedIn وX",
      "تحويل أي مقال أو صفحة لبوستات",
      "مقال أسبوعي على WordPress وينتشر على كل حساباتك",
    ],
    apps: ["instagram", "facebook", "tiktok", "linkedin", "x", "wordpress"],
    category: "سوشيال ميديا",
  },
  {
    id: "agencies",
    title: "الوكالات والفرق",
    lead: "كل عميل محتمل يوصل للشخص الصح بسرعة، وكل مهمة تتسجل في مكانها",
    items: [
      "فورمات برابط مباشر لأي حملة",
      "تقييم العملاء المحتملين بالذكاء الاصطناعي",
      "Notion وHubSpot وTrello وAirtable",
      "تقارير يومية تلخّص اللي حصل",
      "سيناريوهات تشتغل من Claude وChatGPT عن طريق MCP",
    ],
    apps: ["notion", "hubspot", "slack", "trello", "airtable", "form"],
    category: "المبيعات والتسويق",
  },
];

export function Solutions() {
  const location = useLocation();
  const { user } = useAuth();
  useEffect(() => {
    const target = location.hash.slice(1);
    if (target) window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [location.hash]);

  return (
    <div className="lp-wrap">
      <section className="lp-section" style={{ paddingBottom: 40 }}>
        <span className="kicker">الحلول</span>
        <h1 className="detail-title" style={{ maxWidth: 760 }}>
          أتمتة مبنية حوالين نوع شغلك، مش حوالين الأدوات
        </h1>
        <p className="lp-lead">اختار المجال الأقرب ليك وابدأ من تيمبلت جاهز - كل واحد فيهم شغال عند ناس قبلك</p>
        <div className="sol-jump">
          {SOLUTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </div>
      </section>
      {SOLUTIONS.map((s, i) => (
        <section key={s.id} id={s.id} className="lp-section sol-block">
          <div className="lp-case" style={i % 2 ? { direction: "ltr" } : undefined}>
            <div style={{ direction: "rtl" }}>
              <span className="kicker">{String(i + 1).padStart(2, "0")}</span>
              <h2 style={{ fontSize: 30, marginBottom: 12 }}>{s.title}</h2>
              <p>{s.lead}</p>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="lp-actions">
                <Link className="btn primary" to={user ? "/app/templates" : "/register"}>
                  ابدأ من تيمبلت
                </Link>
                <Link className="btn" to="/templates">
                  شوف التيمبلت
                </Link>
              </div>
            </div>
            <div className="card sol-apps" style={{ direction: "rtl" }}>
              {s.apps.map((app) => (
                <Link key={app} to={`/integrations/${app}`} className="sol-app">
                  <AppBadge app={app} size={44} />
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- /enterprise ---------- */
export function Enterprise() {
  const contact = useSiteContact();
  const text = "السلام عليكم، عايز أعرف أكتر عن تدفّق للشركات";
  return (
    <div className="lp-wrap">
      <section className="lp-section" style={{ paddingBottom: 48 }}>
        <span className="kicker">الشركات</span>
        <h1 className="detail-title" style={{ maxWidth: 780 }}>
          أتمتة على مقاس شركتك، ومعاك فريق بيبنيها
        </h1>
        <p className="lp-lead">لو عندك حجم شغل كبير، أو أنظمة خاصة، أو محتاج حد يبني ويتابع معاك - بنظبط باقة وخطة على مقاسك</p>
        <div className="lp-actions">
          <a className="btn primary lg" href={whatsappLink(contact.whatsapp, text)} target="_blank" rel="noreferrer">
            كلّمنا على واتساب
          </a>
          <a className="btn lg" href={`tel:${contact.phone}`}>
            <span dir="ltr">{prettyPhone(contact.phone)}</span>
          </a>
        </div>
      </section>
      <section className="lp-section">
        <div className="lp-local">
          {[
            { icon: "flows", h: "بنبني معاك", p: "فريقنا يبني أول السيناريوهات مع فريقك ويدرّبهم لحد ما يمشوا لوحدهم" },
            { icon: "plug", h: "تكامل مع أنظمتك", p: "ERP أو CRM داخلي أو أي نظام عنده API - بنربطه ونعمله خطوات جاهزة لفريقك" },
            { icon: "coins", h: "كريديت على قد استخدامك", p: "حجم تشغيل كبير بسعر ثابت متفق عليه، من غير مفاجآت آخر الشهر" },
            { icon: "shield", h: "أمان ومتابعة", p: "مراجعة للصلاحيات والبيانات، ومتابعة للتشغيلات المهمة وتنبيه لو حاجة وقفت" },
            { icon: "send", h: "دعم مباشر", p: "خط واتساب مباشر مع الفريق، وأولوية في الرد" },
            { icon: "sparkles", h: "المساعد الذكي لفريقك", p: "كريديت مساعد أكبر لفريقك كله يبني ويصلّح بالكلام" },
          ].map((item) => (
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
    </div>
  );
}
