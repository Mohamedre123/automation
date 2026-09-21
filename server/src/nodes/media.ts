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
  help: "نعم / لا - أو من إعدادات قبلها زي {{2.makeImages}}. لو «لا» الخطوة بتتخطى والسيناريو يكمّل عادي",
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
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "text/html": "html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

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
      `الملف حجمه ${(body.length / 1048576).toFixed(1)} ميجا - أكبر من اللي السيرفر يقدر يعرضه. ضيف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في Vercel عشان الفيديوهات تتخزن في Supabase Storage`,
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

/** "@{اسم الصورة}" in any step field = that image from the customer's library. */
export const MEDIA_MENTION = /@\{([^{}\n]{1,120})\}/g;

export async function resolveMediaMentions<T>(value: T, userId: string): Promise<T> {
  const text = JSON.stringify(value);
  if (!text || !text.includes("@{")) return value;
  const names = new Set([...text.matchAll(MEDIA_MENTION)].map((m) => m[1].trim()));
  if (!names.size) return value;
  const found = new Map<string, string>();
  for (const name of names) {
    const row = await one<{ id: string; url: string }>(
      "SELECT id, url FROM media WHERE user_id = $1 AND lower(name) = lower($2) ORDER BY created_at DESC LIMIT 1",
      [userId, name],
    );
    if (!row) throw new Error(`مفيش صورة اسمها «${name}» في مكتبة الصور - اكتب @ واختار الصورة من القايمة`);
    found.set(name, mediaUrlFor(row));
  }
  const replace = (input: unknown): unknown => {
    if (typeof input === "string") return input.replace(MEDIA_MENTION, (_m, name: string) => found.get(name.trim()) ?? _m);
    if (Array.isArray(input)) return input.map(replace);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, replace(v)]));
    return input;
  };
  return replace(value) as T;
}

/** Several URLs in one field (comma, new line or space separated). */
export const urlList = (value: unknown) =>
  String(value ?? "")
    .split(/[\s,،]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));

export const loadMedia = (id: string) =>
  one<{ mime_type: string; data: string; url: string; name: string }>("SELECT mime_type, data, url, name FROM media WHERE id = $1", [id]);

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

/**
 * Width and height straight out of the file header (JPEG, PNG, WebP, GIF) - no decoding.
 * Used to warn before a platform crops a picture that is the wrong shape for it.
 */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  // PNG: IHDR is always the first chunk.
  if (bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  // GIF: little-endian screen descriptor.
  if (bytes.toString("ascii", 0, 3) === "GIF") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1, height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (kind === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    return null;
  }
  // JPEG: walk the markers to the frame header that carries the size.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = bytes[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      const length = bytes.readUInt16BE(at + 2);
      if (length < 2) return null;
      at += 2 + length;
    }
  }
  return null;
}

/** The shape of a picture at a URL, or null when we cannot tell (a link we do not control). */
export async function imageShape(url: string, signal: AbortSignal) {
  try {
    const { bytes } = await fileBytes(url, signal, 40 * 1024 * 1024);
    return imageSize(bytes);
  } catch {
    return null;
  }
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
  { value: "1024x1280", label: "بوست إنستجرام 4:5 (الأفضل)" },
  { value: "1024x1024", label: "مربعة 1:1" },
  { value: "1536x1024", label: "عرضية 16:9 (فيسبوك / X / يوتيوب)" },
  { value: "1024x1536", label: "طولية 9:16 (ستوري / ريلز)" },
];

const ASPECTS: Record<string, string> = { "1024x1280": "4:5", "1024x1024": "1:1", "1536x1024": "16:9", "1024x1536": "9:16" };
/** OpenAI image sizes are fixed: the nearest one for each aspect. */
const OPENAI_SIZES: Record<string, string> = { "1024x1280": "1024x1536", "1024x1024": "1024x1024", "1536x1024": "1536x1024", "1024x1536": "1024x1536" };

/** Reference photos are the real product: the model must keep it as is, not reinterpret it. */
const KEEP_PRODUCT =
  "\n\nIMPORTANT - the attached image shows the exact product. Use that exact product as the hero of the design: keep its packaging, shape, proportions, colors, label, logo and any printed text exactly as they appear. Do not open it, do not show what is inside it, do not replace, redraw or redesign it. Build a professional advertising scene (background, lighting, props, composition) around this exact product.";

