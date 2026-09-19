import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAccount, useAuth } from "../context";
import { Icon } from "../icons";
import { AssistantLauncher } from "./Assistant";
import { useAutoHideHeader } from "./useAutoHideHeader";
import { ThemeToggle, UserMenu } from "./UserMenu";

interface SideItem {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
}

/** Sidebar: grouped the way people think about their work, not the way the code is split. */
const GROUPS: { label: string; items: SideItem[] }[] = [
  {
    label: "مساحة العمل",
    items: [
      { to: "/app", icon: "home", label: "نظرة عامة", end: true },
      { to: "/app/scenarios", icon: "flows", label: "السيناريوهات" },
      { to: "/app/templates", icon: "templates", label: "التيمبلت" },
    ],
  },
  {
    label: "المتابعة",
    items: [
      { to: "/app/executions", icon: "history", label: "سجل التشغيل" },
      { to: "/app/usage", icon: "coins", label: "استهلاك الكريديت" },
    ],
  },
  {
    label: "البيانات والربط",
    items: [
      { to: "/app/credentials", icon: "key", label: "الحسابات والمفاتيح" },
      { to: "/app/media", icon: "image", label: "مكتبة الصور" },
      { to: "/app/datastore", icon: "database", label: "مخزن البيانات" },
      { to: "/app/links", icon: "webhook", label: "الروابط والـ Webhooks" },
      { to: "/app/mcp", icon: "plug", label: "MCP" },
    ],
  },
];

const ACCOUNT_ITEMS: SideItem[] = [
  { to: "/app/billing", icon: "crown", label: "الاشتراك" },
  { to: "/app/settings", icon: "tools", label: "الإعدادات" },
];

/** Page names for the top bar. */
const TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, "نظرة عامة"],
  [/^\/app\/scenarios/, "السيناريوهات"],
  [/^\/app\/workflows\//, "المحرر"],
  [/^\/app\/templates/, "التيمبلت"],
  [/^\/app\/executions/, "سجل التشغيل"],
  [/^\/app\/usage/, "استهلاك الكريديت"],
  [/^\/app\/credentials/, "الحسابات والمفاتيح"],
  [/^\/app\/media/, "مكتبة الصور"],
  [/^\/app\/datastore/, "مخزن البيانات"],
  [/^\/app\/links/, "الروابط والـ Webhooks"],
  [/^\/app\/mcp/, "MCP"],
  [/^\/app\/billing/, "الاشتراك والكريديت"],
  [/^\/app\/settings/, "إعدادات الحساب"],
  [/^\/app\/admin/, "لوحة الأدمن"],
];

/** Credits at the bottom of the sidebar; animates a small "−N" whenever something gets charged. */
function SideCredits() {
  const { account } = useAccount();
  const previous = useRef<number | null>(null);
  const [spent, setSpent] = useState<{ amount: number; id: number } | null>(null);

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
  const total = Math.max(account.monthlyCredits, account.credits, 1);
  const percent = Math.max(3, Math.min(100, Math.round((account.credits / total) * 100)));
  const low = !account.isAdmin && account.credits <= Math.max(20, account.monthlyCredits * 0.1);
  return (
    <Link to="/app/billing" className="side-credits credit-pill-host" title="الكريديت المتبقي">
      <div className="side-credits-row">
        <span className="side-credits-text">{account.isAdmin ? "حساب الأدمن" : account.plan.name}</span>
        <strong style={{ position: "relative" }}>
          <span key={account.credits} className={spent ? "credit-value bump" : "credit-value"} style={low ? { color: "var(--danger)" } : undefined}>
            {account.isAdmin ? "∞" : account.credits.toLocaleString("en-US")}
          </span>
          {spent && (
            <span key={spent.id} className="credit-spent">
              −{spent.amount.toLocaleString("en-US")}
            </span>
          )}
        </strong>
      </div>
      {!account.isAdmin && (
        <div className="meter-bar">
          <span className={low ? "low" : ""} style={{ width: `${percent}%` }} />
        </div>
      )}
    </Link>
  );
}

/** Out of credits: said once, at the top of every page. */
function CreditNotice() {
  const { account } = useAccount();
  const location = useLocation();
  if (!account || account.isAdmin || location.pathname === "/app/billing" || account.credits > 0) return null;
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="alert error credit-notice" style={{ margin: 0 }}>
        <Icon name="alert" size={16} /> الكريديت بتاعك خلص - السيناريوهات والمساعد واقفين. <Link to="/app/billing">جدّد أو اشتري كريديت</Link>
      </div>
    </div>
  );
}

function SideLink({ item }: { item: SideItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `side-link ${isActive ? "active" : ""}`} title={item.label}>
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const inEditor = location.pathname.startsWith("/app/workflows/");
  const bar = useAutoHideHeader(drawer || inEditor);
  const title = TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? "";

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <div className={`app-shell ${drawer ? "expanded" : ""} ${inEditor ? "editor-mode" : ""}`}>
      <aside className="app-side" aria-label="القائمة">
        <div className="app-side-head">
          <Link to="/app" className="brand">
            <img className="brand-logo" src="/logo.png" alt="" />
            <span className="brand-name">تدفّق</span>
          </Link>
          <button className="btn ghost icon sm side-close" onClick={closeDrawer} aria-label="إغلاق القائمة">
            <Icon name="x" size={18} />
          </button>
        </div>
        <nav className="app-side-scroll">
          {GROUPS.map((group) => (
            <div className="side-group" key={group.label}>
              <div className="side-label">{group.label}</div>
              {group.items.map((item) => (
                <SideLink key={item.to} item={item} />
              ))}
            </div>
          ))}
          <div className="side-group">
            <div className="side-label">الحساب</div>
            {ACCOUNT_ITEMS.map((item) => (
              <SideLink key={item.to} item={item} />
            ))}
            {user?.isAdmin && <SideLink item={{ to: "/app/admin", icon: "users", label: "لوحة الأدمن" }} />}
          </div>
        </nav>
        <SideCredits />
      </aside>
      <div className="side-scrim" onClick={closeDrawer} aria-hidden="true" />

      <div className="app-main">
        <header className={`app-top ${bar.hidden ? "is-hidden" : ""}`}>
          <button className="btn ghost icon sm side-open" onClick={() => setDrawer((open) => !open)} aria-label="القائمة" aria-expanded={drawer}>
            <Icon name="menu" size={19} />
          </button>
          <div className="app-crumb">{inEditor ? "" : title}</div>
          <Link className="btn ghost sm hide-sm" to="/help">
            مساعدة
          </Link>
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="app-content">
          <CreditNotice />
          <Outlet />
        </main>
      </div>

      {!inEditor && (
        <nav className="app-tabbar" aria-label="التنقل السريع">
          <NavLink to="/app" end className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name="home" size={20} />
            الرئيسية
          </NavLink>
          <NavLink to="/app/scenarios" className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name="flows" size={20} />
            السيناريوهات
          </NavLink>
          <NavLink to="/app/templates" className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name="templates" size={20} />
            التيمبلت
          </NavLink>
          <NavLink to="/app/executions" className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name="history" size={20} />
            التشغيلات
          </NavLink>
          <button onClick={() => setDrawer(true)}>
            <Icon name="menu" size={20} />
            المزيد
          </button>
        </nav>
      )}
      <AssistantLauncher />
    </div>
  );
}
