import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import { AssistantLauncher } from "./Assistant";
import { BurgerButton, NavDrawer, type NavItem } from "./NavDrawer";
import { useAutoHideHeader } from "./useAutoHideHeader";
import { ThemeToggle, UserMenu } from "./UserMenu";

const links: NavItem[] = [
  { to: "/app", icon: "flows", label: "السيناريوهات", end: true },
  { to: "/app/templates", icon: "templates", label: "التيمبلت" },
  { to: "/app/credentials", icon: "key", label: "الحسابات" },
  { to: "/app/media", icon: "image", label: "الصور" },
  { to: "/app/executions", icon: "history", label: "التشغيلات" },
  { to: "/app/datastore", icon: "database", label: "البيانات" },
  { to: "/app/mcp", icon: "plug", label: "MCP" },
];

/** Remaining credits, always one tap from the subscription page. */
function CreditPill() {
  const { account } = useAccount();
  const previous = useRef<number | null>(null);
  const [spent, setSpent] = useState<{ amount: number; id: number } | null>(null);

  // When credits drop, float a small "−N" so the customer sees what was just used.
  useEffect(() => {
    if (!account || account.isAdmin) return;
    const before = previous.current;
    previous.current = account.credits;
    if (before !== null && account.credits < before) {
      setSpent({ amount: before - account.credits, id: Date.now() });
      const timer = window.setTimeout(() => setSpent(null), 2600);
      return () => window.clearTimeout(timer);
    }
  }, [account]);

  if (!account) return null;
  const low = !account.isAdmin && account.credits <= Math.max(20, account.monthlyCredits * 0.1);
  return (
    <Link to="/app/billing" className={`credit-pill ${low ? "low" : ""}`} title="الكريديت المتبقي">
      <Icon name={account.isAdmin ? "crown" : "coins"} size={15} />
      <span key={account.credits} className={spent ? "credit-value bump" : "credit-value"}>
        {account.isAdmin ? "أدمن" : account.credits.toLocaleString("en-US")}
      </span>
      {spent && (
        <span key={spent.id} className="credit-spent">
          −{spent.amount.toLocaleString("en-US")}
        </span>
      )}
    </Link>
  );
}

/** Out of credits (or the trial just ended): say so on every page, not only on the billing page. */
function CreditNotice() {
  const { account } = useAccount();
  const location = useLocation();
  if (!account || account.isAdmin || location.pathname === "/app/billing") return null;
  if (account.credits > 0) return null;
  return (
    <div className="alert error credit-notice">
      <Icon name="alert" size={16} /> الكريديت بتاعك خلص - السيناريوهات والمساعد واقفين.{" "}
      <Link to="/app/billing">جدّد أو اترقّى من هنا</Link>
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => setMenuOpen(false), [location.pathname]);
  const bar = useAutoHideHeader(menuOpen);

  return (
    <div className="shell">
      <header className={`topbar ${bar.hidden ? "is-hidden" : ""} ${bar.scrolled ? "is-scrolled" : ""}`}>
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

        <div className="nav-side">
          <CreditPill />
          <ThemeToggle />
          <UserMenu />
          <BurgerButton open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
        </div>
      </header>

      <NavDrawer
        open={menuOpen}
        onClose={closeMenu}
        links={[
          ...links,
          { to: "/app/billing", icon: "crown", label: "الاشتراك والكريديت" },
          ...(user?.isAdmin ? [{ to: "/app/admin", icon: "users", label: "لوحة الأدمن" }] : []),
        ]}
        homeTo="/app"
        footer={
          <Link className="btn block" to="/" onClick={closeMenu}>
            <Icon name="home" size={16} /> الصفحة الرئيسية للموقع
          </Link>
        }
      />

      <main className="main">
        <CreditNotice />
        <Outlet />
      </main>
      <AssistantLauncher />
    </div>
  );
}
