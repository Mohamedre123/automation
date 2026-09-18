import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { number } from "../components/PlanCards";
import { AppIcon, copyText, Empty, Spinner, useToast } from "../components/ui";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";

/* ---------- where the credits went ---------- */
export function Usage() {
  const { account } = useAccount();
  const [data, setData] = useState<{ days: { day: string; credits: number; runs: number }[]; scenarios: { id: string; name: string; credits: number; runs: number }[] } | null>(null);
  useEffect(() => {
    api<typeof data>("/billing/usage").then(setData).catch(() => setData({ days: [], scenarios: [] }));
  }, []);

  // Last 30 days, including days with no runs.
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const found = data?.days.find((d) => d.day === date);
    return { day: date, credits: found?.credits ?? 0, runs: found?.runs ?? 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.credits));
  const total = days.reduce((sum, d) => sum + d.credits, 0);
  const runs = days.reduce((sum, d) => sum + d.runs, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>استهلاك الكريديت</h1>
          <p>الكريديت راح فين في آخر 30 يوم: كل يوم، وكل سيناريو.</p>
        </div>
        <Link className="btn primary" to="/app/billing#credits">
          <Icon name="plus" size={16} /> شراء كريديت
        </Link>
      </div>
      {!data ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="card stat">
              <div className="stat-label">باقي معاك</div>
              <div className="stat-value">{account?.isAdmin ? "∞" : number(account?.credits ?? 0)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">اتصرف في 30 يوم</div>
              <div className="stat-value">{number(total)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">عدد التشغيلات</div>
              <div className="stat-value">{number(runs)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">متوسط التشغيلة</div>
              <div className="stat-value">{runs ? (total / runs).toFixed(1) : "0"}</div>
            </div>
          </div>

          <div className="card usage-chart-card">
            <h3>الكريديت كل يوم</h3>
            <div className="usage-chart" role="img" aria-label="رسم بياني للكريديت اليومي">
              {days.map((d) => (
                <div key={d.day} className="usage-col" title={`${d.day}: ${d.credits} كريديت · ${d.runs} تشغيلة`}>
                  <span style={{ height: `${Math.max(d.credits ? 4 : 1, (d.credits / peak) * 100)}%` }} className={d.credits ? "" : "zero"} />
                </div>
              ))}
            </div>
            <div className="usage-axis faint">
              <span>{days[0].day.slice(5)}</span>
              <span>النهارده</span>
            </div>
          </div>

          <div className="card" style={{ padding: 18, marginTop: 18 }}>
            <h3 style={{ marginBottom: 12 }}>أكتر السيناريوهات استهلاكاً</h3>
            {data.scenarios.length ? (
              <div className="usage-list">
                {data.scenarios.map((s) => (
                  <Link key={s.id} to={`/app/workflows/${s.id}`} className="usage-row">
                    <span className="truncate">{s.name}</span>
                    <span className="faint">{number(s.runs)} تشغيلة</span>
                    <strong>{number(s.credits)} كريديت</strong>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                مفيش تشغيلات في آخر 30 يوم.
              </p>
            )}
          </div>
          <p className="help" style={{ marginTop: 14 }}>
            الخطوات اللي بتكلّم تطبيق أو ذكاء اصطناعي بس هي اللي بتاخد كريديت - الشروط والفلاتر وحفظ البيانات مجاناً.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------- every public link in one place ---------- */
interface LinkRow {
  workflowId: string;
  workflow: string;
  active: boolean;
  trigger: string;
  app: string;
  kind: "form" | "webhook";
  url: string;
}

export function Links() {
  const toast = useToast();
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  useEffect(() => {
    api<LinkRow[]>("/workflows/links").then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>الروابط والـ Webhooks</h1>
          <p>كل رابط السيناريوهات بتاعتك بتستقبل عليه: فورمات، Webhooks، وبوتات واتساب.</p>
        </div>
      </div>
      {!rows ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !rows.length ? (
        <div className="card">
          <Empty icon="webhook" title="مفيش روابط لسه" text="أي سيناريو بمحفّز فورم أو Webhook أو رسايل واتساب هيظهر رابطه هنا." />
        </div>
      ) : (
        <div className="links-list">
          {rows.map((row) => (
            <div key={row.url} className="card link-row">
              <AppIcon app={row.app} size={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <strong className="truncate">{row.workflow}</strong>
                  <span className={`badge ${row.active ? "success" : ""}`}>{row.active ? "شغال" : "متوقف"}</span>
                </div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {row.trigger}
                </div>
                <div className="mono link-url" dir="ltr">
                  {row.url}
                </div>
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn sm" onClick={() => copyText(row.url).then(() => toast("الرابط اتنسخ ✓", "success"))}>
                  <Icon name="copy" size={14} /> نسخ
                </button>
                {row.kind === "form" && (
                  <a className="btn sm" href={row.url} target="_blank" rel="noreferrer">
                    فتح
                  </a>
                )}
                <Link className="btn sm" to={`/app/workflows/${row.workflowId}`}>
                  السيناريو
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- profile & password ---------- */
export function Settings() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState("");

  const saveName = async () => {
    setBusy("name");
    try {
      const res = await api<{ user: NonNullable<typeof user> }>("/auth/profile", { method: "PUT", body: { name } });
      updateUser(res.user);
      toast("الاسم اتحفظ ✓", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  const savePassword = async () => {
    setBusy("password");
    try {
      await api("/auth/password", { body: { current, next } });
      setCurrent("");
      setNext("");
      toast("كلمة السر اتغيرت ✓ وأي جهاز تاني اتسجل خروجه", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  if (!user) return null;
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>إعدادات الحساب</h1>
          <p>بياناتك وكلمة السر.</p>
        </div>
      </div>
      <div className="card settings-card">
        <h3>بياناتك</h3>
        <div className="field">
          <label className="label">الاسم</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">الإيميل</label>
          <input className="input" value={user.email} disabled dir="ltr" />
        </div>
        <div className="field">
          <label className="label">رقم الحساب</label>
          <div className="row">
            <input className="input mono" value={user.id} readOnly dir="ltr" />
            <button className="btn" onClick={() => copyText(user.id).then(() => toast("رقم الحساب اتنسخ ✓", "success"))}>
              <Icon name="copy" size={15} />
            </button>
          </div>
          <div className="help">بتحتاجه لو بتدفع أو بتكلّم الدعم.</div>
        </div>
        <button className="btn primary" onClick={saveName} disabled={busy === "name" || !name.trim() || name === user.name}>
          {busy === "name" ? <Spinner size={14} /> : "حفظ"}
        </button>
      </div>

      <div className="card settings-card">
        <h3>تغيير كلمة السر</h3>
        <div className="field">
          <label className="label">كلمة السر الحالية</label>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">كلمة السر الجديدة</label>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <div className="help">8 حروف على الأقل.</div>
        </div>
        <button className="btn primary" onClick={savePassword} disabled={busy === "password" || !current || next.length < 8}>
          {busy === "password" ? <Spinner size={14} /> : "غيّر كلمة السر"}
        </button>
      </div>

      <div className="card settings-card">
        <h3>مسح الحساب</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          لو عايز تمسح حسابك وكل بياناتك نهائياً، ابعتلنا من صفحة التواصل برقم حسابك وهنمسحه خلال يومين.
        </p>
        <Link className="btn" to="/contact">
          صفحة التواصل
        </Link>
      </div>
    </div>
  );
}
