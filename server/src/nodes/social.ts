import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { imageShape, urlList } from "./media.js";
import { sleep, withTimeout } from "./util.js";

const VERSION = "v23.0";
const FACEBOOK_GRAPH = `https://graph.facebook.com/${VERSION}`;
const INSTAGRAM_GRAPH = `https://graph.instagram.com/${VERSION}`;

interface MetaError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

/**
 * Meta answers with the same vague "Invalid parameter" for a dozen different mistakes.
 * This turns the code Meta sends into the one sentence that says what to do about it.
 */
function metaMessage(label: string, error: MetaError | undefined, status: number): string {
  const raw = error?.message ?? `HTTP ${status}`;
  const code = error?.code;
  const sub = error?.error_subcode;
  const say = (text: string) => `${label}: ${text}`;

  if (code === 190 || status === 401) {
    if (sub === 463) return say("التوكن خلصت مدته. اعمل توكن جديد ومدّده من Access Token Debugger (زرار Extend Access Token) وحدّث الحساب هنا");
    if (sub === 467) return say("التوكن ملغي (غالباً غيّرت باسورد فيسبوك أو شلت التطبيق). اعمل توكن جديد وحدّث الحساب هنا");
    return say("التوكن مرفوض. التوكن اللي من Graph API Explorer مؤقت وبيخلص بسرعة - مدّده من Access Token Debugger أو اعمل System User Token دائم");
  }
  if (code === 100 && sub === 33) {
    return say(
      "الرقم اللي كاتبه التوكن ده مش شايفه. لازم Instagram User ID اللي راجع من instagram_business_account - مش رقم من رابط البروفايل ولا رقم التطبيق. سيب الخانة فاضية واضغط «اختبار الاتصال» وإحنا هنجيبه لوحدنا",
    );
  }
  if (code === 200 || code === 3 || code === 10 || (code === 100 && /permission/i.test(raw))) {
    return say("التوكن ناقصه صلاحيات. لازم instagram_basic و instagram_content_publish و pages_show_list و pages_read_engagement (ولو صفحة كمان pages_manage_posts)");
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return say("وصلت للحد المسموح من Meta مؤقتاً (إنستجرام بيسمح بـ 50 بوست في 24 ساعة). استنى شوية وجرّب تاني");
  }
  if (code === 9004 || /media.*(download|fetch|url)/i.test(raw)) {
    return say("Meta مقدرتش تحمّل الملف من الرابط. لازم رابط عام يفتح من غير تسجيل دخول - صور المنصة نفسها بتنفع، لكن روابط جوجل درايف المشتركة لأ");
  }
  if (code === 36003 || /aspect ratio/i.test(raw)) return say("مقاس الصورة مرفوض - إنستجرام بيقبل من 4:5 لحد 1.91:1 (المربع 1080×1080 أو الطولي 1080×1350 مضمونين)");
  if (code === 36001 || /unsupported.*format|invalid image format/i.test(raw)) return say("نوع الملف مرفوض - الصور JPEG أو PNG، والفيديو MP4 أو MOV");
  if (String(code ?? "").startsWith("2207")) return say(`إنستجرام رفض الملف - ${error?.error_user_msg ?? raw}`);
  if (code === 24 || /not.*business|media.*publish.*not.*available/i.test(raw)) {
    return say("الحساب ده مش Business أو Creator، أو مش مربوط بصفحة فيسبوك. حوّله من إنستجرام ← الإعدادات ← نوع الحساب، واربطه بصفحة");
  }
  if (error?.error_user_msg) return say(error.error_user_msg);
  return say(raw);
}

async function metaFetch(
  base: string,
  path: string,
  init: RequestInit & { params?: Record<string, string> },
  token: string,
  label: string,
  signal?: AbortSignal,
) {
  const url = new URL(`${base}/${path}`);
  for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    signal: signal ? withTimeout(signal, 30_000) : AbortSignal.timeout(30_000),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(metaMessage(label, data?.error, response.status));
    (error as any).metaCode = data?.error?.code;
    (error as any).metaSubcode = data?.error?.error_subcode;
    throw error;
  }
  return data;
}

const metaGet = (base: string, path: string, params: Record<string, string>, token: string, label: string, signal?: AbortSignal) =>
  metaFetch(base, path, { method: "GET", params }, token, label, signal);

const metaPost = (base: string, path: string, body: Record<string, unknown>, token: string, label: string, signal?: AbortSignal) =>
  metaFetch(base, path, { method: "POST", body: JSON.stringify(body) }, token, label, signal);

