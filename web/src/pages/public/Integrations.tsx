import { useEffect, useMemo, useState } from "react";
import { AppBadge } from "../../components/AppBadge";
import { useReveal } from "../../components/PublicLayout";
import { Spinner } from "../../components/ui";
import { Icon } from "../../icons";

interface CatalogApp {
  key: string;
  name: string;
  color: string;
  group: string;
  triggers: string[];
  actions: string[];
}

export function Integrations() {
  const [apps, setApps] = useState<CatalogApp[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/public/catalog")
      .then((r) => r.json())
      .then(setApps)
      .catch(() => setApps([]));
  }, []);

  useReveal([apps]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (apps ?? []).filter((app) => !q || `${app.name} ${app.triggers.join(" ")} ${app.actions.join(" ")}`.toLowerCase().includes(q));
  }, [apps, query]);

  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="templates" size={15} /> التطبيقات
        </span>
        <h2>التطبيقات اللي تقدر تربطها</h2>
        <p>ولو التطبيق اللي عايزه مش موجود، خطوة HTTP بتربط أي خدمة عندها API.</p>
      </div>

      <div className="search-box reveal">
        <Icon name="search" size={18} />
        <input placeholder="ابحث عن تطبيق..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {!apps ? (
        <div className="empty">
          <Spinner size={26} />
        </div>
      ) : (
        <div className="grid">
          {visible.map((app) => (
            <article className="card integration reveal" key={app.key}>
              <div className="row" style={{ gap: 12 }}>
                <AppBadge app={app.key} color={app.color} size={46} />
                <h3>{app.name}</h3>
              </div>
              {app.triggers.length > 0 && (
                <div>
                  <div className="mini-label">
                    <Icon name="zap" size={13} /> محفّزات
                  </div>
                  <div className="tag-list">
                    {app.triggers.map((t) => (
                      <span className="badge" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {app.actions.length > 0 && (
                <div>
                  <div className="mini-label">
                    <Icon name="play" size={12} /> خطوات
                  </div>
                  <div className="tag-list">
                    {app.actions.map((a) => (
                      <span className="badge" key={a}>
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
