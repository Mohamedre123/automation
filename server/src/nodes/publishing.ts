import { createHmac, randomBytes } from "node:crypto";
import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth } from "./api.js";
import { checkEveryField } from "./feeds.js";
import { imageAsBase64 } from "./media.js";
import { keyValueRows, parseBody, sleep, withTimeout } from "./util.js";

const str = (value: unknown) => String(value ?? "").trim();
const list = (value: unknown) =>
  str(value)
    .split(/[,،\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const dummy = (data: Record<string, string>): CredentialValue => ({ id: "", type: "", data });

/** Uploads raw bytes (images) - apiRequest only speaks JSON/form bodies. */
async function uploadBinary(label: string, url: string, body: Buffer, headers: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(url, { method: "POST", headers, body: new Uint8Array(body), signal: withTimeout(signal, 60_000) });
  const text = await response.text();
  const data = parseBody(text, response.headers.get("content-type")) as any;
  if (!response.ok) {
    const detail = typeof data === "string" ? data.slice(0, 300) : (data?.message ?? data?.error ?? JSON.stringify(data).slice(0, 300));
    throw new Error(`${label}: رفع الصورة فشل - ${detail}`);
  }
  return data;
}

/* =====================================================================
   WordPress (REST API + Application Passwords)
   ===================================================================== */
const wpBase = (c?: CredentialValue) => `${str(c?.data.siteUrl).replace(/\/+$/, "")}/wp-json/wp/v2`;
const wpHeaders = (c?: CredentialValue) => ({
  authorization: `Basic ${Buffer.from(`${str(c?.data.username)}:${str(c?.data.appPassword).replace(/\s+/g, "")}`).toString("base64")}`,
});

async function wpUploadImage(c: CredentialValue | undefined, imageUrl: string, title: string, signal: AbortSignal) {
  const image = await imageAsBase64(imageUrl, signal);
  const ext = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const safeName = (title || "image").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "image";
  return uploadBinary(
    "WordPress",
    `${wpBase(c)}/media`,
    Buffer.from(image.data, "base64"),
    {
      ...wpHeaders(c),
      "content-type": image.mimeType,
      "content-disposition": `attachment; filename="${encodeURIComponent(safeName)}.${ext}"`,
    },
    signal,
  );
}

/** Accepts category / tag ids or names; names are looked up and created when missing. */
async function wpTermIds(c: CredentialValue | undefined, taxonomy: "categories" | "tags", value: unknown, signal: AbortSignal) {
  const ids: number[] = [];
  for (const item of list(value)) {
    if (/^\d+$/.test(item)) {
      ids.push(Number(item));
      continue;
    }
    const found = await apiRequest<any[]>("WordPress", `${wpBase(c)}/${taxonomy}?search=${encodeURIComponent(item)}&per_page=20`, {
      headers: wpHeaders(c),
      signal,
    });
    const exact = found.find((term) => stripHtml(String(term.name)).toLowerCase() === item.toLowerCase());
    if (exact) ids.push(exact.id);
    else {
      const created = await apiRequest("WordPress", `${wpBase(c)}/${taxonomy}`, { headers: wpHeaders(c), json: { name: item }, signal });
      ids.push(created.id);
    }
  }
  return ids;
}

const simplifyWpPost = (p: any) => ({
  id: p.id,
  title: stripHtml(p.title?.rendered ?? p.title?.raw ?? ""),
  link: p.link,
  status: p.status,
  date: p.date,
  excerpt: stripHtml(p.excerpt?.rendered ?? "").slice(0, 500),
  content: p.content?.rendered,
  featuredMedia: p.featured_media,
  categories: p.categories,
  tags: p.tags,
});

const wpPostFields = [
  { key: "title", label: "العنوان", type: "text" as const, required: true, placeholder: "{{2.title}}" },
  { key: "content", label: "المحتوى (نص أو HTML)", type: "textarea" as const, placeholder: "{{2.text}}" },
  { key: "excerpt", label: "المقتطف (اختياري)", type: "textarea" as const },
  {
    key: "status",
    label: "الحالة",
    type: "select" as const,
    default: "publish",
    options: <{ value: string; label: string }[]>[
      { value: "publish", label: "نشر فوراً" },
      { value: "draft", label: "مسودة" },
      { value: "pending", label: "في انتظار المراجعة" },
      { value: "future", label: "جدولة لميعاد" },
    ],
  },
  { key: "date", label: "ميعاد النشر", type: "text" as const, placeholder: "2026-10-01T09:00:00", showIf: { field: "status", values: ["future"] } },
  { key: "categories", label: "التصنيفات", type: "text" as const, placeholder: "أخبار، عروض (أسماء أو أرقام)" },
  { key: "tags", label: "الوسوم", type: "text" as const, placeholder: "تسويق، منتجات" },
  { key: "imageUrl", label: "رابط الصورة البارزة (اختياري)", type: "text" as const, placeholder: "{{3.url}}", help: "بتترفع لمكتبة ووردبريس وتتحط صورة بارزة للمقال." },
];

async function wpPostBody(c: CredentialValue | undefined, params: Record<string, any>, signal: AbortSignal) {
  const body: Record<string, unknown> = {};
  if (str(params.title)) body.title = str(params.title);
  if (params.content !== undefined && str(params.content)) {
    const content = String(params.content);
    // Plain text from AI steps: keep its paragraphs.
    body.content = /<\/?[a-z][\s\S]*>/i.test(content)
      ? content
      : content
          .split(/\n{2,}/)
          .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
          .join("\n");
  }
  if (str(params.excerpt)) body.excerpt = str(params.excerpt);
  if (str(params.status)) body.status = str(params.status);
  if (str(params.status) === "future" && str(params.date)) body.date = str(params.date);
  if (str(params.categories)) body.categories = await wpTermIds(c, "categories", params.categories, signal);
  if (str(params.tags)) body.tags = await wpTermIds(c, "tags", params.tags, signal);
  if (str(params.imageUrl)) {
    const media = await wpUploadImage(c, str(params.imageUrl), str(params.title), signal);
    body.featured_media = media.id;
  }
  return body;
}

/* =====================================================================
   Ghost (Admin API key -> short-lived JWT)
   ===================================================================== */
const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

function ghostToken(adminKey: string) {
  const [id, secret] = adminKey.split(":");
  if (!id || !secret) throw new Error("Ghost: الـ Admin API key لازم يكون بالشكل id:secret");
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 300, aud: "/admin/" }));
  const signature = createHmac("sha256", Buffer.from(secret, "hex")).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const ghostBase = (c?: CredentialValue) => `${str(c?.data.siteUrl).replace(/\/+$/, "")}/ghost/api/admin`;
