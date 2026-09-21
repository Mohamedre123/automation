import type { FieldDef, NodeDefinition, WorkflowGraph, WorkflowNode } from "./types.js";

/** Earlier steps of a node, nearest first. */
function ancestors(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  const seen = new Set<string>();
  const queue = [nodeId];
  const order: WorkflowNode[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.target !== current || seen.has(edge.source)) continue;
      seen.add(edge.source);
      const node = graph.nodes.find((n) => n.id === edge.source);
      if (node) order.push(node);
      queue.push(edge.source);
    }
  }
  return order;
}

const empty = (value: unknown) => value === undefined || value === null || (typeof value === "string" ? !value.trim() : Array.isArray(value) && !value.length);

/**
 * Content boxes the customer left empty (caption, image, video, product photo) take the matching output
 * of the nearest earlier step that produced one - in every template, assistant-built or hand-made scenario.
 */
export function autoFillFromRun(
  def: NodeDefinition,
  node: WorkflowNode,
  params: Record<string, any>,
  graph: WorkflowGraph,
  outputs: Record<string, unknown>,
): Record<string, any> {
  const fields = def.fields.filter((f): f is FieldDef & { autoFill: NonNullable<FieldDef["autoFill"]> } => Boolean(f.autoFill));
  if (!fields.length || !fields.some((f) => empty(params[f.key]))) return params;

  const earlier = ancestors(graph, node.id).filter((n) => !n.disabled && outputs[n.id] !== undefined);
  const out = (n: WorkflowNode) => (outputs[n.id] ?? {}) as Record<string, any>;
  const url = (n: WorkflowNode | undefined) => {
    const value = n ? out(n).url : undefined;
    return typeof value === "string" && value && !out(n!).skipped ? value : "";
  };

  const caption = () => {
    for (const n of earlier) {
      if (!["ai.generate", "ai.agent", "anthropic.message"].includes(n.type)) continue;
      const result = out(n);
      if (result.json && typeof result.json === "object") {
        for (const key of ["post", "caption", "content", "text"]) {
          if (typeof result.json[key] === "string" && result.json[key].trim()) return result.json[key];
        }
      }
      if (typeof result.text === "string" && result.text.trim()) return result.text;
    }
    // No AI step: the words the customer wrote with the pictures, or typed into the form.
    for (const n of earlier) {
      if (n.type !== "media.gallery") continue;
      const written = out(n).caption;
      if (typeof written === "string" && written.trim()) return written;
    }
    for (const n of earlier) {
      if (n.type !== "media.select") continue;
      const idea = out(n).idea;
      if (typeof idea === "string" && idea.trim()) return idea;
    }
    for (const n of earlier) {
      if (n.type !== "trigger.form") continue;
      const rows = Array.isArray(n.params.formFields) ? (n.params.formFields as { key?: string; value?: string }[]) : [];
      const row = rows.find((r) => /محتوى|كابشن|نص|بوست|caption|content|post/i.test(String(r?.value ?? "")));
      const value = row?.key ? out(n).data?.[row.key] : undefined;
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  };
  const gallery = (key: "list" | "video") => {
    for (const n of earlier) {
      if (n.type !== "media.gallery") continue;
      const value = out(n)[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  };
  const productImage = () => {
    for (const n of earlier) if (["media.select", "media.pick"].includes(n.type) && url(n)) return url(n);
    const form = earlier.find((n) => n.type === "trigger.form");
    if (form) {
      const rows = Array.isArray(form.params.formFields) ? (form.params.formFields as { key?: string; value?: string }[]) : [];
      const row = rows.find((r) => /\((صورة|image)\)/i.test(String(r?.value ?? "")));
      const value = row?.key ? out(form).data?.[row.key] : undefined;
      if (typeof value === "string" && value) return value;
    }
    return "";
  };
  const generated = (type: string) => {
    for (const n of earlier) if (n.type === type && url(n)) return url(n);
    return "";
  };

  const wholeResult = () => {
    for (const n of earlier) {
      const value = outputs[n.id];
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    }
    return "";
  };

  const publishTime = () => {
    const trigger = earlier.find((n) => n.type === "trigger.schedule");
    const at = trigger ? out(trigger).publishAt : undefined;
    // Only a future time schedules the post; otherwise it goes out right away.
    return typeof at === "string" && Date.parse(at) > Date.now() + 90_000 ? at : "";
  };

  const next = { ...params };
  for (const field of fields) {
    if (!empty(next[field.key])) continue;
    const value =
      field.autoFill === "record"
        ? wholeResult()
        : field.autoFill === "publishTime"
        ? publishTime()
        : field.autoFill === "caption"
        ? caption()
        : field.autoFill === "video"
          ? generated("ai.video") || gallery("video")
          : field.autoFill === "sourceImage"
            ? productImage()
            : generated("ai.image") || gallery("list") || productImage();
    if (value) next[field.key] = value;
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Wiring a whole scenario once, before anybody opens it.
 *
 * autoFillFromRun above fixes an empty box while the scenario runs. This does it at the
 * other end: the moment a scenario is created - from a template, from the assistant, or
 * from the editor - every content box that is still empty gets written as {{N.path}} of
 * the nearest earlier step that produces it. So a publishing step arrives already holding
 * the caption and the images, and the only thing left to choose is the account.
 * ------------------------------------------------------------------ */

/** A box counts as unwired when it is empty, or still holds the "write here" note a template left in it. */
const NOTE = /^\s*(اكتب|حدد|سيب|ضع|\(اكتب)/;
const unwired = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" ? !value.trim() || NOTE.test(value) : Array.isArray(value) && !value.length);

const FORM_IMAGE = /\((صورة|صوره|image|photo)\)/i;
const FORM_VIDEO = /\((فيديو|video)\)/i;
const FORM_TEXT = /محتوى|كابشن|نص|بوست|caption|content|post/i;

function formField(node: WorkflowNode, match: RegExp): string {
  const rows = Array.isArray(node.params?.formFields) ? (node.params.formFields as { key?: string; value?: string }[]) : [];
  const row = rows.find((r) => match.test(String(r?.value ?? "")) || match.test(String(r?.key ?? "")));
  return row?.key ? `{{${node.id}.data.${row.key}}}` : "";
}

/** The expression for one kind of content, from the nearest earlier step that has it. */
function wireValue(kind: NonNullable<FieldDef["autoFill"]>, earlier: WorkflowNode[]): string {
  const first = (test: (n: WorkflowNode) => string) => {
    for (const node of earlier) {
      if (node.disabled) continue;
      const value = test(node);
      if (value) return value;
    }
    return "";
  };
  const fromAi = (node: WorkflowNode) => {
    if (!["ai.generate", "ai.agent", "anthropic.message"].includes(node.type)) return "";
    if (node.params?.parseJson) {
      const system = String(node.params.system ?? "");
      for (const key of ["post", "caption", "content", "text"]) if (new RegExp(`"${key}"`).test(system)) return `{{${node.id}.json.${key}}}`;
    }
    return `{{${node.id}.text}}`;
  };
  const fromLibrary = (node: WorkflowNode) => (["media.select", "media.pick"].includes(node.type) ? `{{${node.id}.url}}` : "");

  // The gallery step is where the customer puts the pictures and the words together.
  const fromGallery = (node: WorkflowNode, key: string) =>
    node.type === "media.gallery" && (key !== "caption" || String(node.params?.caption ?? "").trim()) ? `{{${node.id}.${key}}}` : "";

  switch (kind) {
    case "caption":
      return (
        first((n) => fromGallery(n, "caption")) ||
        first(fromAi) ||
        first((n) => (n.type === "media.select" && String(n.params?.ideas ?? "").trim() ? `{{${n.id}.idea}}` : "")) ||
        first((n) => (n.type === "trigger.form" ? formField(n, FORM_TEXT) : ""))
      );
    case "video":
      return (
        first((n) => (n.type === "ai.video" ? `{{${n.id}.url}}` : "")) ||
        first((n) => (n.type === "media.gallery" && String(n.params?.video ?? "").trim() ? `{{${n.id}.video}}` : "")) ||
        first((n) => (n.type === "trigger.form" ? formField(n, FORM_VIDEO) : ""))
      );
    case "sourceImage":
      return first((n) => fromGallery(n, "url")) || first(fromLibrary) || first((n) => (n.type === "trigger.form" ? formField(n, FORM_IMAGE) : ""));
    case "publishTime":
      return first((n) => (n.type === "trigger.schedule" && String(n.params?.publishTime ?? "").trim() ? `{{${n.id}.publishAt}}` : ""));
    case "record":
      // A whole result, so a sheet or a table can match its own columns against it by name.
      return first((n) => `{{${n.id}}}`);
    default:
      // image / images: a whole gallery when there is one, otherwise a single picture
      return (
        first((n) => (n.type === "ai.image" ? `{{${n.id}.url}}` : "")) ||
        first((n) => fromGallery(n, kind === "images" ? "list" : "list")) ||
        first(fromLibrary) ||
        first((n) => (n.type === "trigger.form" ? formField(n, FORM_IMAGE) : ""))
      );
  }
}

/** Fills every step's empty content boxes from the steps before it. Returns a new graph. */
export function wireGraph(graph: WorkflowGraph, getNode: (type: string) => NodeDefinition | undefined): WorkflowGraph {
  const nodes = graph.nodes.map((node) => {
    const def = getNode(node.type);
    const fields = def?.fields.filter((f) => f.autoFill) ?? [];
    if (!fields.length) return node;
    const earlier = ancestors(graph, node.id);
    if (!earlier.length) return node;

    let params = node.params;
    for (const field of fields) {
      if (!unwired(params?.[field.key])) continue;
      const value = wireValue(field.autoFill!, earlier);
      if (value) params = { ...params, [field.key]: value };
    }
    return params === node.params ? node : { ...node, params };
  });
  return { ...graph, nodes };
}

/** "Hook... CTA\n#tag #tag" + link -> the link sits right under the call to action, before the hashtags. */
export function placeLinkUnderCta(caption: string, link: string): string {
  const url = link.trim();
  if (!url || caption.includes(url)) return caption;
  const lines = caption.replace(/\s+$/, "").split("\n");
  let tagStart = lines.length;
  while (tagStart > 0) {
    const line = lines[tagStart - 1].trim();
    if (!line || /^(#[^\s#]+\s*)+$/.test(line)) tagStart--;
    else break;
  }
  if (tagStart === lines.length) return `${caption.replace(/\s+$/, "")}\n\n${url}`;
  const body = lines.slice(0, tagStart).join("\n").replace(/\s+$/, "");
  const tags = lines.slice(tagStart).join("\n").replace(/^\s+/, "");
  return `${body}\n${url}\n\n${tags}`;
}
