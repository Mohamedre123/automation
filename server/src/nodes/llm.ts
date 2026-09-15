import type { CredentialType, CredentialValue } from "../engine/types.js";
import { claudeRun } from "./anthropic.js";

/** Provider-neutral chat + tool loop. Each provider keeps its native message format internally. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface LlmRunOptions {
  apiKey: string;
  model: string;
  system?: string;
  history: { role: "user" | "assistant"; text: string }[];
  prompt: string;
  tools: ToolSpec[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxSteps: number;
  maxTokens: number;
  signal: AbortSignal;
}

export interface LlmRunResult {
  text: string;
  model: string;
  toolCalls: { name: string; args: unknown; result: unknown }[];
  usage: { inputTokens: number; outputTokens: number };
}

export async function callTool(options: LlmRunOptions, result: LlmRunResult, name: string, args: Record<string, unknown>) {
  let output: unknown;
  try {
    output = await options.runTool(name, args);
  } catch (error) {
    output = { error: error instanceof Error ? error.message : String(error) };
  }
  result.toolCalls.push({ name, args, result: output });
  return output;
}

export const tooManySteps = () => new Error("الـ AI Agent عدّى الحد الأقصى لعدد الخطوات من غير ما يوصل لرد نهائي");

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal, label: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await response.json().catch(() => null)) as any;
  if (!response.ok) {
    const message: string = data?.error?.message ?? data?.message ?? `HTTP ${response.status}`;
    if (response.status === 401 || /api key not valid|invalid api key|incorrect api key|API_KEY_INVALID/i.test(message)) {
      throw new Error(`${label}: مفتاح الـ API غلط`);
    }
    if (response.status === 429) throw new Error(`${label}: الرصيد خلص أو وصلت للحد المسموح - ${message}`);
    if (response.status === 404) throw new Error(`${label}: الموديل مش موجود أو مش متاح لحسابك - ${message}`);
    throw new Error(`${label}: ${message}`);
  }
  return data;
}

/* ---------- OpenAI (Responses API) ---------- */
async function openaiRun(o: LlmRunOptions): Promise<LlmRunResult> {
  const result: LlmRunResult = { text: "", model: o.model, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
  const input: unknown[] = [...o.history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: o.prompt }];
  const tools = o.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));

  for (let step = 0; step <= o.maxSteps; step++) {
    const body: Record<string, unknown> = { model: o.model, input, max_output_tokens: o.maxTokens };
    if (o.system) body.instructions = o.system;
    if (tools.length) body.tools = tools;
    const data = await postJson("https://api.openai.com/v1/responses", body, { authorization: `Bearer ${o.apiKey}` }, o.signal, "OpenAI");
    result.model = data.model ?? o.model;
    result.usage.inputTokens += data.usage?.input_tokens ?? 0;
    result.usage.outputTokens += data.usage?.output_tokens ?? 0;

    const output: any[] = Array.isArray(data.output) ? data.output : [];
    const calls = output.filter((item) => item.type === "function_call");
    if (!calls.length) {
      result.text = output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((part: any) => part.type === "output_text")
        .map((part: any) => part.text)
        .join("\n")
        .trim();
      return result;
    }
    input.push(...output);
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        /* model sent invalid JSON: run with no args, the tool reports what's missing */
      }
      const output = await callTool(o, result, call.name, args);
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
    }
  }
  throw tooManySteps();
}

