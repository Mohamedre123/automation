import { Link } from "react-router-dom";
import { useReveal } from "../../components/PublicLayout";
import { useAuth } from "../../context";
import { Icon } from "../../icons";

const PLANS = [
  {
    name: "مجاني",
    price: "0",
    note: "للتجربة والمشاريع الصغيرة",
    features: ["كل التطبيقات والخطوات", "كل التيمبلت", "AI Agent بمفتاحك الخاص", "سجل تشغيل كامل"],
    cta: "ابدأ مجاناً",
    highlight: false,
  },
  {
    name: "احترافي",
    price: "قريباً",
    note: "للأعمال اللي بتعتمد على الأتمتة يومياً",
    features: ["كل مميزات المجاني", "مساعد ذكي يبني الأتمتة معاك ويحل الأخطاء", "تشغيلات أكتر وأولوية في التنفيذ", "دعم فني مباشر"],
    cta: "سجّل واتبلّغ أول ما ينزل",
    highlight: true,
  },
  {
    name: "شركات",
    price: "حسب الطلب",
    note: "للفرق والوكالات",
    features: ["فرق وصلاحيات", "تكاملات مخصصة لشركتك", "استضافة خاصة", "اتفاقية مستوى خدمة"],
    cta: "تواصل معانا",
    highlight: false,
  },
];

export function Pricing() {
  const { user } = useAuth();
  useReveal();
  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="key" size={15} /> الأسعار
        </span>
        <h2>ابدأ مجاناً وكبّر لما تحتاج</h2>
        <p>الباقات المدفوعة لسه بتتجهز - سجّل دلوقتي وهتوصلك أول ما تنزل.</p>
      </div>
      <div className="pricing-grid">
        {PLANS.map((plan, i) => (
          <article className={`card plan reveal ${plan.highlight ? "highlight" : ""}`} key={plan.name} style={{ transitionDelay: `${i * 70}ms` }}>
            {plan.highlight && <span className="plan-badge">الأكثر طلباً</span>}
            <h3>{plan.name}</h3>
            <div className="plan-price">
              {plan.price === "0" ? (
                <>
                  0 <small>جنيه / شهرياً</small>
                </>
              ) : (
                plan.price
              )}
            </div>
            <p className="faint">{plan.note}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={15} style={{ color: "var(--success)", flexShrink: 0 }} /> {feature}
                </li>
              ))}
            </ul>
            <Link
              className={`btn ${plan.highlight ? "primary" : ""}`}
              to={plan.name === "شركات" ? "/contact" : user ? "/app" : "/register"}
            >
              {plan.cta}
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
