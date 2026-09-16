import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { postJson } from "./llm.js";
import { sleep } from "./util.js";

const GRAPH = "https://graph.facebook.com/v25.0";

async function graphGet(path: string, params: Record<string, string>, token: string, label: string) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}: ${data?.error?.message ?? `HTTP ${response.status}`}`);
  return data;
}

export const facebookCredential: CredentialType = {
  key: "facebookPage",
  name: "صفحة فيسبوك",
  app: "facebook",
  description: "من Meta for Developers ← Graph API Explorer: اختار صفحتك وهات Page Access Token طويل المدى + رقم الصفحة.",
  docsUrl: "https://developers.facebook.com/docs/pages-api/getting-started",
  fields: [
    { key: "pageId", label: "Page ID", required: true },
    { key: "pageAccessToken", label: "Page Access Token", secret: true, required: true },
  ],
  async test(data) {
    const page = await graphGet(data.pageId, { fields: "name" }, data.pageAccessToken, "فيسبوك");
    return `متصل بصفحة ${page.name}`;
  },
};

export const instagramCredential: CredentialType = {
  key: "instagramBusiness",
  name: "إنستجرام بيزنس",
  app: "instagram",
  description: "لازم حساب Business أو Creator مربوط بصفحة فيسبوك. هات Instagram User ID والتوكن من Graph API Explorer.",
  docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
  fields: [
    { key: "igUserId", label: "Instagram User ID", required: true },
    { key: "accessToken", label: "Access Token", secret: true, required: true },
  ],
  async test(data) {
    const account = await graphGet(data.igUserId, { fields: "username" }, data.accessToken, "إنستجرام");
    return `متصل بحساب @${account.username}`;
  },
};

export const socialNodes: NodeDefinition[] = [
  {
    type: "facebook.post",
    name: "نشر بوست على فيسبوك",
    description: "بينشر نص أو صورة على صفحة الفيسبوك بتاعتك.",
    app: "facebook",
    appName: "فيسبوك",
    color: "#1877f2",
    group: "apps",
    kind: "action",
    credentialTypes: ["facebookPage"],
    fields: [
      { key: "message", label: "نص البوست", type: "textarea", required: true, placeholder: "{{2.text}}" },
      { key: "imageUrl", label: "رابط صورة (اختياري)", type: "text", placeholder: "{{3.url}}" },
      { key: "link", label: "رابط مرفق (اختياري)", type: "text", placeholder: "https://..." },
    ],
    sampleOutput: { id: "123456789_987654321", postUrl: "https://facebook.com/123456789_987654321" },
    async run({ params, credential, signal }) {
      const token = credential?.data.pageAccessToken ?? "";
      const pageId = credential?.data.pageId ?? "";
      const message = String(params.message ?? "");
      const imageUrl = String(params.imageUrl ?? "").trim();
      const body: Record<string, unknown> = imageUrl
        ? { url: imageUrl, caption: message, published: true }
        : { message, ...(String(params.link ?? "").trim() ? { link: String(params.link).trim() } : {}) };
      const result = await postJson(
        `${GRAPH}/${pageId}/${imageUrl ? "photos" : "feed"}`,
        body,
        { authorization: `Bearer ${token}` },
        signal,
        "فيسبوك",
      );
      const id = result.post_id ?? result.id;
      return { output: { ...result, postUrl: id ? `https://facebook.com/${id}` : undefined } };
    },
  },
  {
    type: "instagram.post",
    name: "نشر بوست على إنستجرام",
    description: "بينشر صورة بتعليق على حساب إنستجرام بيزنس. الصورة لازم تكون على رابط عام.",
    app: "instagram",
    appName: "إنستجرام",
    color: "#e1306c",
    group: "apps",
    kind: "action",
    credentialTypes: ["instagramBusiness"],
    fields: [
      { key: "imageUrl", label: "رابط الصورة", type: "text", required: true, placeholder: "{{3.url}}" },
      { key: "caption", label: "التعليق", type: "textarea", placeholder: "{{2.text}}" },
    ],
    sampleOutput: { id: "17895695668004550", containerId: "17889455560051444" },
    async run({ params, credential, signal }) {
      const token = credential?.data.accessToken ?? "";
      const igUserId = credential?.data.igUserId ?? "";
      const imageUrl = String(params.imageUrl ?? "").trim();
      if (!imageUrl) throw new Error("رابط الصورة فاضي");

      const container = await postJson(
        `${GRAPH}/${igUserId}/media`,
        { image_url: imageUrl, caption: String(params.caption ?? "") },
        { authorization: `Bearer ${token}` },
        signal,
        "إنستجرام",
      );
      // The container needs a moment to finish processing before it can be published.
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const published = await postJson(
            `${GRAPH}/${igUserId}/media_publish`,
            { creation_id: container.id },
            { authorization: `Bearer ${token}` },
            signal,
            "إنستجرام",
          );
          return { output: { ...published, containerId: container.id } };
        } catch (error) {
          lastError = error;
          await sleep(3000, signal);
        }
      }
      throw lastError instanceof Error ? lastError : new Error("إنستجرام: النشر فشل");
    },
  },
];
