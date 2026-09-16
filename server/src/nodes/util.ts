export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function parseBody(text: string, contentType: string | null): unknown {
  if (!text) return "";
  if (contentType?.includes("json") || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export const toNumber = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && String(value ?? "").trim() !== "" ? n : fallback;
};

export const keyValueRows = (value: unknown): { key: string; value: unknown }[] =>
  Array.isArray(value) ? value.filter((row) => row && String(row.key ?? "").trim()) : [];

/** Hosted platform only: user-configured URLs (HTTP step, custom providers) may not target private networks. */
export function assertAllowedUrl(raw: string, blockPrivate: boolean): URL {
  if (blockPrivate) return assertPublicUrl(raw);
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("الرابط لازم يبدأ بـ http أو https");
  return url;
}

/** Blocks obvious internal targets for URLs chosen at runtime (e.g. by an AI agent). */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("الرابط مش صحيح");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("الرابط لازم يبدأ بـ http أو https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|::1$|fc|fd|fe80)/i.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new Error("مش مسموح بالوصول لعناوين داخلية");
  }
  return url;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "انتهت المهلة قبل ما الخطوة تخلص";
    if (error.name === "AbortError") return "اتلغى التشغيل";
    return error.message;
  }
  return String(error);
}
