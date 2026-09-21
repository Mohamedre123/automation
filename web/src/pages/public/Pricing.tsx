import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { CREDIT_FAQ, Faq, PeriodSwitch, PlanCards, type Period } from "../../components/PlanCards";
import { useReveal } from "../../components/PublicLayout";
import { Spinner } from "../../components/ui";
import { useAuth } from "../../context";
import { Icon } from "../../icons";
import type { PlanDef } from "../../types";

export function Pricing() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<PlanDef[] | null>(null);
  const [trialDays, setTrialDays] = useState(3);
  const [period, setPeriod] = useState<Period>("monthly");
  useReveal([plans]);

  useEffect(() => {
    api<{ plans: PlanDef[]; trialDays: number }>("/plans")
      .then((res) => {
        setPlans(res.plans);
        setTrialDays(res.trialDays);
      })
      .catch(() => setPlans([]));
  }, []);

  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="coins" size={15} /> الأسعار
        </span>
        <h2>ادفع على قد شغلك</h2>
        <p>
          جرّب كل المميزات {trialDays} أيام مجاناً من غير بطاقة. الذكاء الاصطناعي والتطبيقات بتشتغل بمفاتيحك انت، فبتدفع هنا بس لتشغيل المنصة
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <PeriodSwitch period={period} onChange={setPeriod} />
        </div>
      </div>

      {!plans ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : (
        <PlanCards
          plans={plans}
          period={period}
          action={(plan) => (
            <Link
              className={`btn ${plan.key === "pro" ? "primary" : ""}`}
              to={user ? (plan.key === "free" ? "/app/billing" : `/app/billing?plan=${plan.key}&period=${period}`) : "/register"}
            >
              {plan.key === "free" ? "ابدأ مجاناً" : user ? "اشترك" : `جرّب ${trialDays} أيام مجاناً`}
            </Link>
          )}
        />
      )}

      <div className="card enterprise reveal">
        <div>
          <h3>شركات ووكالات</h3>
          <p className="muted" style={{ margin: 0 }}>
            كريديت أكتر، تكاملات مخصصة لنظامك، استضافة خاصة، ودعم مباشر. كلّمنا ونظبطلك باقة على مقاسك
          </p>
        </div>
        <Link className="btn" to="/contact">
          تواصل معانا
        </Link>
      </div>

      <div className="section-head reveal" style={{ marginTop: 50 }}>
        <h2 style={{ fontSize: 26 }}>أسئلة شائعة</h2>
      </div>
      <Faq items={CREDIT_FAQ} />
    </div>
  );
}