const ghostHeaders = (c?: CredentialValue) => ({ authorization: `Ghost ${ghostToken(str(c?.data.adminKey))}`, "accept-version": "v5.0" });

/* =====================================================================
   X / Twitter (OAuth 1.0a user context: keys never expire)
   ===================================================================== */
const pct = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

function oauth1Header(method: string, url: string, c?: CredentialValue, extra: Record<string, string> = {}) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: str(c?.data.apiKey),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: str(c?.data.accessToken),
    oauth_version: "1.0",
  };
  const parsed = new URL(url);
  const params: [string, string][] = [...Object.entries(oauth), ...Object.entries(extra), ...parsed.searchParams.entries()];
  const normalized = params
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([a1, b1], [a2, b2]) => (a1 === a2 ? (b1 < b2 ? -1 : 1) : a1 < a2 ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseUrl = `${parsed.origin}${parsed.pathname}`;
  const base = [method.toUpperCase(), pct(baseUrl), pct(normalized)].join("&");
  const key = `${pct(str(c?.data.apiSecret))}&${pct(str(c?.data.accessSecret))}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return `OAuth ${Object.entries(oauth)
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .join(", ")}`;
}

/* =====================================================================
   Bluesky (AT Protocol, app password)
   ===================================================================== */
const bskyService = (c?: CredentialValue) => str(c?.data.service).replace(/\/+$/, "") || "https://bsky.social";

async function bskySession(c: CredentialValue | undefined, signal: AbortSignal) {
  return apiRequest<{ accessJwt: string; did: string; handle: string }>("Bluesky", `${bskyService(c)}/xrpc/com.atproto.server.createSession`, {
    json: { identifier: str(c?.data.handle).replace(/^@/, ""), password: str(c?.data.appPassword) },
    signal,
  });
}

/** Clickable links in Bluesky posts need byte-offset facets. */
function bskyLinkFacets(text: string) {
  const facets: unknown[] = [];
  const encoder = new TextEncoder();
  for (const match of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const start = encoder.encode(text.slice(0, match.index)).length;
    facets.push({
      index: { byteStart: start, byteEnd: start + encoder.encode(match[0]).length },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
    });
  }
  return facets;
}

/* =====================================================================
   Credentials
   ===================================================================== */
export const publishingCredentials: CredentialType[] = [
  {
    key: "wordpressApi",
    name: "WordPress",
    app: "wordpress",
    description:
      "من لوحة ووردبريس ← Users ← Profile ← Application Passwords: اكتب اسم (مثلاً تدفق) واضغط Add. انسخ الباسورد اللي هيظهر (مش باسورد الدخول).",
    docsUrl: "https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/",
    fields: [
      { key: "siteUrl", label: "رابط الموقع", required: true, placeholder: "https://myblog.com" },
      { key: "username", label: "اسم المستخدم", required: true },
      { key: "appPassword", label: "Application Password", secret: true, required: true, placeholder: "abcd efgh ijkl mnop qrst uvwx" },
    ],
    async test(data) {
      const me = await apiRequest("WordPress", `${wpBase(dummy(data))}/users/me?context=edit`, { headers: wpHeaders(dummy(data)), signal: AbortSignal.timeout(15_000) });
      return `متصل كـ ${me.name}`;
    },
  },
  {
    key: "ghostAdmin",
    name: "Ghost",
    app: "ghost",
    description: "من Ghost Admin ← Settings ← Integrations ← Add custom integration: انسخ Admin API key و API URL.",
    docsUrl: "https://ghost.org/docs/admin-api/",
    fields: [
      { key: "siteUrl", label: "API URL", required: true, placeholder: "https://myblog.ghost.io" },
      { key: "adminKey", label: "Admin API key", secret: true, required: true, placeholder: "id:secret" },
    ],
    async test(data) {
      const site = await apiRequest("Ghost", `${ghostBase(dummy(data))}/site/`, { headers: ghostHeaders(dummy(data)), signal: AbortSignal.timeout(15_000) });
      return `متصل بـ ${site.site?.title ?? "الموقع"}`;
    },
  },
  {
    key: "webflowApi",
    name: "Webflow",
    app: "webflow",
    description: "من Webflow ← Site settings ← Apps & integrations ← API access: اعمل Site token بصلاحية CMS (read & write).",
    docsUrl: "https://developers.webflow.com/data/reference/authentication",
    fields: [{ key: "token", label: "Site API token", secret: true, required: true }],
    test: (data) => checkAuth("Webflow", "https://api.webflow.com/v2/sites", { authorization: `Bearer ${data.token}` }),
  },
  {
    key: "linkedinApi",
    name: "LinkedIn",
    app: "linkedin",
    description:
      "اعمل App على LinkedIn Developers وفعّل منتج Share on LinkedIn و Sign In with OpenID، وهات Access token بصلاحيات openid profile w_member_social (صالح 60 يوم). للنشر باسم صفحة شركة حط Organization URN.",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
    fields: [
      { key: "accessToken", label: "Access token", secret: true, required: true },
      { key: "authorUrn", label: "Author URN (اختياري)", placeholder: "urn:li:organization:123 - فاضي = حسابك الشخصي" },
    ],
    test: (data) => checkAuth("LinkedIn", "https://api.linkedin.com/v2/userinfo", { authorization: `Bearer ${data.accessToken}` }),
  },
  {
    key: "xOAuth1",
    name: "X (تويتر)",
    app: "x",
    description:
      "من developer.x.com ← Projects & Apps ← App ← Keys and tokens: هات API Key & Secret، وبعد ما تخلي صلاحية التطبيق Read and write اعمل Access Token & Secret.",
    docsUrl: "https://docs.x.com/x-api/posts/creation-of-a-post",
    fields: [
      { key: "apiKey", label: "API Key", required: true },
      { key: "apiSecret", label: "API Key Secret", secret: true, required: true },
      { key: "accessToken", label: "Access Token", required: true },
      { key: "accessSecret", label: "Access Token Secret", secret: true, required: true },
    ],
    async test(data) {
      const url = "https://api.x.com/2/users/me";
      const me = await apiRequest("X", url, { headers: { authorization: oauth1Header("GET", url, dummy(data)) }, signal: AbortSignal.timeout(15_000) });
      return `متصل كـ @${me.data?.username}`;
    },
  },
  {
    key: "pinterestApi",
    name: "Pinterest",
    app: "pinterest",
    description: "من developers.pinterest.com ← My apps: هات Access token بصلاحيات boards:read و pins:write.",
    docsUrl: "https://developers.pinterest.com/docs/api/v5/pins-create/",
    fields: [{ key: "accessToken", label: "Access token", secret: true, required: true }],
    test: (data) => checkAuth("Pinterest", "https://api.pinterest.com/v5/user_account", { authorization: `Bearer ${data.accessToken}` }),
  },
  {
    key: "threadsApi",
    name: "Threads",
    app: "threads",
    description: "من Meta for Developers: اعمل App بـ Threads API وهات Access token (threads_basic, threads_content_publish) و Threads user ID.",
    docsUrl: "https://developers.facebook.com/docs/threads/posts",
    fields: [
      { key: "userId", label: "Threads user ID", required: true },
      { key: "accessToken", label: "Access token", secret: true, required: true },
    ],
    async test(data) {
      const me = await apiRequest("Threads", `https://graph.threads.net/v1.0/me?fields=username&access_token=${encodeURIComponent(data.accessToken)}`, {
        signal: AbortSignal.timeout(15_000),
      });
      return `متصل كـ @${me.username}`;
    },
  },
  {
    key: "blueskyApi",
    name: "Bluesky",
    app: "bluesky",
    description: "من Bluesky ← Settings ← Privacy and security ← App passwords: اعمل App password.",
    docsUrl: "https://docs.bsky.app/docs/advanced-guides/posts",
    fields: [
      { key: "handle", label: "الحساب (handle)", required: true, placeholder: "name.bsky.social" },
      { key: "appPassword", label: "App password", secret: true, required: true },
      { key: "service", label: "السيرفر (اختياري)", placeholder: "https://bsky.social" },
    ],
    async test(data) {
      const session = await bskySession(dummy(data), AbortSignal.timeout(15_000));
      return `متصل كـ @${session.handle}`;
    },
  },
];

