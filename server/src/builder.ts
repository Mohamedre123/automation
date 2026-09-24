import { executionFromRow } from "./engine/executor.js";
import type { WorkflowGraph } from "./engine/types.js";
import { one, parseJson, query } from "./db.js";
import { getNode, nodeDefinitions } from "./nodes/index.js";
import { templates } from "./templates.js";
import { insertWorkflow, sanitizeGraph, setWorkflowActive, updateInactiveWorkflow } from "./routes/workflows.js";
import { arrangeGraph, type Arranged } from "./engine/layout.js";

/*
 * Everything an AI needs to build on this platform, in one place.
 *
 * The MCP server hands these to whatever agent the customer connects, so Claude (or anything
 * else that speaks MCP) can do what our own assistant does: read the catalog, build a scenario,
 * fix it, test it, and read why a run failed.
 */

export interface BuilderTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  /** Changes the account's scenarios, so a read-only connection does not get it. */
  writes?: boolean;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

const str = (description: string) => ({ type: "string", description });

export const builderTools: BuilderTool[] = [
  {
    name: "list_steps",
    description:
      "The catalog of steps this platform can run: triggers, AI, apps, logic and data. Call this before building anything. " +
      "Pass a search word to narrow it down (e.g. 'whatsapp', 'sheets', 'instagram').",
    schema: obj({ search: str("Optional word to filter by, matched against the step's name, app and description") }),
  },
  {
    name: "describe_step",
    description: "Everything about one step: every setting, its type, whether it is required, its choices, and what the step outputs.",
    schema: obj({ type: str("The step type, e.g. 'whatsapp.send' or 'ai.generate'") }, ["type"]),
  },
  {
    name: "list_templates",
    description: "Ready-made scenarios the user can start from. Prefer one of these over building from scratch when it fits.",
    schema: obj({ search: str("Optional word to filter by") }),
  },
  {
    name: "use_template",
    description: "Create a new scenario for the user from a template. Returns the new scenario's id.",
    schema: obj({ template_id: str("The template's id from list_templates") }, ["template_id"]),
    writes: true,
  },
  {
    name: "list_scenarios",
    description: "The user's scenarios: id, name, whether it is running, its trigger, and how its last run went.",
    schema: obj({}),
  },
  {
    name: "get_scenario",
    description: "One scenario with its full graph, so you can read it before changing it.",
    schema: obj({ scenario_id: str("The scenario's id") }, ["scenario_id"]),
  },
  {
    name: "create_scenario",
    description:
      "Create a new scenario from a graph. It is created stopped, so nothing runs until the user activates it. " +
      "Returns the id and a link the user can open. Read the format rules in the server instructions first.",
    schema: obj({ name: str("A short Arabic name"), graph: { type: "object", description: "{ nodes: [...], edges: [...] }" } }, ["name", "graph"]),
    writes: true,
  },
  {
    name: "update_scenario",
    description: "Replace the graph (and optionally the name) of a scenario. The scenario must be stopped. Tell the user what you are changing first.",
    schema: obj({ scenario_id: str("The scenario's id"), name: str("Optional new name"), graph: { type: "object" } }, ["scenario_id", "graph"]),
    writes: true,
  },
  {
    name: "set_scenario_active",
    description: "Start or stop a scenario. Starting one makes it run on its own from then on, so ask the user before starting.",
    schema: obj({ scenario_id: str("The scenario's id"), active: { type: "boolean", description: "true to start, false to stop" } }, [
      "scenario_id",
      "active",
    ]),
    writes: true,
  },
  {
    name: "run_scenario",
    description: "Run a scenario once as a test and return every step's result. Costs the user credits, exactly like pressing run in the app.",
    schema: obj({ scenario_id: str("The scenario's id"), data: { type: "object", description: "Optional data for the trigger" } }, ["scenario_id"]),
    writes: true,
  },
  {
    name: "get_runs",
    description: "Recent runs of a scenario with each step's input, output and error - this is how you find out why something failed.",
    schema: obj({ scenario_id: str("The scenario's id"), limit: { type: "integer", description: "1 to 5, default 3" } }, ["scenario_id"]),
  },
  {
    name: "list_accounts",
    description:
      "The accounts the user has already connected (id, type, name), so a step can point at one with credentialId. Secrets are never returned.",
    schema: obj({}),
  },
];

