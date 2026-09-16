import { decrypt } from "../crypto.js";
import { newId, now, one, parseJson, query, run } from "../db.js";
import type { CredentialValue, FieldDef, NodeContext, NodeDefinition, StepLog } from "../engine/types.js";
import { connectedNodes } from "./connected.js";
import { publishingNodes } from "./publishing.js";
import { socialNodes } from "./social.js";
import { telegramNodes } from "./telegram.js";
import { customRequest, fillTemplate } from "./custom.js";
import { errorMessage } from "./util.js";

// Loaded directly (not via the executor) so this module has no import cycle with the node registry.
async function loadCredential(userId: string, credentialId: string): Promise<CredentialValue | undefined> {
  const row = await one<{ id: string; type: string; data: string }>("SELECT id, type, data FROM credentials WHERE id = $1 AND user_id = $2", [
    credentialId,
    userId,
  ]);
  return row ? { id: row.id, type: row.type, data: decrypt<Record<string, string>>(row.data) } : undefined;
}

/* ---------- when to publish ---------- */
function zoneOffsetMs(utcMs: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Wall-clock time in a time zone -> UTC timestamp. */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/**
 * "" -> now, "19:00" -> today at 19:00 (tomorrow if it already passed), "2026-10-01 19:00" -> that moment,
 * "+2h" / "+30m" -> after a delay. All wall-clock values are in the chosen time zone.
 */
export function parsePublishAt(value: unknown, timeZone: string, from = Date.now()): number {
  const text = String(value ?? "").trim();
  if (!text || /^(الآن|الان|now|دلوقتي|فوراً|فورا)$/i.test(text)) return from;
  const relative = text.match(/^\+?\s*(\d+)\s*(m|min|د|دقيقة|دقايق|h|hour|س|ساعة|ساعات)$/i);
  if (relative) return from + Number(relative[1]) * (/^(h|hour|س|ساعة|ساعات)$/i.test(relative[2]) ? 3_600_000 : 60_000);

  let zone = timeZone || "Africa/Cairo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "Africa/Cairo";
  }
  const time = text.match(/^(\d{1,2}):(\d{2})\s*(ص|م|am|pm)?$/i);
  if (time) {
    let hour = Number(time[1]);
    const meridiem = time[3]?.toLowerCase();
    if ((meridiem === "م" || meridiem === "pm") && hour < 12) hour += 12;
    if ((meridiem === "ص" || meridiem === "am") && hour === 12) hour = 0;
    const today = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date(from))
        .map((p) => [p.type, p.value]),
    );
    let at = zonedToUtc(+today.year, +today.month, +today.day, hour, Number(time[2]), zone);
    if (at < from - 60_000) at += 86_400_000;
    return at;
  }
  const full = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (full && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return zonedToUtc(+full[1], +full[2], +full[3], Number(full[4] ?? 9), Number(full[5] ?? 0), zone);
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`ميعاد النشر «${text}» مش مفهوم - اكتب ساعة زي 19:00 أو تاريخ زي 2026-10-01 19:00 أو سيبه فاضي للنشر فوراً`);
}

/* ---------- platforms ---------- */
interface PlatformDef {
  key: string;
  label: string;
  credentialTypes: string[];
  node: string;
  /** Video-only platforms skip posts without a video. */
  videoOnly?: boolean;
  targetField?: FieldDef;
}