/* ---------- Instagram: two different logins, one credential ---------- */

export interface IgAccount {
  /** graph.facebook.com (Facebook login) or graph.instagram.com (Instagram login). */
  base: string;
  id: string;
  username: string;
  /** How we found the id, so the customer knows what happened. */
  how: "as-is" | "from-page" | "from-pages" | "from-me";
}

const igCache = new Map<string, { at: number; account: IgAccount }>();

/**
 * Publishing needs the Instagram *Business* account id, which is not the number customers
 * usually have: they paste the page id, an app-scoped id, or nothing - and the token can come
 * from either of Meta's two logins. This finds the right pair, or says exactly what is missing.
 */
export async function resolveIgAccount(data: Record<string, string>, signal?: AbortSignal): Promise<IgAccount> {
  const token = (data.accessToken ?? "").trim();
  if (!token) throw new Error("إنستجرام: اكتب Access Token");
  const given = (data.igUserId ?? "").trim();
  const cacheKey = `${token.slice(-24)}:${given}`;
  const cached = igCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.account;

  const attempts: (() => Promise<IgAccount>)[] = [];

  if (given) {
    // The number is already an Instagram account id.
    attempts.push(async () => {
      const account = await metaGet(FACEBOOK_GRAPH, given, { fields: "username" }, token, "إنستجرام", signal);
      if (!account?.username) throw new Error("إنستجرام: الرقم ده مش حساب إنستجرام");
      return { base: FACEBOOK_GRAPH, id: given, username: account.username, how: "as-is" };
    });
    // The number is the Facebook page id: the Instagram account hangs off it.
    attempts.push(async () => {
      const page = await metaGet(FACEBOOK_GRAPH, given, { fields: "instagram_business_account{id,username}" }, token, "إنستجرام", signal);
      const linked = page?.instagram_business_account;
      if (!linked?.id) throw new Error("إنستجرام: الصفحة دي مش مربوطة بحساب إنستجرام بيزنس");
      return { base: FACEBOOK_GRAPH, id: String(linked.id), username: linked.username ?? "", how: "from-page" };
    });
    // An Instagram-login token talks to a different host.
    attempts.push(async () => {
      const account = await metaGet(INSTAGRAM_GRAPH, given, { fields: "username" }, token, "إنستجرام", signal);
      if (!account?.username) throw new Error("إنستجرام: الرقم ده مش حساب إنستجرام");
      return { base: INSTAGRAM_GRAPH, id: given, username: account.username, how: "as-is" };
    });
  }

  // No usable number: read it off the token itself.
  attempts.push(async () => {
    const pages = await metaGet(
      FACEBOOK_GRAPH,
      "me/accounts",
      { fields: "name,instagram_business_account{id,username}", limit: "50" },
      token,
      "إنستجرام",
      signal,
    );
    const withIg = (pages?.data ?? []).find((page: any) => page?.instagram_business_account?.id);
    if (!withIg) {
      throw new Error(
        "إنستجرام: مفيش ولا صفحة فيسبوك على التوكن ده مربوطة بحساب إنستجرام بيزنس. اربط الحساب بصفحتك (إعدادات الصفحة ← Linked accounts ← Instagram) وتأكد إن نوع الحساب Business أو Creator",
      );
    }
    const linked = withIg.instagram_business_account;
    return { base: FACEBOOK_GRAPH, id: String(linked.id), username: linked.username ?? "", how: "from-pages" };
  });
  attempts.push(async () => {
    const me = await metaGet(INSTAGRAM_GRAPH, "me", { fields: "id,user_id,username" }, token, "إنستجرام", signal);
    const id = me?.user_id ?? me?.id;
    if (!id) throw new Error("إنستجرام: التوكن ده مرجّعش حساب");
    return { base: INSTAGRAM_GRAPH, id: String(id), username: me.username ?? "", how: "from-me" };
  });

  let first: unknown;
  for (const attempt of attempts) {
    try {
      const account = await attempt();
      igCache.set(cacheKey, { at: Date.now(), account });
      return account;
    } catch (error) {
      first ??= error;
    }
  }
  throw first instanceof Error ? first : new Error("إنستجرام: مقدرتش أوصل للحساب");
}

