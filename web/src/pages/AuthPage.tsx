import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Spinner } from "../components/ui";
import { ThemeToggle } from "../components/UserMenu";
import { useAuth } from "../context";
import { Icon } from "../icons";
import type { User } from "../types";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;
  const isRegister = mode === "register";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User }>(isRegister ? "/auth/register" : "/auth/login", { body: form });
      signIn(res.token, res.user);
      navigate("/app", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
              عندك حساب؟ <Link to="/login">سجّل دخول</Link>
            </>
          ) : (
            <>
              مستخدم جديد؟ <Link to="/register">اعمل حساب</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
