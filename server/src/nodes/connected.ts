import type { CredentialType, CredentialValue, NodeDefinition } from "../engine/types.js";
import { oauthAccessToken } from "../oauth.js";
import { apiRequest } from "./api.js";
import { checkEveryField } from "./feeds.js";
import { fileBytes } from "./media.js";
import { parseBody, withTimeout } from "./util.js";

/* =====================================================================
   "Connect with ..." account types (no keys to paste)
   ===================================================================== */
const google = (key: string, name: string, app: string, scopes: string[], steps: string[]): CredentialType => ({
  key,
  name,
  app,
  description: `دوس «ربط» ووافق من حساب جوجل بتاعك - من غير أي مفاتيح.`,
  fields: [],
  oauth: { provider: "google", scopes: ["openid", "email", ...scopes] },
  steps: ["دوس زرار «ربط بحساب Google».", "اختار الحساب ووافق على الصلاحيات.", ...steps],
});

export const connectedCredentials: CredentialType[] = [
  google("gmailOAuth", "Gmail", "gmail", ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"], [
    "لو ظهرتلك رسالة «Google hasn't verified this app» دوس Advanced ثم Continue (ده طبيعي لحد ما صاحب المنصة يوثّق التطبيق عند جوجل).",
  ]),
  google("googleSheetsOAuth", "Google Sheets", "sheets", ["https://www.googleapis.com/auth/spreadsheets"], [
    "كل الشيتات اللي في حسابك هتبقى متاحة - هتحط ID الشيت في الخطوة.",
  ]),
  google("googleDriveOAuth", "Google Drive", "drive", ["https://www.googleapis.com/auth/drive"], [
    "ID الفولدر: افتح الفولدر في Drive وانسخ الجزء اللي بعد /folders/ في الرابط.",
  ]),
  google("googleCalendarOAuth", "Google Calendar", "gcalendar", ["https://www.googleapis.com/auth/calendar.events"], [
    "التقويم الأساسي اسمه primary - أو حط ID أي تقويم تاني من إعداداته.",
  ]),
  google("youtubeOAuth", "YouTube", "youtube", ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"], [
    "اختار القناة اللي هترفع عليها لو عندك أكتر من قناة.",
    "ملحوظة: الفيديوهات المرفوعة من تطبيق مش موثّق عند جوجل بتنزل «خاصة» لحد ما يتوثّق.",
  ]),
  {
    key: "metaOAuth",
    name: "فيسبوك وإنستجرام (ربط تلقائي)",
    app: "facebook",
    description: "دوس «ربط» ووافق - كل صفحاتك وحسابات إنستجرام بيزنس المربوطة بيها هتتضاف لوحدها.",
    fields: [],
    oauth: {
      provider: "meta",
      scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "business_management"],
      creates: ["facebookPage", "instagramBusiness"],
    },
    steps: [
      "اتأكد إن حساب إنستجرام Business ومربوط بصفحة فيسبوك.",
      "دوس «ربط بفيسبوك» وسجّل دخول.",
      "اختار الصفحات وحسابات إنستجرام اللي عايز المنصة تنشر عليها ووافق.",
      "هيتعمل حساب لكل صفحة وكل حساب إنستجرام تلقائياً - وتلاقيهم في خطوات النشر.",
    ],
  },
  {
    key: "tiktokOAuth",
    name: "TikTok",
    app: "tiktok",
    description: "دوس «ربط» ووافق من حساب تيك توك بتاعك.",
    fields: [],
    oauth: { provider: "tiktok", scopes: ["user.info.basic", "video.upload", "video.publish"] },
    steps: [
      "دوس «ربط بـ TikTok» وسجّل دخول ووافق.",
      "ملحوظة: لحد ما تيك توك يراجع تطبيق المنصة، الفيديوهات بتنزل «خاصة» (Only me) وتقدر تخليها عامة من التطبيق.",
    ],
  },
  {
    key: "linkedinOAuth",
    name: "LinkedIn (ربط مباشر)",
    app: "linkedin",
    description: "دوس «ربط» ووافق - من غير توكن يدوي.",
    fields: [],
    oauth: { provider: "linkedin", scopes: ["openid", "profile", "email", "w_member_social"] },
    steps: ["دوس «ربط بـ LinkedIn» ووافق.", "الربط صالح 60 يوم، وبعدها دوس «إعادة الربط»."],
  },
  {
    key: "xOAuth2",
    name: "X (ربط مباشر)",
    app: "x",
    description: "دوس «ربط» ووافق من حساب X - من غير مفاتيح.",
    fields: [],
    oauth: { provider: "x", scopes: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"] },
    steps: ["دوس «ربط بـ X» وسجّل دخول.", "دوس Authorize app."],
  },
];

