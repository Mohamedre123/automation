export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multiselect"
  | "combo"
  | "model"
  | "credential"
  | "boolean"
  | "json"
  | "keyvalue"
  | "conditions"
  | "readonly";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  /** combo fields: suggest the model list of the selected credential type. */
  suggestFromCredential?: boolean;
  /** model fields: which models to offer from the provider's live list. */
  modelKind?: "text" | "image";
  /** credential fields: a second account used by the step (e.g. where the agent notifies the owner). */
  credentialTypes?: string[];
  /** readonly path fields: which public link to show. */
  urlKind?: "webhook" | "form";
  /** Only show this field when another field has one of these values. */
  showIf?: { field: string; values: unknown[] };
}

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  required?: boolean;
}

export interface CredentialType {
  key: string;
  name: string;
  app: string;
  description?: string;
  docsUrl?: string;
  fields: CredentialField[];
  /** AI providers: model suggestions and the model used when the field is empty. */
  models?: string[];
  defaultModel?: string;
  /** Resolves with a short success note, throws with a readable message on failure. */
  test?: (data: Record<string, string>) => Promise<string>;
}

export interface CredentialValue {
  id: string;
  type: string;
  data: Record<string, string>;
}

export interface WebhookResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface WebhookRequest {
  method: string;
  headers: Record<string, unknown>;
  query: unknown;
  body: unknown;
}

export type ExecutionMode = "manual" | "webhook" | "schedule" | "poll";

export interface NodeContext {
  params: Record<string, any>;
  credential?: CredentialValue;
  outputs: Record<string, unknown>;
  workflow: { id: string; name: string; userId: string };
  execution: { id: string; mode: ExecutionMode };
  signal: AbortSignal;
  respond?: (response: WebhookResponse) => void;
}

export interface NodeResult {
  output: unknown;
  /** For branching nodes: which output handle to follow. */
  branch?: string;
}

export interface PollContext {
  params: Record<string, any>;
  credential?: CredentialValue;
  state: any;
  signal: AbortSignal;
  testMode: boolean;
}

export interface WebhookContext {
  params: Record<string, any>;
  secretToken: string;
  credential?: CredentialValue;
}

export interface TriggerWebhook {
  /** Point the external service at our URL (on activation or a test run). */
  register?: (ctx: {
    params: Record<string, any>;
    credential?: CredentialValue;
    url: string;
    secretToken: string;
    signal: AbortSignal;
  }) => Promise<void>;
  unregister?: (ctx: { params: Record<string, any>; credential?: CredentialValue; signal: AbortSignal }) => Promise<void>;
  /** Answer a platform's subscription handshake (e.g. Meta's hub.challenge) before parsing. */
  verify?: (request: WebhookRequest, ctx: WebhookContext) => WebhookResponse | undefined;
  /** Incoming request -> trigger items (one execution each). Return [] to ignore. */
  parse: (request: WebhookRequest, ctx: WebhookContext) => unknown[];
}

export type NodeGroup = "trigger" | "ai" | "apps" | "logic" | "data";

export interface NodeDefinition {
  type: string;
  name: string;
  description: string;
  app: string;
  appName: string;
  color: string;
  group: NodeGroup;
  kind: "trigger" | "action";
  /** webhook = our URL is called directly, app = an external app pushes events (webhook) or is polled locally. */
  triggerType?: "manual" | "webhook" | "schedule" | "app";
  credentialTypes?: string[];
  credentialOptional?: boolean;
  fields: FieldDef[];
  outputs?: { key: string; label: string }[];
  sampleOutput?: unknown;
  run?: (ctx: NodeContext) => Promise<NodeResult>;
  webhook?: TriggerWebhook;
  poll?: (ctx: PollContext) => Promise<{ items: unknown[]; state: any }>;
}

export interface WorkflowNode {
  id: string;
  type: string;
  name?: string;
  position: { x: number; y: number };
  params: Record<string, any>;
  credentialId?: string | null;
  disabled?: boolean;
  continueOnFail?: boolean;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface StepLog {
  nodeId: string;
  type: string;
  name: string;
  status: "success" | "error" | "skipped";
  startedAt: string;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  branch?: string;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  status: "running" | "success" | "error";
  mode: ExecutionMode;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  steps: StepLog[];
}
