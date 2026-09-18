import { useState } from "react";
import { api } from "../api";
import { CREDIT_FAQ, Faq, money, number, PeriodSwitch, PlanCards, type Period } from "../components/PlanCards";
import { formatDateTime, Modal, Spinner, useToast } from "../components/ui";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import type { AccountInfo, PlanDef } from "../types";

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
  if (account.isAdmin) return "حساب الأدمن: كل المميزات مفتوحة ومن غير حدود.";
  if (account.plan.key === "trial") return `فترة التجربة المجانية - باقي ${daysLeft(account.trialEndsAt)} يوم (لحد ${formatDateTime(account.trialEndsAt)})`;
  if (account.plan.key === "free") return "الباقة المجانية - اترقّى عشان تشغّل سيناريوهات أكتر وتفتح المساعد الذكي.";
  return `${account.period === "yearly" ? "اشتراك سنوي" : "اشتراك شهري"} - شغال لحد ${formatDateTime(account.expiresAt)}`;
}

export function Billing() {
  const { account, plans, requests, refresh } = useAccount();
  const { user } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("monthly");
  const [chosen, setChosen] = useState<PlanDef | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  if (!account) {
    return (
      <div className="empty">
        <Spinner />
      </div>
    );
  }
  const pending = requests.find((r) => r.status === "pending");
  const outOfCredits = !account.isAdmin && account.credits <= 0;

  const send = async () => {
    if (!chosen) return;
    setSending(true);
    try {
      await api("/billing/request", { body: { plan: chosen.key, period, note } });
      toast("وصلنا طلبك ✓ هنتواصل معاك لتأكيد الدفع والتفعيل", "success");
      setChosen(null);
      setNote("");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

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
          الكريديت بتاعك خلص - السيناريوهات والمساعد واقفين لحد ما الرصيد يتجدد أو تترقّى لباقة أعلى.
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
          <div className="faint" style={{ fontSize: 12.5 }}>
            {account.plan.key === "trial"
              ? "رصيد التجربة مش بيتجدد - بعد التجربة بتاخد رصيد الباقة المجانية كل شهر."
              : account.resetsAt
                ? `الرصيد بيتجدد ${formatDateTime(account.resetsAt)} · استخدمت الشهر ده ${number(account.creditsUsed)} كريديت${account.assistantUsed ? ` + ${number(account.assistantUsed)} للمساعد` : ""}`
                : ""}
          </div>
        </div>
      </div>

      {pending && (
        <div className="alert success" style={{ margin: "18px 0" }}>
          طلب اشتراك «{plans.find((p) => p.key === pending.plan)?.name ?? pending.plan}» ({pending.period === "yearly" ? "سنوي" : "شهري"}) مستني التفعيل -
          هنتواصل معاك لتأكيد الدفع، وأول ما يتأكد الباقة بتشتغل على حسابك فوراً.
        </div>
      )}

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
            <button className={`btn ${plan.key === "pro" ? "primary" : ""}`} onClick={() => setChosen(plan)} disabled={account.isAdmin}>
              {account.plan.key === plan.key ? "جدّد الباقة" : "اشترك"}
            </button>
          )
        }
      />

      <h2 style={{ fontSize: 20, margin: "34px 0 14px" }}>أسئلة عن الكريديت</h2>
      <Faq items={CREDIT_FAQ} />

      {chosen && (
        <Modal
          title={`الاشتراك في باقة «${chosen.name}»`}
          onClose={() => setChosen(null)}
          footer={
            <>
              <button className="btn" onClick={() => setChosen(null)}>
                إلغاء
              </button>
              <button className="btn primary" onClick={send} disabled={sending}>
                {sending ? <Spinner size={14} /> : "ابعت طلب الاشتراك"}
              </button>
            </>
          }
        >
          <PeriodSwitch period={period} onChange={setPeriod} />
          <div className="card" style={{ padding: 16, margin: "14px 0" }}>
            <div className="plan-price" style={{ fontSize: 26 }}>
              {money(chosen.price[period])} <small>/ شهرياً</small>
            </div>
            <div className="faint">
              {period === "yearly" ? `إجمالي ${money(Math.round(chosen.price.yearly * 12))} في السنة` : "بتدفع كل شهر"} ·{" "}
              {number(chosen.credits + chosen.assistantCredits)} كريديت كل شهر
            </div>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            الدفع الإلكتروني لسه بيتجهز: ابعت الطلب وهنتواصل معاك نأكّد طريقة الدفع (فودافون كاش، إنستاباي، تحويل بنكي أو غيرها)، وأول ما يتأكد الباقة بتتفعّل على حسابك.
          </p>
          <div className="field">
            <label className="label">رقم واتساب أو أي ملاحظة (اختياري)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: 01012345678 - هدفع فودافون كاش" />
          </div>
        </Modal>
      )}
    </div>
  );
}
