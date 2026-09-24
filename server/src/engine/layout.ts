import type { NodeDefinition, WorkflowEdge, WorkflowGraph, WorkflowNode } from "./types.js";

/*
 * Tidying a scenario an agent wrote.
 *
 * ChatGPT, Claude, Cursor - whatever the customer connects - will sometimes send the steps and
 * forget the arrows, or send every step at position 0,0. The result opened as a pile of steps
 * stacked on top of each other with nothing joined, and the customer had to pull them apart and
 * wire them by hand. Two fixes, both conservative:
 *
 *  1. A step nothing points at can never run. Join it to the step written just before it - the
 *     order the agent wrote them in is the order it meant them to run in.
 *  2. If steps sit on top of each other, lay the whole scenario out left to right by how far
 *     each step is from the trigger, branches spread above and below.
 *
 * Anything the agent did get right - its arrows, a layout with no overlaps - is left alone.
 */

const STEP_X = 280;
const STEP_Y = 160;

type GetNode = (type: string) => NodeDefinition | undefined;

function wouldLoop(edges: WorkflowEdge[], from: string, to: string): boolean {
  // Adding from -> to makes a loop if "to" can already reach "from".
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

/** Steps sitting close enough to cover each other on the canvas. */
export function overlaps(nodes: WorkflowNode[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].position;
      const b = nodes[j].position;
      if (Math.abs(a.x - b.x) < 140 && Math.abs(a.y - b.y) < 110) return true;
    }
  }
  return false;
}

/** Left to right by distance from the trigger; steps at the same distance spread top to bottom. */
export function layOut(nodes: WorkflowNode[], edges: WorkflowEdge[], trigger: WorkflowNode | undefined): WorkflowNode[] {
  const depth = new Map<string, number>();
  const order: string[] = [];
  if (trigger) {
    // Longest path, so a step two branches meet at sits after both of them, not beside the shorter one.
    depth.set(trigger.id, 0);
    const queue = [trigger.id];
    const visits = new Map<string, number>();
    while (queue.length) {
      const id = queue.shift()!;
      if (!order.includes(id)) order.push(id);
      for (const e of edges) {
        if (e.source !== id) continue;
        const next = (depth.get(id) ?? 0) + 1;
        if (next > (depth.get(e.target) ?? -1)) depth.set(e.target, next);
        // A graph without loops settles; the cap only guards against a malformed one.
        const count = (visits.get(e.target) ?? 0) + 1;
        visits.set(e.target, count);
        if (count <= nodes.length) queue.push(e.target);
      }
    }
  }
  // Whatever the trigger cannot reach goes after everything else, in the agent's own order.
  let last = Math.max(0, ...depth.values());
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, ++last);
      order.push(node.id);
    }
  }

  const columns = new Map<number, string[]>();
  for (const id of order) {
    const d = depth.get(id)!;
    const column = columns.get(d) ?? [];
    if (!column.includes(id)) column.push(id);
    columns.set(d, column);
  }
  const placed = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of columns) {
    ids.forEach((id, i) => placed.set(id, { x: d * STEP_X, y: Math.round((i - (ids.length - 1) / 2) * STEP_Y) }));
  }
  return nodes.map((n) => ({ ...n, position: placed.get(n.id) ?? n.position }));
}

export interface Arranged {
  graph: WorkflowGraph;
  /** How many arrows were added for steps nothing pointed at. */
  connected: number;
  /** Whether the steps had to be spread out because they covered each other. */
  laidOut: boolean;
}

export function arrangeGraph(graph: WorkflowGraph, getNode: GetNode): Arranged {
  let nodes = graph.nodes.map((n) => ({ ...n, position: { ...n.position } }));
  const edges = graph.edges.map((e) => ({ ...e }));
  const trigger = nodes.find((n) => getNode(n.type)?.kind === "trigger");
  let connected = 0;

  if (trigger) {
    const inOrder = [trigger, ...nodes.filter((n) => n !== trigger)];
    for (let i = 1; i < inOrder.length; i++) {
      const node = inOrder[i];
      if (edges.some((e) => e.target === node.id)) continue;
      const from = inOrder[i - 1];
      // A step with named exits (a question, a router): the first one nothing uses yet.
      const exits = getNode(from.type)?.outputs?.map((o) => o.key);
      const handle = exits?.length ? (exits.find((key) => !edges.some((e) => e.source === from.id && e.sourceHandle === key)) ?? exits[0]) : null;
      if (wouldLoop(edges, from.id, node.id)) continue;
      let id = `e${from.id}-${node.id}`;
      while (edges.some((e) => e.id === id)) id += "x";
      edges.push({ id, source: from.id, target: node.id, sourceHandle: handle });
      connected++;
    }
  }

  const laidOut = overlaps(nodes);
  if (laidOut) nodes = layOut(nodes, edges, trigger);
  return { graph: { nodes, edges }, connected, laidOut };
}
