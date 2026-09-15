import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { AppIcon, Spinner, useToast } from "../components/ui";
import { Icon } from "../icons";
import type { Template } from "../types";

export function Templates() {
  const toast = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [category, setCategory] = useState("الكل");
  const [using, setUsing] = useState("");

  useEffect(() => {
    api<Template[]>("/templates").then(setTemplates).catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  const use = async (template: Template) => {
    setUsing(template.id);
    try {
      const res = await api<{ id: string }>(`/templates/${template.id}/use`, { method: "POST" });
      toast("اتعمل سيناريو من التيمبلت - اختار الحسابات وجرّبه", "success");
      navigate(`/workflows/${res.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setUsing("");
    }
  };

  const categories = ["الكل", ...new Set((templates ?? []).map((t) => t.category))];
  const visible = (templates ?? []).filter((t) => category === "الكل" || t.category === category);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>التيمبلت</h1>
          <p>سيناريوهات جاهزة، استخدمها كنقطة بداية وعدّل عليها زي ما تحب.</p>
        </div>
      </div>
      <div className="chips">
        {categories.map((c) => (
          <button key={c} className={`chip ${c === category ? "active" : ""}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      {!templates ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : (
        <div className="grid">
          {visible.map((t) => (
            <div className="card tpl" key={t.id}>
              <div className="row" style={{ gap: 6 }}>
                {t.apps.map((app, i) => (
                  <Fragment key={app}>
                    {i > 0 && <Icon name="arrowRight" size={14} style={{ color: "var(--text-3)", transform: "scaleX(-1)" }} />}
                    <AppIcon app={app} size={34} />
                  </Fragment>
                ))}
              </div>
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="badge">{t.category}</span>
                <button className="btn primary sm" onClick={() => use(t)} disabled={Boolean(using)}>
                  {using === t.id ? <Spinner size={14} /> : "استخدم التيمبلت"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
