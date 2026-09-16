import { useState, type FormEvent } from "react";
import { useReveal } from "../../components/PublicLayout";
import { Icon } from "../../icons";

const CONTACT_EMAIL = "support@tadfuq.app";

export function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  useReveal();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = `الاسم: ${form.name}\nالإيميل: ${form.email}\n\n${form.message}`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("تواصل من موقع تدفّق")}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="send" size={15} /> تواصل معنا
        </span>
        <h2>محتاج مساعدة أو عندك فكرة؟</h2>
        <p>ابعتلنا وهنرد عليك في أقرب وقت.</p>
      </div>
      <form className="card contact-card reveal" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="c-name">
            الاسم
          </label>
          <input id="c-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="c-email">
            الإيميل
          </label>
          <input
            id="c-email"
            className="input mono"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="c-message">
            رسالتك
          </label>
          <textarea
            id="c-message"
            className="textarea"
            rows={5}
            required
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
        </div>
        <button className="btn primary" style={{ width: "100%" }}>
          <Icon name="send" size={16} /> إرسال
        </button>
      </form>
    </div>
  );
}
