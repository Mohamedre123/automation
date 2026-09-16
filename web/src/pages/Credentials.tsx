import { useCallback, useEffect, useRef, useState } from "react";
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
  // "Connect with Facebook" creates Page / Instagram accounts: offer it wherever those are needed.
  const options = meta.credentialTypes.filter(
    (t) => !types || types.includes(t.key) || Boolean(t.oauth?.creates?.some((created) => types.includes(created))),
  );
  const [type, setType] = useState<CredentialTypeDef | undefined>(
    existing ? credType(existing.type) : options.length === 1 ? options[0] : undefined,
  );
  const [name, setName] = useState(existing?.name ?? type?.name ?? "");
  const [data, setData] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const popupRef = useRef<Window | null>(null);
  const provider = type?.oauth ? meta.oauth?.providers[type.oauth.provider] : undefined;

  // The provider's popup reports back when the customer approved (or cancelled).
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const message = event.data as { source?: string; ok?: boolean; message?: string; credentialIds?: string[] };
      if (message?.source !== "tadfuq-oauth") return;
      popupRef.current = null;
      if (!message.ok) {
        setBusy("");
        setResult({ ok: false, message: message.message ?? "الربط ما كملش" });
        return;
      }
      try {
        const all = await api<Credential[]>("/credentials");
        const created = all.filter((c) => message.credentialIds?.includes(c.id));
        const wanted = created.find((c) => !types || types.includes(c.type)) ?? created[0];
        toast(message.message ?? "اتربط ✓", "success");
        if (wanted) onSaved(wanted);
        else onClose();
      } catch (e) {
        setResult({ ok: false, message: (e as Error).message });
      } finally {
        setBusy("");
      }
    };
    window.addEventListener("message", onMessage);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "tadfuq-oauth-result" || !event.newValue) return;
      try {
        void onMessage(new MessageEvent("message", { data: JSON.parse(event.newValue) }));
      } catch {
        /* ignore malformed values */
      }
    };
    window.addEventListener("storage", onStorage);
    // Closed the popup without finishing: stop the spinner.
    const watcher = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setBusy("");
      }
    }, 800);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(watcher);
    };
  }, [onClose, onSaved, toast, types]);

  const connect = async () => {
    if (!type) return;
    // Open the window right away (inside the click) so popup blockers allow it.
    const popup = window.open("about:blank", "tadfuq-oauth", "width=540,height=740");
    popupRef.current = popup;
    setBusy("save");
    setResult(null);
    try {
      const { url } = await api<{ url: string }>(`/oauth/${type.key}/start`, {
        body: { name: existing ? undefined : name !== type.name ? name : "", credentialId: existing?.id },
      });
      if (popup && !popup.closed) popup.location.href = url;
      else window.location.href = url;
    } catch (e) {
      popup?.close();
      popupRef.current = null;
      setBusy("");
      setResult({ ok: false, message: (e as Error).message });
    }
  };

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
            {type.oauth ? (
              <button className="btn primary" onClick={connect} disabled={Boolean(busy) || provider?.ready === false}>
                {busy === "save" ? (
                  <>
                    <Spinner size={14} /> مستني موافقتك...
                  </>
                ) : (
                  <>
                    <Icon name="key" size={15} /> {existing ? "إعادة الربط" : `ربط بحساب ${provider?.name ?? type.name}`}
                  </>
                )}
              </button>
            ) : (
              <button className="btn primary" onClick={save} disabled={Boolean(busy)}>
                {busy === "save" ? <Spinner size={14} /> : "حفظ"}
              </button>
            )}
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
              {t.oauth && <span className="badge success" style={{ fontSize: 10.5 }}>ربط بضغطة</span>}
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
          {type.oauth && provider?.ready === false && (
            <div className="alert error" style={{ marginBottom: 12 }}>
              الربط بـ {provider.name} لسه مش متفعّل على المنصة. صاحب المنصة يضيف {provider.env.join(" و ")} في إعدادات السيرفر، ويسجّل رابط الرجوع:
              <div className="mono" style={{ direction: "ltr", marginTop: 6, wordBreak: "break-all" }}>
                {meta.oauth?.redirectUrl}
              </div>
            </div>
          )}
          {existing?.oauth && (
            <div className="alert info" style={{ marginBottom: 12 }}>
              مربوط بـ {existing.oauth.account || "الحساب"}
              {existing.oauth.expiresAt && !existing.oauth.refreshable ? ` - صالح لحد ${new Date(existing.oauth.expiresAt).toLocaleDateString("ar-EG")}` : " - بيتجدد تلقائياً"}
            </div>
          )}
          {!type.oauth?.creates && (
            <div className="field">
              <label className="label">اسم الحساب</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: بوت خدمة العملاء" />
            </div>
          )}
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
                  {c.oauth && (
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                      <span className="muted">مربوط بـ</span>
                      <span className="faint" style={{ direction: "ltr" }}>{c.oauth.account || "—"}</span>
                    </div>
                  )}
                  {type?.fields.map((f) => (
                    <div key={f.key} className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                      <span className="muted">{f.label}</span>
                      <span className="mono faint">{c.preview[f.key] || "—"}</span>
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
                    {type?.oauth ? "إعادة الربط" : "تعديل"}
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
