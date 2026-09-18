import { useState } from "react";
import { api } from "../api";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import type { CreditPack, PlanDef } from "../types";
import { money, number, PeriodSwitch, type Period } from "./PlanCards";
import { copyText, Modal, useToast } from "./ui";

export type Order = { kind: "plan"; plan: PlanDef; period: Period } | { kind: "credits"; pack: CreditPack };

const total = (order: Order) =>
  order.kind === "credits" ? order.pack.price : order.period === "yearly" ? Math.round(order.plan.price.yearly * 12) : order.plan.price.monthly;

const describe = (order: Order) =>
  order.kind === "credits"
    ? `شراء ${order.pack.name}`
    : `اشتراك باقة «${order.plan.name}» - ${order.period === "yearly" ? "سنوي (12 شهر)" : "شهري (30 يوم)"}`;

/** Manual payment: transfer by wallet / InstaPay, then send the receipt on WhatsApp with a ready-made message. */
export function PayModal({ order: initial, onClose }: { order: Order; onClose: () => void }) {
  const { user } = useAuth();
  const { payment, refresh } = useAccount();
  const toast = useToast();
  const [order, setOrder] = useState(initial);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  if (!payment || !user) return null;

  const usd = total(order);
  const egp = Math.round(usd * payment.egpRate);
  const phoneDigits = payment.phone.replace(/\D/g, "");
  const message = [
    "السلام عليكم، ده إيصال دفع على منصة تدفّق 👋",
    "",
    `الاسم: ${user.name}`,
    `الإيميل: ${user.email}`,
    `رقم الحساب: ${user.id}`,
    `الطلب: ${describe(order)}`,
    `المبلغ: ${money(usd)} (حوالي ${number(egp)} جنيه)`,
    ...(note.trim() ? [`ملاحظة: ${note.trim()}`] : []),
    "",
    "مرفق صورة إيصال التحويل.",
  ].join("\n");
  const whatsapp = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;

  // Record the request (the admin sees it) while WhatsApp opens: no await, so the link isn't blocked on phones.
  const record = () => {
    const body =
      order.kind === "credits"
        ? { kind: "credits", pack: order.pack.key, note }
        : { kind: "plan", plan: order.plan.key, period: order.period, note };
    api("/billing/request", { body })
      .then(refresh)
      .catch(() => {});
    setSent(true);
  };

  return (
    <Modal title={order.kind === "credits" ? "شراء كريديت" : `الاشتراك في «${order.plan.name}»`} onClose={onClose}>
      {order.kind === "plan" && (
        <div style={{ marginBottom: 12 }}>
          <PeriodSwitch period={order.period} onChange={(period) => setOrder({ ...order, period })} />
        </div>
      )}

      <div className="pay-summary">
        <div>
          <div className="faint" style={{ fontSize: 13 }}>
            {describe(order)}
          </div>
          <div className="pay-amount">
            {money(usd)} <span>≈ {number(egp)} جنيه</span>
          </div>
        </div>
        <Icon name={order.kind === "credits" ? "coins" : "crown"} size={30} />
      </div>

      <ol className="pay-steps">
        <li>
          حوّل المبلغ على الرقم ده:
          <div className="pay-phone">
            <span className="mono" dir="ltr">
              {payment.phone}
            </span>
            <button className="btn sm" onClick={() => copyText(payment.phone).then(() => toast("الرقم اتنسخ ✓", "success"))}>
              <Icon name="copy" size={14} /> نسخ
            </button>
          </div>
          <div className="pay-methods">
            {payment.methods.map((m) => (
              <span key={m} className="chip">
                {m}
              </span>
            ))}
          </div>
        </li>
        <li>خد صورة (سكرين شوت) لإيصال التحويل.</li>
        <li>دوس الزرار تحت: واتساب هيفتح برسالة جاهزة فيها اسمك ورقم حسابك وطلبك - ابعتها ومعاها صورة الإيصال.</li>
      </ol>

      <div className="field">
        <label className="label">ملاحظة (اختياري)</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: حوّلت من رقم 010..." />
      </div>

      <a className="btn whatsapp block" href={whatsapp} target="_blank" rel="noreferrer" onClick={record}>
        <Icon name="whatsapp" size={18} /> ابعت الإيصال على واتساب
      </a>
      {sent && (
        <div className="alert success" style={{ marginTop: 12 }}>
          طلبك اتسجّل ✓ أول ما نراجع التحويل {order.kind === "credits" ? "الكريديت هيتضاف لحسابك" : "الباقة هتتفعّل على حسابك"} - عادة خلال ساعات.
        </div>
      )}
      <p className="help" style={{ marginTop: 10 }}>
        المبلغ بالجنيه تقريبي حسب سعر الدولار. لو في أي سؤال ابعتلنا على نفس رقم الواتساب.
      </p>
    </Modal>
  );
}
