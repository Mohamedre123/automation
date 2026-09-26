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
          <p>كل الحسابات المسجلة، وتفعيل الباقات والتجربة والكريديت من هنا</p>
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

      <SchedulerCard />
      <MailCard />
      <SettingsCard />

      {pending.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 22 }}>
          <h3 style={{ marginBottom: 4 }}>
            <Icon name="crown" size={17} /> طلبات الدفع
          </h3>
          <p className="faint" style={{ margin: "0 0 12px", fontSize: 13 }}>
            قارن كل طلب بصورة الإيصال اللي وصلتك على واتساب (فيها نفس رقم الحساب) قبل التفعيل
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
/*
 * Scheduled scenarios only run when something calls /api/cron/tick. Webhooks and chat bots do not
 * need it - they arrive on their own - but a schedule that nobody is ticking is silent, so the
 * heartbeat is shown here with what to do when it stops.
 */
/** The host of an address, or the text itself when it is not a full URL. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function SchedulerCard() {
  const [health, setHealth] = useState<{
    webhooksReachable?: boolean;
    minutesSinceTick?: number | null;
    lastTickAt?: string | null;
    publicUrl?: string;
    publicUrlRedirectsTo?: string | null;
  } | null>(null);
  useEffect(() => {
    fetch("/api/health?check=address")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);
  if (!health) return null;
  const minutes = health.minutesSinceTick;
  const stalled = minutes === null || minutes === undefined || minutes > 15;
  // Every link the platform hands out (forms, webhooks, MCP, emails, images) is built from its public
  // address. If that is not the domain the site is served on, those links point somewhere else.
  const publicHost = health.publicUrl ? new URL(health.publicUrl).host : "";
  const local = /localhost|127\.0\.0\.1/.test(location.host);
  // Worse than a mismatch: the address itself redirects, and webhooks, MCP and the cron pinger stop at the redirect.
  const redirectHost = health.publicUrlRedirectsTo ? hostOf(health.publicUrlRedirectsTo) : "";
  const addressWrong = !local && Boolean(publicHost) && (Boolean(redirectHost) || publicHost !== location.host);

  return (
    <div className="card" style={{ padding: 18, marginBottom: 22 }}>
      <h3 style={{ marginBottom: 4 }}>
        <Icon name="clock" size={17} /> التشغيل التلقائي
      </h3>
      <div className="ov-list" style={{ marginTop: 10 }}>
        <div className="ov-row">
          <Icon name="webhook" size={17} style={{ color: health.webhooksReachable ? "var(--success)" : "var(--danger)", flexShrink: 0 }} />
          <div className="grow">
            <div>البوتات والفورمات والـ Webhooks</div>
            <div>{health.webhooksReachable ? "شغالة على مدار الساعة - بتوصل للمنصة لوحدها من غير أي تشغيل" : "مش قادرة توصل للمنصة"}</div>
          </div>
        </div>
        <div className="ov-row">
          <Icon name="schedule" size={17} style={{ color: stalled ? "var(--danger)" : "var(--success)", flexShrink: 0 }} />
          <div className="grow">
            <div>السيناريوهات اللي بميعاد والنشر المؤجّل</div>
            <div>
              {minutes === null || minutes === undefined
                ? "لسه مفيش نبضة - الجدولة مش شغالة"
                : `آخر نبضة من ${minutes} دقيقة${stalled ? " - المفروض كل دقيقة" : ""}`}
            </div>
          </div>
        </div>
        <div className="ov-row">
          <Icon name="globe" size={17} style={{ color: addressWrong ? "var(--danger)" : "var(--success)", flexShrink: 0 }} />
          <div className="grow">
            <div>عنوان المنصة في الروابط</div>
            <div dir="auto">
              {redirectHost
                ? `الروابط بتطلع على ${publicHost} - بس العنوان ده بيحوّل لـ ${redirectHost}`
                : addressWrong
                  ? `الروابط بتطلع على ${publicHost} - وانت فاتح على ${location.host}`
                  : `كل الروابط بتطلع على ${publicHost || location.host}`}
            </div>
          </div>
        </div>
      </div>
      {redirectHost ? (
        <div className="guide-note" style={{ marginTop: 12, display: "block" }}>
          <strong style={{ display: "block", marginBottom: 6 }}>
            العنوان {publicHost} بيحوّل لعنوان تاني - البوتات والجدولة وروابط MCP الجديدة مش هتوصل
          </strong>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.95, color: "var(--text-2)" }}>
            واتساب وتيليجرام وcron-job.org مش بيمشوا ورا التحويل. الحل من Vercel ← المشروع ← Settings ← Domains:
            <br />• جنب <span dir="ltr">{publicHost}</span> دوس Edit ← Connect to an environment ← Production ← Save
            <br />• جنب <span dir="ltr">{redirectHost}</span> دوس Edit ← Redirect to Another Domain ← <span dir="ltr">{publicHost}</span> ← Save
            <br />
            الحل التاني: تخلي عنوان المنصة <span dir="ltr">https://{redirectHost}</span> في متغير APP_URL (نوعه Config مش Secret) وتعمل Redeploy
          </p>
        </div>
      ) : (
        addressWrong && (
          <div className="guide-note" style={{ marginTop: 12, display: "block" }}>
            <strong style={{ display: "block", marginBottom: 6 }}>روابط الفورم والـ Webhook وMCP والإيميلات بتطلع على عنوان تاني</strong>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.95, color: "var(--text-2)" }}>
              في Vercel ← المشروع ← Settings ← Environment Variables خلّي APP_URL (نوعه Config مش Secret) =
              <br />
              <span className="mono" dir="ltr" style={{ fontSize: 12.5 }}>
                https://{location.host}
              </span>
              <br />
              وبعدها Deployments ← آخر نشر ← ⋮ ← Redeploy. العنوان لازم يكون اللي بيفتح على طول من غير ما يحوّل لعنوان تاني
            </p>
          </div>
        )
      )}
      {stalled && (
        <div className="guide-note" style={{ marginTop: 12, display: "block" }}>
          <strong style={{ display: "block", marginBottom: 6 }}>عشان المواعيد تشتغل بالدقيقة</strong>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.95, color: "var(--text-2)" }}>
            اعمل حساب مجاني على cron-job.org وضيف Cron Job كل دقيقة على الرابط:
            <br />
            <span className="mono" dir="ltr" style={{ fontSize: 12.5, wordBreak: "break-all" }}>
              {location.origin}/api/cron/tick?secret=CRON_SECRET
            </span>
            <br />
            وحط مكان CRON_SECRET نفس القيمة اللي في متغيرات البيئة على Vercel. من غير ده المواعيد بتشتغل مرة واحدة في اليوم بس
          </p>
        </div>
      )}
    </div>
  );
}

interface MailState {
  configured: boolean;
  provider: "resend" | "smtp";
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  host?: string;
  port?: string;
  user?: string;
}

/** Where the platform's own mail goes out from: verification codes, receipts, subscription news. */
function MailCard() {
  const toast = useToast();
  const [state, setState] = useState<MailState | null>(null);
  const [form, setForm] = useState({
    provider: "resend" as "resend" | "smtp",
    apiKey: "",
    fromName: "تدفّق",
    fromEmail: "",
    replyTo: "",
    host: "smtp.gmail.com",
    port: "465",
    user: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    api<MailState>("/admin/mail")
      .then((res) => {
        setState(res);
        setForm((f) => ({
          ...f,
          provider: res.provider ?? "resend",
          fromName: res.fromName ?? f.fromName,
          fromEmail: res.fromEmail ?? "",
          replyTo: res.replyTo ?? "",
          host: res.host || f.host,
          port: res.port || f.port,
          user: res.user ?? "",
        }));
      })
      .catch(() => {});
  }, []);

  if (!state) return null;
  const resend = form.provider === "resend";
  const ready = resend ? (form.apiKey || state.configured) && form.fromEmail.includes("@") : form.user && (form.password || state.configured);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api<MailState>("/admin/mail", { method: "PUT", body: form });
      setState(res);
      setForm((f) => ({ ...f, apiKey: "", password: "" }));
      toast("اشتغل ✓ بعتنالك إيميل تجربة - من دلوقتي كل إيميلات المنصة هتخرج من هنا", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 22 }}>
      <h3 style={{ marginBottom: 4 }}>
        <Icon name="mail" size={17} /> إيميل المنصة
      </h3>
      <p className="faint" style={{ margin: "0 0 12px", fontSize: 13 }}>
        {state.configured
          ? `شغال من ${state.fromEmail || state.user} - أكواد التحقق وإيصالات الدفع وتنبيهات الاشتراك كلها بتخرج من هنا`
          : "لسه مش متضبط: الحسابات الجديدة بتدخل من غير كود تحقق، ومفيش إيميلات اشتراك بتتبعت"}
      </p>

      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={resend ? "on" : ""} onClick={() => setForm({ ...form, provider: "resend" })}>
          Resend (المفضّل)
        </button>
        <button className={!resend ? "on" : ""} onClick={() => setForm({ ...form, provider: "smtp" })}>
          SMTP
        </button>
      </div>

      <div className="settings-grid">
        {resend ? (
          <>
            <div className="field">
              <label className="label">API Key</label>
              <input
                className="input mono"
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={state.configured ? "سيبه فاضي عشان يفضل زي ما هو" : "re_..."}
              />
              <div className="help">
                من <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">resend.com/api-keys</a> بصلاحية Sending access
              </div>
            </div>
            <div className="field">
              <label className="label">الإيميل اللي بيبعت</label>
              <input
                className="input mono"
                dir="ltr"
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                placeholder="no-reply@yourdomain.com"
              />
              <div className="help">لازم يكون على دومين متحقق منه في Resend ← Domains</div>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label className="label">الإيميل اللي بيبعت</label>
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
            </div>
            <div className="field">
              <label className="label">سيرفر SMTP والبورت</label>
              <div className="row">
                <input className="input mono" dir="ltr" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
                <input className="input mono" dir="ltr" style={{ width: 90 }} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              </div>
            </div>
          </>
        )}
        <div className="field">
          <label className="label">اسم المرسل</label>
          <input className="input" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">الرد يروح فين (اختياري)</label>
          <input
            className="input mono"
            dir="ltr"
            value={form.replyTo}
            onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
            placeholder="support@yourdomain.com"
          />
          <div className="help">لما عميل يرد على أي إيميل، الرد هيوصل على العنوان ده</div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn primary" onClick={save} disabled={saving || !ready}>
          {saving ? <Spinner size={14} /> : "جرّب واحفظ"}
        </button>
        <button className="btn ghost sm" onClick={() => setGuide(!guide)}>
          <Icon name="info" size={15} /> {guide ? "إخفاء الشرح" : "إزاي أضبطه؟"}
        </button>
        <span className="faint" style={{ fontSize: 12.5 }}>
          هيتبعت إيميل تجربة على إيميلك الأول، ولو وصل بيتحفظ
        </span>
      </div>

      {guide && (
        <div className="guide-note" style={{ marginTop: 14, display: "block" }}>
          <strong style={{ display: "block", marginBottom: 8 }}>خطوات Resend (أول ما تشتري الدومين)</strong>
          <ol style={{ margin: 0, paddingInlineStart: 18, lineHeight: 2, fontSize: 13.5, color: "var(--text-2)" }}>
            <li>اعمل حساب على resend.com - الباقة المجانية بتسمح بـ 3,000 إيميل في الشهر و100 في اليوم</li>
            <li>Domains ← Add Domain واكتب دومينك، واختار المنطقة الأقرب</li>
            <li>هيديك سجلات DNS (سجل MX وسجلين TXT للـ DKIM والـ SPF) - حطهم عند اللي شاريت منه الدومين</li>
            <li>استنى لحد ما الحالة تبقى Verified (عادة دقايق، ممكن توصل ساعات)</li>
            <li>زوّد سجل DMARC: اسمه _dmarc وقيمته v=DMARC1; p=none; - ده بيخلي الإيميلات تدخل الوارد مش السبام</li>
            <li>API Keys ← Create API Key بصلاحية Sending access، وانسخه والصقه فوق</li>
            <li>اكتب «الإيميل اللي بيبعت» على دومينك (مثلاً no-reply@yourdomain.com) ودوس «جرّب واحفظ»</li>
          </ol>
          <strong style={{ display: "block", margin: "12px 0 6px" }}>الإيميلات اللي بتتبعت لوحدها</strong>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.9, color: "var(--text-2)" }}>
            كود التحقق عند التسجيل · ترحيب بعد التفعيل · إيصال «استلمنا طلبك وبنراجع التحويل» · تفعيل الباقة · إضافة كريديت · رفض الطلب بسببه ·
            تنبيه قبل ما الاشتراك يخلص بـ 3 أيام · إشعار لما يخلص. وانت كمان بيوصلك إيميل بكل طلب دفع جديد
          </p>
        </div>
      )}
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
        أي تغيير هنا بيتطبق على الموقع كله في خلال ثواني، من غير ما تعيد النشر
      </p>
      <div className="settings-grid">
        <div className="field">
          <label className="label">سعر الدولار بالجنيه</label>
          <input className="input" type="number" step="0.01" min={1} value={form.egpRate} onChange={(e) => setForm({ ...form, egpRate: e.target.value })} />
          <div className="help">بيتحسب بيه المبلغ بالجنيه في شاشة الدفع</div>
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
          <div className="help">كل كريديت مساعد = سنت من فلوس Claude. الموديل الأرخص بيخلّي كريديت العملاء يكفّي رسايل أكتر</div>
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
      <p className="help">التفعيل بيبدأ من النهارده وبيملا رصيد الباقة كامل</p>

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
        الرصيد الحالي: {number(user.credits)} للمنصة · {number(user.assistantCredits)} للمساعد. رقم بالسالب بيخصم
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
