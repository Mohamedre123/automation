/**
 * Matching the columns of a sheet / table to the data coming out of the step before it,
 * by name. A column called "التليفون" takes the value of a field called "التليفون",
 * "Phone" takes "phone", and nobody has to say which value goes in which column.
 */

/** Forgiving comparison: case, spaces, underscores, and the Arabic letters people spell both ways. */
export const nameKey = (name: unknown) =>
  String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْ]/g, "");

const SKIP = /^(_|\$)/;

/**
 * Every name a value can be found under, down two levels: a form's { data: { name } }
 * answers to "name" as well as to "data.name". Shallower names win.
 */
export function flatten(value: unknown, depth = 2, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SKIP.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const plain = child === null || typeof child !== "object";
    if (plain || Array.isArray(child)) {
      if (!out.has(nameKey(key))) out.set(nameKey(key), child);
      out.set(nameKey(path), child);
    } else if (depth > 1) {
      flatten(child, depth - 1, path, out);
    }
  }
  return out;
}

/** A value as a sheet / table cell: objects and lists become readable text, never "[object Object]". */
export function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(cell).filter(Boolean).join(", ");
  return JSON.stringify(value);
}

export interface Mapped {
  /** Column name -> the value that goes in it. */
  values: Record<string, string>;
  matched: string[];
  /** Columns that found nothing - said out loud so a silent blank is never a surprise. */
  missing: string[];
  /** Data that matched no column, so nothing is quietly dropped. */
  unused: string[];
}

export function matchByName(columns: string[], record: unknown): Mapped {
  const flat = flatten(record);
  const used = new Set<string>();
  const values: Record<string, string> = {};
  const matched: string[] = [];
  const missing: string[] = [];

  for (const column of columns) {
    const key = nameKey(column);
    if (flat.has(key)) {
      values[column] = cell(flat.get(key));
      used.add(key);
      matched.push(column);
    } else {
      values[column] = "";
      missing.push(column);
    }
  }
  // Only the top-level names count as "unused"; the dotted duplicates would double-report.
  const unused = [...flat.keys()].filter((key) => !used.has(key) && !key.includes(".") && !columns.some((c) => nameKey(c) === key));
  return { values, matched, missing, unused };
}

/** The object a step was handed: already an object, or JSON text, or nothing usable. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export const NO_DATA =
  "مفيش بيانات توصل للأعمدة - وصّل الخطوة دي بخطوة قبلها فيها بيانات، أو غيّر «طريقة الملء» لـ «أنا هحدد كل عمود»";
