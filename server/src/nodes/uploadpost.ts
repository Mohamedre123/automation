import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { parseBody, withTimeout } from "./util.js";

/**
 * Upload-Post: one API that publishes to TikTok, Instagram, YouTube, Facebook, X, LinkedIn, Threads,
 * Pinterest, Bluesky... through accounts the customer connected on upload-post.com - no official apps needed.
 */
const BASE = "https://api.upload-post.com/api";

export const UPLOAD_POST_PLATFORMS = [
  { value: "instagram", label: "إنستجرام" },
  { value: "facebook", label: "فيسبوك" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X (تويتر)" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "threads", label: "Threads" },
  { value: "pinterest", label: "Pinterest" },
  { value: "bluesky", label: "Bluesky" },
  { value: "telegram", label: "تيليجرام" },
  { value: "reddit", label: "Reddit" },
];

/** Networks that can't take a text-only post. */
const MEDIA_ONLY = ["instagram", "tiktok", "youtube", "pinterest"];

const auth = (c?: CredentialValue) => ({ authorization: `Apikey ${String(c?.data.apiKey ?? "").trim()}` });
const list = (value: unknown) =>
  (Array.isArray(value) ? value : String(value ?? "").split(/[,،\n]/))
    .map((item) => String(item).trim())
    .filter(Boolean);

export const uploadPostCredential: CredentialType = {
  key: "uploadPostApi",
  name: "Upload-Post (نشر على كل المنصات)",
  app: "uploadpost",
  description: "خدمة بتنشر على TikTok وإنستجرام ويوتيوب وفيسبوك وX وLinkedIn وغيرهم بحساباتك اللي ربطتها عندهم - من غير تطبيقات رسمية.",
  docsUrl: "https://docs.upload-post.com",
  fields: [
    { key: "apiKey", label: "API Key", secret: true, required: true },
    {
      key: "user",
      label: "اسم البروفايل (Profile / User)",
      required: true,
      placeholder: "my-brand",
      help: "اسم البروفايل اللي عملته في upload-post.com وربطت عليه حسابات السوشيال.",
    },
  ],
  steps: [
    "اعمل حساب على upload-post.com.",
    "من Manage Users اعمل بروفايل (مثلاً اسم البراند) واربط عليه حسابات تيك توك وإنستجرام ويوتيوب وغيرهم.",
    "من API Keys انسخ المفتاح والصقه هنا.",
    "اكتب اسم البروفايل بالظبط زي ما هو مكتوب عندهم.",
    "في السيناريو استخدم خطوة «Upload-Post: نشر» أو اختاره في «انشر على كل المنصات».",
  ],
  async test(data) {
    const response = await fetch(`${BASE}/uploadposts/me`, { headers: auth({ id: "", type: "", data }), signal: AbortSignal.timeout(15_000) });
    const body: any = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw new Error("Upload-Post: المفتاح غلط");
    if (!response.ok) throw new Error(`Upload-Post: ${body?.message ?? `HTTP ${response.status}`}`);
    return `متصل${body?.email ? ` كـ ${body.email}` : ""}`;
  },
};

/** Publishes one post (video, photos or text) to the chosen platforms. */
export async function uploadPostPublish(
  credential: CredentialValue | undefined,
  post: { platforms: string[]; title: string; description?: string; videoUrl?: string; imageUrls?: string[]; scheduledDate?: string; facebookPageId?: string; pinterestBoardId?: string },
  signal: AbortSignal,
) {
  if (!post.platforms.length) throw new Error("Upload-Post: اختار منصة واحدة على الأقل");
  if (!post.title.trim()) throw new Error("Upload-Post: الكابشن فاضي - اربطه بخطوة كتابة المحتوى");
  const mediaOnly = post.platforms.filter((p) => MEDIA_ONLY.includes(p));
  if (!post.videoUrl && !post.imageUrls?.length && mediaOnly.length) {
    throw new Error(
      `Upload-Post: ${mediaOnly.join(" و ")} محتاجة صورة أو فيديو - خانة الصورة والفيديو فاضية. اربط «روابط الصور» بخطوة التصميم (مثلاً {{4.url}}) أو دوس «ربط تلقائي بالخطوات اللي قبلها».`,
    );
  }
  const form = new FormData();
  form.set("user", String(credential?.data.user ?? "").trim());
  for (const platform of post.platforms) form.append("platform[]", platform);
  form.set("title", post.title.slice(0, 2200));
  if (post.description) form.set("description", post.description);
  if (post.scheduledDate) form.set("scheduled_date", post.scheduledDate);
  if (post.facebookPageId) form.set("facebook_page_id", post.facebookPageId);
  if (post.pinterestBoardId) form.set("pinterest_board_id", post.pinterestBoardId);

  let endpoint = "upload_text";
  if (post.videoUrl) {
    endpoint = "upload";
    form.set("video", post.videoUrl);
  } else if (post.imageUrls?.length) {
    endpoint = "upload_photos";
    for (const url of post.imageUrls) form.append("photos[]", url);
  }

  const response = await fetch(`${BASE}/${endpoint}`, { method: "POST", headers: auth(credential), body: form, signal: withTimeout(signal, 180_000) });
  const data: any = parseBody(await response.text(), response.headers.get("content-type"));
  if (!response.ok || data?.success === false) {
    const detail = typeof data === "string" ? data.slice(0, 300) : (data?.message ?? data?.error ?? JSON.stringify(data).slice(0, 300));
    if (response.status === 401 || response.status === 403) throw new Error("Upload-Post: المفتاح غلط أو الباقة مش بتسمح");
    throw new Error(`Upload-Post: ${detail}`);
  }
  return data;
}

export const uploadPostNode: NodeDefinition = {
  type: "uploadpost.post",
  name: "Upload-Post: نشر على المنصات",
  description: "بينشر فيديو أو صور أو نص على المنصات اللي تختارها عن طريق حساب Upload-Post بتاعك.",
  app: "uploadpost",
  appName: "Upload-Post",
  color: "#6366f1",
  group: "apps",
  kind: "action",
  credentialTypes: ["uploadPostApi"],
  timeoutMs: 200_000,
  fields: [
    { key: "platforms", label: "المنصات", type: "multiselect", default: ["instagram", "tiktok"], options: UPLOAD_POST_PLATFORMS },
    { key: "title", label: "الكابشن / العنوان", type: "textarea", required: true, placeholder: "{{3.json.post}}" },
    { key: "description", label: "وصف إضافي (يوتيوب / LinkedIn)", type: "textarea" },
    { key: "videoUrl", label: "رابط الفيديو", type: "text", placeholder: "{{5.url}}", help: "لو فيه فيديو بيتنشر الفيديو، وإلا الصور، وإلا النص بس." },
    { key: "imageUrls", label: "روابط الصور", type: "text", placeholder: "{{4.url}}", help: "أكتر من صورة؟ افصل بينهم بفاصلة." },
    { key: "scheduledDate", label: "ميعاد النشر عندهم (اختياري)", type: "text", placeholder: "2026-10-01T19:00:00Z" },
    { key: "facebookPageId", label: "Facebook Page ID (اختياري)", type: "text" },
    { key: "pinterestBoardId", label: "Pinterest Board ID (اختياري)", type: "text" },
  ],
  sampleOutput: { success: true, results: { instagram: { success: true, url: "https://instagram.com/p/..." } } },
  async run({ params, credential, signal }) {
    const output = await uploadPostPublish(
      credential,
      {
        platforms: list(params.platforms),
        title: String(params.title ?? ""),
        description: String(params.description ?? "").trim() || undefined,
        videoUrl: String(params.videoUrl ?? "").trim() || undefined,
        imageUrls: list(params.imageUrls),
        scheduledDate: String(params.scheduledDate ?? "").trim() || undefined,
        facebookPageId: String(params.facebookPageId ?? "").trim() || undefined,
        pinterestBoardId: String(params.pinterestBoardId ?? "").trim() || undefined,
      },
      signal,
    );
    return { output };
  },
};
