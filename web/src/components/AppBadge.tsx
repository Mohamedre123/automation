import { brandBackground } from "../brands";
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
  schedule: "#f97316",
  manual: "#64748b",
  datastore: "#0284c7",
  agent: "#9333ea",
  ai: "#7c3aed",
  logic: "#16a34a",
  tools: "#0f766e",
  form: "#f59e0b",
  media: "#0ea5e9",
  email: "#f43f5e",
  rss: "#f97316",
  slack: "#4a154b",
  discord: "#5865f2",
  sheets: "#0f9d58",
  airtable: "#18bfff",
  notion: "#52525b",
  trello: "#0079bf",
  github: "#6e5494",
  shopify: "#5e8e3e",
  woocommerce: "#7f54b3",
  stripe: "#635bff",
  hubspot: "#ff7a59",
  mailchimp: "#d4a300",
  wordpress: "#21759b",
  ghost: "#1b1f2e",
  webflow: "#146ef5",
  wix: "#1b1f2e",
  salla: "#004956",
  zid: "#6d28d9",
  linkedin: "#0a66c2",
  x: "#1b1f2e",
  pinterest: "#e60023",
  threads: "#1b1f2e",
  bluesky: "#1185fe",
  youtube: "#ff0000",
  gmail: "#ea4335",
  social: "#ec4899",
  customai: "#0f766e",
  drive: "#1a73e8",
  gcalendar: "#4285f4",
  tiktok: "#1b1f2e",
  customapi: "#475569",
};

export function AppBadge({ app, size = 34, color }: { app: string; size?: number; color?: string }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, background: brandBackground(app, color ?? APP_COLORS[app] ?? "#f97316") }}>
      <AppGlyph app={app} size={Math.round(size * 0.52)} />
    </span>
  );
}
