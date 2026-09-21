import type { Edge, Node } from "@xyflow/react";
import { randomPath } from "../api";
import type { NodeDefinition, WorkflowEdge, WorkflowGraph, WorkflowNode } from "../types";

export type FlowNodeData = { node: WorkflowNode };
export type FlowNodeType = Node<FlowNodeData, "app">;

export function toFlow(graph: WorkflowGraph): { nodes: FlowNodeType[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({ id: node.id, type: "app", position: node.position, data: { node } })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "main" })),
  };
}

export function toGraph(nodes: FlowNodeType[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({ ...n.data.node, id: n.id, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map<WorkflowEdge>((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle && e.sourceHandle !== "main" ? e.sourceHandle : null,
    })),
  };
}

export const nextNodeId = (nodes: FlowNodeType[]) =>
  String(nodes.reduce((max, n) => Math.max(max, Number(n.id) || 0), 0) + 1);

/** Ancestors of a node, nearest first. */
export function upstreamIds(nodeId: string, edges: Edge[]): string[] {
  const seen = new Set<string>();
  const queue = [nodeId];
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of edges) {
      if (e.target === current && !seen.has(e.source)) {
        seen.add(e.source);
        order.push(e.source);
        queue.push(e.source);
      }
    }
  }
  return order;
}

export const pathSegment = (key: string | number) =>
  typeof key === "number" ? `[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`;

export function defaultParams(def: NodeDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.default !== undefined) params[field.key] = structuredClone(field.default);
  }
  // Webhook and app triggers own a URL path (Telegram gets its webhook pointed at it).
  if (def.triggerType === "webhook" || def.triggerType === "app") params.path = randomPath();
  return params;
}

export function isFieldVisible(def: NodeDefinition, fieldKey: string, params: Record<string, unknown>): boolean {
  const field = def.fields.find((f) => f.key === fieldKey);
  if (!field?.showIf) return true;
  const controller = def.fields.find((f) => f.key === field.showIf!.field);
  const value = params[field.showIf.field] ?? controller?.default;
  return field.showIf.values.includes(value);
}

/**
 * Values for a step's content boxes taken from the nearest earlier steps:
 * caption = the AI-written post, image / video = the generated media, sourceImage = the product photo.
 * Only empty boxes are filled.
 */
const FORM_IMAGE = /\((صورة|صوره|image|photo)\)/i;
const FORM_VIDEO = /\((فيديو|video)\)/i;
const FORM_TEXT = /محتوى|كابشن|نص|بوست|caption|content|post/i;
const FORM_PHONE = /واتساب|تليفون|موبايل|رقم|phone|whatsapp|mobile/i;
/** A box counts as unwired when it is empty, or still holds a "write here" note. */
const NOTE = /^\s*(اكتب|حدد|سيب|ضع|\(اكتب)/;
const unwired = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" ? !value.trim() || NOTE.test(value) : Array.isArray(value) && !value.length);

/** The expression for one kind of content, from the nearest earlier step that has it. */
export function wireValue(kind: NonNullable<NodeDefinition["fields"][number]["autoFill"]>, upstream: WorkflowNode[]): string {
  const first = (pick: (n: WorkflowNode) => string) => {
    for (const node of upstream) {
      if (node.disabled) continue;
      const value = pick(node);
      if (value) return value;
    }
    return "";
  };
  const formKey = (node: WorkflowNode, match: RegExp) => {
    if (node.type !== "trigger.form") return "";
    const rows = Array.isArray(node.params.formFields) ? (node.params.formFields as { key?: string; value?: string }[]) : [];
    const row = rows.find((r) => match.test(String(r?.value ?? "")) || match.test(String(r?.key ?? "")));
    return row?.key ? `{{${node.id}.data.${row.key}}}` : "";
  };
  const fromAi = (node: WorkflowNode) => {
    if (!["ai.generate", "ai.agent", "anthropic.message"].includes(node.type)) return "";
    if (node.params.parseJson) {
      const system = String(node.params.system ?? "");
      for (const key of ["post", "caption", "content", "text"]) if (new RegExp(`"${key}"`).test(system)) return `{{${node.id}.json.${key}}}`;
    }
    return `{{${node.id}.text}}`;
  };
  const fromLibrary = (node: WorkflowNode) => (["media.select", "media.pick"].includes(node.type) ? `{{${node.id}.url}}` : "");

  // The gallery step is where the customer puts the pictures and the words together.
  const fromGallery = (node: WorkflowNode, key: string) =>
    node.type === "media.gallery" && (key !== "caption" || String(node.params.caption ?? "").trim()) ? `{{${node.id}.${key}}}` : "";

  switch (kind) {
    case "caption":
      return (
        first((n) => fromGallery(n, "caption")) ||
        first(fromAi) ||
        first((n) => (n.type === "media.select" && String(n.params.ideas ?? "").trim() ? `{{${n.id}.idea}}` : "")) ||
        first((n) => formKey(n, FORM_TEXT))
      );
    case "video":
      return (
        first((n) => (n.type === "ai.video" ? `{{${n.id}.url}}` : "")) ||
        first((n) => (n.type === "media.gallery" && String(n.params.video ?? "").trim() ? `{{${n.id}.video}}` : "")) ||
        first((n) => formKey(n, FORM_VIDEO))
      );
    case "sourceImage":
      return first((n) => fromGallery(n, "url")) || first(fromLibrary) || first((n) => formKey(n, FORM_IMAGE));
    case "publishTime":
      return first((n) => (n.type === "trigger.schedule" && String(n.params.publishTime ?? "").trim() ? `{{${n.id}.publishAt}}` : ""));
    case "record":
      // A whole result, so a sheet or a table can match its own columns against it by name.
      return first((n) => `{{${n.id}}}`);
    case "replyTo":
      // Whoever wrote in: the phone that messaged, the chat that messaged, or the number on the form.
      return (
        first((n) => (["wasender.trigger", "whatsapp.trigger"].includes(n.type) ? `{{${n.id}.phone}}` : "")) ||
        first((n) => (n.type === "telegram.trigger" ? `{{${n.id}.message.chat.id}}` : "")) ||
        first((n) => formKey(n, FORM_PHONE))
      );
    default:
      return (
        first((n) => (n.type === "ai.image" ? `{{${n.id}.url}}` : "")) ||
        first((n) => fromGallery(n, "list")) ||
        first(fromLibrary) ||
        first((n) => formKey(n, FORM_IMAGE))
      );
  }
}

export function autoFillParams(def: NodeDefinition, params: Record<string, unknown>, upstream: WorkflowNode[]): Record<string, unknown> {
  const fields = def.fields.filter((f) => f.autoFill);
  if (!fields.length) return params;
  const next = { ...params };
  for (const field of fields) {
    if (!unwired(next[field.key])) continue;
    const value = wireValue(field.autoFill!, upstream);
    if (value) next[field.key] = value;
  }
  return next;
}

/** Re-wires one step from everything now before it (used after a new connection is drawn). */
export function wireNode(
  node: WorkflowNode,
  upstream: WorkflowNode[],
  nodeDef: (type: string) => NodeDefinition | undefined,
): WorkflowNode {
  const def = nodeDef(node.type);
  if (!def) return node;
  const params = autoFillParams(def, node.params, upstream);
  return params === node.params ? node : { ...node, params };
}
