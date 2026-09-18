import { useEffect, useState } from "react";

export interface SiteContact {
  whatsapp: string;
  phone: string;
}

// Shown until the server answers (and if it can't); the live values come from the admin settings.
const FALLBACK: SiteContact = { whatsapp: "+201200026457", phone: "+201281762540" };
let cached: SiteContact | null = null;
let pending: Promise<SiteContact> | null = null;

function load() {
  pending ??= fetch("/api/site")
    .then((r) => r.json())
    .then((res: { contact: SiteContact }) => (cached = res.contact))
    .catch(() => FALLBACK);
  return pending;
}

export function useSiteContact(): SiteContact {
  const [contact, setContact] = useState(cached ?? FALLBACK);
  useEffect(() => {
    if (!cached) void load().then(setContact);
  }, []);
  return contact;
}

export const digits = (phone: string) => phone.replace(/\D/g, "");
export const whatsappLink = (phone: string, text?: string) => `https://wa.me/${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
/** "+201200026457" -> "+20 120 002 6457" for reading. */
export const prettyPhone = (phone: string) => {
  const d = digits(phone);
  return d.startsWith("20") && d.length === 12 ? `+20 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : phone;
};
