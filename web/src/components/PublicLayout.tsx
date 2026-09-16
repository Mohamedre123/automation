import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context";
import { Icon } from "../icons";
import { BurgerButton, NavDrawer } from "./NavDrawer";
import { useAutoHideHeader } from "./useAutoHideHeader";
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
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const bar = useAutoHideHeader(menuOpen);

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
        <header className={`topbar ${bar.hidden ? "is-hidden" : ""} ${bar.scrolled ? "is-scrolled" : ""}`}>
          <Link to="/" className="brand">
            <img className="brand-logo" src="/logo.png" alt="تدفّق" />
            <span className="brand-name">تدفّق</span>
          </Link>

          <nav className="nav-links" aria-label="أقسام الموقع">
            {PUBLIC_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <Icon name={link.icon} size={16} />
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav-side">
            <ThemeToggle />
            {loading ? null : user ? (
              <>
                <Link className="btn primary sm hide-sm" to="/app">
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
            <BurgerButton open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
          </div>
        </header>

        <NavDrawer
          open={menuOpen}
          onClose={closeMenu}
          links={[{ to: "/", label: "الرئيسية", icon: "home", end: true }, ...PUBLIC_LINKS]}
          homeTo="/"
          footer={
            loading ? null : user ? (
              <Link className="btn primary block" to="/app" onClick={closeMenu}>
                <Icon name="flows" size={16} /> لوحة التحكم
              </Link>
            ) : (
              <div className="drawer-actions">
                <Link className="btn" to="/login" onClick={closeMenu}>
                  تسجيل الدخول
                </Link>
                <Link className="btn primary" to="/register" onClick={closeMenu}>
                  ابدأ مجاناً
                </Link>
              </div>
            )
          }
        />

        <Outlet />

        <footer className="site-footer">
          <div className="footer-grid">
            <div>
              <Link to="/" className="brand" style={{ marginBottom: 10 }}>
                <img className="brand-logo" src="/logo.png" alt="تدفّق" />
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
