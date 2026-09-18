import type { ReactNode } from "react";
import { Icon } from "../icons";
import type { PlanDef, PlanKey } from "../types";

export type Period = "monthly" | "yearly";

export const money = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
export const number = (value: number) => value.toLocaleString("en-US");

export function PeriodSwitch({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  return (
    <div className="period-switch" role="tablist" aria-label="طريقة الدفع">
      <button role="tab" aria-selected={period === "monthly"} className={period === "monthly" ? "on" : ""} onClick={() => onChange("monthly")}>
        شهري
      </button>
      <button role="tab" aria-selected={period === "yearly"} className={period === "yearly" ? "on" : ""} onClick={() => onChange("yearly")}>
        سنوي <span className="save-pill">وفّر 15%</span>
      </button>
    </div>
  );
}

/** Price, credits split and features of every public plan. `action` renders each card's button. */
export function PlanCards({
  plans,
  period,
  current,
  action,
}: {
  plans: PlanDef[];
  period: Period;
  current?: PlanKey;
  action: (plan: PlanDef) => ReactNode;
}) {
  return (
    <div className="pricing-grid plans-4">
      {plans.map((plan) => {
        const price = plan.price[period];
        const highlight = plan.key === "pro";
        return (
          <article key={plan.key} className={`card plan ${highlight ? "highlight" : ""} ${current === plan.key ? "current" : ""}`}>
            {highlight && <span className="plan-badge">الأكثر طلباً</span>}
            {current === plan.key && <span className="plan-badge current-badge">باقتك الحالية</span>}
            <h3>{plan.name}</h3>
            <p className="faint" style={{ margin: 0, minHeight: 40 }}>
              {plan.tagline}
            </p>
            <div className="plan-price">
              {money(price)} <small>/ شهرياً</small>
            </div>
            <div className="faint" style={{ fontSize: 12.5, minHeight: 18 }}>
              {price === 0 ? "مجاناً على طول" : period === "yearly" ? `بتدفع ${money(Math.round(price * 12))} مرة واحدة في السنة` : "بتدفع كل شهر"}
            </div>
            <div className="plan-credits">
              <div>
                <Icon name="coins" size={15} /> <strong>{number(plan.credits + plan.assistantCredits)}</strong> كريديت / شهر
              </div>
              {plan.assistantCredits > 0 && (
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {number(plan.credits)} للمنصة + {number(plan.assistantCredits)} للمساعد الذكي
                </div>
              )}
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={15} style={{ color: "var(--success)", flexShrink: 0, marginTop: 3 }} /> {feature}
                </li>
              ))}
            </ul>
            {action(plan)}
          </article>
        );
      })}
    </div>
  );
}

export const CREDIT_FAQ: { q: string; a: string }[] = [
  {
    q: "يعني إيه كريديت؟",
    a: "كل خطوة بتشتغل في السيناريو بتاخد كريديت واحد: مثلاً سيناريو فيه «رسالة واتساب ← AI Agent ← رد» بياخد 2 كريديت في كل رسالة. المحفّز والخطوات اللي اتخطّت مجاناً.",
  },
  {
    q: "الذكاء الاصطناعي والتطبيقات بيتحسبوا عليّ؟",
    a: "لا. كل التطبيقات والذكاء الاصطناعي بتشتغل بمفاتيحك انت (Gemini أو ChatGPT أو غيرهم)، فاستهلاكهم على حسابك عندهم. الكريديت هنا بس لتشغيل المنصة.",
  },
  {
    q: "كريديت المساعد الذكي ده إيه؟",
    a: "المساعد اللي بيبني السيناريوهات ويصلّح الأخطاء شغال على حساب المنصة، وليه رصيد لوحده في باقة احترافي وماكس. الرسالة العادية بتاخد تقريباً من 3 لـ 10 كريديت حسب طولها، وأول رسالة في كل محادثة جديدة بتاخد أكتر شوية.",
  },
  {
    q: "إيه اللي بيحصل لما الكريديت يخلص؟",
    a: "السيناريوهات والمساعد بيقفوا لحد ما الرصيد يتجدد أول الشهر الجاي، أو تترقّى لباقة أعلى. سيناريوهاتك وبياناتك كلها بتفضل محفوظة زي ما هي.",
  },
  {
    q: "الكريديت اللي ما استخدمتوش بيترحّل؟",
    a: "لا، الرصيد بيتجدد كل شهر بقيمة الباقة.",
  },
  {
    q: "في تجربة مجانية؟",
    a: "أيوه، أي حساب جديد بياخد 3 أيام بكل مميزات الاحترافي (فيها المساعد الذكي). بعدها بيتحول للباقة المجانية لحد ما تشترك.",
  },
];

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.q} className="card faq-item">
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