/** The rules an agent has to follow to produce a graph this platform accepts. */
export const GRAPH_RULES = `# How a scenario is built here

A scenario is { nodes: [...], edges: [...] }.

A node: { "id": "1", "type": "<step type>", "name": "اسم بالعربي", "position": { "x": 0, "y": 0 }, "params": { ... }, "credentialId": null }

- Ids are strings counting up: "1", "2", "3". The trigger (kind = trigger) is always "1", and there is exactly one trigger.
- Any step may also carry "retries": 0-5 and "retryWaitSeconds": 1-120 - add them to a step that calls a
  service known to be flaky. Only failures worth retrying (network, timeout, rate limit, 5xx) are retried.
- To pause between steps use the step "logic.delay" with { "seconds": 0-120 }. For hours or days do not wait:
  make a second scenario with a trigger.schedule at that time.
- Two edges out of one step run BOTH branches, and a plain step both branches point at runs TWICE.
  When the steps after a split should run once, end the split with "logic.merge": it waits for every
  branch, runs once, and gives {{n.items}} - what each branch produced.
- "logic.iterator" makes the steps after it run once per item in a list. To act on the whole list
  afterwards (one message, one report) instead of once per item, put "logic.collect" after the loop's
  last step: it waits for every round and gives {{n.items}}, {{n.count}} and {{n.text}}. Its "field"
  setting picks one value out of each round.
- EVERY step except the trigger needs at least one edge pointing at it, or it never runs. Send the
  edges every time - a list of steps is not a scenario. (If you forget one, the platform joins that
  step to the step you wrote just before it and says so under "tidied" - but that is a guess.)
- position.x is the step's order x 280, position.y is 0. For branches use y = -160 and y = +160.
  Never put two steps at the same position: they open stacked on top of each other.
- An edge: { "id": "e1-2", "source": "1", "target": "2", "sourceHandle": null }.
- Steps with named exits need sourceHandle set to the exit: logic.if uses "true" / "false",
  logic.switch uses "r1".."r5" / "else" (describe_step lists a step's "outputs"). Every other step uses null.
- Two edges out of one step means both branches run.
- No loops: a step never points back to a step before it.
- If create_scenario or update_scenario answers with "tidied", tell the user what the platform fixed.

# Chatbots

An "ai.agent" step learns on the job by default ("learn": true). When a customer asks something its
knowledge does not cover, it asks the owner, the owner's answer goes to that customer, and the bot keeps
it. For that it needs "ownerContact": the owner's own WhatsApp number with country code (not the number
the bot runs on) or their Telegram @username. Ask the user for it; never guess one. Put what the user
tells you about their business (prices, hours, delivery, policies) in "knowledge".

# Passing data between steps

Write {{2.text}} to use step 2's output. Paths follow the step's sampleOutput, which describe_step returns:
{{1.message.text}}, {{1.body.email}}, {{3.json.post}}, {{4.url}}, {{1.data.<form field>}}.
System values: {{$now}}, {{$today}}, {{$workflow.name}}.

Content boxes fill themselves: leave a publishing or messaging step's caption, image, video or
recipient empty and the platform wires it to the nearest earlier step that produces one. Only
fill them yourself when you want something other than the obvious.

# Accounts

A step with credentialTypes needs credentialId set to an account of that type - call list_accounts.
If the user has none, leave credentialId null, create the scenario anyway, and tell them which
account to connect from the "الحسابات والمفاتيح" page. Never ask a user for an API key in chat.

# Field types

"json" takes JSON text. "keyvalue" takes [{"key": "...", "value": "..."}].
"conditions" takes [{"left": "...", "op": "equals", "right": "..."}]. "multiselect" takes an array.
Any text field accepts @{اسم الصورة} to mean a picture from the user's library.

# Working well

- Build only what was asked. Do not add steps nobody asked for.
- Prefer a template when one fits: list_templates, then use_template.
- A new scenario is created stopped. Say what the user still has to do (connect an account, write
  their phone number) and how to test it, then ask before set_scenario_active.
- Never claim you created or changed something unless the tool returned success.`;

