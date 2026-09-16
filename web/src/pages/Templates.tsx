import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { AppIcon, Empty, Spinner, useToast } from "../components/ui";
import { Icon } from "../icons";
import type { Template } from "../types";

export function Templates() {
  const toast = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [category, setCategory] = useState("الكل");
  const [query, setQuery] = useState("");
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
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? [])
      .filter((t) => category === "الكل" || t.category === category)
      .filter(
        (t) =>
          !q ||
          `${t.name} ${t.description} ${t.category} ${t.apps.map((a) => a.name).join(" ")} ${t.requires.join(" ")}`
            .toLowerCase()
            .includes(q),
      );
  }, [templates, category, query]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>التيمبلت</h1>
          <p>سيناريوهات جاهزة. كل واحدة مكتوب عليها بتربط أنهي تطبيقات وإيه اللي محتاجه عشان تشتغل.</p>
        </div>
      </div>

      <div className="expr-wrap" style={{ marginBottom: 14, maxWidth: 420 }}>
        <input
          className="input"
          placeholder="ابحث: واتساب، إنستجرام، صور، تيليجرام..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
      ) : visible.length === 0 ? (
        <div className="card">
          <Empty icon="search" title="مفيش تيمبلت بالمواصفات دي" text="جرّب كلمة تانية أو تصفّح كل الأقسام." />
        </div>
      ) : (
        <div className="grid">
          {visible.map((t) => (
            <div className="card tpl" key={t.id}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {t.apps.map((app, i) => (
                  <Fragment key={app.key}>
                    {i > 0 && <Icon name="arrowRight" size={13} style={{ color: "var(--text-3)", transform: "scaleX(-1)" }} />}
                    <span className="badge" style={{ gap: 6, paddingInlineStart: 4 }}>
                      <AppIcon app={app.key} size={20} />
                      {app.name}
                    </span>
                  </Fragment>
                ))}
              </div>
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <div className="requires">
                <div className="label" style={{ marginBottom: 4, fontSize: 12 }}>
                  محتاج:
                </div>
                <ul>
                  {t.requires.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="faint" style={{ fontSize: 12 }}>
                  {t.category} · {t.steps} خطوات
                </span>
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
