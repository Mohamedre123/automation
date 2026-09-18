import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { number } from "../components/PlanCards";
import { copyText, formatDateTime, Modal, Spinner, timeAgo, useToast } from "../components/ui";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import type { AccountInfo, CreditPack, PlanDef, PlanKey } from "../types";

interface AdminUser extends AccountInfo {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  workflows: number;
  activeWorkflows: number;
  runs30d: number;
}

interface AdminRequest {
  id: string;
  userId: string;
  kind: "plan" | "credits";
  pack: string;
  amount: string;
  plan: PlanKey;
  period: "monthly" | "yearly";
  note: string;
  status: "pending" | "done" | "rejected";
  createdAt: string;
  email: string;
  name: string;
}

const PLAN_TONE: Record<string, string> = { free: "", trial: "running", core: "brand", pro: "success", max: "success" };

function planLine(user: AdminUser) {
  if (user.isAdmin) return "أدمن - كل حاجة مفتوحة";
  if (user.plan.key === "trial") return `تجربة - بتخلص ${formatDateTime(user.trialEndsAt)}`;
  if (user.plan.key === "free") return "مجاني";
  return `${user.period === "yearly" ? "سنوي" : "شهري"} - لحد ${formatDateTime(user.expiresAt)}`;
}

export function Admin() {
  const { user } = useAuth();
  const { refresh: refreshMine } = useAccount();
  const toast = useToast();
  const [data, setData] = useState<{ users: AdminUser[]; requests: AdminRequest[]; plans: PlanDef[]; packs: CreditPack[] } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PlanKey>("all");
  const [managing, setManaging] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    api<{ users: AdminUser[]; requests: AdminRequest[]; plans: PlanDef[]; packs: CreditPack[] }>("/admin/users")
      .then(setData)
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.users ?? []).filter(
      (u) =>
        (filter === "all" || u.plan.key === filter) &&
        (!term || u.email.toLowerCase().includes(term) || u.name.toLowerCase().includes(term) || u.id.toLowerCase().includes(term)),
    );
  }, [data, search, filter]);

  if (!user?.isAdmin) return <Navigate to="/app" replace />;
  if (!data) {
    return (
      <div className="empty">
        <Spinner />
      </div>
    );
  }

  const pending = data.requests.filter((r) => r.status === "pending");
  const paid = data.users.filter((u) => ["core", "pro", "max"].includes(u.plan.key)).length;
  const trials = data.users.filter((u) => u.plan.key === "trial").length;
  const planName = (key: string) => data.plans.find((p) => p.key === key)?.name ?? key;

  const setPlan = async (userId: string, plan: PlanKey, period: "monthly" | "yearly" = "monthly", days?: number) => {
    try {
      await api(`/admin/users/${userId}/plan`, { body: { plan, period, days } });
      toast(plan === "free" ? "الباقة اتقفلت ورجع للمجاني" : `اتفعّلت باقة «${planName(plan)}» ✓`, "success");
      load();
      refreshMine();
      setManaging(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const decide = async (r: AdminRequest, status: "done" | "rejected") => {
    try {
      await api(`/admin/requests/${r.id}`, { body: { status } });
      toast(status === "rejected" ? "الطلب اترفض" : r.kind === "credits" ? "الكريديت اتضاف ✓" : "الباقة اتفعّلت ✓", "success");
      refreshMine();
    } catch (e) {
      toast((e as Error).message, "error");
    }
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>لوحة الأدمن</h1>
          <p>كل الحسابات المسجلة، وتفعيل الباقات والتجربة والكريديت من هنا.</p>
        </div>
        <button className="btn" onClick={load}>
          <Icon name="history" size={16} /> تحديث
        </button>
      </div>

      <div className="stats">
        <div className="card stat">
          <div className="stat-label">كل المستخدمين</div>
          <div className="stat-value">{number(data.users.length)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">مشتركين مدفوع</div>
          <div className="stat-value">{number(paid)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">في فترة التجربة</div>
          <div className="stat-value">{number(trials)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">طلبات دفع مستنية</div>
          <div className="stat-value">{number(pending.length)}</div>
        </div>
      </div>

      <MailCard />
      <SettingsCard />

      {pending.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 22 }}>
          <h3 style={{ marginBottom: 4 }}>
            <Icon name="crown" size={17} /> طلبات الدفع
          </h3>
          <p className="faint" style={{ margin: "0 0 12px", fontSize: 13 }}>
            قارن كل طلب بصورة الإيصال اللي وصلتك على واتساب (فيها نفس رقم الحساب) قبل التفعيل.
          </p>
          <div className="admin-requests">
            {pending.map((r) => (
              <div key={r.id} className="admin-request">
                <div style={{ minWidth: 0 }}>
                  <strong>{r.name}</strong> <span className="faint">{r.email}</span>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {r.kind === "credits"
                      ? `شراء «${data.packs.find((p) => p.key === r.pack)?.name ?? r.pack}»`
                      : `باقة «${planName(r.plan)}» ${r.period === "yearly" ? "سنوي" : "شهري"}`}
                    {r.amount && ` · ${r.amount}`} · {timeAgo(r.createdAt)}
                    {r.note && ` · ${r.note}`}
                  </div>
                </div>
                <div className="row">
                  <button className="btn sm primary" onClick={() => decide(r, "done")}>
                    {r.kind === "credits" ? "ضيف الكريديت" : "فعّل"}
                  </button>
                  <button className="btn sm" onClick={() => decide(r, "rejected")}>
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="admin-toolbar">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="دوّر بالاسم أو الإيميل أو رقم الحساب" />
        </div>
        <select className="input" style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value as "all" | PlanKey)}>
          <option value="all">كل الباقات</option>
          {data.plans.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="admin-users">
        {shown.map((u) => (
          <div key={u.id} className="card admin-user">
            <div className="admin-user-head">
              <div style={{ minWidth: 0 }}>
                <h3>{u.name}</h3>
                <div className="faint" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                  {u.email}
                </div>
              </div>
              <span className={`badge ${PLAN_TONE[u.plan.key] ?? ""}`}>{u.isAdmin ? "أدمن" : u.plan.name}</span>
            </div>
            <button
              className="admin-id mono"
              title="نسخ رقم الحساب"
              onClick={() => copyText(u.id).then(() => toast("رقم الحساب اتنسخ", "success"))}
            >
              <Icon name="copy" size={13} /> {u.id}
            </button>
            <div className="admin-user-facts">
              <span>{planLine(u)}</span>
              <span>
                كريديت: {number(u.credits)}
                {u.assistantCredits > 0 || u.plan.assistant ? ` · مساعد: ${number(u.assistantCredits)}` : ""}
              </span>
              <span>
                سيناريوهات: {u.activeWorkflows} شغال من {u.workflows} · تشغيلات 30 يوم: {number(u.runs30d)}
              </span>
              <span className="faint">سجّل {timeAgo(u.createdAt)}</span>
            </div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn sm primary" onClick={() => setManaging(u)}>
                إدارة الباقة
              </button>
              {!u.isAdmin && u.plan.key !== "free" && (
                <button className="btn sm danger" onClick={() => window.confirm(`تقفل باقة ${u.name} وترجّعه للمجاني؟`) && setPlan(u.id, "free")}>
                  اقفل الباقة
                </button>
              )}
            </div>
          </div>
        ))}
        {!shown.length && <div className="empty">مفيش حسابات مطابقة</div>}
      </div>

      {managing && <ManageModal user={managing} plans={data.plans} onClose={() => setManaging(null)} onPlan={setPlan} onCredits={load} />}
    </div>
  );
}

/** The Gmail (or any SMTP) account that sends sign-up codes. Saved only after a test email goes through. */
function MailCard() {
  const toast = useToast();
  const [state, setState] = useState<{ configured: boolean; host?: string; port?: string; user?: string; fromName?: string } | null>(null);
  const [form, setForm] = useState({ host: "smtp.gmail.com", port: "465", user: "", password: "", fromName: "تدفّق" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ configured: boolean; host?: string; port?: string; user?: string; fromName?: string }>("/admin/mail")
      .then((res) => {
        setState(res);
        if (res.configured) setForm((f) => ({ ...f, host: res.host ?? f.host, port: res.port ?? f.port, user: res.user ?? "", fromName: res.fromName ?? f.fromName }));
      })
      .catch(() => {});
  }, []);

  if (!state) return null;
  const save = async () => {
    setSaving(true);
    try {
      const res = await api<typeof state>("/admin/mail", { method: "PUT", body: form });
      setState(res);
      setForm((f) => ({ ...f, password: "" }));
      toast("اشتغل ✓ بعتنالك إيميل تجربة - من دلوقتي أي حساب جديد لازم يأكد بكود على الإيميل", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 22 }}>
      <h3 style={{ marginBottom: 4 }}>
        <Icon name="mail" size={17} /> إيميل المنصة (كود التحقق عند التسجيل)
      </h3>
      <p className="faint" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {state.configured
          ? `شغال من ${state.user} - أي حساب جديد بيوصله كود من 6 أرقام لازم يكتبه قبل ما يدخل.`
          : "لسه مش متضبط، فالحسابات الجديدة بتدخل من غير تحقق. حط إيميل Gmail وكلمة سر التطبيقات (App Password) هنا."}
      </p>
      <div className="settings-grid">
        <div className="field">
          <label className="label">الإيميل اللي هيبعت</label>
          <input className="input mono" dir="ltr" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="you@gmail.com" />
        </div>
        <div className="field">
          <label className="label">كلمة سر التطبيقات (App Password)</label>
          <input
            className="input mono"
            dir="ltr"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={state.configured ? "سيبها فاضية عشان تفضل زي ما هي" : "16 حرف من جوجل"}
          />
          <div className="help">
            من <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a> (لازم التحقق بخطوتين يكون مفعّل).
          </div>
        </div>
        <div className="field">
          <label className="label">اسم المرسل</label>
          <input className="input" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">سيرفر SMTP والبورت</label>
          <div className="row">
            <input className="input mono" dir="ltr" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            <input className="input mono" dir="ltr" style={{ width: 90 }} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </div>
        </div>
      </div>
      <button className="btn primary" onClick={save} disabled={saving || !form.user || (!form.password && !state.configured)}>
        {saving ? <Spinner size={14} /> : "جرّب واحفظ"}
      </button>
      <span className="faint" style={{ fontSize: 12.5, marginInlineStart: 10 }}>
        هيتبعت إيميل تجربة على إيميلك الأول، ولو وصل بيتحفظ.
      </span>
    </div>
  );
}

/** Payment details and the assistant model: saved in the database, live immediately (no redeploy). */
function SettingsCard() {
  const toast = useToast();
  const { refresh } = useAccount();
  const [form, setForm] = useState<{ egpRate: string; paymentPhone: string; assistantModel: string; contactWhatsapp: string; contactPhone: string } | null>(null);
  const [models, setModels] = useState<{ id: string; name: string; cost?: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ egpRate: number; phone: string; assistantModel: string; whatsapp: string; contactPhone?: string }>("/admin/settings")
      .then((res: any) =>
        setForm({ egpRate: String(res.egpRate), paymentPhone: res.phone, assistantModel: res.assistantModel, contactWhatsapp: res.whatsapp, contactPhone: res.contactPhone }),
      )
      .catch(() => {});
    api<{ models: { id: string; name: string; cost?: string }[] }>("/assistant/models")
      .then((res) => setModels(res.models))
      .catch(() => {});
  }, []);

  if (!form) return null;
  const save = async () => {
    setSaving(true);
    try {
      await api("/admin/settings", { method: "PUT", body: form });
      toast("الإعدادات اتحفظت ✓ واتطبقت على الموقع فوراً", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 22 }}>
      <h3 style={{ marginBottom: 4 }}>
        <Icon name="tools" size={17} /> إعدادات الدفع والمساعد
      </h3>
      <p className="faint" style={{ margin: "0 0 12px", fontSize: 13 }}>
        أي تغيير هنا بيتطبق على الموقع كله في خلال ثواني، من غير ما تعيد النشر.
      </p>
      <div className="settings-grid">
        <div className="field">
          <label className="label">سعر الدولار بالجنيه</label>
          <input className="input" type="number" step="0.01" min={1} value={form.egpRate} onChange={(e) => setForm({ ...form, egpRate: e.target.value })} />
          <div className="help">بيتحسب بيه المبلغ بالجنيه في شاشة الدفع.</div>
        </div>
        <div className="field">
          <label className="label">رقم الدفع (محفظة / إنستاباي / واتساب)</label>
          <input className="input mono" dir="ltr" value={form.paymentPhone} onChange={(e) => setForm({ ...form, paymentPhone: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">واتساب التواصل (صفحة التواصل والفوتر)</label>
          <input className="input mono" dir="ltr" value={form.contactWhatsapp} onChange={(e) => setForm({ ...form, contactWhatsapp: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">تليفون التواصل</label>
          <input className="input mono" dir="ltr" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">الموديل الافتراضي للمساعد</label>
          <select className="input" value={form.assistantModel} onChange={(e) => setForm({ ...form, assistantModel: e.target.value })}>
            {!models.some((m) => m.id === form.assistantModel) && <option value={form.assistantModel}>{form.assistantModel}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.cost ? `${m.name} · ${m.cost}` : m.name}
              </option>
            ))}
          </select>
          <div className="help">كل كريديت مساعد = سنت من فلوس Claude. الموديل الأرخص بيخلّي كريديت العملاء يكفّي رسايل أكتر.</div>
        </div>
      </div>
      <button className="btn primary" onClick={save} disabled={saving}>
        {saving ? <Spinner size={14} /> : "حفظ الإعدادات"}
      </button>
    </div>
  );
}

function ManageModal({
  user,
  plans,
  onClose,
  onPlan,
  onCredits,
}: {
  user: AdminUser;
  plans: PlanDef[];
  onClose: () => void;
  onPlan: (userId: string, plan: PlanKey, period?: "monthly" | "yearly", days?: number) => Promise<void>;
  onCredits: () => void;
}) {
  const toast = useToast();
  const [plan, setPlan] = useState<PlanKey>(["core", "pro", "max"].includes(user.plan.key) ? user.plan.key : "pro");
  const [period, setPeriod] = useState<"monthly" | "yearly">(user.period);
  const [days, setDays] = useState("");
  const [trialDays, setTrialDays] = useState("3");
  const [credits, setCredits] = useState("");
  const [assistantCredits, setAssistantCredits] = useState("");
  const [busy, setBusy] = useState(false);

  const addCredits = async () => {
    setBusy(true);
    try {
      await api(`/admin/users/${user.id}/credits`, { body: { credits: Number(credits) || 0, assistantCredits: Number(assistantCredits) || 0 } });
      toast("الكريديت اتعدّل ✓", "success");
      setCredits("");
      setAssistantCredits("");
      onCredits();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const paidPlans = plans.filter((p) => ["core", "pro", "max"].includes(p.key));

  return (
    <Modal title={`إدارة حساب ${user.name}`} onClose={onClose} wide>
      <div className="faint" style={{ fontSize: 13, marginBottom: 14, overflowWrap: "anywhere" }}>
        {user.email} · رقم الحساب: <span className="mono">{user.id}</span> · الحالية: {user.plan.name}
      </div>

      <h4 className="admin-h">تفعيل باقة مدفوعة</h4>
      <div className="admin-form">
        <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as PlanKey)}>
          {paidPlans.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as "monthly" | "yearly")}>
          <option value="monthly">شهري (30 يوم)</option>
          <option value="yearly">سنوي (365 يوم)</option>
        </select>
        <input className="input" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} placeholder="عدد أيام مخصص (اختياري)" />
        <button className="btn primary" onClick={() => onPlan(user.id, plan, period, Number(days) || undefined)}>
          فعّل
        </button>
      </div>
      <p className="help">التفعيل بيبدأ من النهارده وبيملا رصيد الباقة كامل.</p>

      <h4 className="admin-h">تجربة مجانية</h4>
      <div className="admin-form">
        <input className="input" type="number" min={1} max={60} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        <button className="btn" onClick={() => onPlan(user.id, "trial", "monthly", Number(trialDays) || 3)}>
          ابدأ تجربة بعدد الأيام ده
        </button>
      </div>

      <h4 className="admin-h">كريديت إضافي</h4>
      <div className="admin-form">
        <input className="input" type="number" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="كريديت المنصة (+ أو -)" />
        <input className="input" type="number" value={assistantCredits} onChange={(e) => setAssistantCredits(e.target.value)} placeholder="كريديت المساعد (+ أو -)" />
        <button className="btn" onClick={addCredits} disabled={busy || (!Number(credits) && !Number(assistantCredits))}>
          {busy ? <Spinner size={14} /> : "طبّق"}
        </button>
      </div>
      <p className="help">
        الرصيد الحالي: {number(user.credits)} للمنصة · {number(user.assistantCredits)} للمساعد. رقم بالسالب بيخصم.
      </p>

      {user.plan.key !== "free" && !user.isAdmin && (
        <>
          <h4 className="admin-h">قفل الباقة</h4>
          <button className="btn danger" onClick={() => onPlan(user.id, "free")}>
            رجّعه للباقة المجانية (المميزات تتقفل)
          </button>
        </>
      )}
    </Modal>
  );
}
