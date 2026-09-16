import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { AppIcon, Toggle, copyText, useToast } from "../components/ui";
import { useMeta } from "../context";
import { Icon } from "../icons";
import { CredentialModal } from "../pages/Credentials";
import type { Credential, FieldDef } from "../types";
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

// Provider model lists mix chat, image, audio and embedding models: keep the ones a step can use.
const NON_TEXT_MODEL = /image|embedding|tts|audio|transcri|realtime|whisper|dall-e|moderation|computer-use|live|veo|imagen|robotics|aqa/i;

function ModelSelect({
  value,
  onChange,
  credentialId,
  kind,
}: {
  value: string;
  onChange: (value: string) => void;
  credentialId?: string | null;
  kind: "text" | "image" | "video";
}) {
  const [state, setState] = useState<{ models: string[]; defaultModel: string | null; error?: string; loading: boolean }>({
    models: [],
    defaultModel: null,
    loading: false,
  });
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!credentialId) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<{ models: string[]; defaultModel: string | null; error?: string }>(`/credentials/${credentialId}/models`)
      .then((res) => alive && setState({ ...res, loading: false }))
      .catch((e: Error) => alive && setState({ models: [], defaultModel: null, error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [credentialId]);

  if (!credentialId) return <div className="help">اختار الحساب الأول عشان تظهر الموديلات المتاحة فيه.</div>;

  const available = state.models.filter((m) =>
    kind === "image" ? /image/i.test(m) : kind === "video" ? /veo|sora/i.test(m) : !NON_TEXT_MODEL.test(m),
  );
  const options = value && !available.includes(value) ? [value, ...available] : available;

  return (
    <div>
      {custom ? (
        <div className="row">
          <input className="input mono" autoFocus value={value} placeholder="model-id" onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="btn sm" onClick={() => setCustom(false)}>
            القايمة
          </button>
        </div>
      ) : (
        <select
          className="select"
          value={value}
          disabled={state.loading}
          onChange={(e) => (e.target.value === "__custom" ? setCustom(true) : onChange(e.target.value))}
        >
          <option value="">
            {state.loading ? "جاري تحميل الموديلات..." : `الافتراضي${state.defaultModel && kind === "text" ? ` (${state.defaultModel})` : ""}`}
          </option>
          {options.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
          <option value="__custom">✏️ اكتب اسم موديل تاني...</option>
        </select>
      )}
      {state.error && (
        <div className="help" style={{ color: "var(--warning)" }}>
          مقدرتش أجيب القايمة من حسابك ({state.error}) - بعرض الموديلات المقترحة.
        </div>
      )}
      {!state.loading && !state.error && options.length > 0 && (
        <div className="help">{options.length} موديل متاح في حسابك</div>
      )}
    </div>
  );
}

function CredentialSelect({
  value,
  onChange,
  types,
  credentials,
  onCredentialCreated,
}: {
  value: string;
  onChange: (value: string) => void;
  types?: string[];
  credentials: Credential[];
  onCredentialCreated?: (credential: Credential) => void;
}) {
  const { credType } = useMeta();
  const [adding, setAdding] = useState(false);
  const matching = credentials.filter((c) => !types?.length || types.includes(c.type));
  return (
    <>
      <div className="row">
        <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— اختار حساب —</option>
          {matching.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {credType(c.type)?.name ?? c.type}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> ربط
        </button>
      </div>
      {matching.length === 0 && (
        <div className="help">مفيش حساب {types?.map((t) => credType(t)?.name ?? t).join(" أو ")} لسه - دوس «ربط» وهتلاقي الشرح خطوة بخطوة.</div>
      )}
      {adding && (
        <CredentialModal
          types={types}
          onClose={() => setAdding(false)}
          onSaved={(credential) => {
            setAdding(false);
            onCredentialCreated?.(credential);
            onChange(credential.id);
          }}
        />
      )}
    </>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  nodeId,
  models = [],
  credentialId,
  credentials = [],
  onCredentialCreated,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  nodeId: string;
  /** Model suggestions of the selected credential (for combo fields). */
  models?: string[];
  /** The step's selected account (model fields load that account's models). */
  credentialId?: string | null;
  credentials?: Credential[];
  onCredentialCreated?: (credential: Credential) => void;
}) {
  const { meta } = useMeta();
  const toast = useToast();
  const text = value === undefined || value === null ? "" : String(value);

  switch (field.type) {
    case "readonly": {
      const url = `${field.urlKind === "form" ? window.location.origin : meta.publicUrl}/${field.urlKind === "form" ? "form" : "webhook"}/${text}`;
      return (
        <div className="copy-box">
          <input className="input mono" readOnly value={text ? url : "احفظ السيناريو عشان يتعمل الرابط"} onFocus={(e) => e.target.select()} />
          {field.urlKind === "form" && text && (
            <a className="btn icon" href={url} target="_blank" rel="noreferrer" title="افتح الفورم">
              <Icon name="arrowRight" size={16} style={{ transform: "scaleX(-1)" }} />
            </a>
          )}
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
    case "model":
      return <ModelSelect value={text} onChange={onChange} credentialId={credentialId} kind={field.modelKind ?? "text"} />;
    case "credential":
      return (
        <CredentialSelect
          value={text}
          onChange={onChange}
          types={field.credentialTypes}
          credentials={credentials}
          onCredentialCreated={onCredentialCreated}
        />
      );
    case "combo": {
      const listId = `models-${nodeId}-${field.key}`;
      return (
        <>
          <input
            className="input mono"
            list={listId}
            value={text}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <datalist id={listId}>
            {(field.suggestFromCredential ? models : (field.options ?? []).map((o) => o.value)).map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </>
      );
    }
    case "multiselect": {
      const selected: string[] = Array.isArray(value) ? value : [];
      return (
        <div className="picker-list">
          {field.options?.map((option) => (
            <label key={option.value} className="node-option" style={{ cursor: "pointer", padding: "7px 8px", gap: 8 }}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );
    }
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
