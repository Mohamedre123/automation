import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context";
import { Icon } from "../icons";
import { ThemeToggle, UserMenu } from "./UserMenu";

export const PUBLIC_LINKS = [
  { to: "/features", label: "المميزات", icon: "sparkles" },
  { to: "/integrations", label: "التطبيقات", icon: "templates" },
  { to: "/templates", label: "التيمبلت", icon: "flows" },
  { to: "/pricing", label: "الأسعار", icon: "key" },
  { to: "/contact", label: "تواصل معنا", icon: "send" },
];

export function PublicLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true">
        <span className="orb a" />
        <span className="orb b" />
        <span className="orb c" />
      </div>

      <div className="landing-inner">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Icon name="zap" size={19} />
            </span>
            <span className="brand-name">تدفّق</span>
          </Link>

          <nav className={`nav-links ${menuOpen ? "open" : ""}`} aria-label="أقسام الموقع">
            {PUBLIC_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <Icon name={link.icon} size={16} />
                {link.label}
              </NavLink>
            ))}
            {!loading && !user && (
              <div className="drawer-actions">
                <Link className="btn" to="/login">
                  تسجيل الدخول
                </Link>
                <Link className="btn primary" to="/register">
                  ابدأ مجاناً
                </Link>
              </div>
            )}
          </nav>

          <div className="nav-side">
            <ThemeToggle />
            {loading ? null : user ? (
              <>
                <Link className="btn primary sm hide-xs" to="/app">
                  لوحة التحكم
                </Link>
                <UserMenu />
              </>
            ) : (
              <>
                <Link className="btn ghost sm hide-sm" to="/login">
                  دخول
                </Link>
                <Link className="btn primary sm hide-sm" to="/register">
                  ابدأ مجاناً
                </Link>
              </>
            )}
            <button
              className="btn ghost icon sm burger"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="القائمة"
              aria-expanded={menuOpen}
            >
              <Icon name={menuOpen ? "x" : "menu"} size={19} />
            </button>
          </div>
        </header>
        {menuOpen && <div className="nav-backdrop" onClick={() => setMenuOpen(false)} />}

        <Outlet />

        <footer className="site-footer">
          <div className="footer-grid">
            <div>
              <Link to="/" className="brand" style={{ marginBottom: 10 }}>
                <span className="brand-mark">
                  <Icon name="zap" size={19} />
                </span>
                تدفّق
              </Link>
              <p className="faint" style={{ margin: 0, fontSize: 13.5 }}>
                منصة أتمتة عربية بتربط تطبيقاتك ببعض وبالذكاء الاصطناعي.
              </p>
            </div>
            <div>
              <h4>المنصة</h4>
              {PUBLIC_LINKS.slice(0, 3).map((link) => (
                <Link key={link.to} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </div>
            <div>
              <h4>الشركة</h4>
              {PUBLIC_LINKS.slice(3).map((link) => (
                <Link key={link.to} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </div>
            <div>
              <h4>حسابك</h4>
              {user ? (
                <Link to="/app">لوحة التحكم</Link>
              ) : (
                <>
                  <Link to="/login">تسجيل الدخول</Link>
                  <Link to="/register">إنشاء حساب</Link>
                </>
              )}
            </div>
          </div>
          <div className="footer-bottom">تدفّق © {new Date().getFullYear()} - كل الحقوق محفوظة</div>
        </footer>
      </div>
    </div>
  );
}

/** Adds the "in" class to .reveal elements as they scroll into view. */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const items = document.querySelectorAll(".reveal:not(.in)");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -40px 0px" },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
