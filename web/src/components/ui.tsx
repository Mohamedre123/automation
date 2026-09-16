import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { brandBackground } from "../brands";
import { AppGlyph, Icon } from "../icons";
import { useMeta } from "../context";

/* ---------- toast ---------- */
type ToastKind = "info" | "success" | "error";
const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);
  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------- primitives ---------- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="إغلاق">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
  title,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      className={`toggle ${on ? "on" : ""}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    />
  );
}

export const Spinner = ({ size = 18 }: { size?: number }) => (
  <span className="spinner" style={{ width: size, height: size }} aria-label="جاري التحميل" />
);

export function AppIcon({ app, size = 36 }: { app: string; size?: number }) {
  const { appColor } = useMeta();
  return (
    <span className="app-icon" style={{ width: size, height: size, background: brandBackground(app, appColor(app)) }}>
      <AppGlyph app={app} size={Math.round(size * 0.52)} />
    </span>
  );
}

const statusLabels: Record<string, string> = { success: "نجح", error: "فشل", running: "شغال", skipped: "اتخطّى" };

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`badge ${status}`}>
    {status === "running" ? <Spinner size={10} /> : <Icon name={status === "success" ? "check" : "alert"} size={12} />}
    {statusLabels[status] ?? status}
  </span>
);

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      {text && <p style={{ margin: "0 0 16px" }}>{text}</p>}
      {action}
    </div>
  );
}

/* ---------- json viewer ---------- */
const IMAGE_URL = /^https?:\/\/\S+(\/media\/[\w-]+|\.(png|jpe?g|webp|gif))(\?\S*)?$/i;

function JsonPrimitive({ value }: { value: unknown }) {
  if (typeof value === "string" && IMAGE_URL.test(value)) {
    return (
      <>
        <span className="s">{JSON.stringify(value)}</span>
        <a href={value} target="_blank" rel="noreferrer" className="json-image">
          <img src={value} alt="معاينة الصورة" loading="lazy" />
        </a>
      </>
    );
  }
  if (typeof value === "string") return <span className="s">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="n">{value}</span>;
  if (typeof value === "boolean" || value === null || value === undefined) return <span className="b">{String(value ?? null)}</span>;
  return <span>{String(value)}</span>;
}

function JsonNode({ name, value, level, last }: { name?: string; value: unknown; level: number; last: boolean }) {
  const [open, setOpen] = useState(level < 2);
  const comma = last ? "" : ",";
  const label = name !== undefined ? (
    <>
      <span className="k">{JSON.stringify(name)}</span>:{" "}
    </>
  ) : null;
  if (!value || typeof value !== "object") {
    return (
      <div>
        {label}
        <JsonPrimitive value={value} />
        {comma}
      </div>
    );
  }
  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  const [openChar, closeChar] = isArray ? ["[", "]"] : ["{", "}"];
  if (!entries.length) {
    return (
      <div>
        {label}
        {openChar}
        {closeChar}
        {comma}
      </div>
    );
  }
  return (
    <div>
      <span className="toggle-btn" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"}
      </span>
      {label}
      {openChar}
      {!open && (
        <span className="faint" style={{ cursor: "pointer" }} onClick={() => setOpen(true)}>
          {" "}
          … {entries.length} {closeChar}
          {comma}
        </span>
      )}
      {open && (
        <>
          <div className="child">
            {entries.slice(0, 200).map(([key, child], i) => (
              <JsonNode
                key={key}
                name={isArray ? undefined : key}
                value={child}
                level={level + 1}
                last={i === Math.min(entries.length, 200) - 1}
              />
            ))}
            {entries.length > 200 && <div className="faint">… {entries.length - 200} more</div>}
          </div>
          <div>
            {closeChar}
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

export const JsonView = ({ value }: { value: unknown }) => (
  <div className="json">
    <JsonNode value={value} level={0} last />
  </div>
);

/* ---------- helpers ---------- */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "من ثواني";
  if (seconds < 3600) return `من ${Math.floor(seconds / 60)} دقيقة`;
  if (seconds < 86400) return `من ${Math.floor(seconds / 3600)} ساعة`;
  return new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} مللي/ث` : `${(ms / 1000).toFixed(1)} ث`;
}

export const modeLabels: Record<string, string> = {
  manual: "تجربة يدوية",
  webhook: "Webhook",
  schedule: "جدولة",
  poll: "تطبيق",
};

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
