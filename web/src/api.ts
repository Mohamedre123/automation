const TOKEN_KEY = "tadfuq_token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode: session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    // A page still open on www.: its requests are redirected to the main address, and the browser
    // will not follow a request across to another address. Move the page there instead.
    if (location.hostname.startsWith("www.")) {
      location.replace(location.href.replace("//www.", "//"));
    }
    // The browser's own words ("Failed to fetch") tell a customer nothing.
    throw new ApiError(NETWORK_ERROR, 0);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/auth/")) {
    tokenStore.clear();
    window.location.assign("/login");
  }
  if (!response.ok) throw new ApiError((data as { error?: string }).error ?? response.statusText, response.status);
  return data as T;
}

export function randomPath(bytes = 18): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buffer)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Where customers reach the platform - the address a form link or a report link must carry. It is
 * the platform's one configured public address, not whatever address this browser happens to be on
 * (an old domain, a preview). In local development the web app has its own port, so it uses that.
 */
export const siteUrl = (publicUrl: string | undefined) =>
  publicUrl && !/localhost|127\.0\.0\.1/.test(publicUrl) ? publicUrl.replace(/\/+$/, "") : window.location.origin;

/** What a customer should read when a request fails: the server's own message, or plain words for a dropped connection. */
export const NETWORK_ERROR = "مقدرناش نوصل للمنصة - اتأكد من النت، واعمل تحديث للصفحة وجرّب تاني";
export const errorText = (error: unknown) =>
  error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String((error as Error)?.message ?? "")) ? NETWORK_ERROR : (error as Error)?.message || NETWORK_ERROR;
