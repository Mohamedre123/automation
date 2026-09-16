import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context";
import { Icon } from "../icons";
import { useTheme } from "../theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="btn ghost icon sm theme-toggle"
      onClick={(e) => toggle(e)}
      title={theme === "dark" ? "الوضع النهاري" : "الوضع الليلي"}
      aria-label="تبديل الوضع"
    >
      <Icon key={theme} name={theme === "dark" ? "sun" : "moon"} size={17} />
    </button>
  );
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  const logout = () => {
    if (!window.confirm("متأكد إنك عايز تسجّل خروج؟")) return;
    setOpen(false);
    signOut();
    navigate("/");
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="avatar-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar">{initial}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className="avatar lg">{initial}</span>
            <div style={{ minWidth: 0 }}>
              <strong className="truncate" style={{ display: "block" }}>
                {user.name}
              </strong>
              <span className="faint truncate" style={{ display: "block", fontSize: 12.5 }}>
                {user.email}
              </span>
            </div>
          </div>
          <Link className="menu-item" to="/app" onClick={() => setOpen(false)} role="menuitem">
            <Icon name="flows" size={16} /> لوحة التحكم
          </Link>
          <Link className="menu-item" to="/" onClick={() => setOpen(false)} role="menuitem">
            <Icon name="home" size={16} /> الصفحة الرئيسية
          </Link>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={logout} role="menuitem">
            <Icon name="logout" size={16} /> تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}
