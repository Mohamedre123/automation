import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context";
import { Icon } from "../icons";

const links = [
  { to: "/", icon: "flows", label: "السيناريوهات", end: true },
  { to: "/templates", icon: "templates", label: "التيمبلت" },
  { to: "/credentials", icon: "key", label: "الحسابات" },
  { to: "/executions", icon: "history", label: "التشغيلات" },
  { to: "/datastore", icon: "database", label: "البيانات" },
];

export function Layout() {
  const { user, signOut } = useAuth();
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="القائمة الرئيسية">
        <div className="logo" title="تدفّق">
          <Icon name="zap" size={22} />
        </div>
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
            <Icon name={link.icon} size={20} />
            {link.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <button className="side-link" onClick={signOut} title={user?.email}>
          <Icon name="logout" size={20} />
          خروج
        </button>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
