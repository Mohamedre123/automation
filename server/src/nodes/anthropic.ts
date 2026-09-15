import Anthropic from "@anthropic-ai/sdk";
import type { CredentialType, NodeDefinition } from "../engine/types.js";
import { toNumber } from "./util.js";

// Models that support server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);

function describeError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) return new Error("Claude: مفتاح الـ API غلط أو اتلغى");
  if (error instanceof Anthropic.PermissionDeniedError) return new Error("Claude: المفتاح مالوش صلاحية على الموديل ده");
  if (error instanceof Anthropic.NotFoundError) return new Error("Claude: الموديل مش موجود");
  if (error instanceof Anthropic.RateLimitError) return new Error("Claude: وصلت للحد المسموح (Rate limit) - جرّب بعد شوية");
  if (error instanceof Anthropic.BadRequestError) return new Error(`Claude: طلب غير صالح - ${error.message}`);
  if (error instanceof Anthropic.APIError) return new Error(`Claude: خطأ ${error.status ?? ""} - ${error.message}`);
  return error instanceof Error ? error : new Error(String(error));
}

export const anthropicCredential: CredentialType = {
  key: "anthropicApi",
  name: "Anthropic (Claude)",
  app: "anthropic",
  description: "هات المفتاح من console.anthropic.com ← API Keys.",
  docsUrl: "https://console.anthropic.com/settings/keys",
  fields: [{ key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-ant-..." }],
  async test(data) {
    const client = new Anthropic({ apiKey: data.apiKey, maxRetries: 0, timeout: 15_000 });
    try {
      await client.models.list({ limit: 1 });
    } catch (error) {
      throw describeError(error);
    }
    return "المفتاح شغال";
  },
};

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(Math.min(...["{", "["].map((c) => (text.indexOf(c) + 1 || Infinity) - 1)));
  try {
    return JSON.parse(candidate.trim());
  } catch {
    throw new Error("Claude مارجّعش JSON صالح. وضّح في البرومبت إن الرد يكون JSON بس.");
  }
}

export const anthropicNodes: NodeDefinition[] = [
  {
    type: "anthropic.message",
    name: "اسأل Claude",
    description: "بيبعت برومبت لـ Claude ويرجّع الرد (كتابة، تلخيص، تصنيف، رد على عملاء...).",
    app: "anthropic",
    appName: "Anthropic Claude",
    color: "#d97757",
    group: "ai",
    kind: "action",
    credentialTypes: ["anthropicApi"],
    fields: [
      {
        key: "model",
        label: "الموديل",
        type: "select",
        default: "claude-opus-5",
        options: [
          { value: "claude-opus-5", label: "Claude Opus 5 (الأذكى - افتراضي)" },
          { value: "claude-sonnet-5", label: "Claude Sonnet 5 (متوازن)" },
          { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (الأسرع والأرخص)" },
          { value: "claude-fable-5-1", label: "Claude Fable 5.1 (للمهام الصعبة جداً)" },
        ],
      },
      { key: "system", label: "تعليمات النظام (System prompt)", type: "textarea", placeholder: "أنت موظف خدمة عملاء لشركة ..." },
      { key: "prompt", label: "البرومبت", type: "textarea", required: true, placeholder: "{{1.message.text}}" },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      {
        key: "effort",
        label: "مستوى التفكير",
        type: "select",
        default: "",
        options: [
          { value: "", label: "افتراضي" },
          { value: "low", label: "منخفض (أسرع وأرخص)" },
          { value: "medium", label: "متوسط" },
          { value: "high", label: "عالي" },
        ],
      },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false, help: "هيظهر في {{N.json}}" },
    ],
    sampleOutput: {
      text: "أهلاً بيك! الأسعار بتبدأ من 500 جنيه.",
      json: null,
      model: "claude-opus-5",
      stopReason: "end_turn",
      usage: { input_tokens: 120, output_tokens: 40 },
    },
    async run({ params, credential, signal }) {
      const prompt = String(params.prompt ?? "");
      if (!prompt.trim()) throw new Error("البرومبت فاضي");
      const model = String(params.model || "claude-opus-5");
      const client = new Anthropic({ apiKey: credential?.data.apiKey, maxRetries: 2 });

      const request: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: Math.max(1, Math.floor(toNumber(params.maxTokens, 16000))),
        messages: [{ role: "user", content: prompt }],
      };
      if (String(params.system ?? "").trim()) request.system = String(params.system);
      if (params.effort && model !== "claude-haiku-4-5") {
        request.output_config = { effort: params.effort };
      }

      let response;
      try {
        response = FALLBACK_MODELS.has(model)
          ? await client.beta.messages.create(
              { ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as any,
              { signal },
            )
          : await client.messages.create(request, { signal });
      } catch (error) {
        throw describeError(error);
      }

      if (response.stop_reason === "refusal") {
        const category = (response as any).stop_details?.category;
        throw new Error(`Claude رفض الطلب${category ? ` (${category})` : ""}`);
      }
      const text = response.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text as string)
        .join("\n")
        .trim();

      return {
        output: {
          text,
          json: params.parseJson ? extractJson(text) : null,
          model: response.model,
          stopReason: response.stop_reason,
          usage: response.usage,
        },
      };
    },
  },
];
