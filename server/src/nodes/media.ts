import { config } from "../config.js";
import { newId, now, one, query, run } from "../db.js";
import type { NodeDefinition } from "../engine/types.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import { postJson } from "./llm.js";
import { assertPublicUrl, withTimeout } from "./util.js";

const CURSOR_STORE = "مؤشر_صور_المكتبة";
export const MAX_UPLOAD_BYTES = 2.8 * 1024 * 1024;

export const mediaUrl = (id: string) => `${config.publicUrl}/media/${id}`;

/** Images live in the database and get a public URL, so WhatsApp / Instagram can fetch them. */
export async function storeMedia(
  userId: string,
  base64: string,
  mimeType: string,
  options: { name?: string; folder?: string; source?: "generated" | "upload" } = {},
) {
  const id = newId();
  await run(
    "INSERT INTO media (id, user_id, name, mime_type, data, folder, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, userId, options.name ?? "image", mimeType, base64, options.folder ?? "", options.source ?? "generated", now()],
  );
  return { id, url: mediaUrl(id), mimeType };
}

export const loadMedia = (id: string) =>
  one<{ mime_type: string; data: string }>("SELECT mime_type, data FROM media WHERE id = $1", [id]);

/** Fetches an image as base64, reading our own /media files straight from the database. */
export async function imageAsBase64(url: string, signal: AbortSignal): Promise<{ data: string; mimeType: string }> {
  const own = url.match(/\/media\/([0-9a-f-]{36})(?:[?#]|$)/i);
  if (own) {
    const file = await loadMedia(own[1]);
    if (file) return { data: file.data, mimeType: file.mime_type };
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
    credentialTypes: ["geminiApi", "openaiApi"],
    fields: [
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
      } else {
        throw new Error("توليد الصور متاح مع Gemini أو OpenAI - اختار حساب منهم");
      }

      if (!base64) throw new Error("المزوّد مرجّعش صورة - جرّب وصف تاني أو موديل تاني");
      const stored = await storeMedia(workflow.userId, base64, mimeType, {
        name: prompt.slice(0, 80),
        folder: String(params.folder ?? "مولّدة"),
        source: "generated",
      });
      return { output: { ...stored, prompt, provider: credential.type === "openaiApi" ? "openai" : "gemini" } };
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
      const rows = await query<{ id: string; name: string }>(
        "SELECT id, name FROM media WHERE user_id = $1 AND folder = $2 ORDER BY created_at",
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
      return { output: { id: row.id, url: mediaUrl(row.id), name: row.name, folder, index: index + 1, total: rows.length } };
    },
  },
];
