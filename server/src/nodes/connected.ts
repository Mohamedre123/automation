import type { CredentialValue, NodeDefinition } from "../engine/types.js";
import { apiRequest } from "./api.js";
import { checkEveryField } from "./feeds.js";
import { googleToken } from "./google.js";
import { fileBytes } from "./media.js";
import { parseBody, withTimeout } from "./util.js";

/* Google Drive and Calendar through the same Google key (service account) as Sheets. */

/* =====================================================================
   Helpers
   ===================================================================== */
const str = (value: unknown) => String(value ?? "").trim();
const googleAuth = async (credential: CredentialValue | undefined, signal: AbortSignal) => ({
  authorization: `Bearer ${await googleToken(credential, signal)}`,
});
const emails = (value: unknown) =>
  str(value)
    .split(/[,;،\s]+/)
    .filter((e) => e.includes("@"));

/** Parses "2026-10-01 15:00" / ISO into a Calendar dateTime (the time zone is sent separately). */
const calendarTime = (value: string) => {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (match) return `${match[1]}T${match[2].padStart(2, "0")}:${match[3]}:00`;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`الميعاد «${value}» مش مفهوم - اكتبه زي 2026-10-01 15:00`);
  return new Date(parsed).toISOString();
};

/** Remembers which ids a watch trigger already reported (first check only records). */
function newOnly<T extends { id: string }>(items: T[], state: any) {
  const seen: string[] = Array.isArray(state?.seen) ? state.seen : [];
  const fresh = state?.seen ? items.filter((item) => !seen.includes(item.id)) : [];
  return { fresh: fresh.reverse(), state: { seen: [...items.map((i) => i.id), ...seen].slice(0, 200) } };
}

