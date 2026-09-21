import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { PayModal, type Order } from "../components/Payment";
import { CREDIT_FAQ, Faq, money, number, PeriodSwitch, PlanCards, type Period } from "../components/PlanCards";
import { formatDateTime, Spinner } from "../components/ui";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import type { AccountInfo } from "../types";

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0);

export function CreditMeter({ label, left, total, icon }: { label: string; left: number; total: number; icon: string }) {
  const percent = total ? Math.min(100, Math.round((left / total) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>
          <Icon name={icon} size={15} /> {label}
        </span>
        <strong>
          {number(left)} <span className="faint">/ {number(total)}</span>
        </strong>
      </div>
      <div className="meter-bar">
        <span style={{ width: `${percent}%` }} className={percent <= 10 ? "low" : ""} />
      </div>
    </div>
  );
}

function statusLine(account: AccountInfo) {
  if (account.isAdmin) return "حساب الأدمن: كل المميزات مفتوحة ومن غير حدود";
  if (account.plan.key === "trial") return `فترة التجربة المجانية - باقي ${daysLeft(account.trialEndsAt)} يوم (لحد ${formatDateTime(account.trialEndsAt)})`;
  if (account.plan.key === "free") return "الباقة المجانية - اترقّى عشان تشغّل سيناريوهات أكتر وتفتح المساعد الذكي";
  return `${account.period === "yearly" ? "اشتراك سنوي" : "اشتراك شهري"} - شغال لحد ${formatDateTime(account.expiresAt)}`;
}

export function Billing() {
  const { account, plans, packs, requests } = useAccount();
  const { user } = useAuth();
  const location = useLocation();
  const [period, setPeriod] = useState<Period>("monthly");
  const [order, setOrder] = useState<Order | null>(null);

  // Links from the pricing page (?plan=pro&period=yearly) and "buy credits" (#credits).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const plan = plans.find((p) => p.key === params.get("plan"));
    if (plan && plan.key !== "free") setOrder({ kind: "plan", plan, period: params.get("period") === "yearly" ? "yearly" : "monthly" });
    if (location.hash === "#credits") window.setTimeout(() => document.getElementById("credits")?.scrollIntoView({ behavior: "smooth" }), 150);
  }, [location.search, location.hash, plans]);

  if (!account) {
    return (
      <div className="empty">
        <Spinner />
      </div>
    );
  }
  const pending = requests.filter((r) => r.status === "pending");
  const outOfCredits = !account.isAdmin && account.credits <= 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>الاشتراك والكريديت</h1>
          <p>{statusLine(account)}</p>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
            رقم حسابك: <span className="mono">{user?.id}</span>
          </p>
        </div>
      </div>

      {outOfCredits && (
        <div className="alert error" style={{ marginBottom: 18 }}>
          الكريديت بتاعك خلص - السيناريوهات والمساعد واقفين لحد ما الرصيد يتجدد أو تترقّى لباقة أعلى
        </div>
      )}

      <div className="billing-top">
        <div className="card billing-plan">
          <div className="faint" style={{ fontSize: 13 }}>
            باقتك
          </div>
          <div className="billing-plan-name">
            <Icon name="crown" size={20} /> {account.isAdmin ? "أدمن" : account.plan.name}
          </div>
          <div className="billing-facts">
            <span>
              <Icon name="flows" size={14} /> {account.limits.maxActiveScenarios ? `${account.limits.maxActiveScenarios} سيناريو شغالين` : "سيناريوهات بلا حدود"}
            </span>
            <span>
              <Icon name="clock" size={14} /> أقل فترة {account.limits.minIntervalMinutes} دقيقة
            </span>
            <span>
              <Icon name="sparkles" size={14} /> {account.plan.assistant ? "المساعد الذكي متاح" : "من غير المساعد الذكي"}
            </span>
          </div>
        </div>
        <div className="card billing-credits">
          <CreditMeter label="كريديت المنصة" left={account.credits} total={Math.max(account.monthlyCredits, account.credits)} icon="coins" />
          {(account.monthlyAssistantCredits > 0 || account.assistantCredits > 0) && (
            <CreditMeter
              label="كريديت المساعد الذكي"
              left={account.assistantCredits}
              total={Math.max(account.monthlyAssistantCredits, account.assistantCredits)}
              icon="sparkles"
            />
          )}
          {account.extraCredits + account.extraAssistantCredits > 0 && (
            <div className="faint" style={{ fontSize: 12.5 }}>
              منهم كريديت إضافي اشتريته (ما بينتهيش): {number(account.extraCredits)} للمنصة
              {account.extraAssistantCredits ? ` + ${number(account.extraAssistantCredits)} للمساعد` : ""}
            </div>
          )}
          <a className="btn sm primary" href="#credits" style={{ justifySelf: "start" }}>
            <Icon name="plus" size={14} /> شراء كريديت
          </a>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {account.plan.key === "trial"
              ? "رصيد التجربة مش بيتجدد - بعد التجربة بتاخد رصيد الباقة المجانية كل شهر"
              : account.resetsAt
                ? `الرصيد بيتجدد ${formatDateTime(account.resetsAt)} · استخدمت الشهر ده ${number(account.creditsUsed)} كريديت${account.assistantUsed ? ` + ${number(account.assistantUsed)} للمساعد` : ""}`
                : ""}
          </div>
        </div>
      </div>

      {pending.map((r) => (
        <div key={r.id} className="alert success" style={{ margin: "18px 0 0" }}>
          {r.kind === "credits"
            ? `طلب شراء «${packs.find((p) => p.key === r.pack)?.name ?? r.pack}» (${r.amount}) مستني مراجعة التحويل`
            : `طلب اشتراك «${plans.find((p) => p.key === r.plan)?.name ?? r.plan}» (${r.period === "yearly" ? "سنوي" : "شهري"} - ${r.amount}) مستني مراجعة التحويل`}{" "}
          - أول ما يتأكد بيتفعّل على حسابك فوراً
        </div>
      ))}

      <div className="section-title-row">
        <h2 style={{ fontSize: 20 }}>الباقات</h2>
        <PeriodSwitch period={period} onChange={setPeriod} />
      </div>
      <PlanCards
        plans={plans}
        period={period}
        current={account.isAdmin ? undefined : account.plan.key}
        action={(plan) =>
          plan.key === "free" ? (
            <button className="btn" disabled>
              {account.plan.key === "free" ? "باقتك الحالية" : "متاحة بعد التجربة"}
            </button>
          ) : (
            <button className={`btn ${plan.key === "pro" ? "primary" : ""}`} onClick={() => setOrder({ kind: "plan", plan, period })} disabled={account.isAdmin}>
              {account.plan.key === plan.key ? "جدّد الباقة" : "اشترك"}
            </button>
          )
        }
      />

      <div id="credits" className="section-title-row" style={{ marginTop: 36 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>شراء كريديت إضافي</h2>
          <p className="faint" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
            بيتضاف فوق باقتك وما بينتهيش، وبيتصرف بعد كريديت الشهر
          </p>
        </div>
      </div>
      <div className="packs">
        {packs.map((pack) => (
          <button key={pack.key} className="card pack" onClick={() => setOrder({ kind: "credits", pack })} disabled={account.isAdmin}>
            <Icon name={pack.assistantCredits ? "sparkles" : "coins"} size={22} />
            <strong>{pack.name}</strong>
            <span className="pack-price">{money(pack.price)}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              {pack.assistantCredits ? "للمساعد الذكي" : "للمنصة"}
            </span>
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 20, margin: "34px 0 14px" }}>أسئلة عن الكريديت</h2>
      <Faq items={CREDIT_FAQ} />

      {order && <PayModal order={order} onClose={() => setOrder(null)} />}
    </div>
  );
}
