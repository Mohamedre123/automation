import { useEffect, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Icon } from "../icons";
import { useTheme } from "../theme";

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

/** Hamburger button shown on phones and tablets only. */
export function BurgerButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="btn ghost icon sm burger" onClick={onClick} aria-label="القائمة" aria-expanded={open}>
      <Icon name="menu" size={20} />
    </button>
  );
}

/**
 * Side drawer for small screens. It lives outside the top bar on purpose: the bar's
 * backdrop-filter would otherwise trap a fixed child inside the bar's own box.
 */
export function NavDrawer({
  open,
  onClose,
  links,
  homeTo,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  links: NavItem[];
  homeTo: string;
  footer?: ReactNode;
}) {
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("drawer-lock");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("drawer-lock");
    };
  }, [open, onClose]);

  return (
    <>
      <div className={`drawer-backdrop ${open ? "open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? "open" : ""}`} aria-label="القائمة" aria-hidden={!open} inert={!open}>
        <div className="drawer-head">
          <Link to={homeTo} className="brand" onClick={onClose}>
            <span className="brand-mark">
              <Icon name="zap" size={19} />
            </span>
            <span className="brand-name">تدفّق</span>
          </Link>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="إغلاق القائمة">
            <Icon name="x" size={19} />
          </button>
        </div>

        <nav className="drawer-links">
          {links.map((link, i) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={onClose}
              className={({ isActive }) => `drawer-link ${isActive ? "active" : ""}`}
              style={{ transitionDelay: open ? `${60 + i * 35}ms` : "0ms" }}
            >
              <span className="drawer-link-icon">
                <Icon name={link.icon} size={18} />
              </span>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="drawer-foot">
          <button className={`theme-switch ${theme}`} onClick={(e) => toggle(e)} aria-label="تبديل الوضع">
            <span className="theme-switch-track">
              <span className="theme-switch-thumb">
                <Icon name={theme === "dark" ? "moon" : "sun"} size={14} />
              </span>
            </span>
            <span>{theme === "dark" ? "الوضع الليلي" : "الوضع النهاري"}</span>
          </button>
          {footer}
        </div>
      </aside>
    </>
  );
}
