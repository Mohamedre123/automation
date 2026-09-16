import {
  siAirtable,
  siBluesky,
  siClaude,
  siDiscord,
  siGhost,
  siGithub,
  siGmail,
  siGooglegemini,
  siGooglesheets,
  siHubspot,
  siInstagram,
  siFacebook,
  siMailchimp,
  siNotion,
  siPinterest,
  siRss,
  siSalla,
  siShopify,
  siStripe,
  siTelegram,
  siThreads,
  siTrello,
  siWebflow,
  siWhatsapp,
  siWix,
  siWoocommerce,
  siWordpress,
  siX,
  siYoutube,
} from "simple-icons";

/** Official brand marks (Simple Icons, 24x24 viewBox) drawn on the brand's own color. */
export interface Brand {
  path: string;
  /** Tile background: brand color or gradient. */
  bg: string;
  /** Glyph color on that background. */
  fg?: string;
}

// Marks that newer Simple Icons releases no longer ship.
const OPENAI =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";
const SLACK =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z";
const LINKEDIN =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";
// Zid has no public mark in Simple Icons: a rounded "Z" in its purple.
const ZID = "M5 4h14v3.2L10.1 17H19v3H5v-3.2L13.9 7H5z";

const INSTAGRAM_BG = "linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)";
const DARK = "#1b1f2e";

export const BRANDS: Record<string, Brand> = {
  whatsapp: { path: siWhatsapp.path, bg: "#25d366" },
  telegram: { path: siTelegram.path, bg: "#26a5e4" },
  instagram: { path: siInstagram.path, bg: INSTAGRAM_BG },
  facebook: { path: siFacebook.path, bg: "#0866ff" },
  threads: { path: siThreads.path, bg: DARK },
  x: { path: siX.path, bg: DARK },
  linkedin: { path: LINKEDIN, bg: "#0a66c2" },
  pinterest: { path: siPinterest.path, bg: "#e60023" },
  bluesky: { path: siBluesky.path, bg: "#1185fe" },
  youtube: { path: siYoutube.path, bg: "#ff0000" },
  gemini: { path: siGooglegemini.path, bg: "linear-gradient(135deg, #4285f4, #9b72cb 60%, #d96570)" },
  openai: { path: OPENAI, bg: "#10a37f" },
  anthropic: { path: siClaude.path, bg: "#d97757" },
  slack: { path: SLACK, bg: "#4a154b" },
  discord: { path: siDiscord.path, bg: "#5865f2" },
  gmail: { path: siGmail.path, bg: "#ea4335" },
  sheets: { path: siGooglesheets.path, bg: "#0f9d58" },
  airtable: { path: siAirtable.path, bg: "#18bfff" },
  notion: { path: siNotion.path, bg: DARK },
  trello: { path: siTrello.path, bg: "#0052cc" },
  github: { path: siGithub.path, bg: "#24292f" },
  shopify: { path: siShopify.path, bg: "#5e8e3e" },
  woocommerce: { path: siWoocommerce.path, bg: "#7f54b3" },
  wordpress: { path: siWordpress.path, bg: "#21759b" },
  ghost: { path: siGhost.path, bg: DARK },
  webflow: { path: siWebflow.path, bg: "#146ef5" },
  wix: { path: siWix.path, bg: DARK },
  salla: { path: siSalla.path, bg: "#004956", fg: "#baf3e6" },
  zid: { path: ZID, bg: "#6d28d9" },
  stripe: { path: siStripe.path, bg: "#635bff" },
  hubspot: { path: siHubspot.path, bg: "#ff7a59" },
  mailchimp: { path: siMailchimp.path, bg: "#ffe01b", fg: "#241c15" },
  rss: { path: siRss.path, bg: "#f97316" },
};

/** Tile background for an app: the real brand color when we have its mark. */
export const brandBackground = (app: string, fallback?: string) => BRANDS[app]?.bg ?? fallback;
