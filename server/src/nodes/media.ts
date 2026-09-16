import { config } from "../config.js";
import { newId, now, one, query, run } from "../db.js";
import type { NodeDefinition } from "../engine/types.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import { postJson } from "./llm.js";
import { assertPublicUrl, sleep, withTimeout } from "./util.js";

const CURSOR_STORE = "مؤشر_صور_المكتبة";

/* ---------- shared: optional steps ("make images? make videos?") ---------- */
export const whenField = {
  key: "when",
  label: "شغّل الخطوة دي؟",
  type: "text" as const,
  default: "نعم",
  help: "نعم / لا - أو من إعدادات قبلها زي {{2.makeImages}}. لو «لا» الخطوة بتتخطى والسيناريو يكمّل عادي.",
};

/** "لا", "no", "false", "0", "off" (or empty after an expression) mean: skip this step. */
export const isSkipped = (value: unknown) => /^(لا|no|false|0|off|مش|بدون|skip)?$/i.test(String(value ?? "نعم").trim());

export const MAX_UPLOAD_BYTES = 2.8 * 1024 * 1024;

export const mediaUrl = (id: string) => `${config.publicUrl}/media/${id}`;
/** Files kept in external storage carry their own public URL. */
export const mediaUrlFor = (row: { id: string; url?: string | null }) => row.url || mediaUrl(row.id);

// A Vercel function can't return more than ~4.5MB, so bigger files need external storage.
const MAX_DB_FILE_BYTES = config.isVercel ? 4 * 1024 * 1024 : 60 * 1024 * 1024;
const storageEnabled = () => Boolean(config.storage.url && config.storage.serviceKey);
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4" };

async function uploadToStorage(path: string, body: Buffer, mimeType: string) {
  const { url, serviceKey, bucket } = config.storage;
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const put = () =>
    fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": mimeType, "x-upsert": "true", "cache-control": "604800" },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(120_000),
    });
  let response = await put();
  if (response.status === 404 || response.status === 400) {
    // First upload ever: create the public bucket, then retry.
    await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => undefined);
    response = await put();
  }
  if (!response.ok) throw new Error(`Supabase Storage: رفع الملف فشل (HTTP ${response.status}) ${(await response.text()).slice(0, 200)}`);
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}

/** Stores any file (images, videos) and returns a public URL platforms like Instagram can fetch. */
export async function storeFile(
  userId: string,
  body: Buffer,
  mimeType: string,
  options: { name?: string; folder?: string; source?: "generated" | "upload" } = {},
) {
  const id = newId();
  let url = "";
  let data = "";
  if (storageEnabled()) {
    url = await uploadToStorage(`${userId}/${id}.${EXTENSIONS[mimeType] ?? "bin"}`, body, mimeType);
  } else if (body.length > MAX_DB_FILE_BYTES) {
    throw new Error(
      `الملف حجمه ${(body.length / 1048576).toFixed(1)} ميجا - أكبر من اللي السيرفر يقدر يعرضه. ضيف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في Vercel عشان الفيديوهات تتخزن في Supabase Storage.`,
    );
  } else {
    data = body.toString("base64");
  }
  await run(
    "INSERT INTO media (id, user_id, name, mime_type, data, url, folder, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, userId, options.name ?? "file", mimeType, data, url, options.folder ?? "", options.source ?? "generated", now()],
  );
  return { id, url: url || mediaUrl(id), mimeType };
}

/** Images live in the database (or storage) and get a public URL, so WhatsApp / Instagram can fetch them. */
export const storeMedia = (
  userId: string,
  base64: string,
  mimeType: string,
  options: { name?: string; folder?: string; source?: "generated" | "upload" } = {},
) => storeFile(userId, Buffer.from(base64, "base64"), mimeType, options);

export const loadMedia = (id: string) =>
  one<{ mime_type: string; data: string; url: string }>("SELECT mime_type, data, url FROM media WHERE id = $1", [id]);

