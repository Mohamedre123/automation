import Anthropic from "@anthropic-ai/sdk";
import type { CredentialType, NodeDefinition } from "../engine/types.js";
import type { LlmRunOptions, LlmRunResult } from "./llm.js";
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
  models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5-1"],
  defaultModel: "claude-opus-5",
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

/** Claude chat + tool-use loop via the official SDK. */
export async function claudeRun(o: LlmRunOptions): Promise<LlmRunResult> {
  const client = new Anthropic({ apiKey: o.apiKey, maxRetries: 2 });
  const result: LlmRunResult = { text: "", model: o.model, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
  const history = o.history.slice(o.history.findIndex((h) => h.role === "user") >= 0 ? o.history.findIndex((h) => h.role === "user") : o.history.length);
  const messages: Anthropic.MessageParam[] = [...history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: o.prompt }];
  const tools: Anthropic.Tool[] = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  for (let step = 0; step <= o.maxSteps; step++) {
    const request: Anthropic.MessageCreateParamsNonStreaming = { model: o.model, max_tokens: o.maxTokens, messages };
    if (o.system) request.system = o.system;
    if (tools.length) request.tools = tools;

    let response: any;
    try {
      response = FALLBACK_MODELS.has(o.model)
        ? await client.beta.messages.create(
            { ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as any,
            { signal: o.signal },
          )
        : await client.messages.create(request, { signal: o.signal });
    } catch (error) {
      throw describeError(error);
    }
    result.model = response.model;
    result.usage.inputTokens += response.usage?.input_tokens ?? 0;
    result.usage.outputTokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category;
      throw new Error(`Claude رفض الطلب${category ? ` (${category})` : ""}`);
    }
    if (response.stop_reason === "tool_use" || response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter((block: any) => block.type === "tool_use");
      if (!toolUses.length) continue;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses) {
        const output = await callClaudeTool(o, result, block.name, block.input ?? {});
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    result.text = response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text as string)
      .join("\n")
      .trim();
    return result;
  }
  throw new Error("الـ AI Agent عدّى الحد الأقصى لعدد الخطوات من غير ما يوصل لرد نهائي");
}

async function callClaudeTool(o: LlmRunOptions, result: LlmRunResult, name: string, args: Record<string, unknown>) {
  let output: unknown;
  try {
    output = await o.runTool(name, args);
  } catch (error) {
    output = { error: error instanceof Error ? error.message : String(error) };
  }
  result.toolCalls.push({ name, args, result: output });
  return output;
}

export const anthropicNodes: NodeDefinition[] = [
  {
    type: "anthropic.message",
    name: "اسأل Claude",
    description: "خطوة مخصوصة لـ Claude (للمهام اللي محتاجة Claude تحديداً).",
    app: "anthropic",
    appName: "Anthropic Claude",
    color: "#d97757",
    group: "ai",
    kind: "action",
    credentialTypes: ["anthropicApi"],
    fields: [
      { key: "model", label: "الموديل", type: "combo", suggestFromCredential: true, placeholder: "claude-opus-5" },
      { key: "system", label: "تعليمات النظام (System prompt)", type: "textarea", placeholder: "أنت موظف خدمة عملاء لشركة ..." },
      { key: "prompt", label: "البرومبت", type: "textarea", required: true, placeholder: "{{1.message.text}}" },
      { key: "maxTokens", label: "أقصى طول للرد (tokens)", type: "number", default: 16000 },
      { key: "parseJson", label: "حوّل الرد لـ JSON", type: "boolean", default: false, help: "هيظهر في {{N.json}}" },
    ],
    sampleOutput: {
      text: "أهلاً بيك! الأسعار بتبدأ من 500 جنيه.",
      json: null,
      model: "claude-opus-5",
      usage: { inputTokens: 120, outputTokens: 40 },
    },
    async run({ params, credential, signal }) {
      const { extractJson } = await import("./llm.js");
      const prompt = String(params.prompt ?? "");
      if (!prompt.trim()) throw new Error("البرومبت فاضي");
      const out = await claudeRun({
        apiKey: credential?.data.apiKey ?? "",
        model: String(params.model || "").trim() || "claude-opus-5",
        system: String(params.system ?? "").trim() || undefined,
        history: [],
        prompt,
        tools: [],
        runTool: async () => null,
        maxSteps: 1,
        maxTokens: Math.max(1, Math.floor(toNumber(params.maxTokens, 16000))),
        signal,
      });
      return { output: { text: out.text, json: params.parseJson ? extractJson(out.text) : null, model: out.model, usage: out.usage } };
    },
  },
];