/* =====================================================================
   Helpers
   ===================================================================== */
const str = (value: unknown) => String(value ?? "").trim();
const googleAuth = async (credential: CredentialValue | undefined, signal: AbortSignal) => ({
  authorization: `Bearer ${await oauthAccessToken(credential, "google", signal)}`,
});
const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`);
const emails = (value: unknown) =>
  str(value)
    .split(/[,;،\s]+/)
    .filter((e) => e.includes("@"));

/** Walks a Gmail message payload for its text and HTML bodies. */
function gmailBodies(part: any, out = { text: "", html: "" }) {
  if (!part) return out;
  const data = part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
  if (part.mimeType === "text/plain" && data && !out.text) out.text = data;
  if (part.mimeType === "text/html" && data && !out.html) out.html = data;
  for (const child of part.parts ?? []) gmailBodies(child, out);
  return out;
}

function simplifyGmail(message: any) {
  const headers = Object.fromEntries((message.payload?.headers ?? []).map((h: any) => [String(h.name).toLowerCase(), h.value]));
  const bodies = gmailBodies(message.payload);
  const from = String(headers.from ?? "");
  return {
    id: message.id,
    threadId: message.threadId,
    from,
    fromEmail: from.match(/<([^>]+)>/)?.[1] ?? from,
    to: headers.to,
    subject: headers.subject ?? "",
    date: headers.date,
    snippet: message.snippet,
    text: (bodies.text || bodies.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 20_000),
    html: bodies.html.slice(0, 50_000),
    labels: message.labelIds ?? [],
  };
}

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

/* =====================================================================
   Nodes
   ===================================================================== */
export const connectedNodes: NodeDefinition[] = [
  /* ---------- Gmail ---------- */
  {
    type: "gmail.send",
    name: "إرسال إيميل من Gmail",
    description: "بيبعت إيميل من حساب Gmail بتاعك (نص أو HTML).",
    app: "gmail",
    appName: "Gmail",
    color: "#ea4335",
    group: "apps",
    kind: "action",
    credentialTypes: ["gmailOAuth"],
    fields: [
      { key: "to", label: "إلى", type: "text", required: true, placeholder: "{{1.data.email}}" },
      { key: "subject", label: "العنوان", type: "text", required: true },
      { key: "body", label: "المحتوى", type: "textarea", required: true },
      {
        key: "format",
        label: "نوع المحتوى",
        type: "select",
        default: "text",
        options: [
          { value: "text", label: "نص" },
          { value: "html", label: "HTML" },
        ],
      },
      { key: "cc", label: "نسخة (CC)", type: "text" },
      { key: "bcc", label: "نسخة مخفية (BCC)", type: "text" },
      { key: "replyTo", label: "الرد يروح على", type: "text" },
    ],
    sampleOutput: { id: "18f2c...", threadId: "18f2c...", labelIds: ["SENT"] },
    async run({ params, credential, signal }) {
      const to = emails(params.to);
      if (!to.length) throw new Error("مفيش إيميل صحيح في «إلى»");
      const html = params.format === "html";
      const lines = [
        `To: ${to.join(", ")}`,
        ...(emails(params.cc).length ? [`Cc: ${emails(params.cc).join(", ")}`] : []),
        ...(emails(params.bcc).length ? [`Bcc: ${emails(params.bcc).join(", ")}`] : []),
        ...(str(params.replyTo) ? [`Reply-To: ${str(params.replyTo)}`] : []),
        `Subject: ${encodeHeader(str(params.subject))}`,
        "MIME-Version: 1.0",
        `Content-Type: ${html ? "text/html" : "text/plain"}; charset=UTF-8`,
        "Content-Transfer-Encoding: base64",
        "",
        (Buffer.from(String(params.body ?? "")).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
      ];
      const res = await apiRequest("Gmail", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        headers: await googleAuth(credential, signal),
        json: { raw: b64url(lines.join("\r\n")) },
        signal,
      });
      return { output: res };
    },
  },
  {
    type: "gmail.trigger",
    name: "إيميل جديد في Gmail",
    description: "بيشتغل مع كل إيميل جديد يطابق البحث (مثلاً من عميل أو بعنوان معين).",
    app: "gmail",
    appName: "Gmail",
    color: "#ea4335",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    credentialTypes: ["gmailOAuth"],
    fields: [
      {
        key: "query",
        label: "البحث",
        type: "text",
        default: "in:inbox",
        help: "نفس بحث Gmail: in:inbox - is:unread - from:client@x.com - subject:طلب",
      },
      checkEveryField,
    ],
    sampleOutput: simplifyGmail({
      id: "18f2c1",
      threadId: "18f2c1",
      snippet: "عايز أعرف الأسعار",
      payload: {
        headers: [
          { name: "From", value: "Ahmed <ahmed@example.com>" },
          { name: "Subject", value: "استفسار" },
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from("عايز أعرف الأسعار").toString("base64url") },
      },
    }),
    async poll({ params, credential, state, signal, testMode }) {
      const headers = await googleAuth(credential, signal);
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("q", str(params.query) || "in:inbox");
      url.searchParams.set("maxResults", testMode ? "1" : "20");
      const list = await apiRequest("Gmail", url, { headers, signal });
      const ids: { id: string }[] = list.messages ?? [];
      const { fresh, state: next } = testMode ? { fresh: ids.slice(0, 1), state } : newOnly(ids, state);
      const items = [];
      for (const { id } of fresh.slice(0, 20)) {
        const message = await apiRequest("Gmail", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers, signal });
        items.push(simplifyGmail(message));
      }
      return { items, state: next };
    },
  },

  /* ---------- Google Drive ---------- */
  {
    type: "drive.upload",
    name: "رفع ملف على Google Drive",
    description: "بيرفع صورة أو فيديو أو أي ملف من رابط لفولدر في Drive، ويقدر يعمله رابط عام.",
    app: "drive",
    appName: "Google Drive",
    color: "#1a73e8",
    group: "apps",
    kind: "action",
    credentialTypes: ["googleDriveOAuth"],
    fields: [
      { key: "fileUrl", label: "رابط الملف", type: "text", required: true, placeholder: "{{3.url}}" },
      { key: "name", label: "اسم الملف", type: "text", placeholder: "صورة المنتج.png" },
      { key: "folderId", label: "ID الفولدر (اختياري)", type: "text" },
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
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink", {
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
    credentialTypes: ["googleDriveOAuth"],
    fields: [{ key: "folderId", label: "ID الفولدر", type: "text", required: true }, checkEveryField],
    sampleOutput: { id: "1AbC...", name: "منتج جديد.jpg", mimeType: "image/jpeg", createdTime: "2026-09-16T10:00:00Z", webViewLink: "https://drive.google.com/..." },
    async poll({ params, credential, state, signal, testMode }) {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${str(params.folderId).replace(/'/g, "\\'")}' in parents and trashed = false`);
      url.searchParams.set("orderBy", "createdTime desc");
      url.searchParams.set("pageSize", "30");
      url.searchParams.set("fields", "files(id,name,mimeType,createdTime,size,webViewLink,webContentLink)");
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
    credentialTypes: ["googleCalendarOAuth"],
    fields: [
      { key: "calendarId", label: "التقويم", type: "text", default: "primary" },
      { key: "title", label: "العنوان", type: "text", required: true },
      { key: "start", label: "البداية", type: "text", required: true, placeholder: "2026-10-01 15:00" },
      { key: "durationMinutes", label: "المدة بالدقايق", type: "number", default: 30 },
      { key: "timezone", label: "المنطقة الزمنية", type: "text", default: "Africa/Cairo" },
      { key: "description", label: "الوصف", type: "textarea" },
      { key: "location", label: "المكان", type: "text" },
      { key: "attendees", label: "إيميلات الحضور", type: "text", placeholder: "client@example.com" },
      { key: "meet", label: "ضيف لينك Google Meet", type: "boolean", default: false },
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
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(str(params.calendarId) || "primary")}/events`);
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
    credentialTypes: ["googleCalendarOAuth"],
    fields: [
      { key: "calendarId", label: "التقويم", type: "text", default: "primary" },
      { key: "minutesBefore", label: "قبل الميعاد بكام دقيقة", type: "number", default: 60 },
      { key: "minutes", label: "يشيّك كل كام دقيقة", type: "number", default: 10 },
    ],
    sampleOutput: { id: "abc123", title: "مكالمة مع أحمد", start: "2026-09-16T15:00:00+03:00", attendees: ["ahmed@example.com"], description: "" },
    async poll({ params, credential, state, signal, testMode }) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(str(params.calendarId) || "primary")}/events`);
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

  /* ---------- YouTube ---------- */
  {
    type: "youtube.upload",
    name: "رفع فيديو على YouTube",
    description: "بيرفع فيديو (أو Short) على قناتك بعنوان ووصف وتاجات.",
    app: "youtube",
    appName: "YouTube",
    color: "#ff0000",
    group: "apps",
    kind: "action",
    credentialTypes: ["youtubeOAuth"],
    timeoutMs: 280_000,
    fields: [
      { key: "videoUrl", label: "رابط الفيديو", type: "text", required: true, placeholder: "{{4.url}}" },
      { key: "title", label: "العنوان", type: "text", required: true },
      { key: "description", label: "الوصف", type: "textarea" },
      { key: "tags", label: "التاجات", type: "text", placeholder: "عطور، عروض" },
      {
        key: "privacy",
        label: "الظهور",
        type: "select",
        default: "public",
        options: [
          { value: "public", label: "عام" },
          { value: "unlisted", label: "بالرابط بس" },
          { value: "private", label: "خاص" },
        ],
      },
      { key: "short", label: "ده YouTube Short (فيديو طولي قصير)", type: "boolean", default: true },
    ],
    sampleOutput: { id: "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ", privacy: "public" },
    async run({ params, credential, signal }) {
      const headers = await googleAuth(credential, signal);
      const video = await fileBytes(str(params.videoUrl), signal);
      let title = str(params.title).slice(0, 100);
      if (params.short && !/#shorts/i.test(title)) title = `${title.slice(0, 91)} #Shorts`;
      const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(video.bytes.length),
          "x-upload-content-type": video.mimeType.startsWith("video/") ? video.mimeType : "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title,
            description: str(params.description).slice(0, 5000),
            tags: str(params.tags).split(/[,،]/).map((t) => t.trim()).filter(Boolean),
            categoryId: "22",
          },
          status: { privacyStatus: str(params.privacy) || "public", selfDeclaredMadeForKids: false },
        }),
        signal,
      });
      const location = start.headers.get("location");
      if (!start.ok || !location) {
        const err: any = parseBody(await start.text(), start.headers.get("content-type"));
        throw new Error(`YouTube: ${err?.error?.message ?? `HTTP ${start.status}`}`);
      }
      const upload = await fetch(location, {
        method: "PUT",
        headers: { "content-type": video.mimeType.startsWith("video/") ? video.mimeType : "video/mp4" },
        body: new Uint8Array(video.bytes),
        signal: withTimeout(signal, 240_000),
      });
      const result: any = parseBody(await upload.text(), upload.headers.get("content-type"));
      if (!upload.ok) throw new Error(`YouTube: رفع الفيديو فشل - ${result?.error?.message ?? `HTTP ${upload.status}`}`);
      return { output: { id: result.id, url: `https://youtu.be/${result.id}`, privacy: result.status?.privacyStatus, title } };
    },
  },

  /* ---------- TikTok ---------- */
  {
    type: "tiktok.postVideo",
    name: "نشر فيديو على TikTok",
    description: "بيرفع الفيديو على حسابك في تيك توك بالكابشن.",
    app: "tiktok",
    appName: "TikTok",
    color: "#1b1f2e",
    group: "apps",
    kind: "action",
    credentialTypes: ["tiktokOAuth"],
    timeoutMs: 280_000,
    fields: [
      { key: "videoUrl", label: "رابط الفيديو", type: "text", required: true, placeholder: "{{4.url}}" },
      { key: "caption", label: "الكابشن", type: "textarea", help: "لحد 2200 حرف بالهاشتاجات." },
      {
        key: "privacy",
        label: "الظهور",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "عام لو مسموح، وإلا خاص" },
          { value: "PUBLIC_TO_EVERYONE", label: "عام" },
          { value: "MUTUAL_FOLLOW_FRIENDS", label: "الأصدقاء" },
          { value: "SELF_ONLY", label: "أنا بس" },
        ],
      },
    ],
    sampleOutput: { publishId: "v_pub_file~v2-1.123", privacy: "PUBLIC_TO_EVERYONE", status: "PROCESSING_UPLOAD" },
    async run({ params, credential, signal }) {
      const token = await oauthAccessToken(credential, "tiktok", signal);
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" };
      const call = async (path: string, body: unknown) => {
        const response = await fetch(`https://open.tiktokapis.com${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
        const data: any = await response.json().catch(() => null);
        if (!response.ok || (data?.error?.code && data.error.code !== "ok")) {
          const code = data?.error?.code ?? `HTTP ${response.status}`;
          if (/unaudited_client_can_only_post_to_private/.test(code)) {
            throw new Error("TikTok: تطبيق المنصة لسه متراجعش - غيّر الظهور لـ «أنا بس» أو خلي حسابك خاص مؤقتاً");
          }
          throw new Error(`TikTok: ${data?.error?.message || code}`);
        }
        return data.data;
      };

      const creator = await call("/v2/post/publish/creator_info/query/", {});
      const options: string[] = creator?.privacy_level_options ?? ["SELF_ONLY"];
      const wanted = str(params.privacy) || "auto";
      const privacy = wanted === "auto" ? (options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0]) : wanted;

      const video = await fileBytes(str(params.videoUrl), signal);
      const size = video.bytes.length;
      // TikTok: one chunk up to 64MB, otherwise 10MB chunks with the remainder in the last one.
      const chunkSize = size <= 64 * 1024 * 1024 ? size : 10 * 1024 * 1024;
      const chunks = Math.max(1, Math.floor(size / chunkSize));
      const init = await call("/v2/post/publish/video/init/", {
        post_info: { title: str(params.caption).slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: chunks },
      });
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = i === chunks - 1 ? size - 1 : start + chunkSize - 1;
        const response = await fetch(init.upload_url, {
          method: "PUT",
          headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${size}` },
          body: new Uint8Array(video.bytes.subarray(start, end + 1)),
          signal: withTimeout(signal, 180_000),
        });
        if (!response.ok) throw new Error(`TikTok: رفع الفيديو فشل (HTTP ${response.status})`);
      }
      const status = await call("/v2/post/publish/status/fetch/", { publish_id: init.publish_id }).catch(() => null);
      return { output: { publishId: init.publish_id, privacy, status: status?.status ?? "PROCESSING_UPLOAD" } };
    },
  },
];
