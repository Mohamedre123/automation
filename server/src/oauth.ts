import crypto from "node:crypto";
import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";
import { now, one, run } from "./db.js";
import type { CredentialValue } from "./engine/types.js";

/**
 * "Connect with ..." accounts. The platform owner registers one app per provider
 * (env vars below) with the redirect URL {PUBLIC_URL}/api/oauth/callback; customers just click and approve.
 */
export interface OAuthProvider {
  key: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  envNames: [string, string];
  scopeSeparator: string;
  /** TikTok calls the client id "client_key". */
  clientIdParam?: string;
  pkce?: boolean;
  /** X wants the client secret as HTTP Basic auth on the token call. */
  basicAuth?: boolean;
  extraAuthParams?: Record<string, string>;
  /** Who connected (shown on the account card). */
  profile?: (accessToken: string, token: TokenResponse) => Promise<{ account: string; extra?: Record<string, string> }>;
  /** Meta: short-lived token -> long-lived one. */
  upgradeToken?: (token: TokenResponse) => Promise<TokenResponse>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  open_id?: string;
  [key: string]: unknown;
}

const env = (name: string) => process.env[name] || "";

async function getJson(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? data?.error_description ?? `HTTP ${response.status}`);
  return data;
}

export const oauthProviders: Record<string, OAuthProvider> = {
  google: {
    key: "google",
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    envNames: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    scopeSeparator: " ",
    pkce: true,
    // offline + consent: always get a refresh token so the connection keeps working.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    async profile(token) {
      const me = await getJson("https://www.googleapis.com/oauth2/v3/userinfo", { authorization: `Bearer ${token}` });
      return { account: me.email ?? me.name ?? "Google" };
    },
  },
  meta: {
    key: "meta",
    name: "Facebook / Instagram",
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    clientId: env("META_APP_ID"),
    clientSecret: env("META_APP_SECRET"),
    envNames: ["META_APP_ID", "META_APP_SECRET"],
    scopeSeparator: ",",
    async upgradeToken(token) {
      const url = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
      url.search = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: env("META_APP_ID"),
        client_secret: env("META_APP_SECRET"),
        fb_exchange_token: token.access_token,
      }).toString();
      return { ...token, ...(await getJson(url.toString(), {})) };
    },
    async profile(token) {
      const me = await getJson("https://graph.facebook.com/v25.0/me?fields=name", { authorization: `Bearer ${token}` });
      return { account: me.name ?? "Facebook" };
    },
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientId: env("TIKTOK_CLIENT_KEY"),
    clientSecret: env("TIKTOK_CLIENT_SECRET"),
    envNames: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    scopeSeparator: ",",
    clientIdParam: "client_key",
    async profile(token) {
      const me = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=display_name,username", { authorization: `Bearer ${token}` });
      const user = me.data?.user ?? {};
      return { account: user.username ? `@${user.username}` : (user.display_name ?? "TikTok") };
    },
  },
  linkedin: {
    key: "linkedin",
    name: "LinkedIn",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientId: env("LINKEDIN_CLIENT_ID"),
    clientSecret: env("LINKEDIN_CLIENT_SECRET"),
    envNames: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    scopeSeparator: " ",
    async profile(token) {
      const me = await getJson("https://api.linkedin.com/v2/userinfo", { authorization: `Bearer ${token}` });
      return { account: me.name ?? me.email ?? "LinkedIn", extra: { memberId: String(me.sub ?? "") } };
    },
  },
  x: {
    key: "x",
    name: "X",
    authUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    clientId: env("X_CLIENT_ID"),
    clientSecret: env("X_CLIENT_SECRET"),
    envNames: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    scopeSeparator: " ",
    pkce: true,
    basicAuth: true,
    async profile(token) {
      const me = await getJson("https://api.x.com/2/users/me", { authorization: `Bearer ${token}` });
      return { account: me.data?.username ? `@${me.data.username}` : "X" };
    },
  },
};

export const oauthRedirectUrl = () => `${config.publicUrl}/api/oauth/callback`;
export const providerReady = (provider: OAuthProvider) => Boolean(provider.clientId && provider.clientSecret);

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizationUrl(provider: OAuthProvider, scopes: string[], state: string, challenge?: string) {
  const url = new URL(provider.authUrl);
  const params: Record<string, string> = {
    [provider.clientIdParam ?? "client_id"]: provider.clientId,
    redirect_uri: oauthRedirectUrl(),
    response_type: "code",
    scope: scopes.join(provider.scopeSeparator),
    state,
    ...(provider.extraAuthParams ?? {}),
  };
  if (provider.pkce && challenge) {
    params.code_challenge = challenge;
    params.code_challenge_method = "S256";
  }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

async function tokenRequest(provider: OAuthProvider, form: Record<string, string>): Promise<TokenResponse> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const body: Record<string, string> = { ...form };
  if (provider.basicAuth) {
    headers.authorization = `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString("base64")}`;
    body.client_id = provider.clientId;
  } else {
    body[provider.clientIdParam ?? "client_id"] = provider.clientId;
    body.client_secret = provider.clientSecret;
  }
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    const detail = data?.error_description ?? data?.error?.message ?? data?.message ?? data?.error ?? `HTTP ${response.status}`;
    throw new Error(`${provider.name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return data;
}

export async function exchangeCode(provider: OAuthProvider, code: string, verifier?: string) {
  let token = await tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthRedirectUrl(),
    ...(provider.pkce && verifier ? { code_verifier: verifier } : {}),
  });
  if (provider.upgradeToken) token = await provider.upgradeToken(token);
  return token;
}

/** Stored credential data for an OAuth account. */
export function tokenData(token: TokenResponse, previous: Record<string, string> = {}) {
  return {
    ...previous,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? previous.refreshToken ?? "",
    expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : (previous.expiresAt ?? ""),
    scope: String(token.scope ?? previous.scope ?? ""),
    ...(token.open_id ? { openId: String(token.open_id) } : {}),
  };
}

/**
 * A valid access token for a connected account, refreshing (and saving) it when it is about to expire.
 * Steps call this instead of reading the token directly.
 */
export async function oauthAccessToken(credential: CredentialValue | undefined, providerKey: string, signal?: AbortSignal) {
  if (!credential?.data.accessToken) throw new Error("الحساب ده مش مربوط - اربطه تاني من صفحة «الحسابات»");
  const provider = oauthProviders[providerKey];
  const expiresAt = Date.parse(credential.data.expiresAt ?? "");
  const fresh = !Number.isFinite(expiresAt) || expiresAt > Date.now() + 90_000;
  if (fresh) return credential.data.accessToken;
  if (!credential.data.refreshToken || !provider) {
    throw new Error(`صلاحية ربط ${provider?.name ?? "الحساب"} خلصت - افتح «الحسابات» ودوس «إعادة الربط»`);
  }
  signal?.throwIfAborted();
  const token = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: credential.data.refreshToken }).catch((e) => {
    throw new Error(`${e.message} - افتح «الحسابات» ودوس «إعادة الربط»`);
  });
  const data = tokenData(token, credential.data);
  credential.data = data;
  if (credential.id) {
    // Another run may have refreshed at the same moment: keep whatever is newest.
    const row = await one<{ data: string }>("SELECT data FROM credentials WHERE id = $1", [credential.id]);
    const stored = row ? decrypt<Record<string, string>>(row.data) : {};
    await run("UPDATE credentials SET data = $1, updated_at = $2 WHERE id = $3", [encrypt({ ...stored, ...data }), now(), credential.id]);
  }
  return data.accessToken;
}
