import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { AppIcon, Empty, Modal, Spinner, timeAgo, useToast } from "../components/ui";
import { useMeta } from "../context";
import { Icon } from "../icons";
import type { Credential, CredentialTypeDef } from "../types";

export function CredentialModal({
  types,
  existing,
  onClose,
  onSaved,
}: {
  types?: string[];
  existing?: Credential;
  onClose: () => void;
  onSaved: (credential: Credential) => void;
}) {
  const { meta, credType } = useMeta();
  const toast = useToast();
  const options = meta.credentialTypes.filter((t) => !types || types.includes(t.key));
  const [type, setType] = useState<CredentialTypeDef | undefined>(
    existing ? credType(existing.type) : options.length === 1 ? options[0] : undefined,
  );
  const [name, setName] = useState(existing?.name ?? type?.name ?? "");
  const [data, setData] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const pick = (t: CredentialTypeDef) => {
    setType(t);
    setName(t.name);
  };

  const test = async () => {
    if (!type) return;
    setBusy("test");
    setResult(null);
    try {
      const hasNewValues = Object.values(data).some(Boolean);
      const res =
        existing && !hasNewValues
          ? await api<{ ok: boolean; message: string }>(`/credentials/${existing.id}/test`, { method: "POST" })
          : await api<{ ok: boolean; message: string }>("/credentials/test", { body: { type: type.key, data } });
      setResult(res);
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!type) return;
    setBusy("save");
    try {
      const saved = existing
        ? await api<Credential>(`/credentials/${existing.id}`, { method: "PUT", body: { name, data } })
        : await api<Credential>("/credentials", { body: { type: type.key, name, data } });
      toast("الحساب اتحفظ", "success");
      onSaved(saved);
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal
      title={existing ? "تعديل حساب" : type ? `ربط ${type.name}` : "إضافة حساب"}
      onClose={onClose}
      footer={
        type && (
          <>
            {type.hasTest && (
              <button className="btn" onClick={test} disabled={Boolean(busy)}>
                {busy === "test" ? <Spinner size={14} /> : "اختبار الاتصال"}
              </button>
            )}
            <button className="btn primary" onClick={save} disabled={Boolean(busy)}>
              {busy === "save" ? <Spinner size={14} /> : "حفظ"}
            </button>
          </>
        )
      }
    >
      {!type ? (
        <div className="type-grid">
          {options.map((t) => (
            <button key={t.key} className="type-card" onClick={() => pick(t)}>
              <AppIcon app={t.app} size={40} />
              <strong style={{ fontSize: 13 }}>{t.name}</strong>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 12, marginBottom: 16 }}>
            <AppIcon app={type.app} size={42} />
            <div>
              <strong>{type.name}</strong>
              {type.description && <div className="muted">{type.description}</div>}
            </div>
          </div>
          {type.steps?.length ? (
            <details className="guide" open={!existing}>
              <summary>
                <Icon name="sparkles" size={15} /> إزاي تجيب البيانات دي - خطوة بخطوة
              </summary>
              <ol>
                {type.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {type.docsUrl && (
                <a href={type.docsUrl} target="_blank" rel="noreferrer">
                  افتح الصفحة الرسمية ↗
                </a>
              )}
            </details>
          ) : (
            type.docsUrl && (
              <a href={type.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
                إزاي أجيب البيانات دي؟
              </a>
            )
          )}
          <div className="field">
            <label className="label">اسم الحساب</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: بوت خدمة العملاء" />
          </div>
          {type.fields.map((field) => (
            <div className="field" key={field.key}>
              <label className="label">
                {field.label} {field.required && !existing && <span className="req">*</span>}
              </label>
              <input
                className="input mono"
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                value={data[field.key] ?? ""}
                onChange={(e) => setData({ ...data, [field.key]: e.target.value })}
                placeholder={existing ? existing.preview[field.key] || "اتركه فاضي عشان يفضل زي ما هو" : field.placeholder}
              />
              {field.help && <div className="help">{field.help}</div>}
            </div>
          ))}
          <div className="help" style={{ marginBottom: 12 }}>
            🔒 البيانات بتتشفّر (AES-256) قبل ما تتحفظ ومش بتظهر تاني.
          </div>
          {result && <div className={`alert ${result.ok ? "success" : "error"}`}>{result.message}</div>}
        </>
      )}
    </Modal>
  );
}

export function Credentials() {
  const { credType } = useMeta();
  const toast = useToast();
  const [items, setItems] = useState<Credential[] | null>(null);
  const [modal, setModal] = useState<{ existing?: Credential } | null>(null);
  const [testing, setTesting] = useState("");

  const load = useCallback(() => {
    api<Credential[]>("/credentials").then(setItems).catch((e: Error) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  const test = async (c: Credential) => {
    setTesting(c.id);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/credentials/${c.id}/test`, { method: "POST" });
      toast(res.message, res.ok ? "success" : "error");
    } finally {
      setTesting("");
    }
  };

  const remove = async (c: Credential) => {
    const warning = c.usedBy.length ? `\nمستخدم في: ${c.usedBy.map((w) => w.name).join("، ")}` : "";
    if (!window.confirm(`تمسح «${c.name}»؟${warning}`)) return;
    await api(`/credentials/${c.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "error"));
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>الحسابات والمفاتيح</h1>
          <p>مفاتيح الـ API والحسابات اللي السيناريوهات بتستخدمها - متشفّرة ومحفوظة عندك.</p>
        </div>
        <button className="btn primary" onClick={() => setModal({})}>
          <Icon name="plus" size={16} /> إضافة حساب
        </button>
      </div>
      {!items ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <Empty
            icon="key"
            title="مفيش حسابات لسه"
            text="ضيف مفتاح Claude أو توكن بوت تيليجرام أو أي API عشان تستخدمهم في السيناريوهات."
            action={
              <button className="btn primary" onClick={() => setModal({})}>
                إضافة حساب
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid">
          {items.map((c) => {
            const type = credType(c.type);
            return (
              <div className="card tpl" key={c.id}>
                <div className="row" style={{ gap: 12 }}>
                  <AppIcon app={type?.app ?? "http"} size={40} />
                  <div style={{ minWidth: 0 }}>
                    <h3>{c.name}</h3>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {type?.name ?? c.type} · اتضاف {timeAgo(c.createdAt)}
                    </div>
                  </div>
                </div>
                <div>
                  {type?.fields.map((f) => (
                    <div key={f.key} className="cred-row">
                      <span className="muted">{f.label}</span>
                      <span className="mono faint cred-value" title={c.preview[f.key] || ""}>
                        {c.preview[f.key] || "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {c.usedBy.length ? `مستخدم في ${c.usedBy.length} سيناريو` : "مش مستخدم في أي سيناريو"}
                </div>
                <div className="row">
                  {type?.hasTest && (
                    <button className="btn sm" onClick={() => test(c)} disabled={testing === c.id}>
                      {testing === c.id ? <Spinner size={12} /> : "اختبار"}
                    </button>
                  )}
                  <button className="btn sm" onClick={() => setModal({ existing: c })}>
                    تعديل
                  </button>
                  <button className="btn sm danger" onClick={() => remove(c)}>
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {modal && (
        <CredentialModal
          existing={modal.existing}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}