export const facebookCredential: CredentialType = {
  key: "facebookPage",
  name: "صفحة فيسبوك",
  app: "facebook",
  description: "من Meta for Developers ← Graph API Explorer: اختار صفحتك وهات Page Access Token طويل المدى + رقم الصفحة",
  docsUrl: "https://developers.facebook.com/docs/pages-api/getting-started",
  fields: [
    { key: "pageId", label: "Page ID", required: true, placeholder: "102345678901234" },
    { key: "pageAccessToken", label: "Page Access Token", secret: true, required: true },
  ],
  async test(data) {
    const page = await metaGet(FACEBOOK_GRAPH, data.pageId, { fields: "name" }, data.pageAccessToken, "فيسبوك");
    return `متصل بصفحة ${page.name}`;
  },
};

export const instagramCredential: CredentialType = {
  key: "instagramBusiness",
  name: "إنستجرام بيزنس",
  app: "instagram",
  description: "لازم حساب Business أو Creator مربوط بصفحة فيسبوك. سيب خانة الرقم فاضية واضغط «اختبار الاتصال» - هنجيب الرقم لوحدنا من التوكن ونحفظه",
  docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
  fields: [
    {
      key: "accessToken",
      label: "Access Token",
      secret: true,
      required: true,
      help: "التوكن اللي من Graph API Explorer مؤقت - مدّده من Access Token Debugger عشان ميقفش بعد ساعة",
    },
    {
      key: "igUserId",
      label: "Instagram User ID (سيبها فاضية)",
      placeholder: "هنجيبه لوحدنا",
      help: "سيبها فاضية ودوس «اختبار الاتصال» - هنجيب الرقم من التوكن ونحفظه. وتنفع كمان لو كتبت رقم صفحة الفيسبوك",
    },
  ],
  async test(data) {
    const account = await resolveIgAccount(data);
    // Keep the resolved id: the customer never has to hunt for it again.
    data.igUserId = account.id;
    const login = account.base === INSTAGRAM_GRAPH ? "تسجيل دخول إنستجرام" : "تسجيل دخول فيسبوك";
    const found =
      account.how === "from-page"
        ? " (لقيته من صفحة الفيسبوك اللي كتبت رقمها)"
        : account.how === "from-pages" || account.how === "from-me"
          ? " (جبناه لوحدنا وحفظناه)"
          : "";
    return `متصل بحساب @${account.username || account.id} · ${login} · الرقم ${account.id}${found}`;
  },
};

/* ---------- publishing ---------- */

interface IgItem {
  url: string;
  video: boolean;
}

/** Instagram processes videos before they can be published: this waits for the container to be ready. */
async function waitForContainer(account: IgAccount, containerId: string, token: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = await metaGet(account.base, containerId, { fields: "status_code,status" }, token, "إنستجرام", signal);
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(
        `إنستجرام: معالجة الملف فشلت - ${status.status ?? status.status_code}. تأكد إن الفيديو MP4 وأقل من 100 ميجا وطوله من 3 ثواني لـ 15 دقيقة`,
      );
    }
    await sleep(5000, signal);
  }
  throw new Error("إنستجرام: معالجة الفيديو خدت وقت أطول من المسموح - جرّب فيديو أخف");
}

async function igPublish(account: IgAccount, containerId: string, token: string, signal: AbortSignal) {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await metaPost(account.base, `${account.id}/media_publish`, { creation_id: containerId }, token, "إنستجرام", signal);
    } catch (error) {
      last = error;
      // Only a container that is still processing is worth retrying.
      if ((error as any).metaCode === 190 || (error as any).metaSubcode === 33) break;
      await sleep(3000, signal);
    }
  }
  throw last instanceof Error ? last : new Error("إنستجرام: النشر فشل");
}

/*
 * Instagram only accepts pictures between 4:5 (tall) and 1.91:1 (wide), and anything outside
 * that it crops by itself - which is how a picture ends up published with a piece missing.
 * We measure first and stop, so nothing gets cut without the customer saying so.
 */
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

async function assertPublishableShape(items: IgItem[], signal: AbortSignal) {
  for (const [i, item] of items.entries()) {
    if (item.video) continue;
    const size = await imageShape(item.url, signal);
    if (!size?.width || !size.height) continue;
    const ratio = size.width / size.height;
    if (ratio >= MIN_RATIO && ratio <= MAX_RATIO) continue;
    const which = items.length > 1 ? `الصورة رقم ${i + 1}: ` : "";
    const advice =
      ratio < MIN_RATIO
        ? `الصورة طولية أكتر من اللازم. المقاس المضمون 1080×1350`
        : `الصورة عريضة أكتر من اللازم. المقاس المضمون 1080×566 أو 1080×1080`;
    throw new Error(
      `إنستجرام: ${which}مقاسها ${size.width}×${size.height} وإنستجرام مش بيقبل غير من 4:5 لـ 1.91:1، يعني كان هيقص منها. ${advice} - ` +
        `أو غيّر «لو مقاس الصورة مش مناسب» في الخطوة لـ «انشر وسيب إنستجرام تقص»`,
    );
  }
}

