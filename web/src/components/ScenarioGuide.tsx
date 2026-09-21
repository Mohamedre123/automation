import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMeta } from "../context";
import { Icon } from "../icons";
import type { CredentialTypeDef, FieldDef, NodeDefinition, WorkflowGraph, WorkflowNode } from "../types";
import { AppIcon } from "./ui";

/*
 * Every scenario explains itself. The steps below are read off the scenario's own graph, so a
 * template, a scenario the assistant built, and one the customer drew by hand all get the same
 * walkthrough - step by step, in the order the steps run, saying what to fill in each one.
 */

export interface GuideStep {
  nodeId?: string;
  kicker: string;
  title: string;
  app?: string;
  lines: string[];
  fill: { label: string; help?: string }[];
  accounts: string[];
}

/** The steps in the order they run: from the trigger along the connections. */
export function orderedNodes(graph: WorkflowGraph, isTrigger: (node: WorkflowNode) => boolean): WorkflowNode[] {
  const order: WorkflowNode[] = [];
  const queue = graph.nodes.filter(isTrigger).map((n) => n.id);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node) order.push(node);
    for (const e of graph.edges) if (e.source === id) queue.push(e.target);
  }
  for (const node of graph.nodes) if (!seen.has(node.id)) order.push(node);
  return order;
}

const FILL_SKIP = new Set(["readonly", "credential", "boolean"]);

