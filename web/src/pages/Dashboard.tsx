import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { AppIcon, Empty, Spinner, StatusBadge, Toggle, timeAgo, useToast } from "../components/ui";
import { useAuth } from "../context";
import { Icon } from "../icons";
import type { Workflow } from "../types";

interface Stats {
  workflows: number;
  activeWorkflows: number;
  executions24h: number;
  successRate: number | null;
  daily: { day: string; status: string; count: number }[];
}

function UsageChart({ daily }: { daily: Stats["daily"] }) {
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10));
  const byDay = days.map((day) => ({
    day,
    success: daily.find((d) => d.day === day && d.status === "success")?.count ?? 0,
    error: daily.find((d) => d.day === day && d.status === "error")?.count ?? 0,
  }));
  const max = Math.max(1, ...byDay.map((d) => d.success + d.error));
  return (
    <div className="card chart-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 15 }}>التشغيلات آخر 14 يوم</h3>
        <div className="row faint" style={{ fontSize: 12, gap: 14 }}>
          <span className="row" style={{ gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--success)" }} /> نجح
          </span>
          <span className="row" style={{ gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--danger)" }} /> فشل
          </span>
        </div>
      </div>
      <div className="bars">
        {byDay.map((d) => (
          <div className="bar-col" key={d.day} title={`${d.day}: ${d.success} نجح، ${d.error} فشل`}>
            <div className="seg" style={{ height: `${(d.error / max) * 100}%`, background: "var(--danger)" }} />
            <div
              className="seg"
              style={{ height: `${(d.success / max) * 100}%`, background: d.success ? "var(--success)" : "transparent" }}
            />
            {d.success + d.error === 0 && <div className="seg" style={{ height: 3, background: "var(--border)" }} />}
          </div>
        ))}
      </div>
      <div className="bar-labels">
        {byDay.map((d) => (
          <span key={d.day}>{d.day.slice(8)}</span>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api<Workflow[]>("/workflows").then(setWorkflows).catch((e: Error) => toast(e.message, "error"));
    api<Stats>("/stats").then(setStats).catch(() => {});
  }, [toast]);

  useEffect(load, [load]);

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

  const setActive = async (wf: Workflow, active: boolean) => {
    try {
      await api(`/workflows/${wf.id}/activate`, { body: { active } });
      toast(active ? `«${wf.name}» اتفعّل` : `«${wf.name}» اتوقف`, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const duplicate = async (wf: Workflow) => {
    await api(`/workflows/${wf.id}/duplicate`, { method: "POST" }).catch((e: Error) => toast(e.message, "error"));
    load();
  };

  const remove = async (wf: Workflow) => {
    if (!window.confirm(`متأكد إنك عايز تمسح «${wf.name}»؟ سجل التشغيلات هيتمسح كمان.`)) return;
    await api(`/workflows/${wf.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "error"));
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>أهلاً {user?.name} 👋</h1>
          <p>ابني سيناريوهات أتمتة تربط تطبيقاتك ببعض وتشتغل لوحدها.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/app/templates">
            <Icon name="templates" size={16} /> من تيمبلت
          </Link>
          <button className="btn primary" onClick={create} disabled={creating}>
            {creating ? <Spinner size={16} /> : <Icon name="plus" size={16} />} سيناريو جديد
          </button>
        </div>
      </div>

      {stats && (
        <>
          <div className="stats">
            <div className="card stat">
              <div className="stat-label">السيناريوهات</div>
              <div className="stat-value">{stats.workflows}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">المفعّلة دلوقتي</div>
              <div className="stat-value" style={{ color: "var(--success)" }}>
                {stats.activeWorkflows}
              </div>
            </div>
            <div className="card stat">
              <div className="stat-label">تشغيلات آخر 24 ساعة</div>
              <div className="stat-value">{stats.executions24h}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">نسبة النجاح (14 يوم)</div>
              <div className="stat-value">{stats.successRate === null ? "—" : `${stats.successRate}%`}</div>
            </div>
          </div>
          <UsageChart daily={stats.daily} />
        </>
      )}

      <div className="card">
        {!workflows ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : workflows.length === 0 ? (
          <Empty
            icon="flows"
            title="لسه مفيش سيناريوهات"
            text="ابدأ من الصفر أو استخدم تيمبلت جاهز وعدّل عليه."
            action={
              <div className="row" style={{ justifyContent: "center" }}>
                <Link className="btn" to="/app/templates">
                  تصفّح التيمبلت
                </Link>
                <button className="btn primary" onClick={create}>
                  سيناريو جديد
                </button>
              </div>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>السيناريو</th>
                  <th>مفعّل</th>
                  <th>آخر تشغيل</th>
                  <th>التشغيلات</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf) => (
                  <tr key={wf.id} className="clickable" onClick={() => navigate(`/app/workflows/${wf.id}`)}>
                    <td>
                      <div className="row" style={{ gap: 12 }}>
                        <div className="app-stack">
                          {wf.apps.slice(0, 4).map((app) => (
                            <AppIcon key={app} app={app} size={30} />
                          ))}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{wf.name}</div>
                          {wf.triggerError ? (
                            <div style={{ color: "var(--danger)", fontSize: 12 }}>⚠ {wf.triggerError.message}</div>
                          ) : (
                            <div className="faint" style={{ fontSize: 12 }}>
                              اتعدّل {timeAgo(wf.updatedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Toggle on={wf.active} onChange={(v) => setActive(wf, v)} title={wf.active ? "إيقاف" : "تفعيل"} />
                    </td>
                    <td>
                      {wf.lastStatus ? (
                        <div className="row">
                          <StatusBadge status={wf.lastStatus} />
                          <span className="faint" style={{ fontSize: 12 }}>
                            {timeAgo(wf.lastRunAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="faint">لسه متشغلش</span>
                      )}
                    </td>
                    <td>{wf.runs ?? 0}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="btn ghost icon sm" title="نسخ" onClick={() => duplicate(wf)}>
                          <Icon name="copy" size={15} />
                        </button>
                        <button className="btn ghost icon sm danger" title="حذف" onClick={() => remove(wf)}>
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
