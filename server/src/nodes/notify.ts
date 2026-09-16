import type { CredentialValue } from "../engine/types.js";
import { postJson } from "./llm.js";

/** Sends a plain text message through whichever messaging account the customer picked. */
export async function sendNotification(credential: CredentialValue, target: string, text: string, signal: AbortSignal) {
  const to = target.trim();
  if (!to) throw new Error("مفيش مستلم للإشعار");

  switch (credential.type) {
    case "telegramBot": {
      const response = await fetch(`https://api.telegram.org/bot${credential.data.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: to, text: text.slice(0, 4096) }),
        signal,
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!data?.ok) throw new Error(`Telegram: ${data?.description ?? `HTTP ${response.status}`}`);
      return;
    }
    case "wasenderApi":
      await postJson(
        "https://wasenderapi.com/api/send-message",
        { to: to.replace(/[^\d@.a-zA-Z-]/g, ""), text },
        { authorization: `Bearer ${credential.data.apiKey}` },
        signal,
        "WasenderAPI",
      );
      return;
    case "whatsappCloud":
      await postJson(
        `https://graph.facebook.com/v25.0/${credential.data.phoneNumberId}/messages`,
        { messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "text", text: { body: text } },
        { authorization: `Bearer ${credential.data.accessToken}` },
        signal,
        "واتساب",
      );
      return;
    default:
      throw new Error("نوع الحساب ده مينفعش يبعت إشعارات");
  }
}

export const NOTIFY_CREDENTIAL_TYPES = ["telegramBot", "wasenderApi", "whatsappCloud"];