/* =====================================================================
   Nodes
   ===================================================================== */
const wp = { app: "wordpress", appName: "WordPress", color: "#21759b", credentialTypes: ["wordpressApi"] };

export const publishingNodes: NodeDefinition[] = [
  /* ---------- WordPress ---------- */
  {
    ...wp,
    type: "wordpress.postTrigger",
    name: "مقال جديد في WordPress",
    description: "بيشتغل مع كل مقال جديد بيتنشر على موقعك.",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    fields: [checkEveryField],
    sampleOutput: simplifyWpPost({
      id: 128,
      title: { rendered: "5 نصايح لزيادة مبيعاتك" },
      link: "https://myblog.com/sales-tips",
      status: "publish",
      date: "2026-09-16T10:00:00",
      excerpt: { rendered: "<p>مقتطف المقال...</p>" },
      content: { rendered: "<p>محتوى المقال</p>" },
      featured_media: 77,
    }),
    async poll({ credential, state, signal, testMode }) {
      const posts = await apiRequest<any[]>("WordPress", `${wpBase(credential)}/posts?per_page=20&orderby=id&order=desc&status=publish`, {
        headers: wpHeaders(credential),
        signal,
      });
      if (testMode) return { items: posts.slice(0, 1).map(simplifyWpPost), state };
      const lastId = Number(state?.lastId ?? 0);
      const maxId = posts.reduce((max, p) => Math.max(max, p.id), lastId);
      if (!state?.lastId) return { items: [], state: { lastId: maxId || 1 } };
      const fresh = posts.filter((p) => p.id > lastId).reverse();
      return { items: fresh.map(simplifyWpPost), state: { lastId: maxId } };
    },
  },
  {
    ...wp,
    type: "wordpress.createPost",
    name: "نشر مقال على WordPress",
    description: "بينشر مقال (أو مسودة) بتصنيفات ووسوم وصورة بارزة.",
    group: "apps",
    kind: "action",
    fields: wpPostFields,
    sampleOutput: { id: 129, title: "عنوان المقال", link: "https://myblog.com/?p=129", status: "publish" },
    async run({ params, credential, signal }) {
      const body = await wpPostBody(credential, params, signal);
      if (!body.title) throw new Error("WordPress: العنوان فاضي");
      const post = await apiRequest("WordPress", `${wpBase(credential)}/posts`, { headers: wpHeaders(credential), json: body, signal });
      return { output: simplifyWpPost(post) };
    },
  },
  {
    ...wp,
    type: "wordpress.updatePost",
    name: "تعديل مقال في WordPress",
    description: "بيعدّل مقال موجود برقمه (اللي تسيبه فاضي مش بيتغير).",
    group: "apps",
    kind: "action",
    fields: [
      { key: "postId", label: "رقم المقال", type: "text", required: true, placeholder: "{{1.id}}" },
      ...wpPostFields.map((field) =>
        field.key === "status"
          ? { ...field, default: "", options: [{ value: "", label: "بدون تغيير" }, ...(field.options ?? [])] }
          : { ...field, required: false },
      ),
    ],
    sampleOutput: { id: 129, title: "عنوان معدّل", status: "publish" },
    async run({ params, credential, signal }) {
      const body = await wpPostBody(credential, params, signal);
      const post = await apiRequest("WordPress", `${wpBase(credential)}/posts/${encodeURIComponent(str(params.postId))}`, {
        headers: wpHeaders(credential),
        json: body,
        signal,
      });
      return { output: simplifyWpPost(post) };
    },
  },
  {
    ...wp,
    type: "wordpress.getPosts",
    name: "جلب مقالات من WordPress",
    description: "بيجيب آخر المقالات أو يدوّر بكلمة.",
    group: "apps",
    kind: "action",
    fields: [
      { key: "search", label: "كلمة بحث (اختياري)", type: "text" },
      { key: "limit", label: "العدد", type: "number", default: 10 },
    ],
    sampleOutput: { posts: [{ id: 128, title: "5 نصايح لزيادة مبيعاتك", link: "https://myblog.com/sales-tips" }], count: 1 },
    async run({ params, credential, signal }) {
      const url = new URL(`${wpBase(credential)}/posts`);
      url.searchParams.set("per_page", String(Math.min(100, Math.max(1, Number(params.limit) || 10))));
      if (str(params.search)) url.searchParams.set("search", str(params.search));
      const posts = await apiRequest<any[]>("WordPress", url, { headers: wpHeaders(credential), signal });
      return { output: { posts: posts.map(simplifyWpPost), count: posts.length } };
    },
  },
  {
    ...wp,
    type: "wordpress.uploadMedia",
    name: "رفع صورة على WordPress",
    description: "بيرفع صورة من رابط (أو من مكتبة صورك) لمكتبة وسائط ووردبريس.",
    group: "apps",
    kind: "action",
    fields: [
      { key: "imageUrl", label: "رابط الصورة", type: "text", required: true, placeholder: "{{2.url}}" },
      { key: "title", label: "اسم الصورة", type: "text" },
    ],
    sampleOutput: { id: 77, url: "https://myblog.com/wp-content/uploads/2026/09/image.jpg" },
    async run({ params, credential, signal }) {
      const media = await wpUploadImage(credential, str(params.imageUrl), str(params.title), signal);
      return { output: { id: media.id, url: media.source_url, raw: media } };
    },
  },

  /* ---------- Ghost ---------- */
  {
    type: "ghost.createPost",
    name: "نشر مقال على Ghost",
    description: "بينشر مقال أو مسودة على مدونة Ghost.",
    app: "ghost",
    appName: "Ghost",
    color: "#15171a",
    group: "apps",
    kind: "action",
    credentialTypes: ["ghostAdmin"],
    fields: [
      { key: "title", label: "العنوان", type: "text", required: true },
      { key: "html", label: "المحتوى (نص أو HTML)", type: "textarea" },
      {
        key: "status",
        label: "الحالة",
        type: "select",
        default: "published",
        options: [
          { value: "published", label: "نشر فوراً" },
          { value: "draft", label: "مسودة" },
        ],
      },
      { key: "tags", label: "الوسوم", type: "text", placeholder: "أخبار، تسويق" },
      { key: "imageUrl", label: "رابط الصورة البارزة", type: "text" },
    ],
    sampleOutput: { id: "66e8...", title: "عنوان المقال", url: "https://myblog.ghost.io/post/", status: "published" },
    async run({ params, credential, signal }) {
      const content = String(params.html ?? "");
      const html = /<\/?[a-z][\s\S]*>/i.test(content)
        ? content
        : content
            .split(/\n{2,}/)
            .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
            .join("\n");
      const res = await apiRequest("Ghost", `${ghostBase(credential)}/posts/?source=html`, {
        headers: ghostHeaders(credential),
        json: {
          posts: [
            {
              title: str(params.title),
              html,
              status: str(params.status) || "published",
              tags: list(params.tags).map((name) => ({ name })),
              ...(str(params.imageUrl) ? { feature_image: str(params.imageUrl) } : {}),
            },
          ],
        },
        signal,
      });
      const post = res.posts?.[0] ?? {};
      return { output: { id: post.id, title: post.title, url: post.url, status: post.status } };
    },
  },

  /* ---------- Webflow ---------- */
  {
    type: "webflow.createItem",
    name: "إضافة عنصر في Webflow CMS",
    description: "بيضيف مقال / منتج / أي عنصر في Collection على موقع Webflow وينشره.",
    app: "webflow",
    appName: "Webflow",
    color: "#146ef5",
    group: "apps",
    kind: "action",
    credentialTypes: ["webflowApi"],
    fields: [
      { key: "collectionId", label: "Collection ID", type: "text", required: true, help: "من CMS ← إعدادات الـ Collection." },
      { key: "name", label: "الاسم (name)", type: "text", required: true },
      { key: "slug", label: "الـ slug (اختياري)", type: "text" },
      { key: "fields", label: "باقي الحقول", type: "keyvalue", help: "اسم الحقل كما في Webflow (slug الحقل) وقيمته." },
      { key: "publish", label: "انشره على الموقع فوراً", type: "boolean", default: true },
    ],
    sampleOutput: { id: "580e64008c9a982ac9b8b754", fieldData: { name: "مقال جديد", slug: "new-post" } },
    async run({ params, credential, signal }) {
      const fieldData: Record<string, unknown> = { name: str(params.name) };
      if (str(params.slug)) fieldData.slug = str(params.slug);
      for (const row of keyValueRows(params.fields)) fieldData[String(row.key).trim()] = row.value;
      const live = params.publish !== false;
      const item = await apiRequest(
        "Webflow",
        `https://api.webflow.com/v2/collections/${encodeURIComponent(str(params.collectionId))}/items${live ? "/live" : ""}`,
        { headers: { authorization: `Bearer ${credential?.data.token}` }, json: { isArchived: false, isDraft: !live, fieldData }, signal },
      );
      return { output: item };
    },
  },

  /* ---------- LinkedIn ---------- */
  {
    type: "linkedin.post",
    name: "نشر بوست على LinkedIn",
    description: "بينشر بوست نصي (مع رابط اختياري) على حسابك أو صفحة شركتك.",
    app: "linkedin",
    appName: "LinkedIn",
    color: "#0a66c2",
    group: "apps",
    kind: "action",
    credentialTypes: ["linkedinApi"],
    fields: [
      { key: "text", label: "نص البوست", type: "textarea", required: true, placeholder: "{{2.text}}" },
      { key: "link", label: "رابط مقال (اختياري)", type: "text", placeholder: "{{3.link}}" },
      { key: "linkTitle", label: "عنوان الرابط (اختياري)", type: "text" },
    ],
    sampleOutput: { id: "urn:li:share:7240000000000000000", postUrl: "https://www.linkedin.com/feed/update/urn:li:share:7240000000000000000" },
    async run({ params, credential, signal }) {
      const headers = {
        authorization: `Bearer ${credential?.data.accessToken}`,
        "LinkedIn-Version": "202509",
        "X-Restli-Protocol-Version": "2.0.0",
      };
      let author = str(credential?.data.authorUrn);
      if (!author) {
        const me = await apiRequest("LinkedIn", "https://api.linkedin.com/v2/userinfo", { headers: { authorization: headers.authorization }, signal });
        author = `urn:li:person:${me.sub}`;
      }
      const body: Record<string, unknown> = {
        author,
        // LinkedIn's "little text" format reserves these characters.
        commentary: String(params.text ?? "").replace(/([\\|{}@[\]()<>#*_~])/g, "\\$1"),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };
      if (str(params.link)) body.content = { article: { source: str(params.link), title: str(params.linkTitle) || str(params.link) } };
      const response = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: withTimeout(signal, 30_000),
      });
      if (!response.ok) {
        const data: any = parseBody(await response.text(), response.headers.get("content-type"));
        throw new Error(`LinkedIn: ${typeof data === "string" ? data.slice(0, 300) : (data?.message ?? JSON.stringify(data).slice(0, 300))}`);
      }
      const id = response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id") ?? "";
      return { output: { id, postUrl: id ? `https://www.linkedin.com/feed/update/${id}` : undefined } };
    },
  },

  /* ---------- X ---------- */
  {
    type: "x.post",
    name: "نشر تغريدة على X",
    description: "بينشر تغريدة (أو رد على تغريدة).",
    app: "x",
    appName: "X (تويتر)",
    color: "#1b1f2e",
    group: "apps",
    kind: "action",
    credentialTypes: ["xOAuth1"],
    fields: [
      { key: "text", label: "النص", type: "textarea", required: true, help: "الحد 280 حرف للحسابات العادية." },
      { key: "imageUrl", label: "رابط صورة (اختياري)", type: "text", placeholder: "{{3.url}}" },
      { key: "replyTo", label: "رد على تغريدة رقم (اختياري)", type: "text" },
    ],
    sampleOutput: { id: "1835000000000000000", text: "نص التغريدة", postUrl: "https://x.com/i/web/status/1835000000000000000" },
    async run({ params, credential, signal }) {
      const url = "https://api.x.com/2/tweets";
      const body: Record<string, unknown> = { text: String(params.text ?? "") };
      if (str(params.replyTo)) body.reply = { in_reply_to_tweet_id: str(params.replyTo) };
      let mediaNote: string | undefined;
      if (str(params.imageUrl)) {
        try {
          const image = await imageAsBase64(str(params.imageUrl), signal);
          const uploadUrl = "https://api.x.com/2/media/upload";
          const form = new FormData();
          form.set("media", new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }), "image");
          form.set("media_category", "tweet_image");
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { authorization: oauth1Header("POST", uploadUrl, credential) },
            body: form,
            signal: withTimeout(signal, 60_000),
          });
          const uploaded: any = parseBody(await response.text(), response.headers.get("content-type"));
          const mediaId = uploaded?.data?.id ?? uploaded?.media_id_string;
          if (!response.ok || !mediaId) throw new Error(uploaded?.detail ?? uploaded?.title ?? `HTTP ${response.status}`);
          body.media = { media_ids: [String(mediaId)] };
        } catch (e) {
          // The post still goes out; the log says why the picture is missing.
          mediaNote = `الصورة مترفعتش على X (${(e as Error).message}) - اتنشرت التغريدة نص بس`;
        }
      }
      const res = await apiRequest("X", url, { headers: { authorization: oauth1Header("POST", url, credential) }, json: body, signal });
      return {
        output: { ...res.data, postUrl: res.data?.id ? `https://x.com/i/web/status/${res.data.id}` : undefined, ...(mediaNote ? { note: mediaNote } : {}) },
      };
    },
  },

  /* ---------- Pinterest ---------- */
  {
    type: "pinterest.createPin",
    name: "نشر Pin على Pinterest",
    description: "بينشر صورة برابط على لوحة (Board).",
    app: "pinterest",
    appName: "Pinterest",
    color: "#e60023",
    group: "apps",
    kind: "action",
    credentialTypes: ["pinterestApi"],
    fields: [
      { key: "boardId", label: "Board ID", type: "text", required: true },
      { key: "imageUrl", label: "رابط الصورة", type: "text", required: true, placeholder: "{{2.url}}" },
      { key: "title", label: "العنوان", type: "text" },
      { key: "description", label: "الوصف", type: "textarea" },
      { key: "link", label: "رابط المنتج / المقال", type: "text" },
    ],
    sampleOutput: { id: "813744226420795884", link: "https://mystore.com/p/1" },
    async run({ params, credential, signal }) {
      const pin = await apiRequest("Pinterest", "https://api.pinterest.com/v5/pins", {
        headers: { authorization: `Bearer ${credential?.data.accessToken}` },
        json: {
          board_id: str(params.boardId),
          title: str(params.title) || undefined,
          description: str(params.description) || undefined,
          link: str(params.link) || undefined,
          media_source: { source_type: "image_url", url: str(params.imageUrl) },
        },
        signal,
      });
      return { output: pin };
    },
  },

  /* ---------- Threads ---------- */
  {
    type: "threads.post",
    name: "نشر بوست على Threads",
    description: "بينشر نص أو صورة بتعليق على Threads.",
    app: "threads",
    appName: "Threads",
    color: "#1b1f2e",
    group: "apps",
    kind: "action",
    credentialTypes: ["threadsApi"],
    fields: [
      { key: "text", label: "النص", type: "textarea", required: true },
      { key: "imageUrl", label: "رابط صورة (اختياري)", type: "text" },
      { key: "videoUrl", label: "رابط فيديو (اختياري)", type: "text" },
    ],
    sampleOutput: { id: "18000000000000000" },
    async run({ params, credential, signal }) {
      const base = `https://graph.threads.net/v1.0/${encodeURIComponent(str(credential?.data.userId))}`;
      const token = str(credential?.data.accessToken);
      const imageUrl = str(params.imageUrl);
      const videoUrl = str(params.videoUrl);
      const mediaType = videoUrl ? "VIDEO" : imageUrl ? "IMAGE" : "TEXT";
      const create = new URLSearchParams({ media_type: mediaType, text: String(params.text ?? ""), access_token: token });
      if (videoUrl) create.set("video_url", videoUrl);
      else if (imageUrl) create.set("image_url", imageUrl);
      const container = await apiRequest("Threads", `${base}/threads`, { method: "POST", form: Object.fromEntries(create), signal });
      if (videoUrl) {
        for (let attempt = 0; attempt < 36; attempt++) {
          const status = await apiRequest("Threads", `https://graph.threads.net/v1.0/${container.id}?fields=status,error_message&access_token=${encodeURIComponent(token)}`, { signal });
          if (status.status === "FINISHED") break;
          if (status.status === "ERROR" || status.status === "EXPIRED") throw new Error(`Threads: معالجة الفيديو فشلت - ${status.error_message ?? status.status}`);
          await sleep(5000, signal);
        }
      } else {
        // Meta recommends a short wait before publishing so the media finishes processing.
        await sleep(imageUrl ? 8000 : 1500, signal);
      }
      const published = await apiRequest("Threads", `${base}/threads_publish`, {
        method: "POST",
        form: { creation_id: container.id, access_token: token },
        signal,
      });
      return { output: { id: published.id, containerId: container.id } };
    },
  },

  /* ---------- Bluesky ---------- */
  {
    type: "bluesky.post",
    name: "نشر بوست على Bluesky",
    description: "بينشر نص (والروابط بتبقى قابلة للضغط) مع صورة اختيارية.",
    app: "bluesky",
    appName: "Bluesky",
    color: "#1185fe",
    group: "apps",
    kind: "action",
    credentialTypes: ["blueskyApi"],
    fields: [
      { key: "text", label: "النص", type: "textarea", required: true, help: "الحد 300 حرف." },
      { key: "imageUrl", label: "رابط صورة (اختياري)", type: "text", help: "الحد الأقصى لحجم الصورة 1 ميجا." },
      { key: "imageAlt", label: "وصف الصورة", type: "text" },
    ],
    sampleOutput: { uri: "at://did:plc:abc/app.bsky.feed.post/3l...", postUrl: "https://bsky.app/profile/name.bsky.social/post/3l..." },
    async run({ params, credential, signal }) {
      const session = await bskySession(credential, signal);
      const auth = { authorization: `Bearer ${session.accessJwt}` };
      const text = String(params.text ?? "");
      const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() };
      const facets = bskyLinkFacets(text);
      if (facets.length) record.facets = facets;
      let note: string | undefined;
      if (str(params.imageUrl)) {
        try {
          const image = await imageAsBase64(str(params.imageUrl), signal);
          const bytes = Buffer.from(image.data, "base64");
          if (bytes.length > 1_000_000) throw new Error("حجم الصورة أكبر من 1 ميجا");
          const blob = await uploadBinary(
            "Bluesky",
            `${bskyService(credential)}/xrpc/com.atproto.repo.uploadBlob`,
            bytes,
            { ...auth, "content-type": image.mimeType },
            signal,
          );
          record.embed = { $type: "app.bsky.embed.images", images: [{ alt: str(params.imageAlt), image: blob.blob }] };
        } catch (e) {
          note = `الصورة متحطتش على Bluesky (${(e as Error).message}) - اتنشر نص بس`;
        }
      }
      const res = await apiRequest("Bluesky", `${bskyService(credential)}/xrpc/com.atproto.repo.createRecord`, {
        headers: auth,
        json: { repo: session.did, collection: "app.bsky.feed.post", record },
        signal,
      });
      const rkey = String(res.uri ?? "").split("/").pop();
      return { output: { ...res, postUrl: rkey ? `https://bsky.app/profile/${session.handle}/post/${rkey}` : undefined, ...(note ? { note } : {}) } };
    },
  },
];
