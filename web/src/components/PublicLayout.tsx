import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context";
import { Icon } from "../icons";
import { BurgerButton, NavDrawer } from "./NavDrawer";
import { prettyPhone, useSiteContact, whatsappLink } from "./siteContact";
import { useAutoHideHeader } from "./useAutoHideHeader";
import { ThemeToggle, UserMenu } from "./UserMenu";

export const PUBLIC_LINKS = [
  { to: "/features", label: "المنتج", icon: "sparkles" },
  { to: "/solutions", label: "الحلول", icon: "users" },
  { to: "/templates", label: "التيمبلت", icon: "flows" },
  { to: "/integrations", label: "التطبيقات", icon: "templates" },
  { to: "/pricing", label: "الأسعار", icon: "coins" },
  { to: "/help", label: "المساعدة", icon: "search" },
];

/** Tiny live indicator in the footer, from the same health check as the status page. */
function useServiceStatus() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setOk(Boolean(h.ok && h.database === "connected")))
      .catch(() => setOk(false));
  }, []);
  return ok;
}

export function PublicLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const bar = useAutoHideHeader(menuOpen);
  const contact = useSiteContact();
  const status = useServiceStatus();

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
        <header className={`site-header ${bar.hidden ? "is-hidden" : ""} ${bar.scrolled ? "is-scrolled" : ""}`}>
          <div className="site-header-inner">
            <Link to="/" className="brand">
              <img className="brand-logo" src="/logo.png" alt="" />
              <span className="brand-name">تدفّق</span>
            </Link>
            <nav className="site-nav" aria-label="أقسام الموقع">
              {PUBLIC_LINKS.map((link) => (
                <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? "active" : "")}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <div className="site-actions">
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
          </div>
        </header>

        <NavDrawer
          open={menuOpen}
          onClose={closeMenu}
          links={[{ to: "/", label: "الرئيسية", icon: "home", end: true }, ...PUBLIC_LINKS, { to: "/contact", label: "تواصل معنا", icon: "send" }]}
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
                <img className="brand-logo" src="/logo.png" alt="" />
                تدفّق
              </Link>
              <p className="faint" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.8 }}>
                منصة أتمتة عربية بتربط تطبيقاتك ببعض وبالذكاء الاصطناعي، وبتشتغل لوحدها.
              </p>
              <Link to="/status" className={`footer-status ${status === false ? "down" : ""}`}>
                {status === false ? "في مشكلة بنشتغل عليها" : "كل الأنظمة شغالة"}
              </Link>
            </div>
            <div>
              <h4>المنتج</h4>
              <Link to="/features">المميزات</Link>
              <Link to="/ai-agents">AI Agents</Link>
              <Link to="/mcp">MCP</Link>
              <Link to="/integrations">التطبيقات</Link>
              <Link to="/templates">التيمبلت</Link>
              <Link to="/pricing">الأسعار</Link>
            </div>
            <div>
              <h4>الحلول</h4>
              <Link to="/solutions#stores">المتاجر الإلكترونية</Link>
              <Link to="/solutions#support">خدمة العملاء</Link>
              <Link to="/solutions#content">صناعة المحتوى</Link>
              <Link to="/solutions#agencies">الوكالات والفرق</Link>
              <Link to="/enterprise">الشركات</Link>
            </div>
            <div>
              <h4>موارد</h4>
              <Link to="/help">مركز المساعدة</Link>
              <Link to="/changelog">الجديد</Link>
              <Link to="/status">حالة الخدمة</Link>
              <Link to="/about">عن تدفّق</Link>
            </div>
            <div>
              <h4>كلّمنا</h4>
              <a className="footer-contact" href={whatsappLink(contact.whatsapp)} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={15} /> <span dir="ltr">{prettyPhone(contact.whatsapp)}</span>
              </a>
              <a className="footer-contact" href={`tel:${contact.phone}`}>
                <Icon name="phone" size={15} /> <span dir="ltr">{prettyPhone(contact.phone)}</span>
              </a>
              <Link to="/contact">ابعتلنا رسالة</Link>
            </div>
          </div>
          <div className="footer-bottom footer-legal">
            <span>تدفّق © {new Date().getFullYear()}</span>
            <nav>
              <Link to="/privacy">الخصوصية</Link>
              <Link to="/terms">الشروط</Link>
              <Link to="/refund">الاسترداد</Link>
              <Link to="/security">الأمان</Link>
              <Link to="/cookies">الكوكيز</Link>
            </nav>
          </div>
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
