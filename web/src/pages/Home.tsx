import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { number } from "../components/PlanCards";
import { AppIcon, Spinner, timeAgo, useToast } from "../components/ui";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import type { Execution, Workflow } from "../types";

interface Stats {
  workflows: number;
  activeWorkflows: number;
  executions24h: number;
  successRate: number | null;
  daily: { day: string; status: string; count: number }[];
}

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "صباح الخير" : hour < 18 ? "أهلاً" : "مساء الخير";
};

/** Runs per day for the last 14 days, successes on the bottom, failures on top. */
function RunsChart({ daily }: { daily: Stats["daily"] }) {
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10));
  const rows = days.map((day) => ({
    day,
    ok: daily.find((d) => d.day === day && d.status === "success")?.count ?? 0,
    bad: daily.find((d) => d.day === day && d.status === "error")?.count ?? 0,
  }));
  const max = Math.max(1, ...rows.map((r) => r.ok + r.bad));
  const total = rows.reduce((sum, r) => sum + r.ok + r.bad, 0);
  return (
    <>
      <div className="spark" role="img" aria-label={`${total} تشغيلة في آخر 14 يوم`}>
        {rows.map((r) => (
          <div key={r.day} title={`${r.day}: ${r.ok} نجح · ${r.bad} فشل`}>
            <i style={{ height: `${(r.ok / max) * 100}%`, background: "var(--accent)" }} />
            <i style={{ height: `${(r.bad / max) * 100}%`, background: "var(--danger)" }} />
            {r.ok + r.bad === 0 && <i style={{ height: 3, background: "var(--hairline-2)" }} />}
          </div>
        ))}
      </div>
      <div className="row faint" style={{ justifyContent: "space-between", fontSize: 12, marginTop: 8, direction: "ltr" }}>
        <span>{rows[0].day.slice(5)}</span>
        <span>{rows[13].day.slice(5)}</span>
      </div>
    </>
  );
}