const PLATFORMS: PlatformDef[] = [
  { key: "facebook", label: "فيسبوك", credentialTypes: ["facebookPage"], node: "facebook.post" },
  { key: "instagram", label: "إنستجرام", credentialTypes: ["instagramBusiness"], node: "instagram.post" },
  {
    key: "telegram",
    label: "تيليجرام",
    credentialTypes: ["telegramBot"],
    node: "telegram.sendPhoto",
    targetField: { key: "telegramChatId", label: "تيليجرام: القناة أو الجروب", type: "text", placeholder: "@my_channel", help: "البوت لازم يكون أدمن في القناة." },
  },
  { key: "x", label: "X (تويتر)", credentialTypes: ["xOAuth2", "xOAuth1"], node: "x.post" },
  { key: "youtube", label: "YouTube", credentialTypes: ["youtubeOAuth"], node: "youtube.upload", videoOnly: true },
  { key: "tiktok", label: "TikTok", credentialTypes: ["tiktokOAuth"], node: "tiktok.postVideo", videoOnly: true },
  { key: "linkedin", label: "LinkedIn", credentialTypes: ["linkedinOAuth", "linkedinApi"], node: "linkedin.post" },
  { key: "threads", label: "Threads", credentialTypes: ["threadsApi"], node: "threads.post" },
  { key: "bluesky", label: "Bluesky", credentialTypes: ["blueskyApi"], node: "bluesky.post" },
  {
    key: "pinterest",
    label: "Pinterest",
    credentialTypes: ["pinterestApi"],
    node: "pinterest.createPin",
    targetField: { key: "pinterestBoardId", label: "Pinterest: رقم اللوحة (Board ID)", type: "text" },
  },
  {
    key: "custom",
    label: "خدمة نشر خارجية",
    credentialTypes: ["customApi"],
    node: "custom.request",
    targetField: {
      key: "customPath",
      label: "خدمة نشر خارجية: المسار",
      type: "text",
      placeholder: "/post",
      help: "لو عندك خدمة نشر تانية (Ayrshare، Publer، سيستمك). الـ Body بيتبعت بالشكل اللي تحت.",
    },
  },
];

const nodesByType = new Map([...socialNodes, ...publishingNodes, ...telegramNodes, ...connectedNodes].map((n) => [n.type, n]));

export interface PublishPayload {
  caption: string;
  imageUrl: string;
  videoUrl: string;
  link: string;
  mediaMode: "both" | "video" | "image";
  platforms: { key: string; credentialId: string; target?: string }[];
  customBody?: string;
}

