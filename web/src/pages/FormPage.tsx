import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Spinner } from "../components/ui";
import { ThemeToggle } from "../components/UserMenu";
import { Icon } from "../icons";

interface FormDefinition {
  title: string;
  description: string;
  fields: { key: string; label: string }[];
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

  useEffect(() => {
    fetch(`/api/forms/${encodeURIComponent(path)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "الفورم مش متاح");
        setForm(data);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [path]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const response = await fetch(`/webhook/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: values }),
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
      setResult({ ok: false, text: (err as Error).message, images: [] });
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
                <textarea
                  id={`f-${field.key}`}
                  className="textarea"
                  rows={2}
                  dir="auto"
                  required
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
              </div>
            ))}
            <button className="btn primary" style={{ width: "100%" }} disabled={sending}>
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
