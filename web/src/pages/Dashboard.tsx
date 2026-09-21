import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { AppIcon, Empty, Spinner, StatusBadge, Toggle, timeAgo, useToast } from "../components/ui";
import { Icon } from "../icons";
import type { Workflow } from "../types";

type Filter = "all" | "active" | "paused" | "issues";

export function Scenarios() {
  const toast = useToast();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api<Workflow[]>("/workflows").then(setWorkflows).catch((e: Error) => toast(e.message, "error"));
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
    if (!window.confirm(`متأكد إنك عايز تمسح «${wf.name}»؟ سجل التشغيلات هيتمسح كمان`)) return;
    await api(`/workflows/${wf.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "error"));
    load();
  };

  const term = query.trim().toLowerCase();
  const shown = (workflows ?? []).filter(
    (wf) =>
      (!term || wf.name.toLowerCase().includes(term)) &&
      (filter === "all" ||
        (filter === "active" && wf.active) ||
        (filter === "paused" && !wf.active) ||
        (filter === "issues" && (Boolean(wf.triggerError) || wf.lastStatus === "error"))),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>السيناريوهات</h1>
          <p>{workflows ? `${workflows.length} سيناريو · ${workflows.filter((w) => w.active).length} شغالين دلوقتي` : "بتحمّل..."}</p>
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

      {workflows && workflows.length > 0 && (
        <div className="list-toolbar">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="دوّر باسم السيناريو" />
          </div>
          <div className="seg" role="tablist">
            {(
              [
                ["all", "الكل"],
                ["active", "شغال"],
                ["paused", "متوقف"],
                ["issues", "فيه مشكلة"],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
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
            text="ابدأ من الصفر أو استخدم تيمبلت جاهز وعدّل عليه"
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
                {shown.map((wf) => (
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
                    <td data-label="مفعّل">
                      <Toggle on={wf.active} onChange={(v) => setActive(wf, v)} title={wf.active ? "إيقاف" : "تفعيل"} />
                    </td>
                    <td data-label="آخر تشغيل">
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
                    <td data-label="التشغيلات">{wf.runs ?? 0}</td>
                    <td data-label="" onClick={(e) => e.stopPropagation()}>
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
