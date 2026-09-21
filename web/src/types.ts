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
  suggestFromCredential?: boolean;
  modelKind?: "text" | "image";
  credentialTypes?: string[];
  urlKind?: "webhook" | "form";
  autoFill?: "caption" | "image" | "images" | "video" | "sourceImage" | "publishTime" | "record" | "replyTo";
  showIf?: { field: string; values: unknown[] };
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
  triggerType?: "manual" | "webhook" | "schedule" | "app";
  credentialTypes?: string[];
  credentialOptional?: boolean;
  fields: FieldDef[];
  outputs?: { key: string; label: string }[];
  sampleOutput?: unknown;
  guide?: string[];
}

export interface CredentialTypeDef {
  key: string;
  name: string;
  app: string;
  description?: string;
  docsUrl?: string;
  steps?: string[];
  hasTest: boolean;
  models?: string[];
  defaultModel?: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; required?: boolean }[];
}

export interface Meta {
  appName: string;
  publicUrl: string;
  platform: { isVercel: boolean; receivesWebhooks: boolean; backgroundWorkers: boolean };
  nodes: NodeDefinition[];
  credentialTypes: CredentialTypeDef[];
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

export interface Workflow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  apps: string[];
  lastStatus: ExecutionStatus | null;
  lastRunAt: string | null;
  runs?: number;
  triggerError: { message: string; at: string } | null;
  graph?: WorkflowGraph;
}

export type ExecutionStatus = "running" | "success" | "error";

export interface StepLog {
  nodeId: string;
  type: string;
  name: string;
  status: "success" | "error" | "skipped" | "running";
  startedAt: string;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  branch?: string;
}

export interface Execution {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: ExecutionStatus;
  mode: "manual" | "webhook" | "schedule" | "poll";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  steps: StepLog[];
  stepCount?: number;
  /** The step running right now (live runs). */
  currentNode?: string | null;
}

export interface Credential {
  id: string;
  type: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  preview: Record<string, string>;
  usedBy: { id: string; name: string }[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  requires: string[];
  steps: number;
  starts?: string;
  howTo?: string[];
  apps: { key: string; name: string }[];
  graph: WorkflowGraph;
}

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export type PlanKey = "free" | "trial" | "core" | "pro" | "max";

export interface PlanDef {
  key: PlanKey;
  name: string;
  tagline: string;
  price: { monthly: number; yearly: number };
  credits: number;
  assistantCredits: number;
  maxActiveScenarios: number;
  minIntervalMinutes: number;
  assistant: boolean;
  logDays: number;
  priority: boolean;
  features: string[];
}

export interface AccountInfo {
  plan: { key: PlanKey; name: string; assistant: boolean };
  period: "monthly" | "yearly";
  expiresAt: string | null;
  trialEndsAt: string | null;
  credits: number;
  assistantCredits: number;
  /** Bought top-ups (included in the totals above), they never expire. */
  extraCredits: number;
  extraAssistantCredits: number;
  creditsUsed: number;
  assistantUsed: number;
  monthlyCredits: number;
  monthlyAssistantCredits: number;
  resetsAt: string | null;
  isAdmin: boolean;
  limits: { maxActiveScenarios: number; minIntervalMinutes: number };
}

export interface CreditPack {
  key: string;
  name: string;
  credits: number;
  assistantCredits: number;
  price: number;
}

export interface PaymentInfo {
  phone: string;
  egpRate: number;
  methods: string[];
}

export interface SubscriptionRequest {
  id: string;
  kind: "plan" | "credits";
  pack: string;
  amount: string;
  plan: PlanKey;
  period: "monthly" | "yearly";
  status: "pending" | "done" | "rejected";
  note: string;
  createdAt: string;
}
