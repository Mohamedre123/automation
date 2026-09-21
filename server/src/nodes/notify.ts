import type { CredentialValue } from "../engine/types.js";
import { datastoreRead, datastoreWrite } from "./core.js";
import { sendCustomMessage } from "./custom.js";
import { postJson } from "./llm.js";

/** Bots can't message a private @username: we remember the chat id of everyone who wrote to the bot. */
export const TELEGRAM_CONTACTS_STORE = "جهات_تيليجرام";
const botId = (credential: CredentialValue) => String(credential.data.botToken ?? "").split(":")[0];

export async function rememberTelegramContact(userId: string, credential: CredentialValue | undefined, update: any) {
  if (!credential) return;
  const message = update?.message ?? update?.edited_message ?? update?.callback_query?.message;
  const from = update?.message?.from ?? update?.callback_query?.from ?? update?.edited_message?.from;
  if (!from?.username || message?.chat?.type !== "private") return;
  const key = `${botId(credential)}:${String(from.username).toLowerCase()}`;
  const previous = (await datastoreRead(userId, TELEGRAM_CONTACTS_STORE, key)).value as { chatId?: number } | null;
  if (previous?.chatId === message.chat.id) return;
  await datastoreWrite(userId, TELEGRAM_CONTACTS_STORE, key, {
    chatId: message.chat.id,
    username: from.username,
    name: [from.first_name, from.last_name].filter(Boolean).join(" "),
  });
}

async function resolveTelegramTarget(userId: string, credential: CredentialValue, target: string) {
  // Numeric ids (users, groups "-100...") are used as they are.
  if (/^-?\d+$/.test(target)) return target;
  const username = target.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").toLowerCase();
  const contact = (await datastoreRead(userId, TELEGRAM_CONTACTS_STORE, `${botId(credential)}:${username}`)).value as { chatId?: number } | null;
  // Not a known person: it may still be a public channel (@channel) the bot is admin of.
  return contact?.chatId ? String(contact.chatId) : `@${username}`;
}

/** Sends a plain text message through whichever messaging account the customer picked. */
export async function sendNotification(credential: CredentialValue, target: string, text: string, signal: AbortSignal, userId: string) {
  const to = target.trim();
  if (!to) throw new Error("مفيش مستلم للإشعار - اكتب مين يستلم التحويل في إعدادات الخطوة");

  switch (credential.type) {
    case "telegramBot": {
      const chatId = await resolveTelegramTarget(userId, credential, to);
      const response = await fetch(`https://api.telegram.org/bot${credential.data.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
        signal,
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!data?.ok) {
        if (/chat not found|bot can't initiate|blocked/i.test(data?.description ?? "")) {
          throw new Error(
            `Telegram: البوت مش قادر يبعت لـ ${to}. لازم صاحب الحساب ده يفتح البوت ويبعتله أي رسالة (مثلاً /start) مرة واحدة الأول، وبعدها التحويل هيوصله`,
          );
        }
        throw new Error(`Telegram: ${data?.description ?? `HTTP ${response.status}`}`);
      }
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
      try {
        await postJson(
          `https://graph.facebook.com/v25.0/${credential.data.phoneNumberId}/messages`,
          { messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "text", text: { body: text } },
          { authorization: `Bearer ${credential.data.accessToken}` },
          signal,
          "واتساب",
        );
      } catch (e) {
        throw new Error(
          `${(e as Error).message} - ملحوظة: واتساب الرسمي بيسمح برسائل حرة للرقم ده بس لو بعت رسالة لرقم الشركة خلال آخر 24 ساعة`,
        );
      }
      return;
    case "customApi":
      await sendCustomMessage(credential, to, text, signal);
      return;
    default:
      throw new Error("نوع الحساب ده مينفعش يبعت إشعارات - اختار بوت تيليجرام أو حساب واتساب أو خدمة خارجية");
  }
}

export const NOTIFY_CREDENTIAL_TYPES = ["telegramBot", "wasenderApi", "whatsappCloud", "customApi"];
