import { useState, type FormEvent } from "react";
import { useReveal } from "../../components/PublicLayout";
import { prettyPhone, useSiteContact, whatsappLink } from "../../components/siteContact";
import { useAuth } from "../../context";
import { Icon } from "../../icons";

export function Contact() {
  const { user } = useAuth();
  const contact = useSiteContact();
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "", message: "" });
  const [sent, setSent] = useState(false);
  useReveal();

  // The message opens in WhatsApp, addressed to the site's number, with the name and email filled in.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = [
      "السلام عليكم، رسالة من صفحة التواصل في تدفّق 👋",
      "",
      `الاسم: ${form.name.trim()}`,
      `الإيميل: ${form.email.trim()}`,
      ...(user ? [`رقم الحساب: ${user.id}`] : []),
      "",
      form.message.trim(),
    ].join("\n");
    window.open(whatsappLink(contact.whatsapp, text), "_blank", "noopener");
    setSent(true);
  };

  return (
    <div className="section">
      <div className="section-head reveal" style={{ marginTop: 10 }}>
        <span className="eyebrow">
          <Icon name="send" size={15} /> تواصل معنا
        </span>
        <h2>محتاج مساعدة أو عندك فكرة؟</h2>
        <p>كلّمنا على واتساب أو تليفون، أو ابعت رسالتك من الفورم وهتوصلنا على واتساب على طول.</p>
      </div>

      <div className="contact-channels reveal">
        <a className="card contact-channel" href={whatsappLink(contact.whatsapp)} target="_blank" rel="noreferrer">
          <span className="contact-icon whatsapp">
            <Icon name="whatsapp" size={22} />
          </span>
          <span>
            <strong>واتساب</strong>
            <span className="mono" dir="ltr">
              {prettyPhone(contact.whatsapp)}
            </span>
          </span>
        </a>
        <a className="card contact-channel" href={`tel:${contact.phone}`}>
          <span className="contact-icon">
            <Icon name="phone" size={22} />
          </span>
          <span>
            <strong>تليفون</strong>
            <span className="mono" dir="ltr">
              {prettyPhone(contact.phone)}
            </span>
          </span>
        </a>
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
            dir="ltr"
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
        <button className="btn whatsapp block">
          <Icon name="whatsapp" size={18} /> إرسال على واتساب
        </button>
        {sent && (
          <div className="alert success" style={{ marginTop: 12 }}>
            واتساب اتفتح برسالتك جاهزة - دوس «إرسال» هناك وهنرد عليك في أقرب وقت.
          </div>
        )}
      </form>
    </div>
  );
}