/** Fetches an image as base64, reading our own /media files straight from the database. */
/** Any file (video, image, document) as bytes - our own library straight from storage, others over HTTP. */
export async function fileBytes(url: string, signal: AbortSignal, maxBytes = 250 * 1024 * 1024) {
  let target = url;
  const own = url.match(/\/media\/([0-9a-f-]{36})(?:[?#]|$)/i);
  if (own) {
    const file = await loadMedia(own[1]);
    if (file?.data) return { bytes: Buffer.from(file.data, "base64"), mimeType: file.mime_type };
    if (file?.url) target = file.url;
  }
  const response = await fetch(assertPublicUrl(target), { signal: withTimeout(signal, 120_000) });
  if (!response.ok) throw new Error(`مقدرتش أجيب الملف (HTTP ${response.status})`);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > maxBytes) throw new Error(`الملف أكبر من ${Math.round(maxBytes / 1048576)} ميجا`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, mimeType: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
}

export async function imageAsBase64(url: string, signal: AbortSignal): Promise<{ data: string; mimeType: string }> {
  const own = url.match(/\/media\/([0-9a-f-]{36})(?:[?#]|$)/i);
  if (own) {
    const file = await loadMedia(own[1]);
    if (file?.data) return { data: file.data, mimeType: file.mime_type };
    if (file?.url) url = file.url;
  }
  const response = await fetch(assertPublicUrl(url), { signal: withTimeout(signal, 20_000) });
  if (!response.ok) throw new Error(`مقدرتش أجيب الصورة المرجعية (HTTP ${response.status})`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error("الرابط المرجعي مش صورة");
  return { data: Buffer.from(await response.arrayBuffer()).toString("base64"), mimeType };
}

const SIZES = [
  { value: "1024x1024", label: "مربعة (بوست إنستجرام)" },
  { value: "1536x1024", label: "عرضية (فيسبوك / تويتر)" },
  { value: "1024x1536", label: "طولية (ستوري / ريلز)" },
];

const ASPECTS: Record<string, string> = { "1024x1024": "1:1", "1536x1024": "16:9", "1024x1536": "9:16" };

export const mediaNodes: NodeDefinition[] = [
  {
    type: "ai.image",
    name: "توليد صورة بالذكاء الاصطناعي",
    description: "بيعمل صورة من وصف نصي (أو من صورة منتجك) ويحفظها في مكتبة الصور برابط جاهز للنشر.",
    app: "ai",
    appName: "الذكاء الاصطناعي",
    color: "#7c3aed",
    group: "ai",
    kind: "action",
    credentialTypes: ["geminiApi", "openaiApi", "customAiApi"],
    fields: [
      whenField,
      { key: "model", label: "الموديل", type: "model", modelKind: "image", help: "اختار موديل صور من حسابك، أو سيبه على الافتراضي." },
      {
        key: "prompt",
        label: "وصف الصورة",
        type: "textarea",
        required: true,
        placeholder: "صورة إعلانية لمنتج قهوة، إضاءة دافئة، خلفية خشبية",
      },
      {
        key: "referenceImage",
        label: "صورة مرجعية (اختياري)",
        type: "text",
        placeholder: "{{2.url}}",
        help: "مثلاً صورة منتجك من المكتبة: الـ AI هيعمل منها صورة إعلانية. مدعومة مع Gemini.",
      },
      { key: "size", label: "المقاس", type: "select", default: "1024x1024", options: SIZES },
      { key: "folder", label: "يتحفظ في فولدر", type: "text", default: "مولّدة" },
    ],
    sampleOutput: {
      url: "https://your-domain/media/9f1c2d34-...",
      mimeType: "image/png",
      provider: "gemini",
      prompt: "صورة إعلانية لمنتج قهوة",
    },
    async run({ params, credential, workflow, signal }) {
      if (isSkipped(params.when)) return { output: { skipped: true, url: "" } };
      const prompt = String(params.prompt ?? "").trim();
      if (!prompt) throw new Error("وصف الصورة فاضي");
      const size = String(params.size || "1024x1024");
      const model = String(params.model ?? "").trim();
      const reference = String(params.referenceImage ?? "").trim();
      let base64 = "";
      let mimeType = "image/png";

      if (credential?.type === "openaiApi") {
        if (reference) throw new Error("الصورة المرجعية مدعومة مع Gemini بس دلوقتي - اختار حساب Gemini أو شيل الصورة المرجعية");
        const data = await postJson(
          "https://api.openai.com/v1/images/generations",
          { model: model || "gpt-image-2.5-flare", prompt, size, n: 1 },
          { authorization: `Bearer ${credential.data.apiKey}` },
          signal,
          "OpenAI",
        );
        base64 = data?.data?.[0]?.b64_json ?? "";
      } else if (credential?.type === "geminiApi") {
        const parts: unknown[] = [];
        if (reference) {
          const image = await imageAsBase64(reference, signal);
          parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
        }
        parts.push({ text: prompt });
        const data = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-3.1-flash-image")}:generateContent`,
          {
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ASPECTS[size] ?? "1:1" } },
          },
          { "x-goog-api-key": credential.data.apiKey },
          signal,
          "Gemini",
        );
        const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        base64 = part?.inlineData?.data ?? "";
        mimeType = part?.inlineData?.mimeType ?? mimeType;
      } else if (credential?.type === "customAiApi") {
        const base = String(credential.data.baseUrl ?? "").trim().replace(/\/+$/, "");
        const imageModel = model || credential.data.imageModel;
        if (!imageModel) throw new Error("اكتب موديل الصور في الخطوة أو في إعدادات حساب المزوّد");
        const data = await postJson(
          `${base}/images/generations`,
          { model: imageModel, prompt, size, n: 1, response_format: "b64_json" },
          { authorization: `Bearer ${credential.data.apiKey}` },
          signal,
          "المزوّد",
        );
        const item = data?.data?.[0];
        base64 = item?.b64_json ?? "";
        if (!base64 && item?.url) {
          const image = await imageAsBase64(item.url, signal);
          base64 = image.data;
          mimeType = image.mimeType;
        }
      } else {
        throw new Error("توليد الصور متاح مع Gemini أو OpenAI أو مزوّد متوافق - اختار حساب منهم");
      }

      if (!base64) throw new Error("المزوّد مرجّعش صورة - جرّب وصف تاني أو موديل تاني");
      const stored = await storeMedia(workflow.userId, base64, mimeType, {
        name: prompt.slice(0, 80),
        folder: String(params.folder ?? "مولّدة"),
        source: "generated",
      });
      return { output: { ...stored, prompt, provider: credential.type === "openaiApi" ? "openai" : credential.type === "customAiApi" ? "custom" : "gemini" } };
    },
  },
  {
    type: "media.pick",
    name: "صورة من المكتبة",
    description: "بياخد صورة من مكتبة الصور (مثلاً صور منتجاتك) بالترتيب أو عشوائي، عشان تنشرها أو تعدّلها بالـ AI.",
    app: "media",
    appName: "مكتبة الصور",
    color: "#0ea5e9",
    group: "data",
    kind: "action",
    fields: [
      { key: "folder", label: "الفولدر", type: "text", default: "منتجات", required: true, help: "نفس اسم الفولدر اللي رفعت فيه الصور." },
      {
        key: "mode",
        label: "طريقة الاختيار",
        type: "select",
        default: "sequential",
        options: [
          { value: "sequential", label: "بالترتيب (كل مرة الصورة اللي بعدها)" },
          { value: "random", label: "عشوائي" },
          { value: "newest", label: "أحدث صورة اترفعت" },
        ],
      },
    ],
    sampleOutput: { id: "9f1c2d34-...", url: "https://your-domain/media/9f1c2d34-...", name: "تيشيرت أبيض", folder: "منتجات", index: 3, total: 12 },
    async run({ params, workflow }) {
      const folder = String(params.folder ?? "").trim();
      const rows = await query<{ id: string; name: string; url: string; mime_type: string }>(
        "SELECT id, name, url, mime_type FROM media WHERE user_id = $1 AND folder = $2 ORDER BY created_at",
        [workflow.userId, folder],
      );
      if (!rows.length) throw new Error(`مفيش صور في فولدر «${folder}» - ارفع صور من صفحة «مكتبة الصور»`);

      let index: number;
      if (params.mode === "random") index = Math.floor(Math.random() * rows.length);
      else if (params.mode === "newest") index = rows.length - 1;
      else {
        const cursorKey = `${workflow.id}:${folder}`;
        const previous = (await datastoreRead(workflow.userId, CURSOR_STORE, cursorKey)).value;
        index = ((typeof previous === "number" ? previous : -1) + 1) % rows.length;
        await datastoreWrite(workflow.userId, CURSOR_STORE, cursorKey, index);
      }
      const row = rows[index];
      return {
        output: { id: row.id, url: mediaUrlFor(row), name: row.name, mimeType: row.mime_type, folder, index: index + 1, total: rows.length },
      };
    },
  },
];

const VIDEO_ASPECTS = [
  { value: "9:16", label: "طولي (ريلز / ستوري / تيك توك)" },
  { value: "16:9", label: "عرضي (يوتيوب / فيسبوك)" },
];

async function downloadVideo(url: string, headers: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(url, { headers, redirect: "follow", signal: withTimeout(signal, 120_000) });
  if (!response.ok) throw new Error(`تحميل الفيديو فشل (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function geminiVideo(apiKey: string, model: string, prompt: string, aspect: string, seconds: number, reference: string, signal: AbortSignal) {
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const headers = { "x-goog-api-key": apiKey };
  const image = reference ? await imageAsBase64(reference, signal) : undefined;
  const start = (imageShape?: "inline" | "bytes") =>
    postJson(
      `${base}/models/${encodeURIComponent(model)}:predictLongRunning`,
      {
        instances: [
          {
            prompt,
            ...(image
              ? {
                  image:
                    imageShape === "bytes"
                      ? { bytesBase64Encoded: image.data, mimeType: image.mimeType }
                      : { inlineData: { mimeType: image.mimeType, data: image.data } },
                }
              : {}),
          },
        ],
        parameters: { aspectRatio: aspect, ...(seconds ? { durationSeconds: seconds } : {}) },
      },
      headers,
      signal,
      "Gemini Veo",
    );
  let operation: any;
  try {
    operation = await start(image ? "inline" : undefined);
  } catch (e) {
    // The image field shape differs between API versions: retry with the other one.
    if (!image || !/image|inline|bytes|invalid/i.test((e as Error).message)) throw e;
    operation = await start("bytes");
  }
  while (!operation?.done) {
    await sleep(8000, signal);
    const response = await fetch(`${base}/${operation.name}`, { headers, signal });
    const next: any = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Gemini Veo: ${next?.error?.message ?? `HTTP ${response.status}`}`);
    operation = next;
  }
  if (operation.error) throw new Error(`Gemini Veo: ${operation.error.message}`);
  const sample = operation.response?.generateVideoResponse?.generatedSamples?.[0];
  const uri = sample?.video?.uri;
  if (!uri) {
    const filtered = operation.response?.generateVideoResponse?.raiMediaFilteredReasons?.[0];
    throw new Error(`Gemini Veo مرجّعش فيديو${filtered ? ` - ${filtered}` : " - جرّب وصف تاني"}`);
  }
  return downloadVideo(uri, headers, signal);
}

async function openaiVideo(apiKey: string, model: string, prompt: string, aspect: string, seconds: number, signal: AbortSignal) {
  const headers = { authorization: `Bearer ${apiKey}` };
  const allowed = [4, 8, 12];
  const duration = allowed.reduce((best, s) => (Math.abs(s - seconds) < Math.abs(best - seconds) ? s : best), 8);
  let video = await postJson(
    "https://api.openai.com/v1/videos",
    { model, prompt, seconds: String(duration), size: aspect === "16:9" ? "1280x720" : "720x1280" },
    headers,
    signal,
    "OpenAI Sora",
  );
  while (video.status !== "completed") {
    if (video.status === "failed") throw new Error(`OpenAI Sora: ${video.error?.message ?? "التوليد فشل"}`);
    await sleep(8000, signal);
    const response = await fetch(`https://api.openai.com/v1/videos/${video.id}`, { headers, signal });
    const next: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenAI Sora: ${next?.error?.message ?? `HTTP ${response.status}`}`);
    video = next;
  }
  return downloadVideo(`https://api.openai.com/v1/videos/${video.id}/content`, headers, signal);
}

export const videoNode: NodeDefinition = {
  type: "ai.video",
  name: "توليد فيديو بالذكاء الاصطناعي",
  description: "بيعمل فيديو قصير (ريلز / إعلان) من وصف نصي أو من صورة منتجك، ويحفظه برابط جاهز للنشر. بياخد من دقيقة لـ 4 دقايق.",
  app: "ai",
  appName: "الذكاء الاصطناعي",
  color: "#7c3aed",
  group: "ai",
  kind: "action",
  credentialTypes: ["geminiApi", "openaiApi"],
  timeoutMs: 285_000,
  fields: [
    whenField,
    { key: "model", label: "الموديل", type: "model", modelKind: "video", help: "Gemini: موديلات Veo - OpenAI: موديلات Sora. سيبه فاضي للافتراضي." },
    { key: "prompt", label: "وصف الفيديو", type: "textarea", required: true, placeholder: "لقطة سينمائية لزجاجة عطر بتلف ببطء، إضاءة ذهبية" },
    {
      key: "referenceImage",
      label: "صورة المنتج (اختياري)",
      type: "text",
      placeholder: "{{2.url}}",
      help: "الفيديو هيتعمل من صورة منتجك. مدعومة مع Gemini Veo.",
    },
    { key: "aspect", label: "الاتجاه", type: "select", default: "9:16", options: VIDEO_ASPECTS },
    { key: "seconds", label: "المدة بالثواني", type: "number", default: 8 },
    { key: "folder", label: "يتحفظ في فولدر", type: "text", default: "فيديوهات" },
  ],
  sampleOutput: { url: "https://your-domain/media/5b2e...", mimeType: "video/mp4", provider: "gemini", seconds: 8, skipped: false },
  async run({ params, credential, workflow, signal }) {
    if (isSkipped(params.when)) return { output: { skipped: true, url: "" } };
    const prompt = String(params.prompt ?? "").trim();
    if (!prompt) throw new Error("وصف الفيديو فاضي");
    const aspect = params.aspect === "16:9" ? "16:9" : "9:16";
    const seconds = Math.min(Math.max(Math.round(Number(params.seconds) || 8), 4), 12);
    const reference = String(params.referenceImage ?? "").trim();
    const model = String(params.model ?? "").trim();
    let video: Buffer;
    let note: string | undefined;

    if (credential?.type === "geminiApi") {
      video = await geminiVideo(credential.data.apiKey, model || "veo-3.1-fast-generate-preview", prompt, aspect, Math.min(seconds, 8), reference, signal);
    } else if (credential?.type === "openaiApi") {
      if (reference) note = "Sora مش بياخد صورة المنتج هنا - الفيديو اتعمل من الوصف بس. استخدم Gemini Veo لو عايز الفيديو من صورة المنتج.";
      video = await openaiVideo(credential.data.apiKey, model || "sora-2", prompt, aspect, seconds, signal);
    } else {
      throw new Error("توليد الفيديو متاح مع Gemini (Veo) أو OpenAI (Sora) - اختار حساب منهم");
    }

    const stored = await storeFile(workflow.userId, video, "video/mp4", {
      name: prompt.slice(0, 80),
      folder: String(params.folder ?? "فيديوهات"),
      source: "generated",
    });
    return {
      output: {
        ...stored,
        prompt,
        seconds,
        aspect,
        sizeMb: Number((video.length / 1048576).toFixed(1)),
        provider: credential.type === "openaiApi" ? "openai" : "gemini",
        skipped: false,
        ...(note ? { note } : {}),
      },
    };
  },
};
