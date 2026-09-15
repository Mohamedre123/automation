import { useEffect, useRef, useState } from "react";
import { AppIcon, Toggle, copyText, useToast } from "../components/ui";
import { useMeta } from "../context";
import { Icon } from "../icons";
import type { FieldDef } from "../types";
import { useEditor } from "./FlowNode";
import { pathSegment } from "./graph";

const SYSTEM_VARS = ["$now", "$today", "$timestamp", "$workflow.name", "$execution.id"];

// Inside Arabic (RTL) text the bidi algorithm reorders "{{1.body.name}}" visually. Each expression is
// wrapped in invisible LTR isolates for display only; they are stripped before the value is stored.
const ISOLATES = /[⁦-⁩]/g;
const cleanText = (text: string) => text.replace(ISOLATES, "");
const displayText = (text: string) => cleanText(text).replace(/\{\{[\s\S]*?\}\}/g, (m) => `⁦${m}⁩`);

const OPERATORS = [
  ["equals", "يساوي"],
  ["not_equals", "لا يساوي"],
  ["contains", "يحتوي على"],
  ["not_contains", "لا يحتوي على"],
  ["starts_with", "يبدأ بـ"],
  ["ends_with", "ينتهي بـ"],
  ["gt", "أكبر من"],
  ["gte", "أكبر من أو يساوي"],
  ["lt", "أصغر من"],
  ["lte", "أصغر من أو يساوي"],
  ["is_empty", "فاضي"],
  ["not_empty", "مش فاضي"],
  ["regex", "يطابق Regex"],
];

