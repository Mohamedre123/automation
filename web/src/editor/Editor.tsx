import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { api } from "../api";
import { Modal, Spinner, StatusBadge, Toggle, copyText, formatDuration, modeLabels, timeAgo, useToast } from "../components/ui";
import { useMeta } from "../context";
import { Icon } from "../icons";
import { ExecutionSteps } from "../pages/Executions";
import type { Credential, Execution, NodeDefinition, StepLog, Workflow, WorkflowNode } from "../types";
import { EditorContext, FlowNode, type EditorContextValue, type VariableSource } from "./FlowNode";
import { defaultParams, nextNodeId, toFlow, toGraph, upstreamIds, type FlowNodeType } from "./graph";
import { NodePanel } from "./NodePanel";
import { NodePicker } from "./NodePicker";

const nodeTypes = { app: FlowNode };

interface RunResponse {
  execution?: Execution;
  count?: number;
  message?: string;
}

export function Editor() {
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  );
}

function EditorCanvas() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { meta, nodeDef } = useMeta();
  const { fitView } = useReactFlow();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNodeType>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"settings" | "result">("settings");
  const [side, setSide] = useState<"node" | "history">("node");
  const [history, setHistory] = useState<Execution[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const runController = useRef<AbortController | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [picker, setPicker] = useState<{ after?: string; handle?: string } | null>(null);

  useEffect(() => {
    api<Workflow>(`/workflows/${id}`)
      .then((wf) => {
        setWorkflow(wf);
        setName(wf.name);
        const flow = toFlow(wf.graph ?? { nodes: [], edges: [] });
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setTimeout(() => fitView({ padding: 0.35, maxZoom: 1 }), 60);
      })
      .catch((e: Error) => setLoadError(e.message));
    api<Credential[]>("/credentials").then(setCredentials).catch(() => {});
  }, [id, setNodes, setEdges, fitView]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => () => runController.current?.abort(), []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNodeType>[]) => {
      onNodesChangeBase(changes);
      if (changes.some((c) => c.type === "remove" || (c.type === "position" && c.dragging === false))) setDirty(true);
      if (changes.some((c) => c.type === "remove" && c.id === selectedId)) setSelectedId(null);
    },
    [onNodesChangeBase, selectedId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChangeBase(changes);
      if (changes.some((c) => c.type === "remove")) setDirty(true);
    },
    [onEdgesChangeBase],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const handle = connection.sourceHandle ?? "main";
      setEdges((list) => addEdge({ ...connection, id: `e${connection.source}-${connection.target}-${handle}` }, list));
      setDirty(true);
    },
    [setEdges],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (c.source === c.target) return false;
      const target = nodes.find((n) => n.id === c.target);
      if (!target || nodeDef(target.data.node.type)?.kind === "trigger") return false;
      if (upstreamIds(c.source, edges).includes(c.target)) return false;
      return !edges.some(
        (e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? "main") === (c.sourceHandle ?? "main"),
      );
    },
    [nodes, edges, nodeDef],
  );

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode>) => {
      setNodes((list) => list.map((n) => (n.id === nodeId ? { ...n, data: { node: { ...n.data.node, ...patch } } } : n)));
      setDirty(true);
    },
    [setNodes],
  );

  const steps = useMemo(() => {
    const map: Record<string, StepLog> = {};
    for (const step of execution?.steps ?? []) map[step.nodeId] = step;
    return map;
  }, [execution]);

  const triggerNode = nodes.find((n) => nodeDef(n.data.node.type)?.kind === "trigger");
  const triggerDef = triggerNode ? nodeDef(triggerNode.data.node.type) : undefined;
  const selectedNode = nodes.find((n) => n.id === selectedId)?.data.node;

  const addNode = (def: NodeDefinition) => {
    const after = def.kind === "trigger" ? undefined : picker?.after;
    const handle = picker?.handle ?? "main";
    setPicker(null);
    const newId = nextNodeId(nodes);
    const anchor = after ? nodes.find((n) => n.id === after) : undefined;
    let position = anchor
      ? { x: anchor.position.x + 280, y: anchor.position.y + (handle === "true" ? -130 : handle === "false" ? 130 : 0) }
      : !nodes.length
        ? { x: 0, y: 0 }
        : def.kind === "trigger"
          ? { x: Math.min(...nodes.map((n) => n.position.x)) - 280, y: nodes[0].position.y }
          : { x: Math.max(...nodes.map((n) => n.position.x)) + 280, y: 0 };
    while (nodes.some((n) => Math.abs(n.position.x - position.x) < 120 && Math.abs(n.position.y - position.y) < 120)) {
      position = { ...position, y: position.y + 160 };
    }
    const credentialId = def.credentialTypes?.length
      ? (credentials.find((c) => def.credentialTypes!.includes(c.type))?.id ?? null)
      : null;
    const node: WorkflowNode = { id: newId, type: def.type, position, params: defaultParams(def), credentialId };
    setNodes((list) => [
      ...list.map((n) => ({ ...n, selected: false })),
      { id: newId, type: "app", position, data: { node }, selected: true },
    ]);
    if (anchor) {
      setEdges((list) => [...list, { id: `e${anchor.id}-${newId}-${handle}`, source: anchor.id, target: newId, sourceHandle: handle }]);
    }
    setSelectedId(newId);
    setSide("node");
    setPanelTab("settings");
    setDirty(true);
  };

  const deleteNode = (nodeId: string) => {
    setNodes((list) => list.filter((n) => n.id !== nodeId));
    setEdges((list) => list.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedId(null);
    setDirty(true);
  };

  const save = useCallback(async (): Promise<Workflow | null> => {
    setSaving(true);
    try {
      const saved = await api<Workflow>(`/workflows/${id}`, {
        method: "PUT",
        body: { name: name.trim() || "سيناريو بدون اسم", graph: toGraph(nodes, edges) },
      });
      setWorkflow(saved);
      setNodes((list) =>
        list.map((n) => {
          const serverNode = saved.graph?.nodes.find((s) => s.id === n.id);
          return serverNode ? { ...n, data: { node: { ...n.data.node, params: serverNode.params } } } : n;
        }),
      );
      setDirty(false);
      return saved;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setSaving(false);
    }
  }, [id, name, nodes, edges, setNodes, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save().then((saved) => saved && toast("اتحفظ", "success"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, toast]);

  const setActive = async (active: boolean) => {
    if (dirty && !(await save())) return;
    try {
      const updated = await api<Workflow>(`/workflows/${id}/activate`, { body: { active } });
      setWorkflow(updated);
      toast(active ? "السيناريو اتفعّل وبقى شغال في الخلفية ✓" : "السيناريو اتوقف", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const runOnce = async () => {
    if (running) {
      runController.current?.abort();
      return;
    }
    if (!triggerNode) {
      toast("ضيف محفّز الأول", "error");
      return;
    }
    const controller = new AbortController();
    runController.current = controller;
    setRunning(true);
    setExecution(null);
    setShowResults(false);
    try {
      const res = await api<RunResponse>(`/workflows/${id}/run`, {
        body: { graph: toGraph(nodes, edges) },
        signal: controller.signal,
      });
      if (res.execution) {
        setExecution(res.execution);
        if (res.execution.status === "success") {
          toast(res.count && res.count > 1 ? `اتشغل ${res.count} مرات بنجاح ✓` : "اتشغل بنجاح ✓", "success");
        } else {
          toast("التشغيل فشل - شوف الخطوة اللي عليها علامة !", "error");
          const failed = res.execution.steps.find((s) => s.status === "error");
          if (failed) {
            setSelectedId(failed.nodeId);
            setSide("node");
            setPanelTab("result");
          }
        }
      } else if (res.message) {
        toast(res.message);
      }
    } catch (e) {
      toast((e as Error).name === "AbortError" ? "اتلغى التشغيل" : (e as Error).message, (e as Error).name === "AbortError" ? "info" : "error");
    } finally {
      setRunning(false);
      runController.current = null;
    }
  };

  const toggleHistory = () => {
    if (side === "history") {
      setSide("node");
      return;
    }
    setSide("history");
    setSelectedId(null);
    setHistory(null);
    api<Execution[]>(`/workflows/${id}/executions`)
      .then(setHistory)
      .catch((e: Error) => toast(e.message, "error"));
  };

  const loadExecution = (executionId: string) =>
    api<Execution>(`/executions/${executionId}`)
      .then(setExecution)
      .catch((e: Error) => toast(e.message, "error"));

  const variableSources = useCallback(
    (nodeId: string): VariableSource[] =>
      upstreamIds(nodeId, edges).flatMap((sourceId) => {
        const source = nodes.find((n) => n.id === sourceId);
        if (!source) return [];
        const def = nodeDef(source.data.node.type);
        const step = steps[sourceId];
        const hasOutput = step?.output !== undefined;
        return [
          {
            id: sourceId,
            name: source.data.node.name || def?.name || source.data.node.type,
            app: def?.app ?? "",
            data: hasOutput ? step.output : def?.sampleOutput,
            isSample: !hasOutput,
          },
        ];
      }),
    [edges, nodes, nodeDef, steps],
  );

  const editorContext = useMemo<EditorContextValue>(
    () => ({
      steps,
      variableSources,
      onAddAfter: (nodeId, handle) => setPicker({ after: nodeId, handle }),
      onOpenStep: (nodeId) => {
        setSelectedId(nodeId);
        setSide("node");
        setPanelTab("result");
      },
    }),
    [steps, variableSources],
  );

  if (loadError) {
    return (
      <div className="page">
        <div className="alert error">{loadError}</div>
      </div>
    );
  }
  if (!workflow) {
    return (
      <div className="empty">
        <Spinner size={28} />
      </div>
    );
  }

  const webhookUrl =
    triggerNode?.data.node.type === "trigger.webhook" ? `${meta.publicUrl}/webhook/${triggerNode.data.node.params.path ?? ""}` : "";
  const addTarget = selectedNode && !nodeDef(selectedNode.type)?.outputs ? selectedNode.id : undefined;

  return (
    <EditorContext.Provider value={editorContext}>
      <div className="editor">
        <div className="editor-top">
          <div className="editor-title">
            <button
              className="btn ghost icon sm"
              title="رجوع للسيناريوهات"
              onClick={() => {
                if (!dirty || window.confirm("فيه تغييرات مش محفوظة. تخرج من غير حفظ؟")) navigate("/");
              }}
            >
              <Icon name="arrowRight" size={18} />
            </button>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              aria-label="اسم السيناريو"
            />
          </div>
          <div className="editor-title" style={{ gap: 10, paddingInline: 12 }}>
            {dirty ? (
              <span className="badge running">تغييرات مش محفوظة</span>
            ) : (
              <span className="faint" style={{ fontSize: 12 }}>
                محفوظ
              </span>
            )}
            <button className="btn sm" onClick={() => save().then((s) => s && toast("اتحفظ", "success"))} disabled={saving}>
              {saving ? <Spinner size={13} /> : <Icon name="save" size={15} />} حفظ
            </button>
            <span className="divider" />
            <span className="row" style={{ gap: 7, fontSize: 13 }}>
              <Toggle on={workflow.active} onChange={setActive} title={workflow.active ? "إيقاف" : "تفعيل"} />
              {workflow.active ? "مفعّل" : "متوقف"}
            </span>
          </div>
        </div>

        {running ? (
          <div className="run-banner">
            <div className="alert info" style={{ boxShadow: "var(--shadow)", alignItems: "center" }}>
              <Spinner size={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {triggerDef?.triggerType === "webhook" ? (
                  <>
                    <strong>مستني طلب يوصل على الـ Webhook (لحد دقيقتين)...</strong>
                    <div className="copy-box" style={{ marginTop: 6 }}>
                      <input className="input mono" readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
                      <button
                        className="btn icon"
                        title="نسخ"
                        onClick={() => copyText(webhookUrl).then((ok) => ok && toast("اتنسخ", "success"))}
                      >
                        <Icon name="copy" size={15} />
                      </button>
                    </div>
                  </>
                ) : triggerDef?.triggerType === "poll" ? (
                  <strong>مستني بيانات جديدة... ابعت رسالة للبوت دلوقتي (لحد دقيقة ونص)</strong>
                ) : (
                  <strong>جاري التشغيل...</strong>
                )}
              </div>
              <button className="btn sm" onClick={() => runController.current?.abort()}>
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          workflow.active &&
          workflow.triggerError && (
            <div className="run-banner">
              <div className="alert error" style={{ boxShadow: "var(--shadow)" }}>
                ⚠ المحفّز فيه مشكلة: {workflow.triggerError.message}
              </div>
            </div>
          )
        )}

        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setSide("node");
              setPanelTab("settings");
            }}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode="Delete"
            minZoom={0.25}
            maxZoom={1.6}
            fitView
          >
            <Background gap={24} color="#cfd3de" />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
        </div>

        {nodes.length === 0 && (
          <div className="empty-canvas">
            <div style={{ textAlign: "center" }}>
              <button onClick={() => setPicker({})} aria-label="إضافة محفّز">
                <Icon name="plus" size={44} />
              </button>
              <div style={{ marginTop: 12, fontWeight: 600 }}>ابدأ باختيار المحفّز</div>
              <div className="muted">إيه اللي يشغّل السيناريو؟ رسالة، Webhook، ميعاد...</div>
            </div>
          </div>
        )}

        <div className="toolbar">
          <button className={`btn ${running ? "" : "primary"}`} onClick={runOnce} disabled={!triggerNode}>
            {running ? (
              <>
                <Icon name="stop" size={15} /> إيقاف
              </>
            ) : (
              <>
                <Icon name="play" size={15} /> تشغيل مرة
              </>
            )}
          </button>
          <span className="divider" />
          <button className="btn ghost sm" onClick={() => setPicker({ after: addTarget, handle: "main" })}>
            <Icon name="plus" size={15} /> {triggerNode ? "خطوة" : "محفّز"}
          </button>
          <button className={`btn ghost sm ${side === "history" ? "active" : ""}`} onClick={toggleHistory}>
            <Icon name="history" size={15} /> السجل
          </button>
          {execution && (
            <button className="btn ghost sm" onClick={() => setShowResults(true)}>
              <StatusBadge status={execution.status} /> النتائج
            </button>
          )}
          <button className="btn ghost icon sm" title="توسيط الكانفس" onClick={() => fitView({ padding: 0.35, maxZoom: 1, duration: 300 })}>
            <Icon name="fit" size={15} />
          </button>
        </div>

        {side === "node" && selectedNode && (
          <NodePanel
            key={selectedNode.id}
            node={selectedNode}
            step={steps[selectedNode.id]}
            credentials={credentials}
            tab={panelTab}
            setTab={setPanelTab}
            onChange={(patch) => updateNode(selectedNode.id, patch)}
            onDelete={() => deleteNode(selectedNode.id)}
            onClose={() => setSelectedId(null)}
            onCredentialCreated={(credential) => setCredentials((list) => [credential, ...list])}
          />
        )}

        {side === "history" && (
          <aside className="panel" aria-label="سجل التشغيلات">
            <div className="panel-head">
              <Icon name="history" />
              <strong style={{ flex: 1 }}>سجل التشغيلات</strong>
              <button className="btn ghost icon sm" onClick={() => setSide("node")}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="panel-body">
              {!history ? (
                <Spinner />
              ) : history.length === 0 ? (
                <div className="faint">لسه مفيش تشغيلات للسيناريو ده.</div>
              ) : (
                <div className="history-list">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      className={`history-item ${execution?.id === h.id ? "active" : ""}`}
                      onClick={() => loadExecution(h.id)}
                    >
                      <StatusBadge status={h.status} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div>
                          {modeLabels[h.mode]} · {h.stepCount} خطوات
                        </div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {timeAgo(h.startedAt)} · {formatDuration(h.durationMs)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {execution && (
                <div className="help" style={{ marginTop: 12 }}>
                  النتيجة ظاهرة على الخطوات في الكانفس - دوس على علامة ✓ أو ! فوق أي خطوة تشوف التفاصيل.
                </div>
              )}
            </div>
          </aside>
        )}

        {picker && <NodePicker onlyTriggers={!triggerNode} onPick={addNode} onClose={() => setPicker(null)} />}
        {showResults && execution && (
          <Modal wide title="نتيجة التشغيل" onClose={() => setShowResults(false)}>
            <ExecutionSteps execution={execution} />
          </Modal>
        )}
      </div>
    </EditorContext.Provider>
  );
}