export function Home() {
  const { user } = useAuth();
  const { account } = useAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [failures, setFailures] = useState<Execution[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<Stats>("/stats").then(setStats).catch(() => {});
    api<Workflow[]>("/workflows").then(setWorkflows).catch(() => setWorkflows([]));
    api<Execution[]>("/executions?status=error&limit=5").then(setFailures).catch(() => {});
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const wf = await api<Workflow>("/workflows", { body: { name: "سيناريو جديد" } });
      navigate(`/app/workflows/${wf.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setCreating(false);
    }
  };

  const recent = (workflows ?? []).slice().sort((a, b) => (b.lastRunAt ?? b.updatedAt).localeCompare(a.lastRunAt ?? a.updatedAt)).slice(0, 6);
  const broken = (workflows ?? []).filter((w) => w.triggerError);
  const firstName = user?.name.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting()}، {firstName}
          </h1>
          <p>ده ملخص اللي بيحصل في سيناريوهاتك.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/app/templates">
            من تيمبلت
          </Link>
          <button className="btn primary" onClick={create} disabled={creating}>
            {creating ? <Spinner size={15} /> : <Icon name="plus" size={15} />} سيناريو جديد
          </button>
        </div>
      </div>

      <div className="ov-kpis">
        <div className="ov-kpi">
          <small>سيناريوهات شغالة</small>
          <strong>{stats ? number(stats.activeWorkflows) : "—"}</strong>
          <em>من {stats ? number(stats.workflows) : "—"}</em>
        </div>
        <div className="ov-kpi">
          <small>تشغيلات آخر 24 ساعة</small>
          <strong>{stats ? number(stats.executions24h) : "—"}</strong>
        </div>
        <div className="ov-kpi">
          <small>نسبة النجاح (14 يوم)</small>
          <strong>{stats?.successRate == null ? "—" : `${stats.successRate}%`}</strong>
        </div>
        <div className="ov-kpi">
          <small>الكريديت المتبقي</small>
          <strong>{account ? (account.isAdmin ? "∞" : number(account.credits)) : "—"}</strong>
          {account && !account.isAdmin && <em>{account.plan.name}</em>}
        </div>
      </div>

      <div className="ov-grid">
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card ov-card">
            <h3>
              التشغيلات آخر 14 يوم
              <Link to="/app/executions">السجل كامل</Link>
            </h3>
            {stats ? <RunsChart daily={stats.daily} /> : <Spinner />}
          </section>

          <section className="card ov-card">
            <h3>
              آخر السيناريوهات
              <Link to="/app/scenarios">كلها</Link>
            </h3>
            {!workflows ? (
              <Spinner />
            ) : recent.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                لسه مفيش سيناريوهات. ابدأ من تيمبلت جاهز - أسرع طريقة.
              </p>
            ) : (
              <div className="ov-list">
                {recent.map((wf) => (
                  <Link key={wf.id} className="ov-row" to={`/app/workflows/${wf.id}`}>
                    <div className="app-stack">
                      {wf.apps.slice(0, 3).map((app) => (
                        <AppIcon key={app} app={app} size={28} />
                      ))}
                    </div>
                    <div className="grow">
                      <div>{wf.name}</div>
                      <div>{wf.lastRunAt ? `آخر تشغيل ${timeAgo(wf.lastRunAt)}` : `اتعدّل ${timeAgo(wf.updatedAt)}`}</div>
                    </div>
                    <span className={`badge ${wf.active ? "success" : ""}`}>{wf.active ? "شغال" : "متوقف"}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          {(failures.length > 0 || broken.length > 0) && (
            <section className="card ov-card">
              <h3>محتاج انتباهك</h3>
              <div className="ov-list">
                {broken.map((wf) => (
                  <Link key={wf.id} className="ov-row" to={`/app/workflows/${wf.id}`}>
                    <Icon name="alert" size={17} style={{ color: "var(--danger)", flexShrink: 0 }} />
                    <div className="grow">
                      <div>{wf.name}</div>
                      <div>{wf.triggerError?.message}</div>
                    </div>
                  </Link>
                ))}
                {failures.map((ex) => (
                  <Link key={ex.id} className="ov-row" to={`/app/workflows/${ex.workflowId}`}>
                    <Icon name="alert" size={17} style={{ color: "var(--danger)", flexShrink: 0 }} />
                    <div className="grow">
                      <div>{ex.workflowName ?? "سيناريو"}</div>
                      <div>
                        {timeAgo(ex.startedAt)} · {ex.error}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card ov-card">
            <h3>ابدأ بسرعة</h3>
            <div className="ov-start">
              <Link to="/app/templates">
                <Icon name="templates" size={18} style={{ color: "var(--accent)" }} />
                <span>
                  تيمبلت جاهز
                  <small>بوت واتساب، نشر يومي، طلبات المتجر...</small>
                </span>
              </Link>
              <Link to="/app/credentials">
                <Icon name="key" size={18} style={{ color: "var(--accent)" }} />
                <span>
                  اربط حساباتك
                  <small>واتساب، الذكاء الاصطناعي، جوجل شيت</small>
                </span>
              </Link>
              <Link to="/app/mcp">
                <Icon name="plug" size={18} style={{ color: "var(--accent)" }} />
                <span>
                  شغّلها من Claude أو ChatGPT
                  <small>رابط MCP واحد لسيناريوهاتك</small>
                </span>
              </Link>
            </div>
          </section>

          {account && !account.isAdmin && (
            <section className="card ov-card">
              <h3>
                باقتك: {account.plan.name}
                <Link to="/app/billing">الاشتراك</Link>
              </h3>
              <div className="meter" style={{ marginBottom: 12 }}>
                <div className="meter-head">
                  <span>كريديت المنصة</span>
                  <strong>{number(account.credits)}</strong>
                </div>
                <div className="meter-bar">
                  <span style={{ width: `${Math.max(3, Math.min(100, (account.credits / Math.max(account.monthlyCredits, account.credits, 1)) * 100))}%` }} />
                </div>
              </div>
              {account.plan.assistant && (
                <div className="meter">
                  <div className="meter-head">
                    <span>كريديت المساعد</span>
                    <strong>{number(account.assistantCredits)}</strong>
                  </div>
                  <div className="meter-bar">
                    <span
                      style={{
                        width: `${Math.max(3, Math.min(100, (account.assistantCredits / Math.max(account.monthlyAssistantCredits, account.assistantCredits, 1)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
