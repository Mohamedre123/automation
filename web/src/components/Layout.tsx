import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { AssistantLauncher } from "./Assistant";
import { ThemeToggle, UserMenu } from "./UserMenu";

const links = [
  { to: "/app", icon: "flows", label: "السيناريوهات", end: true },
  { to: "/app/templates", icon: "templates", label: "التيمبلت" },
  { to: "/app/credentials", icon: "key", label: "الحسابات" },
  { to: "/app/media", icon: "image", label: "الصور" },
  { to: "/app/executions", icon: "history", label: "التشغيلات" },
  { to: "/app/datastore", icon: "database", label: "البيانات" },
];

export function Layout() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/app" className="brand">
          <span className="brand-mark">
            <Icon name="zap" size={19} />
          </span>
          <span className="brand-name">تدفّق</span>
        </Link>

        <nav className={`nav-links ${menuOpen ? "open" : ""}`} aria-label="القائمة الرئيسية">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Icon name={link.icon} size={17} />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-side">
          <ThemeToggle />
          <UserMenu />
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

      <main className="main">
        <Outlet />
      </main>
      <AssistantLauncher />
    </div>
  );
}
