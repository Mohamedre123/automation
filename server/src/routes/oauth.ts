import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { decrypt, encrypt, randomToken } from "../crypto.js";
import { newId, now, one, query, run } from "../db.js";
import { httpError } from "../errors.js";
import { getCredentialType } from "../nodes/index.js";
import { errorMessage } from "../nodes/util.js";
import { authorizationUrl, exchangeCode, oauthProviders, pkcePair, providerReady, tokenData, type TokenResponse } from "../oauth.js";
import { rateLimit } from "../protection.js";

const STATE_TTL_MS = 15 * 60_000;

/** Saves (or refreshes, when the same account is connected again) one credential. */
async function upsertCredential(userId: string, type: string, name: string, data: Record<string, string>, match?: (existing: Record<string, string>) => boolean, id?: string) {
  const timestamp = now();
  if (id) {
    const row = await one<{ id: string }>("SELECT id FROM credentials WHERE id = $1 AND user_id = $2", [id, userId]);
    if (row) {
      await run("UPDATE credentials SET data = $1, updated_at = $2 WHERE id = $3", [encrypt(data), timestamp, id]);
      return id;
    }
  }
  if (match) {
    const rows = await query<{ id: string; data: string }>("SELECT id, data FROM credentials WHERE user_id = $1 AND type = $2", [userId, type]);
    const existing = rows.find((row) => match(decrypt<Record<string, string>>(row.data)));
    if (existing) {
      await run("UPDATE credentials SET name = $1, data = $2, updated_at = $3 WHERE id = $4", [name, encrypt(data), timestamp, existing.id]);
      return existing.id;
    }
  }
  const newCredentialId = newId();
  await run("INSERT INTO credentials (id, user_id, type, name, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    newCredentialId,
    userId,
    type,
    name,
    encrypt(data),
    timestamp,
    timestamp,
  ]);
  return newCredentialId;
}

/** Facebook login gives a user token: turn it into one ready account per Page and per Instagram Business profile. */
async function connectMetaAssets(userId: string, token: TokenResponse) {
  const url = new URL("https://graph.facebook.com/v25.0/me/accounts");
  url.search = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
    access_token: token.access_token,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Facebook: ${data?.error?.message ?? `HTTP ${response.status}`}`);
  const pages: any[] = data?.data ?? [];
  if (!pages.length) throw new Error("مفيش صفحات فيسبوك اتختارت - اربط تاني واختار صفحة واحدة على الأقل");

  const created: string[] = [];
  for (const page of pages) {
    // Page tokens derived from a long-lived user token don't expire.
    created.push(
      await upsertCredential(userId, "facebookPage", `فيسبوك: ${page.name}`, { pageId: page.id, pageAccessToken: page.access_token }, (d) => d.pageId === page.id),
    );
    const ig = page.instagram_business_account;
    if (ig?.id) {
      created.push(
        await upsertCredential(
          userId,
          "instagramBusiness",
          `إنستجرام: @${ig.username ?? ig.id}`,
          { igUserId: ig.id, accessToken: page.access_token },
          (d) => d.igUserId === ig.id,
        ),
      );
    }
  }
  return created;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The popup reports back to the page that opened it, then closes. */
function resultPage(result: { ok: boolean; message: string; credentialIds?: string[] }) {
  const payload = JSON.stringify({ source: "tadfuq-oauth", ...result }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تدفّق</title><style>body{font-family:system-ui,sans-serif;background:#0b0907;color:#fbf6ef;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;text-align:center}
.card{max-width:420px}.ok{color:#34d399}.err{color:#fb7185}a{color:#fbbf24}</style></head><body><div class="card">
<h2 class="${result.ok ? "ok" : "err"}">${result.ok ? "✓ تم الربط" : "الربط ما كملش"}</h2><p>${escapeHtml(result.message)}</p>
<p><a href="/app/credentials">ارجع للحسابات</a></p></div>
<script>var r=${payload};r.at=Date.now();
try{localStorage.setItem("tadfuq-oauth-result",JSON.stringify(r))}catch(e){}
try{if(window.opener){window.opener.postMessage(r,"*")}}catch(e){}
setTimeout(function(){window.close()},${result.ok ? 900 : 5000});</script>
</body></html>`;
}

