import type { FieldDef } from "./types.js";

/**
 * Mapping between steps, Make-style: {{2.text}}, {{1.message.chat.id}},
 * {{3.items[0].name}}, {{1.body["full name"]}}, plus $now, $today, $timestamp,
 * $workflow.name, $execution.id.
 */
export interface ExpressionScope {
  outputs: Record<string, unknown>;
  vars: Record<string, unknown>;
}

const EXPRESSION = /\{\{\s*([\s\S]+?)\s*\}\}/g;
const WHOLE_EXPRESSION = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/;

export function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  let current = "";
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === ".") {
      if (current) parts.push(current);
      current = "";
      i++;
    } else if (ch === "[") {
      if (current) parts.push(current);
      current = "";
      const end = path.indexOf("]", i);
      if (end === -1) throw new Error(`Invalid path: ${path}`);
      let inner = path.slice(i + 1, end).trim();
      if (/^(["']).*\1$/.test(inner)) inner = inner.slice(1, -1);
      parts.push(/^\d+$/.test(inner) ? Number(inner) : inner);
      i = end + 1;
    } else {
      current += ch;
      i++;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function evaluate(expression: string, scope: ExpressionScope): unknown {
  const parts = parsePath(expression.trim());
  if (parts.length === 0) return undefined;
  const [head, ...rest] = parts;
  let value: unknown = String(head).startsWith("$") ? scope.vars[String(head)] : scope.outputs[String(head)];
  for (const key of rest) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

const toText = (value: unknown) =>
  value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

/** A string that is exactly one expression keeps the raw type (object, number...). */
export function resolveValue(value: unknown, scope: ExpressionScope): unknown {
  if (typeof value === "string") {
    const whole = value.match(WHOLE_EXPRESSION);
    if (whole && !whole[1].includes("}}")) return evaluate(whole[1], scope);
    return value.replace(EXPRESSION, (_, expr: string) => toText(evaluate(expr, scope)));
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, scope)]));
  }
  return value;
}

/**
 * JSON templates: "{{x}}" (quoted) becomes a proper JSON value and inline
 * expressions inside strings are escaped, so user data never breaks the JSON.
 */
export function resolveJsonTemplate(template: unknown, scope: ExpressionScope): unknown {
  if (typeof template !== "string") return resolveValue(template, scope);
  if (!template.trim()) return undefined;
  const text = template
    .replace(/"\s*\{\{\s*([\s\S]+?)\s*\}\}\s*"/g, (_, expr: string) => JSON.stringify(evaluate(expr, scope) ?? null))
    .replace(EXPRESSION, (_, expr: string) => {
      const value = evaluate(expr, scope);
      return typeof value === "string" ? JSON.stringify(value).slice(1, -1) : JSON.stringify(value ?? null);
    });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON غير صالح بعد تعويض المتغيرات: ${text.slice(0, 200)}`);
  }
}

export function resolveParams(
  fields: FieldDef[],
  params: Record<string, unknown>,
  scope: ExpressionScope,
): Record<string, any> {
  const jsonKeys = new Set(fields.filter((f) => f.type === "json").map((f) => f.key));
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    result[key] = jsonKeys.has(key) ? resolveJsonTemplate(value, scope) : resolveValue(value, scope);
  }
  for (const field of fields) {
    if (result[field.key] === undefined && field.default !== undefined) result[field.key] = field.default;
  }
  return result;
}

export function systemVars(workflow: { id: string; name: string }, execution: { id: string; mode: string }) {
  const date = new Date();
  return {
    $now: date.toISOString(),
    $today: date.toISOString().slice(0, 10),
    $timestamp: date.getTime(),
    $workflow: workflow,
    $execution: execution,
  };
}
