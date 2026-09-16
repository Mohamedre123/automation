import { config } from "../config.js";
import { newId, now, one, run } from "../db.js";
import type { NodeDefinition } from "../engine/types.js";
import { postJson } from "./llm.js";

/** Generated files live in the database and get a public URL, so WhatsApp / Instagram can fetch them. */
export async function storeMedia(userId: string, base64: string, mimeType: string, name = "image") {
  const id = newId();
  await run("INSERT INTO media (id, user_id, name, mime_type, data, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    id,
    userId,
    name,
    mimeType,
    base64,
    now(),
  ]);
  return { id, url: `${config.publicUrl}/media/${id}`, mimeType };
}

export const loadMedia = (id: string) =>
  one<{ mime_type: string; data: string }>("SELECT mime_type, data FROM media WHERE id = $1", [id]);

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
    description: "بيعمل صورة من وصف نصي ويديك رابط جاهز للنشر على أي منصة.",
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
      { key: "size", label: "المقاس", type: "select", default: "1024x1024", options: SIZES },
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
      let base64 = "";
      let mimeType = "image/png";

      if (credential?.type === "openaiApi") {
        const data = await postJson(
          "https://api.openai.com/v1/images/generations",
          { model: model || "gpt-image-2.5-flare", prompt, size, n: 1 },
          { authorization: `Bearer ${credential.data.apiKey}` },
          signal,
          "OpenAI",
        );
        base64 = data?.data?.[0]?.b64_json ?? "";
      } else if (credential?.type === "geminiApi") {
        const data = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-3.1-flash-image")}:generateContent`,
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
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
      const stored = await storeMedia(workflow.userId, base64, mimeType, prompt.slice(0, 80));
      return { output: { ...stored, prompt, provider: credential.type === "openaiApi" ? "openai" : "gemini" } };
    },
  },
];
