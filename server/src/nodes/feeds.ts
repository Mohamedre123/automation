import type { FieldDef, NodeDefinition } from "../engine/types.js";
import { assertPublicUrl, withTimeout } from "./util.js";

/** Shared by every "watch for new items" trigger: they run on the scheduler. */
export const checkEveryField: FieldDef = {
  key: "minutes",
  label: "يشيّك كل كام دقيقة",
  type: "number",
  default: 15,
  help: "على Vercel المجاني الفحص بيحصل مع كل نداء من cron-job.org.",
};

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function parseFeed(xml: string) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const tag = (block: string, name: string) => {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    return match ? decode(match[1]) : "";
  };
  return blocks.slice(0, 30).map((block) => {
    const link = tag(block, "link") || block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "";
    const title = stripTags(tag(block, "title"));
    return {
      id: tag(block, "guid") || tag(block, "id") || link || title,
      title,
      link,
      description: stripTags(tag(block, "description") || tag(block, "summary") || tag(block, "content")).slice(0, 1000),
      published: tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"),
      image: block.match(/<(?:media:content|media:thumbnail|enclosure)[^>]*url="([^"]+)"/i)?.[1] ?? null,
    };
  });
}

export const feedNodes: NodeDefinition[] = [
  {
    type: "rss.trigger",
    name: "خبر / مقال جديد (RSS)",
    description: "بيراقب أي موقع أو مدونة فيها RSS، وأول ما ينزل جديد يشغّل السيناريو.",
    app: "rss",
    appName: "RSS",
    color: "#f97316",
    group: "trigger",
    kind: "trigger",
    triggerType: "schedule",
    fields: [{ key: "url", label: "رابط الـ RSS", type: "text", required: true, placeholder: "https://example.com/feed" }, checkEveryField],
    sampleOutput: {
      id: "https://example.com/post-1",
      title: "عنوان المقال",
      link: "https://example.com/post-1",
      description: "ملخص المقال...",
      published: "Wed, 16 Sep 2026 10:00:00 GMT",
      image: null,
    },
    async poll({ params, state, signal, testMode }) {
      const response = await fetch(assertPublicUrl(String(params.url ?? "")), {
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: withTimeout(signal, 20_000),
      });
      if (!response.ok) throw new Error(`RSS: الرابط رجّع HTTP ${response.status}`);
      const items = parseFeed(await response.text());
      if (!items.length) throw new Error("RSS: الرابط مفيهوش أخبار أو مش RSS صحيح");
      if (testMode) return { items: [items[0]], state };

      const seen: string[] = Array.isArray(state?.seen) ? state.seen : [];
      if (!Array.isArray(state?.seen)) return { items: [], state: { seen: items.map((i) => i.id) } }; // baseline on first check
      const fresh = items.filter((item) => !seen.includes(item.id)).reverse();
      return { items: fresh, state: { seen: [...items.map((i) => i.id), ...seen].slice(0, 300) } };
    },
  },
];