/** One image, one reel, or a carousel of 2-10: the difference is only how many containers we make. */
export async function instagramPost(
  credentialData: Record<string, string>,
  post: { items: IgItem[]; caption: string; allowCrop?: boolean },
  signal: AbortSignal,
) {
  const token = credentialData.accessToken ?? "";
  const account = await resolveIgAccount(credentialData, signal);
  const items = post.items.slice(0, 10);
  if (!items.length) throw new Error("إنستجرام محتاج صورة أو فيديو - مينفعش نص لوحده");
  if (!post.allowCrop) await assertPublishableShape(items, signal);

  if (items.length === 1) {
    const [item] = items;
    const container = await metaPost(
      account.base,
      `${account.id}/media`,
      item.video
        ? { media_type: "REELS", video_url: item.url, caption: post.caption, share_to_feed: true }
        : { image_url: item.url, caption: post.caption },
      token,
      "إنستجرام",
      signal,
    );
    if (item.video) await waitForContainer(account, container.id, token, signal);
    const published = await igPublish(account, container.id, token, signal);
    return { ...published, containerId: container.id, account: account.username, caption: post.caption, type: item.video ? "reel" : "image" };
  }

  const children: string[] = [];
  for (const item of items) {
    const child = await metaPost(
      account.base,
      `${account.id}/media`,
      item.video ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: true } : { image_url: item.url, is_carousel_item: true },
      token,
      "إنستجرام",
      signal,
    );
    if (item.video) await waitForContainer(account, child.id, token, signal);
    children.push(String(child.id));
  }
  const parent = await metaPost(
    account.base,
    `${account.id}/media`,
    { media_type: "CAROUSEL", children: children.join(","), caption: post.caption },
    token,
    "إنستجرام",
    signal,
  );
  const published = await igPublish(account, parent.id, token, signal);
  return { ...published, containerId: parent.id, account: account.username, caption: post.caption, type: "carousel", count: children.length };
}

/** A Facebook post with several photos: each photo is uploaded unpublished, then attached to one post. */
export async function facebookAlbum(pageId: string, token: string, message: string, images: string[], signal: AbortSignal) {
  const ids: string[] = [];
  for (const url of images.slice(0, 10)) {
    const photo = await metaPost(FACEBOOK_GRAPH, `${pageId}/photos`, { url, published: false }, token, "فيسبوك", signal);
    ids.push(String(photo.id));
  }
  const result = await metaPost(
    FACEBOOK_GRAPH,
    `${pageId}/feed`,
    { message, attached_media: ids.map((media_fbid) => ({ media_fbid })) },
    token,
    "فيسبوك",
    signal,
  );
  const id = result.post_id ?? result.id;
  return { ...result, postUrl: id ? `https://facebook.com/${id}` : undefined, type: "album", count: ids.length };
}

/** Instagram is the only platform that reshapes a picture, so this is where the choice lives. */
export const FIT_FIELD = {
  key: "fit",
  label: "لو مقاس الصورة مش مناسب لإنستجرام",
  type: "select" as const,
  default: "keep",
  options: [
    { value: "keep", label: "وقّف وقولّي (الصورة تنزل بمقاسها أو متنزلش)" },
    { value: "crop", label: "انشر وسيب إنستجرام تقص الزيادة" },
  ],
  help: "إنستجرام بيقبل من 4:5 (طولي) لـ 1.91:1 (عريض) - وأي حاجة برّا كده بيقصها لوحده",
};

const IMAGE_HELP = "اكتب @ واختار من مكتبة صورك، أو الصق رابط صورة. أكتر من صورة = كاروسيل (كل صورة في سطر)";
const VIDEO_HELP = "اكتب @ واختار فيديو من مكتبتك، أو الصق رابط فيديو";
const TEXT_HELP = "اكتب النص، أو دوس زرار البيانات اللي جوه الخانة واختار نتيجة خطوة قبلها";

