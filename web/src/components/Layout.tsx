import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context";
import { Icon } from "../icons";

const links = [
  { to: "/app", icon: "flows", label: "السيناريوهات", end: true },
  { to: "/app/templates", icon: "templates", label: "التيمبلت" },
  { to: "/app/credentials", icon: "key", label: "الحسابات" },
  { to: "/app/executions", icon: "history", label: "التشغيلات" },
  { to: "/app/datastore", icon: "database", label: "البيانات" },
];

const THEME_KEY = "tadfuq_theme";

export function applyStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light") document.documentElement.dataset.theme = "light";
  } catch {
    /* private mode: stay on the default dark theme */
  }
}

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, next ? "light" : "dark");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/app" className="brand">
          <span className="brand-mark">
            <Icon name="zap" size={19} />
          </span>
          تدفّق
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
          <button className="btn ghost icon sm" onClick={toggleTheme} title={light ? "الوضع الليلي" : "الوضع النهاري"}>
            <Icon name={light ? "moon" : "sun"} size={17} />
          </button>
          <button className="btn ghost icon sm" onClick={signOut} title={`خروج (${user?.email ?? ""})`}>
            <Icon name="logout" size={17} />
          </button>
          <span className="avatar" title={user?.name}>
            {user?.name?.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <button
            className="btn ghost icon sm burger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="القائمة"
            aria-expanded={menuOpen}
          >
            <Icon name={menuOpen ? "x" : "menu"} size={18} />
          </button>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
