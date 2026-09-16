import { parseBody, withTimeout } from "./util.js";

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  signal: AbortSignal;
  timeoutMs?: number;
}

/** JSON API call with a readable Arabic error that names the service. */
export async function apiRequest<T = any>(label: string, url: string | URL, init: RequestInit): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  }
  const response = await fetch(url, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal: withTimeout(init.signal, init.timeoutMs ?? 30_000),
  });
  const text = await response.text();
  const data = parseBody(text, response.headers.get("content-type")) as any;
  if (!response.ok) {
    const detail =
      typeof data === "string"
        ? data.slice(0, 300)
        : (data?.error?.message ?? data?.message ?? data?.errors?.[0]?.message ?? data?.error_description ?? data?.error ?? data?.detail);
    const message = typeof detail === "string" ? detail : JSON.stringify(detail ?? data).slice(0, 300);
    if (response.status === 401 || response.status === 403) throw new Error(`${label}: المفتاح أو الصلاحيات غلط - ${message}`);
    if (response.status === 404) throw new Error(`${label}: العنصر المطلوب مش موجود - ${message}`);
    if (response.status === 429) throw new Error(`${label}: وصلت للحد المسموح - جرّب بعد شوية`);
    throw new Error(`${label}: ${message}`);
  }
  return data as T;
}

/** Credential tests: throws on 401/403, anything else reachable counts as connected. */
export async function checkAuth(label: string, url: string | URL, headers: Record<string, string>) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 401 || response.status === 403) throw new Error(`${label}: المفتاح أو الصلاحيات غلط`);
  if (!response.ok && response.status !== 404) throw new Error(`${label}: HTTP ${response.status}`);
  return "متصل ✓";
}

export function parseJsonParam(value: unknown, label: string): any {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label}: لازم يكون JSON صحيح`);
  }
}