interface PlatformResult {
  platform: string;
  label: string;
  status: "success" | "error";
  posts: unknown[];
  error?: string;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** What each platform receives: some only take images, some limit the text. */
function platformPosts(key: string, p: PublishPayload, target: string) {
  const video = p.mediaMode === "image" ? "" : p.videoUrl;
  const image = p.mediaMode === "video" && video ? "" : p.imageUrl;
  const withLink = p.link ? `${p.caption}\n\n${p.link}` : p.caption;
  const both = (make: (media: { imageUrl?: string; videoUrl?: string }) => Record<string, unknown>) =>
    video && image ? [make({ videoUrl: video }), make({ imageUrl: image })] : [make({ videoUrl: video || undefined, imageUrl: image || undefined })];

  switch (key) {
    case "facebook":
      return both((m) => ({ message: withLink, imageUrl: m.imageUrl ?? "", videoUrl: m.videoUrl ?? "", link: p.link }));
    case "instagram":
      if (!video && !image) throw new Error("إنستجرام محتاج صورة أو فيديو - اتخطّى");
      return both((m) => ({ caption: p.caption, imageUrl: m.imageUrl ?? "", videoUrl: m.videoUrl ?? "" }));
    case "threads":
      return both((m) => ({ text: clip(withLink, 500), imageUrl: m.imageUrl ?? "", videoUrl: m.videoUrl ?? "" }));
    case "telegram": {
      if (!target) throw new Error("اكتب القناة أو الجروب بتاع تيليجرام");
      const posts: Record<string, unknown>[] = [];
      const longCaption = withLink.length > 1024;
      if (longCaption || (!video && !image)) posts.push({ _node: "telegram.sendMessage", chatId: target, text: clip(withLink, 4096) });
      const caption = longCaption ? "" : withLink;
      if (video) posts.push({ _node: "telegram.sendVideo", chatId: target, video, caption: image ? "" : caption });
      if (image) posts.push({ _node: "telegram.sendPhoto", chatId: target, photo: image, caption });
      return posts;
    }
    case "x":
      return [{ text: clip(p.link ? `${p.caption}` : p.caption, p.link ? 280 - 24 : 280) + (p.link ? `\n${p.link}` : ""), imageUrl: image || p.imageUrl }];
    case "linkedin":
      return [{ text: p.caption, link: p.link, linkTitle: p.link ? clip(p.caption.split("\n")[0], 200) : "" }];
    case "bluesky":
      return [{ text: clip(withLink, 300), imageUrl: image || p.imageUrl }];
    case "custom": {
      if (!target) throw new Error("اكتب مسار الخدمة الخارجية");
      return [{ _custom: true, path: target }];
    }
    case "youtube": {
      if (!p.videoUrl) throw new Error("YouTube محتاج فيديو - اتخطّى");
      const firstLine = p.caption.split("\n").find((line) => line.trim()) ?? "فيديو جديد";
      return [{ videoUrl: p.videoUrl, title: clip(firstLine.replace(/#\S+/g, "").trim() || "فيديو جديد", 90), description: withLink, privacy: "public", short: true }];
    }
    case "tiktok":
      if (!p.videoUrl) throw new Error("TikTok محتاج فيديو - اتخطّى");
      return [{ videoUrl: p.videoUrl, caption: clip(p.caption, 2200), privacy: "auto" }];
    case "pinterest": {
      if (!target) throw new Error("اكتب رقم لوحة Pinterest (Board ID)");
      if (!p.imageUrl) throw new Error("Pinterest محتاج صورة - اتخطّى");
      return [{ boardId: target, imageUrl: p.imageUrl, title: clip(p.caption.split("\n")[0], 100), description: clip(p.caption, 800), link: p.link }];
    }
    default:
      throw new Error("منصة غير معروفة");
  }
}

export async function publishToPlatforms(
  userId: string,
  payload: PublishPayload,
  context: Pick<NodeContext, "workflow" | "execution" | "signal">,
): Promise<PlatformResult[]> {
  const results: PlatformResult[] = [];
  for (const selected of payload.platforms) {
    const platform = PLATFORMS.find((p) => p.key === selected.key);
    if (!platform) continue;
    const result: PlatformResult = { platform: platform.key, label: platform.label, status: "success", posts: [] };
    try {
      const credential = await loadCredential(userId, selected.credentialId);
      if (!credential) throw new Error("الحساب المختار اتمسح");
      for (const post of platformPosts(platform.key, payload, String(selected.target ?? "").trim())) {
        if ((post as { _custom?: boolean })._custom) {
          const template =
            payload.customBody?.trim() || '{"text":"[caption]","imageUrl":"[imageUrl]","videoUrl":"[videoUrl]","link":"[link]"}';
          const body = fillTemplate(template, {
            caption: payload.caption,
            imageUrl: payload.imageUrl,
            videoUrl: payload.videoUrl,
            link: payload.link,
          });
          result.posts.push(await customRequest(credential, "POST", String((post as { path: string }).path), body, context.signal));
          continue;
        }
        const { _node, ...params } = post as Record<string, unknown> & { _node?: string };
        const node = nodesByType.get(_node ?? platform.node);
        if (!node?.run) throw new Error("خطوة النشر مش موجودة");
        const out = await node.run({ params, credential, outputs: {}, ...context });
        result.posts.push(out.output);
      }
    } catch (e) {
      // One platform failing never stops the others.
      result.status = "error";
      result.error = errorMessage(e);
    }
    results.push(result);
  }
  return results;
}

const summarize = (results: PlatformResult[]) => ({
  published: results.filter((r) => r.status === "success").map((r) => r.label),
  failed: results.filter((r) => r.status === "error").map((r) => ({ platform: r.label, error: r.error })),
  results,
});

/* ---------- node ---------- */
const credentialFields: FieldDef[] = PLATFORMS.flatMap((platform) => [
  {
    key: `${platform.key}CredentialId`,
    label: `${platform.label}: الحساب`,
    type: "credential" as const,
    credentialTypes: platform.credentialTypes,
  },
  ...(platform.targetField ? [platform.targetField] : []),
]);

export const publishAllNode: NodeDefinition = {
  type: "social.publishAll",
  name: "انشر على كل المنصات",
  description:
    "بينشر النص والصورة و/أو الفيديو على كل منصة ليها حساب مختار - واللي من غير حساب بتتخطى لوحدها. وتقدر تأجّل النشر لساعة معينة.",
  app: "social",
  appName: "النشر على المنصات",
  color: "#ec4899",
  group: "apps",
  kind: "action",
  timeoutMs: 280_000,
  fields: [
    { key: "caption", label: "نص البوست", type: "textarea", required: true, placeholder: "{{3.json.post}}" },
    { key: "imageUrl", label: "رابط الصورة", type: "text", placeholder: "{{4.url}}" },
    { key: "videoUrl", label: "رابط الفيديو", type: "text", placeholder: "{{5.url}}" },
    { key: "link", label: "رابط (منتج / موقع) - اختياري", type: "text" },
    {
      key: "mediaMode",
      label: "لو فيه صورة وفيديو",
      type: "select",
      default: "both",
      options: [
        { value: "both", label: "انشر الاتنين (بوست صورة + بوست فيديو)" },
        { value: "video", label: "الفيديو بس" },
        { value: "image", label: "الصورة بس" },
      ],
    },
    {
      key: "publishAt",
      label: "ميعاد النشر",
      type: "text",
      placeholder: "19:00",
      help: "فاضي = ينشر فوراً. 19:00 = النهاردة الساعة 7 بالليل (أو بكرة لو الساعة عدّت). أو تاريخ: 2026-10-01 19:00 - أو +2h بعد ساعتين.",
    },
    { key: "timezone", label: "المنطقة الزمنية", type: "text", default: "Africa/Cairo" },
    ...credentialFields,
    {
      key: "customBody",
      label: "خدمة نشر خارجية: شكل الـ Body",
      type: "textarea",
      placeholder: '{"post":"[caption]","media":["[imageUrl]"],"platforms":["tiktok"]}',
      help: "[caption] النص، [imageUrl] الصورة، [videoUrl] الفيديو، [link] الرابط. فاضي = شكل افتراضي بالأربع قيم.",
    },
  ],
  sampleOutput: {
    scheduled: true,
    publishAt: "2026-09-16T16:00:00.000Z",
    platforms: ["فيسبوك", "إنستجرام", "X (تويتر)"],
    skipped: ["LinkedIn", "Threads", "Bluesky", "Pinterest", "تيليجرام"],
  },
  async run({ params, workflow, execution, signal }) {
    const caption = String(params.caption ?? "").trim();
    if (!caption) throw new Error("نص البوست فاضي");
    const platforms = PLATFORMS.filter((p) => String(params[`${p.key}CredentialId`] ?? "").trim()).map((p) => ({
      key: p.key,
      credentialId: String(params[`${p.key}CredentialId`]).trim(),
      target: p.targetField ? String(params[p.targetField.key] ?? "").trim() : undefined,
    }));
    const skipped = PLATFORMS.filter((p) => !platforms.some((s) => s.key === p.key)).map((p) => p.label);
    if (!platforms.length) throw new Error("مفيش ولا منصة مختار لها حساب - اختار حساب منصة واحدة على الأقل");

    const payload: PublishPayload = {
      caption,
      imageUrl: String(params.imageUrl ?? "").trim(),
      videoUrl: String(params.videoUrl ?? "").trim(),
      link: String(params.link ?? "").trim(),
      mediaMode: params.mediaMode === "video" || params.mediaMode === "image" ? params.mediaMode : "both",
      platforms,
      customBody: String(params.customBody ?? ""),
    };
    const labels = platforms.map((p) => PLATFORMS.find((d) => d.key === p.key)!.label);
    const at = parsePublishAt(params.publishAt, String(params.timezone || "Africa/Cairo"));

    if (at > Date.now() + 90_000) {
      const id = newId();
      await run(
        "INSERT INTO scheduled_posts (id, user_id, workflow_id, execution_id, run_at, payload, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)",
        [id, workflow.userId, workflow.id, execution.id, new Date(at).toISOString(), JSON.stringify(payload), now()],
      );
      return { output: { scheduled: true, scheduleId: id, publishAt: new Date(at).toISOString(), platforms: labels, skipped } };
    }

    const results = await publishToPlatforms(workflow.userId, payload, { workflow, execution, signal });
    const summary = summarize(results);
    if (!summary.published.length) throw new Error(`النشر فشل على كل المنصات: ${summary.failed.map((f) => `${f.platform}: ${f.error}`).join(" | ")}`);
    return { output: { scheduled: false, ...summary, skipped } };
  },
};

/** Called by the scheduler tick: publishes posts whose time has come and logs them as executions. */
export async function runScheduledPosts(limit = 5) {
  await run("UPDATE scheduled_posts SET status = 'error', result = $1, finished_at = $2 WHERE status = 'running' AND run_at < $3", [
    JSON.stringify({ error: "النشر اتقطع قبل ما يخلص" }),
    now(),
    new Date(Date.now() - 30 * 60_000).toISOString(),
  ]);
  const due = await query("SELECT id FROM scheduled_posts WHERE status = 'pending' AND run_at <= $1 ORDER BY run_at LIMIT $2", [now(), limit]);
  let published = 0;
  for (const { id } of due) {
    const claimed = await query("UPDATE scheduled_posts SET status = 'running' WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
    const row = claimed[0];
    if (!row) continue;
    const payload = parseJson<PublishPayload | null>(row.payload, null);
    const workflowRow = row.workflow_id ? (await query("SELECT id, name FROM workflows WHERE id = $1", [row.workflow_id]))[0] : undefined;
    const executionId = newId();
    const started = Date.now();
    const startedAt = now();
    let results: PlatformResult[] = [];
    let error: string | null = null;
    try {
      if (!payload) throw new Error("بيانات البوست المجدول بايظة");
      results = await publishToPlatforms(row.user_id, payload, {
        workflow: { id: row.workflow_id ?? "", name: workflowRow?.name ?? "", userId: row.user_id },
        execution: { id: executionId, mode: "schedule" },
        signal: AbortSignal.timeout(270_000),
      });
      if (!results.some((r) => r.status === "success")) error = "النشر المجدول فشل على كل المنصات";
    } catch (e) {
      error = errorMessage(e);
    }
    const summary = summarize(results);
    await run("UPDATE scheduled_posts SET status = $1, result = $2, finished_at = $3 WHERE id = $4", [
      error ? "error" : "done",
      JSON.stringify(error ? { error, ...summary } : summary),
      now(),
      id,
    ]);
    if (workflowRow) {
      const steps: StepLog[] = results.map((r) => ({
        nodeId: "publish",
        type: "social.publishAll",
        name: `نشر مجدول على ${r.label}`,
        status: r.status,
        startedAt,
        durationMs: 0,
        output: r.posts,
        error: r.error,
      }));
      await run(
        `INSERT INTO executions (id, workflow_id, user_id, status, mode, started_at, finished_at, duration_ms, error, steps)
         VALUES ($1, $2, $3, $4, 'schedule', $5, $6, $7, $8, $9)`,
        [executionId, row.workflow_id, row.user_id, error ? "error" : "success", startedAt, now(), Date.now() - started, error, JSON.stringify(steps)],
      );
    }
    published++;
  }
  return published;
}
