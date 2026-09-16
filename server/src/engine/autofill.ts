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

  const next = { ...params };
  for (const field of fields) {
    if (!empty(next[field.key])) continue;
    const value =
      field.autoFill === "caption"
        ? caption()
        : field.autoFill === "video"
          ? generated("ai.video")
          : field.autoFill === "sourceImage"
            ? productImage()
            : generated("ai.image") || productImage();
    if (value) next[field.key] = value;
  }
  return next;
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