/** Fields worth naming in a guide: the required ones, plus the ones the customer clearly has to write. */
function fieldsToFill(def: NodeDefinition, node: WorkflowNode) {
  // A step with nothing marked required is one the customer fills freely (the pictures and the
  // words, say) - there every box is worth naming, otherwise only the ones that matter.
  const nothingRequired = !def.fields.some((f) => f.required && !FILL_SKIP.has(f.type));
  return def.fields
    .filter((field: FieldDef) => {
      if (nothingRequired) return !FILL_SKIP.has(field.type) && !field.showIf;
      if (FILL_SKIP.has(field.type) || field.showIf) return false;
      // Optional fields only earn a mention when the template left a "write this" note in them,
      // or when they are the images and captions a publishing step is all about.
      const value = node.params?.[field.key];
      const written = typeof value === "string" && /^(اكتب|حدد|سيب|\(اكتب)/.test(value.trim());
      return Boolean(field.required || written || field.autoFill === "image" || field.autoFill === "images" || field.autoFill === "caption");
    })
    .slice(0, 5)
    .map((field) => ({ label: field.label, help: field.help }));
}

const startAdvice = (def: NodeDefinition | undefined, node: WorkflowNode | undefined): GuideStep => {
  const manual = { kicker: "آخر خطوة", title: "شغّله وشوف النتيجة", app: "manual" };
  if (def?.type === "trigger.form") {
    return {
      ...manual,
      lines: [
        "دوس «تشغيل مرة» فوق، وبعدها هيظهر زرار «افتح الفورم» - افتحه واملاه خلال دقيقتين وشوف كل خطوة وهي بتنوّر",
        "عشان يشتغل على طول: فعّل السيناريو من زرار «متوقف / مفعّل» فوق",
        "ابعت رابط الفورم لعملاءك أو حطه في موقعك - كل مرة حد يملاه السيناريو بيشتغل لوحده",
      ],
      fill: [],
      accounts: [],
    };
  }
  if (def?.type === "trigger.schedule") {
    return {
      ...manual,
      lines: [
        "جرّبه الأول بزرار «تشغيل مرة» عشان تشوف النتيجة قبل ما ينزل لحد",
        "بعد ما تطمن، فعّله من زرار «متوقف / مفعّل» - هيشتغل لوحده كل يوم في ميعاده",
        "لو بينشر: ساعة البداية هي وقت التجهيز، وساعة النشر هي وقت نزول البوست",
      ],
      fill: [],
      accounts: [],
    };
  }
  if (def?.type === "trigger.webhook") {
    return {
      ...manual,
      lines: [
        "دوس على خطوة الـ Webhook وانسخ الرابط، وحطه في الموقع أو النظام اللي هيبعت البيانات",
        "دوس «تشغيل مرة» - هيستنى بيانات، وتقدر تبعت بيانات تجربة من نفس الشاشة",
        "فعّل السيناريو - كل ما بيانات توصل هيشتغل لوحده",
      ],
      fill: [],
      accounts: [],
    };
  }
  if (def?.triggerType === "app") {
    return {
      ...manual,
      lines: [
        "فعّل السيناريو من زرار «متوقف / مفعّل» فوق",
        "ابعت رسالة للبوت أو للرقم من موبايلك - هتلاقي الرد وصل",
        "كل تشغيل بيتسجّل في «سجل التشغيل» بكل خطوة وإيه اللي دخلها وطلع منها",
      ],
      fill: [],
      accounts: [],
    };
  }
  if (def?.triggerType === "schedule") {
    return {
      ...manual,
      lines: ["دوس «تشغيل مرة» عشان يجرّب على آخر عنصر موجود", "فعّله - هيشيّك كل كام دقيقة ويشتغل مع كل جديد"],
      fill: [],
      accounts: [],
    };
  }
  return {
    ...manual,
    lines: [
      "دوس «تشغيل مرة» فوق كل ما تحب تشغّله",
      node ? "لو عايزه يشتغل لوحده: غيّر خطوة البداية لـ «جدولة» وحدد الميعاد" : "عايزه يشتغل لوحده؟ ضيف خطوة «جدولة» في الأول",
      "أي خطوة توقع، هتلاقي السبب بالعربي في «سجل التشغيل» وتقدر تعيد التشغيل",
    ],
    fill: [],
    accounts: [],
  };
};

export function buildGuide(
  graph: WorkflowGraph,
  nodeDef: (type: string) => NodeDefinition | undefined,
  credType: (key: string) => CredentialTypeDef | undefined,
): GuideStep[] {
  const nodes = orderedNodes(graph, (node) => nodeDef(node.type)?.kind === "trigger");
  const trigger = nodes.find((node) => nodeDef(node.type)?.kind === "trigger");
  const steps: GuideStep[] = [];

  const accountNames = [
    ...new Set(
      nodes.flatMap((node) => (nodeDef(node.type)?.credentialTypes ?? []).map((key) => credType(key)?.name ?? key).slice(0, 1)),
    ),
  ];
  steps.push({
    kicker: "قبل ما تبدأ",
    title: "السيناريو ده بيعمل إيه",
    app: "manual",
    lines: [
      `فيه ${nodes.length} خطوة، بتشتغل واحدة ورا التانية من فوق لتحت`,
      "دوس على أي خطوة في الرسمة وهتفتح لك إعداداتها على اليمين",
      accountNames.length
        ? `محتاج تربط: ${accountNames.join(" · ")} - وكل واحد فيهم فيه شرح خطوة بخطوة جوه نافذة الربط`
        : "مش محتاج تربط أي حساب في السيناريو ده",
    ],
    fill: [],
    accounts: [],
  });

  nodes.forEach((node, index) => {
    const def = nodeDef(node.type);
    if (!def) return;
    steps.push({
      nodeId: node.id,
      kicker: `خطوة ${index + 1} من ${nodes.length}`,
      title: node.name?.trim() || def.name,
      app: def.app,
      lines: [def.description, ...(def.guide ?? [])].filter(Boolean),
      fill: fieldsToFill(def, node),
      accounts: (def.credentialTypes ?? []).map((key) => credType(key)?.name ?? key),
    });
  });

  steps.push(startAdvice(trigger ? nodeDef(trigger.type) : undefined, trigger));
  return steps;
}

const seenKey = (key: string) => `tadfuq.guide.${key}`;

/** True the first time a scenario is opened (and after the customer asks to see the guide again). */
function useFirstVisit(key: string) {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    if (!key) return;
    try {
      if (!localStorage.getItem(seenKey(key))) setFirst(true);
    } catch {
      /* private mode: just skip the auto-open */
    }
  }, [key]);
  return [first, setFirst] as const;
}

