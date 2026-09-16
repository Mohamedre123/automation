import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { apiRequest, checkAuth } from "./api.js";

/**
 * Publishing services that post to many networks with one key (Ayrshare, Zernio / Late, Blotato).
 * Customers connect their social accounts once on the service's site - no official developer apps.
 */
export interface AggregatorPost {
  platforms: string[];
  text: string;
  imageUrls?: string[];
  videoUrl?: string;
  /** ISO time; empty = publish now. */
  scheduledAt?: string;
  facebookPageId?: string;
  pinterestBoardId?: string;
}

const str = (value: unknown) => String(value ?? "").trim();
export const splitList = (value: unknown) =>
  (Array.isArray(value) ? value : str(value).split(/[,،\n]/))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
const media = (post: AggregatorPost) => (post.videoUrl ? [post.videoUrl] : (post.imageUrls ?? []));
// Everyone else calls it "x"; these services still say "twitter".
const twitterName = (platform: string) => (platform === "x" ? "twitter" : platform);

/* ---------- Ayrshare ---------- */
async function ayrshare(credential: CredentialValue | undefined, post: AggregatorPost, signal: AbortSignal) {
  const headers: Record<string, string> = { authorization: `Bearer ${str(credential?.data.apiKey)}` };
  if (str(credential?.data.profileKey)) headers["Profile-Key"] = str(credential?.data.profileKey);
  const res = await apiRequest("Ayrshare", "https://api.ayrshare.com/api/post", {
    headers,
    json: {
      post: post.text,
      platforms: post.platforms.map(twitterName),
      ...(media(post).length ? { mediaUrls: media(post) } : {}),
      ...(post.videoUrl ? { isVideo: true } : {}),
      ...(post.scheduledAt ? { scheduleDate: new Date(post.scheduledAt).toISOString().replace(/\.\d{3}Z$/, "Z") } : {}),
      ...(post.pinterestBoardId ? { pinterestOptions: { boardId: post.pinterestBoardId } } : {}),
    },
    signal,
    timeoutMs: 120_000,
  });
  if (res?.status === "error") throw new Error(`Ayrshare: ${JSON.stringify(res.errors ?? res).slice(0, 300)}`);
  return res;
}

/* ---------- Zernio (formerly Late) ---------- */
async function zernio(credential: CredentialValue | undefined, post: AggregatorPost, signal: AbortSignal) {
  const headers = { authorization: `Bearer ${str(credential?.data.apiKey)}` };
  const { accounts = [] } = await apiRequest("Zernio", "https://zernio.com/api/v1/accounts", { headers, signal });
  const platforms = post.platforms.map((platform) => {
    const account = (accounts as any[]).find((a) => a.platform === twitterName(platform) && a.isActive !== false);
    if (!account) throw new Error(`Zernio: مفيش حساب ${platform} مربوط في Zernio - اربطه من لوحة Zernio الأول`);
    return { platform: twitterName(platform), accountId: account._id };
  });
  return apiRequest("Zernio", "https://zernio.com/api/v1/posts", {
    headers,
    json: {
      content: post.text,
      platforms,
      ...(media(post).length ? { mediaItems: media(post).map((url) => ({ type: post.videoUrl ? "video" : "image", url })) } : {}),
      ...(post.scheduledAt ? { scheduledFor: new Date(post.scheduledAt).toISOString(), timezone: "UTC" } : { publishNow: true }),
    },
    signal,
    timeoutMs: 120_000,
  });
}

/* ---------- Blotato ---------- */
/** "instagram=123, tiktok=456" -> { instagram: "123", tiktok: "456" } */
const accountMap = (value: unknown) =>
  Object.fromEntries(
    str(value)
      .split(/[,،\n]/)
      .map((pair) => pair.split(/[=:]/).map((part) => part.trim()))
      .filter(([platform, id]) => platform && id)
      .map(([platform, id]) => [platform.toLowerCase(), id]),
  );

