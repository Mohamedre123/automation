import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Spinner } from "../components/ui";
import { ThemeToggle } from "../components/UserMenu";
import { useAuth } from "../context";
import { Icon } from "../icons";
import type { User } from "../types";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // "?next=" brings the customer back to where they started (e.g. the plan they picked on the pricing strip).
  const raw = params.get("next") ?? "";
  const next = raw.startsWith("/app") ? raw : "/app";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // After sign-up (or signing in to an unconfirmed account) the email code is asked for here.
  const [verifyEmail, setVerifyEmail] = useState("");

  if (user) return <Navigate to={next} replace />;
  const isRegister = mode === "register";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token?: string; user?: User; verify?: boolean; email?: string }>(isRegister ? "/auth/register" : "/auth/login", {
        body: form,
      });
      if (res.verify) {
        setVerifyEmail(res.email ?? form.email);
        return;
      }
      signIn(res.token!, res.user!);
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (verifyEmail) {
    return (
      <div className="auth-wrap">
        <div className="auth-top">
          <Link to="/" className="btn ghost sm">
            <Icon name="arrowRight" size={16} /> الصفحة الرئيسية
          </Link>
          <ThemeToggle />
        </div>
        <VerifyCode
          email={verifyEmail}
          onBack={() => setVerifyEmail("")}
          onDone={(token, verified) => {
            signIn(token, verified);
            navigate(next, { replace: true });
          }}
        />
      </div>
    );
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="auth-wrap">
      <div className="auth-top">
        <Link to="/" className="btn ghost sm">
          <Icon name="arrowRight" size={16} /> الصفحة الرئيسية
        </Link>
        <ThemeToggle />
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <Link to="/" className="auth-brand" style={{ color: "inherit" }}>
          <img className="brand-logo lg" src="/logo.png" alt="تدفّق" />
          <div>
            <h1 style={{ fontSize: 22 }}>تدفّق</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              منصة الأتمتة وسيناريوهات العمل
            </div>
          </div>
        </Link>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>{isRegister ? "إنشاء حساب جديد" : "تسجيل الدخول"}</h2>
        {isRegister && (
          <div className="field">
            <label className="label" htmlFor="name">
              الاسم
            </label>
            <input id="name" className="input" value={form.name} onChange={set("name")} required autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="email">
            الإيميل
          </label>
          <input
            id="email"
            className="input mono"
            type="email"
            value={form.email}
            onChange={set("email")}
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            كلمة السر
          </label>
          <input
            id="password"
            className="input mono"
            type="password"
            value={form.password}
            onChange={set("password")}
            required
            minLength={isRegister ? 8 : undefined}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
          {isRegister && <div className="help">8 حروف على الأقل</div>}
        </div>
        {error && (
          <div className="alert error" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}
        <button className="btn primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? <Spinner size={16} /> : isRegister ? "إنشاء الحساب" : "دخول"}
        </button>
        <p className="muted" style={{ textAlign: "center", marginBottom: 0 }}>
          {isRegister ? (
            <>
              عندك حساب؟ <Link to={raw ? `/login?next=${encodeURIComponent(raw)}` : "/login"}>سجّل دخول</Link>
            </>
          ) : (
            <>
              مستخدم جديد؟ <Link to={raw ? `/register?next=${encodeURIComponent(raw)}` : "/register"}>اعمل حساب</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}

/** Six boxes for the emailed code: paste, type or autofill (iOS / Android offer the code from the email). */
function VerifyCode({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: (token: string, user: User) => void }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(60);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    boxes.current[0]?.focus();
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const toLatin = (text: string) =>
    text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\D/g, "");

  const submit = async (code: string) => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User }>("/auth/verify", { body: { email, code } });
      onDone(res.token, res.user);
    } catch (err) {
      setError((err as Error).message);
      setDigits(Array(6).fill(""));
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const fill = (index: number, raw: string) => {
    const value = toLatin(raw);
    const next = [...digits];
    if (value.length > 1) {
      // Pasted or autofilled the whole code.
      value.slice(0, 6 - index).split("").forEach((d, i) => (next[index + i] = d));
    } else {
      next[index] = value;
    }
    setDigits(next);
    const firstEmpty = next.findIndex((d) => !d);
    if (value && firstEmpty !== -1) boxes.current[firstEmpty]?.focus();
    if (next.every(Boolean)) void submit(next.join(""));
  };

  const resend = async () => {
    setError("");
    setInfo("");
    try {
      await api("/auth/resend", { body: { email } });
      setInfo("بعتنالك كود جديد ✓");
      setWait(60);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form
      className="card auth-card"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(digits.join(""));
      }}
    >
      <div className="verify-icon">
        <Icon name="mail" size={28} />
      </div>
      <h2 style={{ fontSize: 20, textAlign: "center", marginBottom: 6 }}>اكتب الكود اللي وصلك</h2>
      <p className="muted" style={{ textAlign: "center", marginTop: 0 }}>
        بعتنا كود من 6 أرقام على
        <br />
        <strong dir="ltr">{email}</strong>
      </p>
      <div className="otp-boxes" dir="ltr">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            className="otp-box"
            value={d}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={i === 0 ? 6 : 1}
            aria-label={`الرقم ${i + 1}`}
            onChange={(e) => fill(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
            }}
            onPaste={(e) => {
              e.preventDefault();
              fill(0, e.clipboardData.getData("text"));
            }}
          />
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}
      <button className="btn primary" style={{ width: "100%" }} disabled={busy || digits.some((d) => !d)}>
        {busy ? <Spinner size={16} /> : "تأكيد"}
      </button>
      <p className="muted" style={{ textAlign: "center", fontSize: 13.5 }}>
        ما وصلكش؟ بص في الـ Spam، أو{" "}
        {wait > 0 ? (
          <span>اطلب كود جديد بعد {wait} ثانية</span>
        ) : (
          <button type="button" className="link-btn" onClick={resend}>
            ابعت كود جديد
          </button>
        )}
      </p>
      <p style={{ textAlign: "center", margin: 0 }}>
        <button type="button" className="link-btn" onClick={onBack}>
          غيّر الإيميل
        </button>
      </p>
    </form>
  );
}