export const connectedNodes: NodeDefinition[] = [
  /* ---------- Google Drive ---------- */
  {
    type: "drive.upload",
    name: "رفع ملف على Google Drive",
    description: "بيرفع صورة أو فيديو أو أي ملف من رابط لفولدر في Drive مشارك مع مفتاح Google، ويقدر يعمله رابط عام.",
    app: "drive",
    appName: "Google Drive",
    color: "#1a73e8",
    group: "apps",
    kind: "action",
    credentialTypes: ["googleServiceAccount"],
    fields: [
      { key: "fileUrl", label: "رابط الملف", type: "text", required: true, placeholder: "{{3.url}}" },
      { key: "name", label: "اسم الملف", type: "text", placeholder: "صورة المنتج.png" },
      {
        key: "folderId",
        label: "ID الفولدر",
        type: "text",
        required: true,
        help: "لازم يكون فولدر جوه Shared Drive (Google Workspace) ومشارك مع إيميل مفتاح Google كـ Content manager - جوجل مش بيسمح لمفاتيح الخدمة تخزّن ملفات في Drive عادي.",
      },
      { key: "share", label: "أي حد معاه الرابط يقدر يشوفه", type: "boolean", default: false },
    ],
    sampleOutput: { id: "1AbC...", name: "صورة.png", webViewLink: "https://drive.google.com/file/d/1AbC.../view" },
    async run({ params, credential, signal }) {
      const headers = await googleAuth(credential, signal);
      const file = await fileBytes(str(params.fileUrl), signal);
      const boundary = `tadfuq${Date.now()}`;
      const metadata = { name: str(params.name) || `file-${Date.now()}`, ...(str(params.folderId) ? { parents: [str(params.folderId)] } : {}) };
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
        file.bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink,webContentLink", {
        method: "POST",
        headers: { ...headers, "content-type": `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(body),
        signal: withTimeout(signal, 120_000),
      });
      const created: any = parseBody(await response.text(), response.headers.get("content-type"));
      if (!response.ok) throw new Error(`Google Drive: ${created?.error?.message ?? `HTTP ${response.status}`}`);
      if (params.share) {
        await apiRequest("Google Drive", `https://www.googleapis.com/drive/v3/files/${created.id}/permissions`, {
          headers,
          json: { role: "reader", type: "anyone" },
          signal,
        });
      }
      return { output: created };
    },
  },
  {
    type: "drive.trigger",
    name: "ملف جديد في فولدر Google Drive",
    description: "بيشتغل لما يتضاف ملف جديد في فولدر معين (مثلاً صور منتجات جديدة).",
    app: "drive",
    appName: "Google Drive",
    color: "#1a73e8",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["googleServiceAccount"],
    fields: [
      { key: "folderId", label: "ID الفولدر", type: "text", required: true, help: "شارك الفولدر مع إيميل مفتاح Google (Viewer كفاية)." },
      checkEveryField,
    ],
    sampleOutput: { id: "1AbC...", name: "منتج جديد.jpg", mimeType: "image/jpeg", createdTime: "2026-09-16T10:00:00Z", webViewLink: "https://drive.google.com/..." },
    async poll({ params, credential, state, signal, testMode }) {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${str(params.folderId).replace(/'/g, "\\'")}' in parents and trashed = false`);
      url.searchParams.set("orderBy", "createdTime desc");
      url.searchParams.set("pageSize", "30");
      url.searchParams.set("fields", "files(id,name,mimeType,createdTime,size,webViewLink,webContentLink)");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      const res = await apiRequest("Google Drive", url, { headers: await googleAuth(credential, signal), signal });
      const files: any[] = res.files ?? [];
      if (testMode) return { items: files.slice(0, 1), state };
      const { fresh, state: next } = newOnly(files, state);
      return { items: fresh, state: next };
    },
  },

  /* ---------- Google Calendar ---------- */
  {
    type: "calendar.createEvent",
    name: "إضافة ميعاد في Google Calendar",
    description: "بيضيف ميعاد (حجز، مكالمة، اجتماع) ويبعت دعوة للحضور.",
    app: "gcalendar",
    appName: "Google Calendar",
    color: "#4285f4",
    group: "apps",
    kind: "action",
    credentialTypes: ["googleServiceAccount"],
    fields: [
      {
        key: "calendarId",
        label: "التقويم (Calendar ID)",
        type: "text",
        required: true,
        placeholder: "you@gmail.com",
        help: "للتقويم الأساسي: إيميلك. شارك التقويم مع إيميل مفتاح Google بصلاحية «Make changes to events».",
      },
      { key: "title", label: "العنوان", type: "text", required: true },
      { key: "start", label: "البداية", type: "text", required: true, placeholder: "2026-10-01 15:00" },
      { key: "durationMinutes", label: "المدة بالدقايق", type: "number", default: 30 },
      { key: "timezone", label: "المنطقة الزمنية", type: "text", default: "Africa/Cairo" },
      { key: "description", label: "الوصف", type: "textarea" },
      { key: "location", label: "المكان", type: "text" },
      { key: "attendees", label: "إيميلات الحضور (Google Workspace بس)", type: "text", placeholder: "client@example.com" },
      { key: "meet", label: "ضيف لينك Google Meet (Google Workspace بس)", type: "boolean", default: false },
    ],
    sampleOutput: { id: "abc123", htmlLink: "https://www.google.com/calendar/event?eid=...", hangoutLink: "https://meet.google.com/xyz" },
    async run({ params, credential, signal }) {
      const timeZone = str(params.timezone) || "Africa/Cairo";
      const start = calendarTime(str(params.start));
      const minutes = Math.max(5, Number(params.durationMinutes) || 30);
      // Local wall-clock end = start + duration (both interpreted in the event's time zone).
      const [date, time] = start.split("T");
      const endLocal = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5) + minutes));
      const end = start.endsWith("Z") ? new Date(Date.parse(start) + minutes * 60_000).toISOString() : endLocal.toISOString().slice(0, 19);
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(str(params.calendarId) || "")}/events`);
      url.searchParams.set("sendUpdates", "all");
      if (params.meet) url.searchParams.set("conferenceDataVersion", "1");
      const event = await apiRequest("Google Calendar", url, {
        headers: await googleAuth(credential, signal),
        json: {
          summary: str(params.title),
          description: str(params.description) || undefined,
          location: str(params.location) || undefined,
          start: { dateTime: start, timeZone },
          end: { dateTime: end, timeZone },
          attendees: emails(params.attendees).map((email) => ({ email })),
          ...(params.meet ? { conferenceData: { createRequest: { requestId: `tadfuq-${Date.now()}` } } } : {}),
        },
        signal,
      });
      return { output: event };
    },
  },
  {
    type: "calendar.upcomingTrigger",
    name: "ميعاد قرّب في Google Calendar",
    description: "بيشتغل قبل كل ميعاد بوقت تحدده - مثلاً تبعت تذكير للعميل على واتساب.",
    app: "gcalendar",
    appName: "Google Calendar",
    color: "#4285f4",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["googleServiceAccount"],
    fields: [
      { key: "calendarId", label: "التقويم (Calendar ID)", type: "text", required: true, placeholder: "you@gmail.com", help: "شارك التقويم مع إيميل مفتاح Google." },
      { key: "minutesBefore", label: "قبل الميعاد بكام دقيقة", type: "number", default: 60 },
      { key: "minutes", label: "يشيّك كل كام دقيقة", type: "number", default: 10 },
    ],
    sampleOutput: { id: "abc123", title: "مكالمة مع أحمد", start: "2026-09-16T15:00:00+03:00", attendees: ["ahmed@example.com"], description: "" },
    async poll({ params, credential, state, signal, testMode }) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(str(params.calendarId) || "")}/events`);
      url.searchParams.set("timeMin", new Date().toISOString());
      url.searchParams.set("timeMax", new Date(Date.now() + Math.max(1, Number(params.minutesBefore) || 60) * 60_000).toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      const res = await apiRequest("Google Calendar", url, { headers: await googleAuth(credential, signal), signal });
      const events = (res.items ?? []).map((e: any) => ({
        id: `${e.id}:${e.start?.dateTime ?? e.start?.date}`,
        eventId: e.id,
        title: e.summary ?? "",
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        description: e.description ?? "",
        location: e.location ?? "",
        attendees: (e.attendees ?? []).map((a: any) => a.email),
        meetLink: e.hangoutLink,
        link: e.htmlLink,
      }));
      if (testMode) return { items: events.slice(0, 1), state };
      // Unlike other watches, the first check reports too: an event starting soon still needs its reminder.
      const seen: string[] = Array.isArray(state?.seen) ? state.seen : [];
      const fresh = events.filter((e: any) => !seen.includes(e.id));
      return { items: fresh, state: { seen: [...fresh.map((e: any) => e.id), ...seen].slice(0, 300) } };
    },
  },

];
