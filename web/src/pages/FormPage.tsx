import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../api";
import { Link, useParams } from "react-router-dom";
import { Spinner } from "../components/ui";
import { ThemeToggle } from "../components/UserMenu";
import { Icon } from "../icons";

interface FormDefinition {
  title: string;
  description: string;
  fields: { key: string; label: string; kind: "text" | "image" | "yesno" | "time" | "optional" }[];
  submitLabel: string;
  successMessage: string;
  testing: boolean;
}

const IMAGE_URL = /^https?:\/\/\S+(\/media\/[\w-]+|\.(png|jpe?g|webp|gif))(\?\S*)?$/i;

/** Every image URL anywhere in the workflow's response, so generated images show up to the visitor. */
function findImages(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string" && IMAGE_URL.test(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => findImages(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => findImages(item, found));
  return found;
}

function findText(value: unknown): string {
  if (typeof value === "string") return IMAGE_URL.test(value) ? "" : value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "text", "reply", "result", "summary", "translation"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return "";
}

export function FormPage() {
  const { path = "" } = useParams();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; images: string[] } | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  const uploadImage = async (key: string, file: File | undefined) => {
    if (!file) return;
    if (file.size > 2.8 * 1024 * 1024) {
      setResult({ ok: false, text: "الصورة أكبر من 2.8 ميجا", images: [] });
      return;
    }
    setUploading((u) => ({ ...u, [key]: true }));
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("مقدرتش أقرا الصورة"));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`/api/forms/${encodeURIComponent(path)}/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "رفع الصورة فشل");
      setValues((v) => ({ ...v, [key]: data.url }));
    } catch (err) {
      setResult({ ok: false, text: errorText(err), images: [] });
    } finally {
      setUploading((u) => ({ ...u, [key]: false }));
    }
  };

  useEffect(() => {
    fetch(`/api/forms/${encodeURIComponent(path)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "الفورم مش متاح");
        setForm(data);
      })
      .catch((e: Error) => setLoadError(errorText(e)));
  }, [path]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const response = await fetch(`/webhook/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Yes/no questions default to "نعم" even when the visitor never touched them.
        body: JSON.stringify({
          data: Object.fromEntries(form!.fields.map((f) => [f.key, values[f.key] ?? (f.kind === "yesno" ? "نعم" : "")])),
        }),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* plain text response */
      }
      const error = response.ok ? "" : (body as { error?: string })?.error ?? `حصل خطأ (${response.status})`;
      const images = findImages(body);
      const reply = findText(body);
      const acknowledged = body && typeof body === "object" && ("accepted" in body || "executed" in body);
      setResult({
        ok: response.ok,
        text: error || (acknowledged ? form!.successMessage : reply || (images.length ? "" : form!.successMessage)),
        images,
      });
    } catch (err) {
      setResult({ ok: false, text: errorText(err), images: [] });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-top">
        <Link to="/" className="btn ghost sm">
          <Icon name="zap" size={15} /> تدفّق
        </Link>
        <ThemeToggle />
      </div>
      <div className="card auth-card form-card">
        {loadError ? (
          <div className="empty" style={{ padding: 20 }}>
            <div className="empty-icon">
              <Icon name="alert" size={28} />
            </div>
            <h3>الفورم مش متاح</h3>
            <p style={{ margin: 0 }}>{loadError}</p>
          </div>
        ) : !form ? (
          <div className="empty">
            <Spinner size={26} />
          </div>
        ) : (
          <form onSubmit={submit}>
            {form.testing && <div className="badge running" style={{ marginBottom: 14 }}>وضع التجربة</div>}
            <h1 style={{ fontSize: 22, marginBottom: 6 }}>{form.title}</h1>
            {form.description && (
              <p className="muted" style={{ marginTop: 0 }}>
                {form.description}
              </p>
            )}
            {form.fields.map((field) => (
              <div className="field" key={field.key}>
                <label className="label" htmlFor={`f-${field.key}`}>
                  {field.label}
                </label>
                {field.kind === "image" ? (
                  <label className="form-upload" htmlFor={`f-${field.key}`}>
                    {values[field.key] ? (
                      <img src={values[field.key]} alt={field.label} />
                    ) : (
                      <span className="muted">{uploading[field.key] ? "جاري رفع الصورة..." : "اضغط لاختيار صورة"}</span>
                    )}
                    <input
                      id={`f-${field.key}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      required={!values[field.key]}
                      onChange={(e) => void uploadImage(field.key, e.target.files?.[0])}
                    />
                  </label>
                ) : field.kind === "yesno" ? (
                  <select
                    id={`f-${field.key}`}
                    className="select"
                    value={values[field.key] ?? "نعم"}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  >
                    <option value="نعم">نعم</option>
                    <option value="لا">لا</option>
                  </select>
                ) : field.kind === "time" ? (
                  <input
                    id={`f-${field.key}`}
                    className="input"
                    type="time"
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  />
                ) : (
                  <textarea
                    id={`f-${field.key}`}
                    className="textarea"
                    rows={2}
                    dir="auto"
                    required={field.kind !== "optional"}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <button className="btn primary" style={{ width: "100%" }} disabled={sending || Object.values(uploading).some(Boolean)}>
              {sending ? (
                <>
                  <Spinner size={16} /> جاري التنفيذ...
                </>
              ) : (
                form.submitLabel
              )}
            </button>

            {result && (
              <div className="form-result">
                {result.text && <div className={`alert ${result.ok ? "success" : "error"}`}>{result.text}</div>}
                {result.images.map((src) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer">
                    <img src={src} alt="النتيجة" />
                  </a>
                ))}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