export function ScenarioGuide({
  graph,
  name,
  storageKey,
  onClose,
  onFocusNode,
}: {
  graph: WorkflowGraph;
  name: string;
  storageKey: string;
  onClose: () => void;
  onFocusNode?: (nodeId: string) => void;
}) {
  const { nodeDef, credType } = useMeta();
  const steps = useMemo(() => buildGuide(graph, nodeDef, credType), [graph, nodeDef, credType]);
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];

  useEffect(() => {
    try {
      localStorage.setItem(seenKey(storageKey), "1");
    } catch {
      /* nothing to remember, the guide just opens again next time */
    }
  }, [storageKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  // Rendered on the body: a card with backdrop-filter would otherwise trap a fixed overlay inside it.
  return createPortal(
    <div className="overlay guide-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="guide-pop" role="dialog" aria-modal="true" aria-label="إرشادات السيناريو">
        <header>
          <div>
            <small>إرشادات · {name}</small>
            <strong>{step.title}</strong>
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="إغلاق">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="guide-rail" role="tablist" aria-label="خطوات الشرح">
          {steps.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === index}
              className={i === index ? "on" : i < index ? "past" : ""}
              onClick={() => setIndex(i)}
              title={s.title}
            >
              <span>{i === 0 ? <Icon name="info" size={13} /> : i === steps.length - 1 ? <Icon name="play" size={13} /> : i}</span>
            </button>
          ))}
        </div>

        <div className="guide-body">
          <div className="guide-kicker">
            {step.app && <AppIcon app={step.app} size={26} />}
            <span>{step.kicker}</span>
          </div>
          {step.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}

          {step.accounts.length > 0 && (
            <div className="guide-note">
              <Icon name="key" size={15} />
              <div>
                <strong>محتاجة حساب: {step.accounts.join(" أو ")}</strong>
                <span>دوس «ربط» جنب خانة الحساب جوه الخطوة - هتلاقي الشرح خطوة بخطوة جوه النافذة</span>
              </div>
            </div>
          )}

          {step.fill.length > 0 && (
            <div className="guide-fill">
              <strong>اللي بتكتبه في الخطوة دي</strong>
              <ul>
                {step.fill.map((field) => (
                  <li key={field.label}>
                    <b>{field.label}</b>
                    {field.help && <span>{field.help}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step.nodeId && onFocusNode && (
            <button
              className="btn sm"
              onClick={() => {
                onFocusNode(step.nodeId!);
              }}
            >
              <Icon name="target" size={14} /> ورّيني الخطوة دي
            </button>
          )}
        </div>

        <footer>
          <button className="btn ghost sm" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}>
            <Icon name="arrowRight" size={15} /> السابق
          </button>
          <span className="faint">
            {index + 1} / {steps.length}
          </span>
          {index === steps.length - 1 ? (
            <button className="btn primary sm" onClick={onClose}>
              فهمت، يلا نبدأ
            </button>
          ) : (
            <button className="btn primary sm" onClick={() => setIndex((i) => Math.min(i + 1, steps.length - 1))}>
              التالي <Icon name="arrowLeft" size={15} />
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The button that is always there (the guide never disappears for good) plus the
 * one-time automatic opening the first time a scenario is opened.
 */
export function GuideLauncher({
  graph,
  name,
  storageKey,
  onFocusNode,
  compact,
  /** Opens by itself the first time (scenarios). Lists of cards pass false. */
  autoOpen = true,
}: {
  graph: WorkflowGraph | undefined;
  name: string;
  storageKey: string;
  onFocusNode?: (nodeId: string) => void;
  compact?: boolean;
  autoOpen?: boolean;
}) {
  const [first, setFirst] = useFirstVisit(autoOpen ? storageKey : "");
  const [open, setOpen] = useState(false);
  const shown = open || first;
  if (!graph?.nodes?.length) return null;
  return (
    <>
      <button
        className={`btn ${compact ? "ghost icon sm" : "sm"} guide-btn`}
        title="إرشادات: شرح كل خطوة بالتفصيل"
        onClick={() => setOpen(true)}
      >
        <Icon name="info" size={compact ? 17 : 15} />
        {!compact && " إرشادات"}
      </button>
      {shown && (
        <ScenarioGuide
          graph={graph}
          name={name}
          storageKey={storageKey}
          onFocusNode={onFocusNode}
          onClose={() => {
            setOpen(false);
            setFirst(false);
          }}
        />
      )}
    </>
  );
}
