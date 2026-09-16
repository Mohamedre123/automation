import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { AssistantLauncher } from "./Assistant";
import { BurgerButton, NavDrawer, type NavItem } from "./NavDrawer";
import { ThemeToggle, UserMenu } from "./UserMenu";

const links: NavItem[] = [
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
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/app" className="brand">
          <img className="brand-logo" src="/logo.png" alt="تدفّق" />
          <span className="brand-name">تدفّق</span>
        </Link>

        <nav className="nav-links" aria-label="القائمة الرئيسية">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Icon name={link.icon} size={17} />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-center">
          <ThemeToggle />
        </div>

        <div className="nav-side">
          <UserMenu />
          <BurgerButton open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
        </div>
      </header>

      <NavDrawer
        open={menuOpen}
        onClose={closeMenu}
        links={links}
        homeTo="/app"
        footer={
          <Link className="btn block" to="/" onClick={closeMenu}>
            <Icon name="home" size={16} /> الصفحة الرئيسية للموقع
          </Link>
        }
      />

      <main className="main">
        <Outlet />
      </main>
      <AssistantLauncher />
    </div>
  );
}