function preview(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return "{…}";
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function TreeRow({
  path,
  label,
  value,
  depth,
  onPick,
}: {
  path: string;
  label: string;
  value: unknown;
  depth: number;
  onPick: (token: string) => void;
}) {
  const expandable = value !== null && typeof value === "object" && Object.keys(value as object).length > 0;
  const [open, setOpen] = useState(depth < 1);
  return (
    <div>
      <button
        type="button"
        className="tree-item"
        style={{ paddingLeft: 6 + depth * 14 }}
        title={`{{${path}}}`}
        onClick={() => onPick(`{{${path}}}`)}
      >
        <span
          style={{ width: 12, color: "var(--text-3)" }}
          onClick={(e) => {
            if (!expandable) return;
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {expandable ? (open ? "▾" : "▸") : ""}
        </span>
        <span className="tk">{label}</span>
        <span className="tv">{preview(value)}</span>
      </button>
      {expandable && open && <TreeRows base={path} value={value} depth={depth + 1} onPick={onPick} />}
    </div>
  );
}

function TreeRows({ base, value, depth, onPick }: { base: string; value: unknown; depth: number; onPick: (token: string) => void }) {
  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.slice(0, 20).map((v, i) => [i, v])
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  return (
    <>
      {entries.map(([key, child]) => (
        <TreeRow key={String(key)} path={base + pathSegment(key)} label={String(key)} value={child} depth={depth} onPick={onPick} />
      ))}
    </>
  );
}

function VariablePicker({ nodeId, onPick }: { nodeId: string; onPick: (token: string) => void }) {
  const { variableSources } = useEditor();
  const sources = variableSources(nodeId);
  return (
    <div className="picker" onMouseDown={(e) => e.preventDefault()}>
      {sources.length === 0 && (
        <div className="faint" style={{ padding: 8 }}>
          مفيش خطوات قبل الخطوة دي - وصّلها بخطوة سابقة الأول.
        </div>
      )}
      {sources.map((source) => (
        <div className="picker-group" key={source.id}>
          <div className="picker-group-head">
            <AppIcon app={source.app} size={22} />
            {source.name}
            <span className="fnode-id">{source.id}</span>
            {source.isSample && (
              <span className="badge" style={{ fontSize: 11 }} title="شغّل السيناريو مرة عشان تظهر البيانات الحقيقية">
                بيانات مثال
              </span>
            )}
          </div>
          {source.data && typeof source.data === "object" ? (
            <TreeRows base={source.id} value={source.data} depth={0} onPick={onPick} />
          ) : (
            <button type="button" className="tree-item" onClick={() => onPick(`{{${source.id}}}`)}>
              <span className="tk">{source.id}</span>
              <span className="tv">{preview(source.data)}</span>
            </button>
          )}
        </div>
      ))}
      <div className="picker-group">
        <div className="picker-group-head">⚙ متغيرات النظام</div>
        {SYSTEM_VARS.map((v) => (
          <button key={v} type="button" className="tree-item" onClick={() => onPick(`{{${v}}}`)}>
            <span className="tk">{v}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExprInput({
  value,
  onChange,
  nodeId,
  multiline,
  mono,
  rows,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  nodeId: string;
  multiline?: boolean;
  mono?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const shown = displayText(value ?? "");

  const insert = (token: string) => {
    const el = multiline ? areaRef.current : inputRef.current;
    const start = el?.selectionStart ?? shown.length;
    const end = el?.selectionEnd ?? start;
    const before = cleanText(shown.slice(0, start)) + token;
    onChange(before + cleanText(shown.slice(end)));
    requestAnimationFrame(() => {
      if (!el) return;
      const caret = displayText(before).length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const className = `${multiline ? "textarea" : "input"} ${mono ? "mono" : ""}`;
  return (
    <div className="expr-wrap" ref={wrapRef}>
      <button type="button" className="expr-btn" title="إدراج بيانات من خطوة سابقة" onClick={() => setOpen(!open)}>
        <Icon name="braces" size={14} />
      </button>
      {multiline ? (
        <textarea
          ref={areaRef}
          className={className}
          rows={rows ?? 4}
          dir={mono ? undefined : "auto"}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => onChange(cleanText(e.target.value))}
        />
      ) : (
        <input
          ref={inputRef}
          className={className}
          dir={mono ? undefined : "auto"}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => onChange(cleanText(e.target.value))}
        />
      )}
      {open && <VariablePicker nodeId={nodeId} onPick={insert} />}
    </div>
  );
}

type Row = Record<string, any>;

function KeyValueInput({ value, onChange, nodeId }: { value: unknown; onChange: (v: Row[]) => void; nodeId: string }) {
  const rows: Row[] = Array.isArray(value) ? value : [];
  const update = (i: number, patch: Row) => onChange(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  return (
    <div>
      {rows.map((row, i) => (
        <div className="kv-row" key={i}>
          <input
            className="input mono"
            placeholder="المفتاح"
            value={row.key ?? ""}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <ExprInput value={String(row.value ?? "")} onChange={(v) => update(i, { value: v })} nodeId={nodeId} placeholder="القيمة" />
          <button type="button" className="btn ghost icon" title="حذف" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        <Icon name="plus" size={14} /> إضافة
      </button>
    </div>
  );
}

function ConditionsInput({ value, onChange, nodeId }: { value: unknown; onChange: (v: Row[]) => void; nodeId: string }) {
  const rows: Row[] = Array.isArray(value) ? value : [];
  const update = (i: number, patch: Row) => onChange(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  return (
    <div>
      {rows.map((row, i) => (
        <div className="cond-row" key={i}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="faint" style={{ fontSize: 12 }}>
              شرط {i + 1}
            </span>
            <button type="button" className="btn ghost icon sm" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          <ExprInput value={String(row.left ?? "")} onChange={(v) => update(i, { left: v })} nodeId={nodeId} placeholder="القيمة (مثلاً {{1.message.text}})" />
          <select className="select" value={row.op ?? "equals"} onChange={(e) => update(i, { op: e.target.value })}>
            {OPERATORS.map(([op, label]) => (
              <option key={op} value={op}>
                {label}
              </option>
            ))}
          </select>
          {!["is_empty", "not_empty"].includes(row.op) && (
            <ExprInput value={String(row.right ?? "")} onChange={(v) => update(i, { right: v })} nodeId={nodeId} placeholder="القيمة المقارنة" />
          )}
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => onChange([...rows, { left: "", op: "equals", right: "" }])}>
        <Icon name="plus" size={14} /> إضافة شرط
      </button>
    </div>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  nodeId,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  nodeId: string;
}) {
  const { meta } = useMeta();
  const toast = useToast();
  const text = value === undefined || value === null ? "" : String(value);

  switch (field.type) {
    case "readonly": {
      const url = `${meta.publicUrl}/webhook/${text}`;
      return (
        <div className="copy-box">
          <input className="input mono" readOnly value={text ? url : "احفظ السيناريو عشان يتعمل الرابط"} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn icon"
            title="نسخ"
            onClick={async () => {
              if (await copyText(url)) toast("الرابط اتنسخ", "success");
            }}
          >
            <Icon name="copy" size={16} />
          </button>
        </div>
      );
    }
    case "select":
      return (
        <select className="select" value={text} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return <Toggle on={Boolean(value)} onChange={onChange} />;
    case "number":
      return (
        <ExprInput
          mono
          value={text}
          nodeId={nodeId}
          placeholder={field.placeholder}
          onChange={(v) => onChange(/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v)}
        />
      );
    case "textarea":
      return <ExprInput multiline value={text} onChange={onChange} nodeId={nodeId} placeholder={field.placeholder} />;
    case "json":
      return (
        <ExprInput
          multiline
          mono
          rows={5}
          value={typeof value === "string" || value === undefined ? text : JSON.stringify(value, null, 2)}
          onChange={onChange}
          nodeId={nodeId}
          placeholder={field.placeholder}
        />
      );
    case "keyvalue":
      return <KeyValueInput value={value} onChange={onChange} nodeId={nodeId} />;
    case "conditions":
      return <ConditionsInput value={value} onChange={onChange} nodeId={nodeId} />;
    default:
      return <ExprInput value={text} onChange={onChange} nodeId={nodeId} placeholder={field.placeholder} />;
  }
}