/* ---------- Google Gemini (generateContent) ---------- */
async function geminiRun(o: LlmRunOptions): Promise<LlmRunResult> {
  const result: LlmRunResult = { text: "", model: o.model, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
  const contents: any[] = [
    ...o.history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: o.prompt }] },
  ];
  const declarations = o.tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(Object.keys(t.parameters.properties).length ? { parameters: t.parameters } : {}),
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`;

  for (let step = 0; step <= o.maxSteps; step++) {
    const body: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: o.maxTokens } };
    if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
    if (declarations.length) body.tools = [{ functionDeclarations: declarations }];
    const data = await postJson(url, body, { "x-goog-api-key": o.apiKey }, o.signal, "Gemini");
    result.model = data.modelVersion ?? o.model;
    result.usage.inputTokens += data.usageMetadata?.promptTokenCount ?? 0;
    result.usage.outputTokens += data.usageMetadata?.candidatesTokenCount ?? 0;

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
      const reason = data.promptFeedback?.blockReason ?? candidate?.finishReason ?? "بدون سبب";
      throw new Error(`Gemini مرجّعش رد (${reason})`);
    }
    const parts: any[] = candidate.content.parts;
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) {
      result.text = parts
        .filter((part) => typeof part.text === "string" && !part.thought)
        .map((part) => part.text)
        .join("")
        .trim();
      return result;
    }
    // Keep the model turn as returned (it may carry thought signatures the API expects back).
    contents.push(candidate.content);
    const responses = [];
    for (const part of calls) {
      const output = await callTool(o, result, part.functionCall.name, part.functionCall.args ?? {});
      responses.push({
        functionResponse: {
          ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
          name: part.functionCall.name,
          response: { result: output },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }
  throw tooManySteps();
}

/* ---------- credentials ---------- */
export const openaiCredential: CredentialType = {
  key: "openaiApi",
  name: "OpenAI (ChatGPT)",
  app: "openai",
  description: "هات المفتاح من platform.openai.com ← API keys.",
  docsUrl: "https://platform.openai.com/api-keys",
  fields: [{ key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-..." }],
  models: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"],
  defaultModel: "gpt-5.6-luna",
  async test(data) {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${data.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) throw new Error("OpenAI: مفتاح الـ API غلط");
    if (!response.ok) throw new Error(`OpenAI: HTTP ${response.status}`);
    return "المفتاح شغال";
  },
};

export const geminiCredential: CredentialType = {
  key: "geminiApi",
  name: "Google Gemini",
  app: "gemini",
  description: "مجاني للبداية: هات المفتاح من Google AI Studio ← Get API key.",
  docsUrl: "https://aistudio.google.com/apikey",
  fields: [{ key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "AIza..." }],
  models: ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-2.5-pro"],
  defaultModel: "gemini-3.8-flash",
  async test(data) {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": data.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new Error("Gemini: مفتاح الـ API غلط");
    if (!response.ok) throw new Error(`Gemini: HTTP ${response.status}`);
    return "المفتاح شغال";
  },
};

export const AI_CREDENTIAL_TYPES = ["geminiApi", "openaiApi", "anthropicApi"];

const runners: Record<string, (o: LlmRunOptions) => Promise<LlmRunResult>> = {
  openaiApi: openaiRun,
  geminiApi: geminiRun,
  anthropicApi: claudeRun,
};

export const providerLabel: Record<string, string> = { openaiApi: "openai", geminiApi: "gemini", anthropicApi: "anthropic" };

/** Picks the provider from the credential the customer selected. */
export function runModel(
  credential: CredentialValue | undefined,
  credentialTypes: CredentialType[],
  options: Omit<LlmRunOptions, "apiKey" | "model"> & { model?: string },
) {
  if (!credential) throw new Error("اختار حساب AI (Gemini أو OpenAI أو Claude)");
  const runner = runners[credential.type];
  const type = credentialTypes.find((t) => t.key === credential.type);
  if (!runner || !type) throw new Error("نوع الحساب المختار مش حساب ذكاء اصطناعي");
  const model = String(options.model ?? "").trim() || type.defaultModel || "";
  return runner({ ...options, apiKey: credential.data.apiKey, model });
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const start = text.search(/[[{]/);
  const candidate = fenced ? fenced[1] : start >= 0 ? text.slice(start) : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    throw new Error("الـ AI مارجّعش JSON صالح. وضّح في التعليمات إن الرد يكون JSON بس.");
  }
}