let catalogCache:
  | { type: string; name: string; app: string; appKey: string; kind: string; trigger?: string; needs?: string[]; about: string }[]
  | null = null;

/** The short catalog: enough for an agent to choose, not so much that it fills the context. */
function stepCatalog() {
  catalogCache ??= nodeDefinitions.map((d) => ({
    type: d.type,
    name: d.name,
    app: d.appName,
    // The English key ("whatsapp", "instagram"): every app is named in Arabic, and an agent searches in English.
    appKey: d.app,
    kind: d.kind,
    trigger: d.triggerType,
    needs: d.credentialTypes?.length ? d.credentialTypes : undefined,
    about: d.description,
  }));
  return catalogCache;
}

/** The full definition of one step, including what it outputs. */
export function stepDetails(type: string) {
  const def = nodeDefinitions.find((d) => d.type === type);
  if (!def) return null;
  return {
    type: def.type,
    name: def.name,
    app: def.appName,
    kind: def.kind,
    triggerType: def.triggerType,
    description: def.description,
    credentialTypes: def.credentialTypes,
    credentialOptional: def.credentialOptional || undefined,
    outputs: def.outputs?.map((o) => o.key),
    fields: def.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required || undefined,
      default: f.default,
      help: f.help,
      options: f.options?.map((o) => o.value),
      showIf: f.showIf,
      credentialTypes: f.credentialTypes,
      /** Left empty, this box fills itself from the steps before it. */
      autoFills: f.autoFill,
    })),
    sampleOutput: def.sampleOutput,
  };
}

const matches = (search: unknown, ...haystack: (string | undefined)[]) => {
  const q = String(search ?? "").trim().toLowerCase();
  return !q || haystack.filter(Boolean).join(" ").toLowerCase().includes(q);
};

