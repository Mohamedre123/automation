import Anthropic from "@anthropic-ai/sdk";
import type { CredentialValue } from "../engine/types.js";

/** Live model list from the provider, using the customer's own key. */
export async function listModels(credential: CredentialValue): Promise<string[]> {
  const key = credential.data.apiKey ?? "";
  const signal = AbortSignal.timeout(15_000);

  if (credential.type === "openaiApi") {
    const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal });
    if (response.status === 401) throw new Error("OpenAI: مفتاح الـ API غلط");
    if (!response.ok) throw new Error(`OpenAI: HTTP ${response.status}`);
    const data = (await response.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).sort();
  }

  if (credential.type === "customAiApi") {
    const base = String(credential.data.baseUrl ?? "").trim().replace(/\/+$/, "");
    const response = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal });
    if (response.status === 401 || response.status === 403) throw new Error("المزوّد: المفتاح غلط");
    if (!response.ok) throw new Error(`المزوّد مش بيعرض قايمة موديلات (HTTP ${response.status}) - اكتب اسم الموديل بإيدك`);
    const data = (await response.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).sort();
  }

  if (credential.type === "geminiApi") {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": key },
      signal,
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new Error("Gemini: مفتاح الـ API غلط");
    if (!response.ok) throw new Error(`Gemini: HTTP ${response.status}`);
    const data = (await response.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.some((method) => method === "generateContent" || method === "predictLongRunning"))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort();
  }

  if (credential.type === "anthropicApi") {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 });
    const ids: string[] = [];
    try {
      for await (const model of client.models.list({ limit: 100 })) ids.push(model.id);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new Error("Claude: مفتاح الـ API غلط");
      throw error;
    }
    return ids;
  }

  return [];
}
