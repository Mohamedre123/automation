/** The Word file: a valid ZIP, XML Word will open, and Arabic set right to left. */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const base = new URL("../dist/", import.meta.url).href;
const { buildDocx, zip } = await import(base + "nodes/docx.js");
const { parseReport, parseInline, blocksToHtml } = await import(base + "nodes/reports.js");

let pass = 0;
const fail = [];
const check = (ok, what) => (ok ? pass++ : fail.push(what));

/** Read a ZIP back the way any unzip would: walk the central directory. */
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("no end-of-central-directory record");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central header at entry ${i}`);
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    files[name] = method === 8 ? inflateRawSync(raw) : raw;
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const markdown = [
  "## الخلاصة في نص دقيقة",
  "- أسعارك أعلى من السوق",
  "- مفيش منافس بيقدم ضمان",
  "",
  "### الأصالة",
  "فقرة فيها **كلمة غامقة** ولينك https://example.com",
  "",
  "| المنافس | نطاق السعر |",
  "| --- | --- |",
  "| متجرك | 800 - 2500 |",
  "| الأصالة | 600 - 1800 |",
  "",
  "1. خطوة أولى",
  "2. خطوة تانية",
].join("\n");

const blocks = parseReport(markdown);
const buffer = buildDocx({ title: "تحليل المنافسين", subtitle: "السوق المصري", date: "21 سبتمبر 2026", blocks, footer: "من تدفّق" });
// A copy to open in Word by hand, outside the repo.
writeFileSync(join(tmpdir(), "tadfuq-sample.docx"), buffer);

/* It is a ZIP, and it reads back. */
check(buffer.subarray(0, 2).toString() === "PK", "starts with the ZIP signature");
const files = unzip(buffer);
check(Object.keys(files).length === 3, `three parts (got ${Object.keys(files).join(", ")})`);
for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
  check(Boolean(files[name]), `part present: ${name}`);
}

/* The document part is the XML Word expects. */
const doc = files["word/document.xml"].toString("utf8");
check(doc.startsWith("<?xml"), "document.xml has a declaration");
check(doc.includes("<w:document") && doc.includes("</w:document>"), "document element opens and closes");
check((doc.match(/<w:p>/g) ?? []).length === (doc.match(/<\/w:p>/g) ?? []).length, "every paragraph closes");
check((doc.match(/<w:tbl>/g) ?? []).length === (doc.match(/<\/w:tbl>/g) ?? []).length, "every table closes");
check((doc.match(/<w:tc>/g) ?? []).length === (doc.match(/<\/w:tc>/g) ?? []).length, "every cell closes");

/* Arabic reads right to left, everywhere it matters. */
check(doc.includes("<w:sectPr><w:bidi/>"), "the section is right to left");
check((doc.match(/<w:bidi\/>/g) ?? []).length > 5, "paragraphs are right to left");
check(doc.includes("<w:rtl/>"), "runs are right to left");
check(doc.includes("<w:bidiVisual/>"), "the table is right to left");

/* The content actually made it in. */
check(doc.includes("تحليل المنافسين"), "the title is in the file");
check(doc.includes("الخلاصة في نص دقيقة"), "a heading is in the file");
check(doc.includes("مفيش منافس بيقدم ضمان"), "a bullet is in the file");
check(doc.includes("800 - 2500"), "a table cell is in the file");
check(doc.includes("كلمة غامقة") && doc.includes("<w:b/>"), "bold text is bold");
check(doc.includes("example.com"), "the link text is in the file");
check(doc.includes("من تدفّق"), "the footer is in the file");
check(doc.includes("21 سبتمبر 2026"), "the date is in the file");

/* Nothing in the content can break the XML. */
{
  const nasty = buildDocx({
    title: 'عنوان & <script> "خطر"',
    date: "اليوم",
    blocks: parseReport("فقرة فيها < و > و & و \" علامات"),
  });
  const xml = unzip(nasty)["word/document.xml"].toString("utf8");
  check(!/<script/i.test(xml), "no raw tag from the content");
  check(xml.includes("&amp;") && xml.includes("&lt;"), "the characters are escaped");
  check((xml.match(/<w:t /g) ?? []).length > 0, "the text still made it in");
}

/* The parse is shared, so the page and the Word file say the same thing. */
{
  const html = blocksToHtml(blocks);
  check(html.includes("<h3>الخلاصة في نص دقيقة</h3>"), "the page has the same heading");
  check(html.includes("<td>800 - 2500</td>"), "the page has the same table cell");
  check(html.includes("<strong>كلمة غامقة</strong>"), "the page has the same bold text");
  check(html.includes('<a href="https://example.com"'), "the page has the same link");
  check((html.match(/<li>/g) ?? []).length === 4, `the page has the same list items (got ${(html.match(/<li>/g) ?? []).length})`);
}

/* Inline parsing: the pieces come out in order. */
{
  const runs = parseInline("عادي **غامق** وبعده [نص](https://a.b) وآخره https://c.d");
  check(runs.length === 6, `six pieces (got ${runs.length}: ${JSON.stringify(runs)})`);
  check(runs[1].bold === true && runs[1].text === "غامق", "the bold piece");
  check(runs[2].text === " وبعده " && !runs[2].bold, "plain text between");
  check(runs[3].link === "https://a.b" && runs[3].text === "نص", "a written link keeps its words");
  check(runs[5].link === "https://c.d", "a bare link becomes a link");
}

/* An empty report does not produce a broken file. */
{
  const empty = buildDocx({ title: "فاضي", date: "اليوم", blocks: [] });
  const xml = unzip(empty)["word/document.xml"].toString("utf8");
  check(xml.includes("</w:document>"), "an empty report is still a valid document");
}

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log("  FAIL", f);
process.exit(fail.length ? 1 : 0);
