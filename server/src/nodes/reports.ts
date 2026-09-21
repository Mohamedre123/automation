import { config } from "../config.js";
import type { NodeDefinition } from "../engine/types.js";
import { buildDocx, DOCX_MIME, type DocBlock, type Run } from "./docx.js";
import { storeFile } from "./media.js";

/*
 * Two steps that turn a scenario into something a person can hand to somebody else:
 *
 *  - "بيانات المشروع": the one place a customer describes their business, so every AI step
 *    after it knows who it is working for without anybody repeating themselves.
 *  - "تقرير احترافي": what an AI step wrote, read once into a document model and then written
 *    out twice - a page with the platform's own look, and a real Word file. Both say the same
 *    thing because both come from the same parse.
 */

const esc = (text: unknown) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* ---------------------------------------------------------------- *
 * Reading the Markdown an AI writes
 * ---------------------------------------------------------------- */

/** A line, split into the pieces that are bold, linked, or plain. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<]+)|`([^`]+)`/g;
  let at = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    if (match[1] !== undefined) runs.push({ text: match[1], bold: true });
    else if (match[2] !== undefined) runs.push({ text: match[2], link: match[3] });
    else if (match[4] !== undefined) runs.push({ text: match[4], link: match[4] });
    else if (match[5] !== undefined) runs.push({ text: match[5] });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs.filter((run) => run.text !== "");
}

/** The small amount of Markdown an AI actually writes in a report. */
export function parseReport(markdown: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: Run[][] } | null = null;
  let table: string[][] | null = null;

  const closeList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const closeTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    blocks.push({ kind: "table", head: head.map(parseInline), rows: rows.map((row) => row.map(parseInline)) });
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (/^\|.*\|$/.test(line)) {
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      // The |---|---| row under a header is a separator, not data.
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      closeList();
      (table ??= []).push(cells);
      continue;
    }
    closeTable();

    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      blocks.push({ kind: "heading", level: Math.min(heading[1].length, 3) as 1 | 2 | 3, runs: parseInline(heading[2]) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeList();
      blocks.push({ kind: "rule" });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) closeList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]));
      continue;
    }
    closeList();
    blocks.push({ kind: "paragraph", runs: parseInline(line) });
  }
  closeList();
  closeTable();
  return blocks;
}

/* ---------------------------------------------------------------- *
 * The page
 * ---------------------------------------------------------------- */

const runsHtml = (runs: Run[]) =>
  runs
    .map((run) => {
      const text = esc(run.text);
      if (run.link) return `<a href="${esc(run.link)}" target="_blank" rel="noreferrer">${text}</a>`;
      return run.bold ? `<strong>${text}</strong>` : text;
    })
    .join("");

export function blocksToHtml(blocks: DocBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "heading":
          return `<h${block.level + 1}>${runsHtml(block.runs)}</h${block.level + 1}>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          return `<${tag}>${block.items.map((item) => `<li>${runsHtml(item)}</li>`).join("")}</${tag}>`;
        }
        case "table":
          return (
            `<div class="scroll"><table><thead><tr>${block.head.map((c) => `<th>${runsHtml(c)}</th>`).join("")}</tr></thead>` +
            `<tbody>${block.rows.map((row) => `<tr>${row.map((c) => `<td>${runsHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
          );
        case "rule":
          return "<hr>";
        default:
          return `<p>${runsHtml(block.runs)}</p>`;
      }
    })
    .join("\n");
}

