import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
        <div className="grid tpl-grid">
          {visible.map((t) => (
            <article className="card tpl reveal" key={t.id}>
              <div className="tpl-apps">
                {t.apps.slice(0, 5).map((app) => (
                  <AppBadge key={app.key} app={app.key} size={30} />
                ))}
              </div>
              <h3>
                <Link to={`/templates/${t.id}`} className="plain-link">
                  {t.name}
                </Link>
              </h3>
              <p>{t.description}</p>
              <div className="tpl-foot">
                <span className="faint">
                  {t.steps} خطوات{t.starts ? ` · بيبدأ ${t.starts}` : ""}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <Link className="btn ghost sm" to={`/templates/${t.id}`}>
                    التفاصيل
                  </Link>
                  <button className="btn primary sm" onClick={() => use(t)} disabled={Boolean(using)}>
                    {using === t.id ? <Spinner size={14} /> : user ? "استخدم" : "ابدأ بيه"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