async function blotato(credential: CredentialValue | undefined, post: AggregatorPost, signal: AbortSignal) {
  const accounts = accountMap(credential?.data.accounts);
  const results: Record<string, unknown> = {};
  for (const platform of post.platforms) {
    const name = twitterName(platform);
    const accountId = accounts[platform] ?? accounts[name];
    if (!accountId) throw new Error(`Blotato: اكتب Account ID بتاع ${platform} في حساب Blotato (مثلاً ${platform}=12345)`);
    const target: Record<string, unknown> = { targetType: name };
    if (name === "facebook") target.pageId = post.facebookPageId || accounts.facebook_page || "";
    if (name === "linkedin" && accounts.linkedin_page) target.pageId = accounts.linkedin_page;
    if (name === "pinterest") Object.assign(target, { boardId: post.pinterestBoardId || accounts.pinterest_board || "", title: post.text.slice(0, 100) });
    if (name === "youtube") Object.assign(target, { title: post.text.split("\n")[0].slice(0, 100) || "فيديو جديد", privacyStatus: "public", shouldNotifySubscribers: true });
    if (name === "tiktok") {
      Object.assign(target, {
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: true,
      });
    }
    results[platform] = await apiRequest("Blotato", "https://backend.blotato.com/v2/posts", {
      headers: { "blotato-api-key": str(credential?.data.apiKey) },
      json: {
        post: { accountId, content: { text: post.text, mediaUrls: media(post), platform: name }, target },
        ...(post.scheduledAt ? { scheduledTime: new Date(post.scheduledAt).toISOString() } : {}),
      },
      signal,
      timeoutMs: 120_000,
    });
  }
  return results;
}

const MEDIA_ONLY = ["instagram", "tiktok", "youtube", "pinterest"];

/** Clear setup errors before calling the service. */
function checkPost(label: string, post: AggregatorPost) {
  if (!post.platforms.length) throw new Error(`${label}: اختار منصة واحدة على الأقل`);
  if (!post.text.trim()) throw new Error(`${label}: النص فاضي - اربطه بخطوة كتابة المحتوى`);
  const mediaOnly = post.platforms.filter((p) => MEDIA_ONLY.includes(p));
  if (!post.videoUrl && !post.imageUrls?.length && mediaOnly.length) {
    throw new Error(`${label}: ${mediaOnly.join(" و ")} محتاجة صورة أو فيديو - اربط خانة الصور أو الفيديو بخطوة التصميم أو دوس «ربط تلقائي بالخطوات اللي قبلها».`);
  }
}

export const AGGREGATORS = {
  ayrshare: { label: "Ayrshare", credentialType: "ayrshareApi", publish: (c: CredentialValue | undefined, p: AggregatorPost, s: AbortSignal) => (checkPost("Ayrshare", p), ayrshare(c, p, s)) },
  zernio: { label: "Zernio (Late)", credentialType: "zernioApi", publish: (c: CredentialValue | undefined, p: AggregatorPost, s: AbortSignal) => (checkPost("Zernio", p), zernio(c, p, s)) },
  blotato: { label: "Blotato", credentialType: "blotatoApi", publish: (c: CredentialValue | undefined, p: AggregatorPost, s: AbortSignal) => (checkPost("Blotato", p), blotato(c, p, s)) },
} as const;

export type AggregatorKey = keyof typeof AGGREGATORS;