const clip = (value: unknown, max = 3000) => {
  const text = JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}…` : value;
};

export type BuilderAction = { type: "scenario_created" | "scenario_updated"; scenarioId: string; name?: string };

export interface BuilderContext {
  userId: string;
  /** Where the user can open what was built. */
  appUrl: string;
  onAction?: (action: BuilderAction) => void;
}

/** What the platform tidied in a graph an agent sent, in words the agent can pass on. */
function tidied(arranged: Arranged) {
  const notes: string[] = [];
  if (arranged.connected) notes.push(`${arranged.connected} step(s) had no arrow pointing at them and were joined to the step written before them`);
  if (arranged.laidOut) notes.push("the steps were on top of each other and were laid out left to right");
  return notes.length ? { tidied: notes } : {};
}

export async function runBuilderTool(name: string, input: Record<string, any>, context: BuilderContext): Promise<unknown> {
  const { userId } = context;
  const link = (id: string) => `${context.appUrl}/app/workflows/${id}`;
  const ownScenario = async (id: string) => {
    const row = await one<{ id: string; name: string; active: number; graph: string }>(
      "SELECT id, name, active, graph FROM workflows WHERE id = $1 AND user_id = $2",
      [String(id), userId],
    );
    if (!row) throw new Error("مفيش سيناريو بالرقم ده");
    return row;
  };

  switch (name) {
    case "list_steps": {
      const all = stepCatalog().filter((s) => matches(input.search, s.type, s.name, s.app, s.appKey, s.about));
      return { count: all.length, steps: all.slice(0, 220) };
    }
    case "describe_step": {
      const details = stepDetails(String(input.type ?? ""));
      if (!details) throw new Error(`مفيش خطوة نوعها ${input.type} - استخدم list_steps`);
      return details;
    }
    case "list_templates":
      return templates
        .filter((t) => matches(input.search, t.id, t.name, t.description, t.category))
        .map((t) => ({ id: t.id, name: t.name, category: t.category, about: t.description, steps: t.graph.nodes.length, needs: t.requires }));
    case "use_template": {
      const template = templates.find((t) => t.id === String(input.template_id ?? ""));
      if (!template) throw new Error("مفيش تيمبلت بالرقم ده - استخدم list_templates");
      const id = await insertWorkflow(userId, template.name, structuredClone(template.graph), template.description);
      context.onAction?.({ type: "scenario_created", scenarioId: id, name: template.name });
      return { created: true, id, name: template.name, url: link(id), needs: template.requires };
    }
    case "list_scenarios": {
      const rows = await query(
        `SELECT w.id, w.name, w.active, w.trigger_type,
           (SELECT status FROM executions e WHERE e.workflow_id = w.id ORDER BY started_at DESC LIMIT 1) AS last_status
         FROM workflows w WHERE w.user_id = $1 ORDER BY w.updated_at DESC LIMIT 50`,
        [userId],
      );
      return rows.map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active), trigger: r.trigger_type, lastStatus: r.last_status }));
    }
    case "get_scenario": {
      const row = await ownScenario(input.scenario_id);
      return {
        id: row.id,
        name: row.name,
        active: Boolean(row.active),
        url: link(row.id),
        graph: parseJson<WorkflowGraph>(row.graph, { nodes: [], edges: [] }),
      };
    }
    case "create_scenario": {
      const scenarioName = String(input.name || "سيناريو جديد").slice(0, 120);
      const arranged = arrangeGraph(sanitizeGraph(input.graph), getNode);
      const id = await insertWorkflow(userId, scenarioName, arranged.graph);
      context.onAction?.({ type: "scenario_created", scenarioId: id, name: scenarioName });
      return { created: true, id, name: scenarioName, url: link(id), note: "اتعمل متوقف - المستخدم هو اللي يفعّله", ...tidied(arranged) };
    }
    case "update_scenario": {
      const id = String(input.scenario_id ?? "");
      const arranged = arrangeGraph(sanitizeGraph(input.graph), getNode);
      await updateInactiveWorkflow(userId, id, arranged.graph, input.name);
      context.onAction?.({ type: "scenario_updated", scenarioId: id });
      return { updated: true, id, url: link(id), ...tidied(arranged) };
    }
    case "set_scenario_active": {
      const row = await ownScenario(input.scenario_id);
      const active = input.active === true || input.active === "true";
      await setWorkflowActive(userId, row.id, active);
      return { id: row.id, active, url: link(row.id) };
    }
    case "run_scenario": {
      const row = await ownScenario(input.scenario_id);
      const { runScenarioOnce } = await import("./routes/workflows.js");
      const record = await runScenarioOnce(userId, row.id, input.data && typeof input.data === "object" ? input.data : {});
      return {
        status: record.status,
        error: record.error,
        url: link(row.id),
        steps: record.steps.map((s) => ({ name: s.name, status: s.status, error: s.error, output: clip(s.output, 1200) })),
      };
    }
    case "get_runs": {
      const row = await ownScenario(input.scenario_id);
      const limit = Math.min(Math.max(Number(input.limit) || 3, 1), 5);
      const rows = await query("SELECT * FROM executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2", [row.id, limit]);
      return rows.map((raw) => {
        const execution = executionFromRow(raw);
        return {
          id: execution.id,
          status: execution.status,
          mode: execution.mode,
          startedAt: execution.startedAt,
          error: execution.error,
          steps: execution.steps.map((s) => ({
            nodeId: s.nodeId,
            name: s.name,
            status: s.status,
            error: s.error,
            input: clip(s.input),
            output: clip(s.output),
          })),
        };
      });
    }
    case "list_accounts":
      return query("SELECT id, type, name FROM credentials WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
