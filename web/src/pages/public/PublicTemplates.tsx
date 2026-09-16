import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { AppBadge } from "../../components/AppBadge";
import { useReveal } from "../../components/PublicLayout";
import { Spinner, useToast } from "../../components/ui";
import { useAuth } from "../../context";
import { Icon } from "../../icons";
import type { Template } from "../../types";

type PublicTemplate = Omit<Template, "graph">;

export function PublicTemplates() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<PublicTemplate[] | null>(null);
  const [category, setCategory] = useState("الكل");
  const [query, setQuery] = useState("");
  const [using, setUsing] = useState("");

  useEffect(() => {
    fetch("/api/public/templates")
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  useReveal([templates, category, query]);

  const categories = ["الكل", ...new Set((templates ?? []).map((t) => t.category))];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? [])
      .filter((t) => category === "الكل" || t.category === category)
      .filter((t) => !q || `${t.name} ${t.description} ${t.apps.map((a) => a.name).join(" ")}`.toLowerCase().includes(q));
  }, [templates, category, query]);

  const use = async (template: PublicTemplate) => {
    if (!user) {
      navigate("/register");
      return;
    }
    setUsing(template.id);
    try {
      const res = await api<{ id: string }>(`/templates/${template.id}/use`, { method: "POST" });
      navigate(`/app/workflows/${res.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setUsing("");
    }
  };

  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="flows" size={15} /> التيمبلت
        </span>
        <h2>سيناريوهات جاهزة تبدأ بيها</h2>
        <p>كل تيمبلت مكتوب عليه بيربط أنهي تطبيقات وإيه اللي محتاجه. استخدمه بضغطة وعدّل عليه.</p>
      </div>

      <div className="search-box reveal">
        <Icon name="search" size={18} />
        <input placeholder="ابحث: واتساب، إنستجرام، صور..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="chips center">
        {categories.map((c) => (
          <button key={c} className={`chip ${c === category ? "active" : ""}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      {!templates ? (
        <div className="empty">
          <Spinner size={26} />
        </div>
      ) : (
        <div className="grid">
          {visible.map((t) => (
            <article className="card tpl reveal" key={t.id}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {t.apps.map((app, i) => (
                  <Fragment key={app.key}>
                    {i > 0 && <Icon name="arrowRight" size={13} style={{ color: "var(--text-3)", transform: "scaleX(-1)" }} />}
                    <span className="badge" style={{ gap: 6, paddingInlineStart: 4 }}>
                      <AppBadge app={app.key} size={20} />
                      {app.name}
                    </span>
                  </Fragment>
                ))}
              </div>
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <div className="requires">
                <div className="mini-label">محتاج:</div>
                <ul>
                  {t.requires.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              {t.howTo?.length ? (
                <details className="guide tpl-guide">
                  <summary>
                    <Icon name="sparkles" size={14} /> إزاي أشغّله{t.starts ? ` (بيبدأ ${t.starts})` : ""}
                  </summary>
                  <ol>
                    {t.howTo.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="faint" style={{ fontSize: 12 }}>
                  {t.category} · {t.steps} خطوات
                </span>
                <button className="btn primary sm" onClick={() => use(t)} disabled={Boolean(using)}>
                  {using === t.id ? <Spinner size={14} /> : user ? "استخدم التيمبلت" : "سجّل واستخدمه"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
