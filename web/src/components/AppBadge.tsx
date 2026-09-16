import { AppGlyph } from "../icons";

/** Brand colors for pages that render without the logged-in platform catalog (public site). */
export const APP_COLORS: Record<string, string> = {
  whatsapp: "#25d366",
  telegram: "#229ed9",
  instagram: "#e1306c",
  facebook: "#1877f2",
  gemini: "#4285f4",
  openai: "#10a37f",
  anthropic: "#d97757",
  webhook: "#e5487a",
  http: "#2563eb",
  schedule: "#7c5cff",
  manual: "#64748b",
  datastore: "#0284c7",
  agent: "#9333ea",
  ai: "#7c3aed",
  logic: "#16a34a",
  tools: "#0f766e",
};

export function AppBadge({ app, size = 34, color }: { app: string; size?: number; color?: string }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, background: color ?? APP_COLORS[app] ?? "#7c5cff" }}>
      <AppGlyph app={app} size={Math.round(size * 0.52)} />
    </span>
  );
}
