import type { NodeDefinition } from "../engine/types.js";
import { storeFile } from "./media.js";

/*
 * Two steps that turn a scenario into something a person can hand to somebody else:
 *
 *  - "بيانات المشروع": the one place a customer describes their business, so every AI step
 *    after it knows who it is working for without anybody repeating themselves.
 *  - "تقرير احترافي": the writing an AI step produced, laid out as a real document with a
 *    cover, headings and tables, saved with its own link that opens on any phone and prints
 *    to PDF from the browser.
 */

const esc = (text: unknown) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The small amount of Markdown an AI actually writes in a report. Everything is escaped
 * first and only then given shape, so nothing that arrives in the text can become markup.
 */
export function renderReport(markdown: string): string {
  const lines = esc(markdown).replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let table: string[][] | null = null;

  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const closeTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push(
      `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
        rows.map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
        `</tbody></table>`,
    );
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    // A table row; the |---|---| separator under the header is skipped.
    if (/^\|.*\|$/.test(line)) {
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
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
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeList();
      out.push("<hr>");
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  return out.join("\n");
}

/** Bold, italic and links inside a line - on text that is already escaped. */
function inline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
}

const PAGE = (title: string, subtitle: string, date: string, highlights: [string, string][], body: string, footer: string) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  @import url("https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;500;600;700&display=swap");
  :root { --ink:#221a13; --soft:#6b5947; --line:#ece0d3; --accent:#ea580c; --bg:#f6f1ea; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:"Readex Pro",Tahoma,"Segoe UI",Arial,sans-serif; line-height:1.9; }
  .sheet { max-width:820px; margin:28px auto; background:#fff; border-radius:18px; overflow:hidden;
    box-shadow:0 18px 60px -30px rgba(80,40,10,.45); }
  header { background:var(--accent); color:#fff; padding:34px 38px; }
  header .kicker { font-size:13px; opacity:.85; letter-spacing:.3px; }
  header h1 { margin:6px 0 4px; font-size:28px; line-height:1.35; }
  header p { margin:0; font-size:15px; opacity:.92; }
  .meta { padding:14px 38px; border-bottom:1px solid var(--line); color:var(--soft); font-size:13px;
    display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .highlights { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px;
    background:var(--line); border-bottom:1px solid var(--line); }
  .highlights div { background:#fff; padding:16px 18px; }
  .highlights small { display:block; color:var(--soft); font-size:12.5px; margin-bottom:4px; }
  .highlights strong { font-size:17px; }
  main { padding:8px 38px 38px; }
  h2 { font-size:21px; margin:30px 0 10px; padding-bottom:8px; border-bottom:2px solid var(--accent); }
  h3 { font-size:17px; margin:22px 0 8px; color:var(--accent); }
  h4 { font-size:15px; margin:18px 0 6px; }
  p { margin:0 0 12px; }
  ul, ol { margin:0 0 14px; padding-inline-start:22px; }
  li { margin-bottom:6px; }
  hr { border:0; border-top:1px solid var(--line); margin:22px 0; }
  code { background:#f6f1ea; padding:2px 6px; border-radius:5px; font-size:13px; }
  a { color:var(--accent); }
  table { width:100%; border-collapse:collapse; margin:14px 0 20px; font-size:14.5px; }
  /* plaintext picks each cell's direction from its own first letter, so "800 - 2500"
     stays in that order instead of being flipped by the Arabic page around it. */
  th, td { border:1px solid var(--line); padding:10px 12px; text-align:right; vertical-align:top; unicode-bidi:plaintext; }
  th { background:#fbf6f0; font-weight:600; }
  tbody tr:nth-child(even) td { background:#fdfaf7; }
  footer { padding:18px 38px 30px; color:var(--soft); font-size:13px; border-top:1px solid var(--line); }
  .print { position:fixed; inset-block-start:16px; inset-inline-start:16px; background:var(--accent); color:#fff;
    border:0; border-radius:10px; padding:11px 18px; font:inherit; font-size:14px; font-weight:600; cursor:pointer;
    box-shadow:0 8px 20px -8px rgba(234,88,12,.8); }
  @media print {
    body { background:#fff; }
    .sheet { margin:0; box-shadow:none; border-radius:0; max-width:none; }
    .print { display:none; }
    h2, h3 { break-after:avoid; }
    table, ul, ol { break-inside:avoid; }
  }
  @media (max-width:700px) {
    .sheet { margin:0; border-radius:0; }
    header, .meta, main, footer { padding-inline:20px; }
    header h1 { font-size:23px; }
  }
</style>
</head>
<body>
<button class="print" onclick="window.print()">حفظ PDF / طباعة</button>
<div class="sheet">
  <header>
    <div class="kicker">تقرير من تدفّق</div>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
  </header>
  <div class="meta"><span>${esc(date)}</span><span>اتعمل تلقائياً</span></div>
  ${
    highlights.length
      ? `<div class="highlights">${highlights.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("")}</div>`
      : ""
  }
  <main>${body}</main>
  ${footer ? `<footer>${esc(footer)}</footer>` : ""}
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
    name: "تقرير احترافي (PDF / صفحة)",
    description:
      "بياخد اللي الذكاء الاصطناعي كتبه ويطلّعه تقرير مصفوف بعناوين وجداول وغلاف، وبيديك رابط يفتح على أي موبايل وفيه زرار «حفظ PDF»",
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
      id: "9f1c2d34-...",
      title: "تحليل المنافسين - سبتمبر",
      words: 940,
    },
    async run({ params, workflow }) {
      const title = String(params.title ?? "").trim() || "تقرير";
      const content = String(params.content ?? "").trim();
      if (!content) throw new Error("محتوى التقرير فاضي - وصّل الخطوة دي بخطوة ذكاء اصطناعي قبلها، أو اكتب المحتوى بنفسك");
      const date = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Cairo",
      }).format(new Date());
      const html = PAGE(
        title,
        String(params.subtitle ?? "").trim(),
        date,
        parseHighlights(params.highlights),
        renderReport(content),
        String(params.footer ?? "").trim() || "اتعمل تلقائياً بواسطة تدفّق",
      );
      const stored = await storeFile(workflow.userId, Buffer.from(html, "utf8"), "text/html", {
        name: String(params.fileName ?? "").trim() || title,
        folder: "تقارير",
        source: "generated",
      });
      return { output: { ...stored, title, date, words: content.split(/\s+/).filter(Boolean).length } };
    },
  },
];