export const socialNodes: NodeDefinition[] = [
  {
    type: "facebook.post",
    name: "نشر بوست على فيسبوك",
    description: "بينشر نص أو صورة أو فيديو على صفحة الفيسبوك بتاعتك. أكتر من صورة بتتنشر كألبوم في بوست واحد",
    app: "facebook",
    appName: "فيسبوك",
    color: "#1877f2",
    group: "apps",
    kind: "action",
    timeoutMs: 280_000,
    credentialTypes: ["facebookPage"],
    fields: [
      { key: "message", label: "نص البوست", type: "textarea", required: true, placeholder: "اكتب البوست هنا", help: TEXT_HELP },
      { key: "imageUrl", label: "الصور (اختياري)", type: "textarea", placeholder: "@{تيشيرت أبيض}", help: IMAGE_HELP },
      { key: "videoUrl", label: "فيديو (اختياري)", type: "text", placeholder: "@{فيديو المنتج}", help: `${VIDEO_HELP}. لو حطيت فيديو هيتنشر الفيديو بالنص` },
      { key: "link", label: "رابط مرفق (اختياري)", type: "text", placeholder: "https://mystore.com/product" },
    ],
    sampleOutput: { id: "123456789_987654321", postUrl: "https://facebook.com/123456789_987654321" },
    async run({ params, credential, signal }) {
      const token = credential?.data.pageAccessToken ?? "";
      const pageId = credential?.data.pageId ?? "";
      const message = String(params.message ?? "");
      const images = urlList(params.imageUrl);
      const videoUrl = String(params.videoUrl ?? "").trim();
      if (videoUrl) {
        const result = await metaPost(FACEBOOK_GRAPH, `${pageId}/videos`, { file_url: videoUrl, description: message }, token, "فيسبوك", signal);
        return { output: { ...result, postUrl: result.id ? `https://facebook.com/${result.id}` : undefined, type: "video" } };
      }
      if (images.length > 1) return { output: { ...(await facebookAlbum(pageId, token, message, images, signal)), message } };
      const link = String(params.link ?? "").trim();
      const body: Record<string, unknown> = images.length
        ? { url: images[0], caption: message, published: true }
        : { message, ...(link ? { link } : {}) };
      const result = await metaPost(FACEBOOK_GRAPH, `${pageId}/${images.length ? "photos" : "feed"}`, body, token, "فيسبوك", signal);
      const id = result.post_id ?? result.id;
      return { output: { ...result, postUrl: id ? `https://facebook.com/${id}` : undefined, message, type: images.length ? "image" : "text" } };
    },
  },
  {
    type: "instagram.post",
    name: "نشر على إنستجرام",
    description: "بينشر صورة أو ريل أو كاروسيل (لحد 10 صور بكابشن واحد) على حساب إنستجرام بيزنس",
    app: "instagram",
    appName: "إنستجرام",
    color: "#e1306c",
    group: "apps",
    kind: "action",
    timeoutMs: 280_000,
    credentialTypes: ["instagramBusiness"],
    fields: [
      { key: "imageUrl", label: "الصور", type: "textarea", placeholder: "@{تيشيرت أبيض}\n@{بنطلون جينز}", help: IMAGE_HELP },
      { key: "videoUrl", label: "فيديو / ريل (اختياري)", type: "text", placeholder: "@{فيديو المنتج}", help: `${VIDEO_HELP}. لو حطيت فيديو هينزل ريل` },
      {
        key: "caption",
        label: "الكابشن",
        type: "textarea",
        placeholder: "اكتب الكابشن هنا",
        help: `${TEXT_HELP}. في الكاروسيل الكابشن ده بيبقى لكل الصور`,
      },
      FIT_FIELD,
    ],
    sampleOutput: { id: "17895695668004550", containerId: "17889455560051444", account: "mystore", type: "carousel", count: 3 },
    async run({ params, credential, signal }) {
      const images = urlList(params.imageUrl);
      const video = String(params.videoUrl ?? "").trim();
      const items: IgItem[] = video ? [{ url: video, video: true }] : images.map((url) => ({ url, video: /\.(mp4|mov|m4v)(\?|$)/i.test(url) }));
      if (!items.length) {
        throw new Error("إنستجرام محتاج صورة أو فيديو - اكتب @ واختار من مكتبة صورك، أو الصق رابط صورة");
      }
      return {
        output: await instagramPost(
          credential?.data ?? {},
          { items, caption: String(params.caption ?? ""), allowCrop: params.fit === "crop" },
          signal,
        ),
      };
    },
  },
];