export const aggregatorCredentials: CredentialType[] = [
  {
    key: "ayrshareApi",
    name: "Ayrshare (نشر على كل المنصات)",
    app: "ayrshare",
    description: "مفتاح واحد بينشر على فيسبوك وإنستجرام وتيك توك ويوتيوب وX وLinkedIn وThreads وPinterest وغيرهم.",
    docsUrl: "https://www.ayrshare.com/docs",
    fields: [
      { key: "apiKey", label: "API Key", secret: true, required: true },
      { key: "profileKey", label: "Profile Key (اختياري)", secret: true, help: "لو عندك أكتر من بروفايل (Business plan)." },
    ],
    steps: [
      "اعمل حساب على app.ayrshare.com.",
      "من Social Accounts اربط حسابات السوشيال اللي عايز تنشر عليها.",
      "من API Key انسخ المفتاح والصقه هنا.",
    ],
    test: (data) => checkAuth("Ayrshare", "https://api.ayrshare.com/api/user", { authorization: `Bearer ${data.apiKey}` }),
  },
  {
    key: "zernioApi",
    name: "Zernio / Late (نشر على كل المنصات)",
    app: "zernio",
    description: "مفتاح واحد بينشر على 15 منصة - الحسابات المربوطة عندهم بتتعرف تلقائياً.",
    docsUrl: "https://docs.zernio.com",
    fields: [{ key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk_..." }],
    steps: [
      "اعمل حساب على zernio.com (اسمها القديم Late).",
      "اربط حسابات السوشيال من لوحة التحكم.",
      "من Settings ← API Keys اعمل مفتاح (بيبدأ بـ sk_) والصقه هنا.",
    ],
    test: (data) => checkAuth("Zernio", "https://zernio.com/api/v1/accounts", { authorization: `Bearer ${data.apiKey}` }),
  },
  {
    key: "blotatoApi",
    name: "Blotato (نشر على كل المنصات)",
    app: "blotato",
    description: "بينشر على تيك توك وإنستجرام ويوتيوب وفيسبوك وX وLinkedIn وThreads وPinterest وBluesky.",
    docsUrl: "https://help.blotato.com/api",
    fields: [
      { key: "apiKey", label: "API Key", secret: true, required: true },
      {
        key: "accounts",
        label: "IDs الحسابات",
        required: true,
        placeholder: "instagram=123, tiktok=456, facebook=789, facebook_page=111",
        help: "لكل منصة: اسمها = الـ Account ID من لوحة Blotato. فيسبوك محتاج كمان facebook_page، وPinterest محتاج pinterest_board.",
      },
    ],
    steps: [
      "اعمل حساب على blotato.com واربط حسابات السوشيال.",
      "من Settings ← API انسخ المفتاح والصقه هنا.",
      "من صفحة Accounts انسخ الـ ID بتاع كل حساب واكتبهم بالشكل: instagram=123, tiktok=456",
    ],
  },
];

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "إنستجرام" },
  { value: "facebook", label: "فيسبوك" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X (تويتر)" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "threads", label: "Threads" },
  { value: "pinterest", label: "Pinterest" },
  { value: "bluesky", label: "Bluesky" },
];

export const aggregatorNodes: NodeDefinition[] = (Object.entries(AGGREGATORS) as [AggregatorKey, (typeof AGGREGATORS)[AggregatorKey]][]).map(
  ([key, service]) => ({
    type: `${key}.post`,
    name: `${service.label}: نشر على المنصات`,
    description: `بينشر نص أو صور أو فيديو على المنصات اللي تختارها عن طريق حساب ${service.label}.`,
    app: key,
    appName: service.label,
    color: key === "ayrshare" ? "#2563eb" : key === "zernio" ? "#111827" : "#7c3aed",
    group: "apps",
    kind: "action",
    credentialTypes: [service.credentialType],
    timeoutMs: 200_000,
    fields: [
      { key: "platforms", label: "المنصات", type: "multiselect", default: ["instagram", "facebook"], options: PLATFORM_OPTIONS },
      { key: "text", label: "النص", type: "textarea", required: true, placeholder: "{{3.json.post}}" },
      { key: "imageUrls", label: "روابط الصور", type: "text", help: "أكتر من صورة؟ افصل بفاصلة." },
      { key: "videoUrl", label: "رابط الفيديو", type: "text" },
      { key: "scheduledAt", label: "ميعاد النشر عندهم (اختياري)", type: "text", placeholder: "2026-10-01T16:00:00Z" },
      { key: "facebookPageId", label: "Facebook Page ID (لو محتاجه)", type: "text" },
      { key: "pinterestBoardId", label: "Pinterest Board ID (لو محتاجه)", type: "text" },
    ],
    sampleOutput: { status: "success", id: "post_123" },
    async run({ params, credential, signal }) {
      const output = await service.publish(
        credential,
        {
          platforms: splitList(params.platforms),
          text: String(params.text ?? ""),
          imageUrls: splitList(params.imageUrls).length ? String(params.imageUrls).split(/[,،\n]/).map((u) => u.trim()).filter(Boolean) : [],
          videoUrl: str(params.videoUrl) || undefined,
          scheduledAt: str(params.scheduledAt) || undefined,
          facebookPageId: str(params.facebookPageId) || undefined,
          pinterestBoardId: str(params.pinterestBoardId) || undefined,
        },
        signal,
      );
      return { output };
    },
  }),
);