export const mediaNodes: NodeDefinition[] = [
  {
    type: "ai.image",
    name: "توليد صورة بالذكاء الاصطناعي",
    description: "بيعمل صورة من وصف نصي (أو من صورة منتجك) ويحفظها في مكتبة الصور برابط جاهز للنشر",
    app: "ai",
    appName: "الذكاء الاصطناعي",
    color: "#7c3aed",
    group: "ai",
    kind: "action",
    credentialTypes: ["geminiApi", "openaiApi", "customAiApi"],
    fields: [
      whenField,
      { key: "model", label: "الموديل", type: "model", modelKind: "image", help: "اختار موديل صور من حسابك، أو سيبه على الافتراضي" },
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
        placeholder: "اكتب @ واختار صورة من مكتبتك",
        help: "اكتب @ واختار صورة منتجك - أو سيبها فاضية وهتتاخد تلقائي من صورة المنتج في الخطوات اللي قبلها. عايز كل صورة لوحدها؟ استخدم «صور محددة من المكتبة» قبلها",
      },
      {
        key: "keepProduct",
        label: "حافظ على المنتج زي ما هو في الصورة المرجعية",
        type: "boolean",
        default: true,
        help: "المنتج يظهر بنفس شكله وتغليفه ولوجوه (من غير ما يتفتح أو يطلع اللي جواه)",
      },
      { key: "size", label: "المقاس", type: "select", default: "1024x1280", options: SIZES },
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
      const size = String(params.size || "1024x1280");
      const model = String(params.model ?? "").trim();
      const references = urlList(params.referenceImage).slice(0, 6);
      const reference = references.join(",");
      const finalPrompt = references.length && params.keepProduct !== false ? `${prompt}${KEEP_PRODUCT}` : prompt;
      let base64 = "";
      let mimeType = "image/png";

      if (credential?.type === "openaiApi") {
        const openaiSize = OPENAI_SIZES[size] ?? "1024x1024";
        if (references.length) {
          // Image edits: the product photos go in as the starting images.
          const form = new FormData();
          form.set("model", model || "gpt-image-2.5-flare");
          form.set("prompt", finalPrompt);
          form.set("size", openaiSize);
          for (const [i, url] of references.entries()) {
            const image = await imageAsBase64(url, signal);
            form.append("image[]", new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }), `product-${i + 1}.${image.mimeType.split("/")[1] ?? "png"}`);
          }
          const response = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: { authorization: `Bearer ${credential.data.apiKey}` },
            body: form,
            signal: withTimeout(signal, 180_000),
          });
          const data: any = await response.json().catch(() => null);
          if (!response.ok) throw new Error(`OpenAI: ${data?.error?.message ?? `HTTP ${response.status}`}`);
          base64 = data?.data?.[0]?.b64_json ?? "";
        } else {
          const data = await postJson(
            "https://api.openai.com/v1/images/generations",
            { model: model || "gpt-image-2.5-flare", prompt, size: openaiSize, n: 1 },
            { authorization: `Bearer ${credential.data.apiKey}` },
            signal,
            "OpenAI",
          );
          base64 = data?.data?.[0]?.b64_json ?? "";
        }
      } else if (credential?.type === "geminiApi") {
        const parts: unknown[] = [];
        for (const url of references) {
          const image = await imageAsBase64(url, signal);
          parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
        }
        parts.push({ text: finalPrompt });
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
    type: "media.select",
    name: "صور محددة من المكتبة",
    description:
      "اختار صور بعينها بـ @ (ولكل صورة فكرتها): الخطوات اللي بعدها بتشتغل على كل صورة لوحدها بالترتيب - صورة تخلص كل خطواتها وبعدين اللي بعدها. أو صورة واحدة كل تشغيل",
    app: "media",
    appName: "مكتبة الصور",
    color: "#0ea5e9",
    group: "data",
    kind: "action",
    fields: [
      {
        key: "images",
        label: "الصور",
        type: "textarea",
        required: true,
        placeholder: "@{تيشيرت أبيض}\n@{كوباية قهوة}",
        help: "اكتب @ واختار كل صورة (كل صورة في سطر)",
      },
      {
        key: "ideas",
        label: "فكرة كل صورة (اختياري)",
        type: "textarea",
        placeholder: "عرض خصم 20%\nمنتج جديد وصل",
        help: "سطر لكل صورة بنفس الترتيب - بتوصل للخطوات اللي بعدها في {{N.idea}}",
      },
      {
        key: "mode",
        label: "طريقة الشغل",
        type: "select",
        default: "each",
        options: [
          { value: "each", label: "كل الصور في نفس التشغيل - واحدة ورا التانية" },
          { value: "rotate", label: "صورة واحدة كل تشغيل بالترتيب (مثلاً صورة كل يوم)" },
        ],
      },
    ],
    sampleOutput: { url: "https://your-domain/media/9f1c2d34-...", name: "تيشيرت أبيض", idea: "عرض خصم 20%", index: 1, total: 3 },
    async run({ params, workflow }) {
      const urls = urlList(params.images);
      if (!urls.length) throw new Error("اختار صورة واحدة على الأقل - اكتب @ واختار من مكتبة الصور");
      const ideas = String(params.ideas ?? "")
        .split("\n")
        .map((line) => line.trim());
      const items = [];
      for (const [i, url] of urls.entries()) {
        const id = url.match(/\/media\/([0-9a-f-]{36})/i)?.[1] ?? url.match(/\/([0-9a-f-]{36})\.[a-z0-9]+$/i)?.[1];
        const row = id ? await one<{ name: string; mime_type: string }>("SELECT name, mime_type FROM media WHERE id = $1 AND user_id = $2", [id, workflow.userId]) : undefined;
        items.push({ url, name: row?.name ?? `صورة ${i + 1}`, mimeType: row?.mime_type ?? "", idea: ideas[i] ?? "", index: i + 1, total: urls.length });
      }
      if (params.mode === "rotate") {
        const cursorKey = `${workflow.id}:select`;
        const previous = (await datastoreRead(workflow.userId, CURSOR_STORE, cursorKey)).value;
        const index = ((typeof previous === "number" ? previous : -1) + 1) % items.length;
        await datastoreWrite(workflow.userId, CURSOR_STORE, cursorKey, index);
        return { output: items[index] };
      }
      return { output: { total: items.length, names: items.map((item) => item.name) }, fanOut: items };
    },
  },
  {
    type: "media.gallery",
    name: "الصور والكابشن",
    description:
      "مكان واحد تحط فيه صور البوست وكلامه. الخطوة اللي بعدها (النشر) بتاخد منها الصور والكابشن لوحدها - انت بس بتختار الحساب",
    app: "media",
    appName: "مكتبة الصور",
    color: "#0ea5e9",
    group: "data",
    kind: "action",
    fields: [
      {
        key: "images",
        label: "الصور",
        type: "textarea",
        placeholder: "@{تيشيرت أبيض}\n@{بنطلون جينز}",
        help: "اكتب @ واختار كل صورة (كل صورة في سطر). أكتر من صورة = كاروسيل بنفس الكابشن",
      },
      { key: "caption", label: "الكابشن", type: "textarea", placeholder: "اكتب كلام البوست هنا", help: "نفس الكابشن لكل الصور" },
      { key: "video", label: "فيديو بدل الصور (اختياري)", type: "text", placeholder: "@{فيديو المنتج}", help: "اكتب @ واختار فيديو - لو حطيته هينزل ريل" },
    ],
    sampleOutput: {
      list: "https://your-domain/media/9f1c2d34-...\nhttps://your-domain/media/7b2e1a88-...",
      urls: ["https://your-domain/media/9f1c2d34-...", "https://your-domain/media/7b2e1a88-..."],
      count: 2,
      caption: "مجموعة الشنط الجديدة وصلت ✨",
      video: "",
      url: "https://your-domain/media/9f1c2d34-...",
    },
    async run({ params }) {
      const urls = urlList(params.images);
      const video = String(params.video ?? "").trim();
      if (!urls.length && !video) throw new Error("حط صورة واحدة على الأقل - اكتب @ واختار من مكتبة الصور، أو حط فيديو");
      return {
        output: {
          list: urls.join("\n"),
          urls,
          count: urls.length,
          url: urls[0] ?? "",
          video,
          caption: String(params.caption ?? ""),
        },
      };
    },
  },
  {
    type: "media.pick",
    name: "صورة من المكتبة",
    description: "بياخد صورة من مكتبة الصور (مثلاً صور منتجاتك) بالترتيب أو عشوائي، عشان تنشرها أو تعدّلها بالـ AI",
    app: "media",
    appName: "مكتبة الصور",
    color: "#0ea5e9",
    group: "data",
    kind: "action",
    fields: [
      { key: "folder", label: "الفولدر", type: "text", default: "منتجات", required: true, help: "نفس اسم الفولدر اللي رفعت فيه الصور" },
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
  description: "بيعمل فيديو قصير (ريلز / إعلان) من وصف نصي أو من صورة منتجك، ويحفظه برابط جاهز للنشر. بياخد من دقيقة لـ 4 دقايق",
  app: "ai",
  appName: "الذكاء الاصطناعي",
  color: "#7c3aed",
  group: "ai",
  kind: "action",
  credentialTypes: ["geminiApi", "openaiApi"],
  timeoutMs: 285_000,
  fields: [
    whenField,
    { key: "model", label: "الموديل", type: "model", modelKind: "video", help: "Gemini: موديلات Veo - OpenAI: موديلات Sora. سيبه فاضي للافتراضي" },
    { key: "prompt", label: "وصف الفيديو", type: "textarea", required: true, placeholder: "لقطة سينمائية لزجاجة عطر بتلف ببطء، إضاءة ذهبية" },
    {
      key: "referenceImage",
      label: "صورة المنتج (اختياري)",
      type: "text",
      placeholder: "اكتب @ واختار صورة من مكتبتك",
      help: "الفيديو هيتعمل من صورة منتجك - اكتب @ واختارها. مدعومة مع Gemini Veo",
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
    const reference = urlList(params.referenceImage)[0] ?? "";
    const model = String(params.model ?? "").trim();
    let video: Buffer;
    let note: string | undefined;

    if (credential?.type === "geminiApi") {
      video = await geminiVideo(credential.data.apiKey, model || "veo-3.1-fast-generate-preview", prompt, aspect, Math.min(seconds, 8), reference, signal);
    } else if (credential?.type === "openaiApi") {
      if (reference) note = "Sora مش بياخد صورة المنتج هنا - الفيديو اتعمل من الوصف بس. استخدم Gemini Veo لو عايز الفيديو من صورة المنتج";
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