/** Logged-in part: start a connection. */
export async function oauthRoutes(app: FastifyInstance) {
  app.post("/api/oauth/:type/start", async (req) => {
    await rateLimit(`oauth:${req.user.id}`, 20, 600);
    const { type: key } = req.params as { type: string };
    const type = getCredentialType(key);
    if (!type?.oauth) throw httpError(400, "نوع الحساب ده مش بيتربط بتسجيل الدخول");
    const provider = oauthProviders[type.oauth.provider];
    if (!provider || !providerReady(provider)) {
      throw httpError(503, `الربط بـ ${provider?.name ?? type.name} لسه مش متفعّل على المنصة - صاحب المنصة لازم يضيف ${provider?.envNames.join(" و ")}`);
    }
    const body = (req.body ?? {}) as { name?: string; credentialId?: string };
    const state = randomToken(24);
    const pkce = provider.pkce ? pkcePair() : undefined;
    await run("DELETE FROM oauth_states WHERE created_at < $1", [new Date(Date.now() - STATE_TTL_MS).toISOString()]);
    await run("INSERT INTO oauth_states (state, user_id, type, name, verifier, credential_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      state,
      req.user.id,
      type.key,
      String(body.name ?? "").trim().slice(0, 120),
      pkce?.verifier ?? "",
      String(body.credentialId ?? ""),
      now(),
    ]);
    return { url: authorizationUrl(provider, type.oauth.scopes, state, pkce?.challenge) };
  });
}

/** Public part: the provider sends the customer back here. */
export async function oauthCallbackRoutes(app: FastifyInstance) {
  app.get("/api/oauth/callback", async (req, reply) => {
    reply.type("text/html; charset=utf-8");
    // Provider pages can cut the popup off from its opener; the result also travels through localStorage.
    reply.header("cross-origin-opener-policy", "unsafe-none");
    const q = (req.query ?? {}) as Record<string, string>;
    const stateRow = q.state ? await one<any>("SELECT * FROM oauth_states WHERE state = $1", [q.state]) : undefined;
    if (stateRow) await run("DELETE FROM oauth_states WHERE state = $1", [q.state]);
    if (!stateRow || Date.parse(stateRow.created_at) < Date.now() - STATE_TTL_MS) {
      return resultPage({ ok: false, message: "الرابط انتهى أو اتستخدم قبل كده - جرّب الربط تاني من صفحة «الحسابات»." });
    }
    if (q.error) {
      const denied = /denied|cancel/i.test(`${q.error} ${q.error_description ?? ""}`);
      return resultPage({ ok: false, message: denied ? "اتلغى الربط - موافقتك مطلوبة عشان المنصة تقدر تستخدم الحساب." : `${q.error_description || q.error}` });
    }
    const type = getCredentialType(stateRow.type);
    const provider = type?.oauth ? oauthProviders[type.oauth.provider] : undefined;
    if (!type?.oauth || !provider || !q.code) return resultPage({ ok: false, message: "طلب الربط ناقص - جرّب تاني." });

    try {
      const token = await exchangeCode(provider, q.code, stateRow.verifier || undefined);
      if (type.oauth.creates?.length) {
        const ids = await connectMetaAssets(stateRow.user_id, token);
        return resultPage({ ok: true, message: `اتضاف ${ids.length} حساب (صفحات فيسبوك وحسابات إنستجرام) - تقدر تقفل الصفحة دي.`, credentialIds: ids });
      }
      const profile = provider.profile ? await provider.profile(token.access_token, token).catch(() => ({ account: provider.name, extra: {} })) : { account: provider.name };
      const data = { ...tokenData(token), account: profile.account, ...(profile.extra ?? {}) };
      const name = stateRow.name || `${type.name}: ${profile.account}`;
      const id = await upsertCredential(stateRow.user_id, type.key, name, data, (d) => d.account === profile.account, stateRow.credential_id || undefined);
      return resultPage({ ok: true, message: `اتربط ${type.name} (${profile.account}) - تقدر تقفل الصفحة دي.`, credentialIds: [id] });
    } catch (error) {
      req.log.warn({ err: error }, "oauth callback failed");
      return resultPage({ ok: false, message: errorMessage(error) });
    }
  });
}

export const oauthStatus = () =>
  Object.fromEntries(Object.values(oauthProviders).map((p) => [p.key, { name: p.name, ready: providerReady(p), env: p.envNames }]));

export const oauthRedirect = () => `${config.publicUrl}/api/oauth/callback`;
