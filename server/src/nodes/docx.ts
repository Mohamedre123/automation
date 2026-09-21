import { deflateRawSync } from "node:zlib";

/*
 * A real Word file, written by hand.
 *
 * A .docx is a ZIP of XML parts, so that is all this is: a small ZIP writer, and the four
 * parts Word needs. Arabic comes out right because Word does the letter shaping itself -
 * we only have to say "this document reads right to left".
 *
 * The same file opens in Word, Google Docs, Pages and WhatsApp's own preview, and every one
 * of them can save it as PDF.
 */

/* ---------------------------------------------------------------- *
 * ZIP
 * ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** MS-DOS date and time, which is what a ZIP entry carries. */
function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(files: { name: string; body: Buffer }[], when = new Date()): Buffer {
  const { time, date } = dosTime(when);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.body);
    const deflated = deflateRawSync(file.body, { level: 9 });
    // Only compress when it actually helps; otherwise store the bytes as they are.
    const compressed = deflated.length < file.body.length;
    const payload = compressed ? deflated : file.body;
    const method = compressed ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(file.body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + payload.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

/* ---------------------------------------------------------------- *
 * The document
 * ---------------------------------------------------------------- */

export interface Run {
  text: string;
  bold?: boolean;
  link?: string;
}

export type DocBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: Run[] }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "list"; ordered: boolean; items: Run[][] }
  | { kind: "table"; head: Run[][]; rows: Run[][][] }
  | { kind: "rule" };

const xml = (text: unknown) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const BRAND = "EA580C";
const INK = "221A13";
const SOFT = "6B5947";
const LINE = "ECE0D3";
/** Word measures in half-points, so 24 = 12pt. */
const SIZES = { h1: 34, h2: 28, h3: 24, body: 22, small: 18 };

function runXml(run: Run, options: { size?: number; color?: string; bold?: boolean } = {}): string {
  const bold = run.bold || options.bold;
  const color = run.link ? BRAND : (options.color ?? INK);
  const props =
    `<w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Segoe UI"/>` +
    (bold ? "<w:b/><w:bCs/>" : "") +
    `<w:color w:val="${color}"/><w:sz w:val="${options.size ?? SIZES.body}"/><w:szCs w:val="${options.size ?? SIZES.body}"/>` +
    (run.link ? "<w:u w:val='single'/>" : "") +
    `<w:rtl/></w:rPr>`;
  // Line breaks inside a run have to be said out loud.
  const text = xml(run.text)
    .split("\n")
    .map((part) => `<w:t xml:space="preserve">${part}</w:t>`)
    .join("<w:br/>");
  return `<w:r>${props}${text}</w:r>`;
}

const paragraphXml = (
  runs: Run[],
  options: { size?: number; color?: string; bold?: boolean; spaceBefore?: number; spaceAfter?: number; border?: boolean; bullet?: string } = {},
) =>
  `<w:p><w:pPr><w:bidi/><w:jc w:val="both"/>` +
  `<w:spacing w:before="${options.spaceBefore ?? 0}" w:after="${options.spaceAfter ?? 120}" w:line="300" w:lineRule="auto"/>` +
  (options.border ? `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="${BRAND}"/></w:pBdr>` : "") +
  (options.bullet ? `<w:ind w:start="360" w:hanging="220"/>` : "") +
  `</w:pPr>` +
  (options.bullet ? runXml({ text: options.bullet, bold: true }, { color: BRAND, size: options.size }) : "") +
  runs.map((run) => runXml(run, options)).join("") +
  `</w:p>`;

function tableXml(head: Run[][], rows: Run[][][]): string {
  const columns = Math.max(head.length, ...rows.map((r) => r.length), 1);
  const width = Math.floor(9000 / columns);
  const cell = (runs: Run[], header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (header ? `<w:shd w:val="clear" w:fill="FBF6F0"/>` : "") +
    `<w:tcBorders>${["top", "start", "bottom", "end"]
      .map((side) => `<w:${side} w:val="single" w:sz="6" w:color="${LINE}"/>`)
      .join("")}</w:tcBorders></w:tcPr>` +
    paragraphXml(runs.length ? runs : [{ text: "" }], { bold: header, size: SIZES.small, spaceAfter: 40 }) +
    `</w:tc>`;
  const row = (cells: Run[][], header: boolean) =>
    `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: columns }, (_, i) => cell(cells[i] ?? [], header)).join("")}</w:tr>`;
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:bidiVisual/>` +
    `<w:tblBorders>${["top", "start", "bottom", "end", "insideH", "insideV"]
      .map((side) => `<w:${side} w:val="single" w:sz="6" w:color="${LINE}"/>`)
      .join("")}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>` +
    row(head, true) +
    rows.map((r) => row(r, false)).join("") +
    `</w:tbl>`
  );
}

function blockXml(block: DocBlock): string {
  switch (block.kind) {
    case "heading":
      return paragraphXml(block.runs, {
        bold: true,
        color: block.level === 1 ? INK : BRAND,
        size: block.level === 1 ? SIZES.h1 : block.level === 2 ? SIZES.h2 : SIZES.h3,
        spaceBefore: block.level === 1 ? 240 : 200,
        spaceAfter: 100,
        border: block.level === 1,
      });
    case "list":
      return block.items.map((item, i) => paragraphXml(item, { bullet: block.ordered ? `${i + 1}.` : "•", spaceAfter: 60 })).join("");
    case "table":
      return tableXml(block.head, block.rows) + paragraphXml([{ text: "" }], { spaceAfter: 120 });
    case "rule":
      return `<w:p><w:pPr><w:bidi/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${LINE}"/></w:pBdr></w:pPr></w:p>`;
    default:
      return paragraphXml(block.runs);
  }
}

/** The cover block at the top: title, subtitle, date. */
function coverXml(title: string, subtitle: string, date: string): string {
  return (
    paragraphXml([{ text: "تقرير من تدفّق" }], { color: BRAND, bold: true, size: SIZES.small, spaceAfter: 60 }) +
    paragraphXml([{ text: title }], { bold: true, size: 40, spaceAfter: 60 }) +
    (subtitle ? paragraphXml([{ text: subtitle }], { color: SOFT, size: SIZES.body, spaceAfter: 40 }) : "") +
    paragraphXml([{ text: date }], { color: SOFT, size: SIZES.small, spaceAfter: 200, border: true })
  );
}

export function buildDocx(options: { title: string; subtitle?: string; date: string; blocks: DocBlock[]; footer?: string }): Buffer {
  const body =
    coverXml(options.title, options.subtitle ?? "", options.date) +
    options.blocks.map(blockXml).join("") +
    (options.footer ? paragraphXml([{ text: options.footer }], { color: SOFT, size: SIZES.small, spaceBefore: 240 }) : "");

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}` +
    `<w:sectPr><w:bidi/><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", body: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", body: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", body: Buffer.from(document, "utf8") },
  ]);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