const PAGE = (
  title: string,
  subtitle: string,
  date: string,
  highlights: [string, string][],
  body: string,
  footer: string,
  wordUrl: string,
) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#221a13; --soft:#6b5947; --line:#ece0d3; --accent:#ea580c; --bg:#f6f1ea; --panel:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:"Readex Pro",Tahoma,"Segoe UI",Arial,sans-serif; font-size:15.5px; line-height:1.95;
    padding-bottom:90px; }
  .sheet { max-width:840px; margin:26px auto; background:var(--panel); border-radius:20px; overflow:hidden;
    box-shadow:0 20px 60px -32px rgba(80,40,10,.5); }
  .cover { background:var(--accent); color:#fff; padding:32px 40px; }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  .brand img { width:34px; height:34px; border-radius:9px; background:rgba(255,255,255,.16); }
  .brand span { font-weight:700; font-size:19px; }
  .cover h1 { margin:0 0 6px; font-size:29px; font-weight:700; line-height:1.4; }
  .cover p { margin:0; font-size:15.5px; opacity:.93; }
  .meta { padding:13px 40px; border-bottom:1px solid var(--line); color:var(--soft); font-size:13.5px;
    display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .highlights { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px;
    background:var(--line); border-bottom:1px solid var(--line); }
  .highlights div { background:var(--panel); padding:16px 20px; }
  .highlights small { display:block; color:var(--soft); font-size:12.5px; margin-bottom:5px; }
  .highlights strong { font-size:18px; font-weight:700; }
  main { padding:10px 40px 36px; }
  h2 { font-size:22px; font-weight:700; margin:32px 0 12px; padding-bottom:9px; border-bottom:2px solid var(--accent); }
  h3 { font-size:18px; font-weight:600; margin:24px 0 8px; color:var(--accent); }
  h4 { font-size:16px; font-weight:600; margin:18px 0 6px; }
  p { margin:0 0 13px; }
  ul, ol { margin:0 0 16px; padding-inline-start:24px; }
  li { margin-bottom:7px; }
  li::marker { color:var(--accent); }
  hr { border:0; border-top:1px solid var(--line); margin:24px 0; }
  a { color:var(--accent); overflow-wrap:anywhere; }
  .scroll { overflow-x:auto; margin:16px 0 22px; }
  table { width:100%; border-collapse:collapse; font-size:14.5px; }
  /* plaintext picks each cell's direction from its own first letter, so "800 - 2500"
     stays in that order instead of being flipped by the Arabic page around it. */
  th, td { border:1px solid var(--line); padding:10px 13px; text-align:right; vertical-align:top; unicode-bidi:plaintext; }
  th { background:#fbf6f0; font-weight:600; }
  tbody tr:nth-child(even) td { background:#fdfaf7; }
  footer { padding:18px 40px 30px; color:var(--soft); font-size:13px; border-top:1px solid var(--line); }
  .actions { position:fixed; inset-block-end:0; inset-inline:0; z-index:5;
    display:flex; gap:10px; justify-content:center; padding:12px 16px calc(12px + env(safe-area-inset-bottom));
    background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(10px);
    border-top:1px solid var(--line); }
  .actions a, .actions button { font:inherit; font-size:14.5px; font-weight:600; border-radius:11px;
    padding:11px 20px; cursor:pointer; text-decoration:none; border:1px solid var(--line); background:var(--panel); color:var(--ink); }
  .actions .main { background:var(--accent); border-color:var(--accent); color:#fff; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { margin:0; box-shadow:none; border-radius:0; max-width:none; }
    .actions { display:none; }
    .scroll { overflow:visible; }
    h2, h3 { break-after:avoid; }
    table, ul, ol { break-inside:avoid; }
  }
  @media (max-width:700px) {
    body { font-size:15px; }
    .sheet { margin:0; border-radius:0; }
    .cover, .meta, main, footer { padding-inline:20px; }
    .cover { padding-block:26px; }
    .cover h1 { font-size:23px; }
    h2 { font-size:19px; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="cover">
    <div class="brand"><img src="${esc(config.publicUrl)}/logo.png" alt=""><span>تدفّق</span></div>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
  </div>
  <div class="meta"><span>${esc(date)}</span><span>اتعمل تلقائياً</span></div>
  ${
    highlights.length
      ? `<div class="highlights">${highlights.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("")}</div>`
      : ""
  }
  <main>${body}</main>
  ${footer ? `<footer>${esc(footer)}</footer>` : ""}
</div>
<div class="actions">
  ${wordUrl ? `<a class="main" href="${esc(wordUrl)}" download>حمّل ملف Word</a>` : ""}
  <button onclick="window.print()">حفظ PDF / طباعة</button>
</div>
</body>
</html>`;

/** "المبيعات: 1,200" on each line -> the boxes across the top of the report. */
function parseHighlights(text: string): [string, string][] {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.split(/[:：]/))
    .filter((parts) => parts.length >= 2 && parts[0].trim() && parts.slice(1).join(":").trim())
    .slice(0, 6)
    .map((parts) => [parts[0].trim(), parts.slice(1).join(":").trim()] as [string, string]);
}

const arabicDate = () =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(new Date());

export const reportNodes: NodeDefinition[] = [
  {
    type: "core.brief",
    name: "بيانات المشروع",
    description:
      "املاها مرة واحدة: اسم مشروعك وبتبيع إيه ولمين ومين منافسينك. كل خطوة ذكاء اصطناعي بعد كده بتشتغل وهي عارفة مشروعك، من غير ما تعيد الكلام",
    app: "manual",
    appName: "بيانات",
    color: "#64748b",
    group: "data",
    kind: "action",
    fields: [
      { key: "business", label: "اسم المشروع", type: "text", required: true, placeholder: "متجر نور للشنط" },
      { key: "offer", label: "بتبيع إيه بالظبط", type: "textarea", required: true, placeholder: "شنط جلد طبيعي حريمي، من 800 لـ 2500 جنيه" },
      { key: "audience", label: "عملاؤك مين", type: "text", placeholder: "بنات وستات من 22 لـ 40 سنة في القاهرة والإسكندرية" },
      { key: "market", label: "السوق / البلد", type: "text", default: "مصر" },
      { key: "site", label: "موقعك أو صفحتك (اختياري)", type: "text", placeholder: "https://mystore.com أو رابط صفحتك على إنستجرام" },
      {
        key: "competitors",
        label: "منافسينك",
        type: "textarea",
        placeholder: "اسم المنافس - أو رابط موقعه أو صفحته\nمنافس تاني - رابطه",
        help: "كل منافس في سطر. تقدر تكتب الاسم بس، أو الاسم ورابطه - الرابط بيخلي التحليل أدق",
      },
      { key: "goal", label: "اللي يهمك تعرفه", type: "textarea", placeholder: "عايز أعرف أسعارهم وإيه اللي بيميزهم وإزاي أسبقهم" },
      { key: "notes", label: "أي حاجة تانية (اختياري)", type: "textarea", placeholder: "بنشحن لكل المحافظات، وعندنا ضمان سنة" },
    ],
    sampleOutput: {
      business: "متجر نور للشنط",
      offer: "شنط جلد طبيعي حريمي",
      audience: "بنات وستات من 22 لـ 40 سنة",
      market: "مصر",
      site: "https://mystore.com",
      competitors: ["شنط الأصالة", "Bag House"],
      goal: "أعرف أسعارهم وإزاي أسبقهم",
      text: "المشروع: متجر نور للشنط\nبيبيع: شنط جلد طبيعي حريمي\n...",
    },
    async run({ params }) {
      const competitors = String(params.competitors ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const fields: [string, string][] = [
        ["المشروع", String(params.business ?? "")],
        ["بيبيع", String(params.offer ?? "")],
        ["العملاء", String(params.audience ?? "")],
        ["السوق", String(params.market ?? "")],
        ["موقعه / صفحته", String(params.site ?? "")],
        ["المنافسين", competitors.join(" | ")],
        ["اللي يهمه", String(params.goal ?? "")],
        ["ملاحظات", String(params.notes ?? "")],
      ];
      // One ready-made block, so an AI step can take the whole brief with a single value.
      const text = fields
        .filter(([, value]) => value.trim())
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n");
      return {
        output: {
          business: String(params.business ?? ""),
          offer: String(params.offer ?? ""),
          audience: String(params.audience ?? ""),
          market: String(params.market ?? ""),
          site: String(params.site ?? ""),
          competitors,
          competitorsText: competitors.join("\n"),
          count: competitors.length,
          goal: String(params.goal ?? ""),
          notes: String(params.notes ?? ""),
          text,
        },
      };
    },
  },
  {
    type: "report.document",
    name: "تقرير احترافي (Word + صفحة)",
    description:
      "بياخد اللي الذكاء الاصطناعي كتبه ويطلّعه تقرير مصفوف بهوية المنصة: ملف Word حقيقي تفتحه وتحفظه PDF، وصفحة تفتح على أي موبايل - الاتنين بنفس المحتوى",
    app: "manual",
    appName: "تقرير",
    color: "#0f766e",
    group: "data",
    kind: "action",
    fields: [
      { key: "title", label: "عنوان التقرير", type: "text", required: true, placeholder: "تحليل المنافسين - سبتمبر" },
      { key: "subtitle", label: "سطر تحت العنوان", type: "text", placeholder: "متجر نور للشنط · السوق المصري" },
      {
        key: "content",
        label: "محتوى التقرير",
        type: "textarea",
        required: true,
        autoFill: "caption",
        placeholder: "بيتاخد من خطوة الذكاء الاصطناعي اللي قبله",
        help: "بيفهم العناوين (## عنوان) والنقط (- نقطة) والجداول (| عمود | عمود |) والكلام الغامق (**كلمة**)",
      },
      {
        key: "highlights",
        label: "أرقام فوق التقرير (اختياري)",
        type: "textarea",
        placeholder: "عدد المنافسين: 5\nأقل سعر في السوق: 750 جنيه",
        help: "كل سطر «العنوان: القيمة» بيبقى مربع في أول التقرير",
      },
      { key: "footer", label: "سطر في آخر التقرير", type: "text", placeholder: "اتعمل تلقائياً بواسطة تدفّق" },
      { key: "fileName", label: "اسم الملف", type: "text", placeholder: "تحليل المنافسين" },
    ],
    sampleOutput: {
      url: "https://your-domain/media/9f1c2d34-...",
      wordUrl: "https://your-domain/media/7b2e1a88-...",
      id: "9f1c2d34-...",
      title: "تحليل المنافسين - سبتمبر",
      words: 940,
    },
    async run({ params, workflow }) {
      const title = String(params.title ?? "").trim() || "تقرير";
      const subtitle = String(params.subtitle ?? "").trim();
      const content = String(params.content ?? "").trim();
      if (!content) throw new Error("محتوى التقرير فاضي - وصّل الخطوة دي بخطوة ذكاء اصطناعي قبلها، أو اكتب المحتوى بنفسك");
      const footer = String(params.footer ?? "").trim() || "اتعمل تلقائياً بواسطة تدفّق";
      const name = String(params.fileName ?? "").trim() || title;
      const date = arabicDate();
      const blocks = parseReport(content);

      // The Word file first, so the page can offer it as a download.
      const word = await storeFile(workflow.userId, buildDocx({ title, subtitle, date, blocks, footer }), DOCX_MIME, {
        name: `${name}.docx`,
        folder: "تقارير",
        source: "generated",
      });
      const page = await storeFile(
        workflow.userId,
        Buffer.from(PAGE(title, subtitle, date, parseHighlights(params.highlights), blocksToHtml(blocks), footer, word.url), "utf8"),
        "text/html",
        { name, folder: "تقارير", source: "generated" },
      );
      return {
        output: {
          ...page,
          wordUrl: word.url,
          wordId: word.id,
          title,
          date,
          words: content.split(/\s+/).filter(Boolean).length,
        },
      };
    },
  },
];
