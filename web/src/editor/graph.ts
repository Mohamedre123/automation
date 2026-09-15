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
