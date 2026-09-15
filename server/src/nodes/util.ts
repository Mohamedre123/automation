export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

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

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "انتهت المهلة قبل ما الخطوة تخلص";
    if (error.name === "AbortError") return "اتلغى التشغيل";
    return error.message;
  }
  return String(error);
}
