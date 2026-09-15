import { createContext, Fragment, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useMeta } from "../context";
import { AppGlyph, Icon } from "../icons";
import type { StepLog } from "../types";
import type { FlowNodeType } from "./graph";

export interface VariableSource {
  id: string;
  name: string;
  app: string;
  data: unknown;
  isSample: boolean;
}

export interface EditorContextValue {
  steps: Record<string, StepLog>;
  onAddAfter: (nodeId: string, handle: string) => void;
  onOpenStep: (nodeId: string) => void;
  variableSources: (nodeId: string) => VariableSource[];
}

export const EditorContext = createContext<EditorContextValue>(null as unknown as EditorContextValue);
export const useEditor = () => useContext(EditorContext);

const CIRCLE_CENTER = 48;
const HANDLE_INSET = 27;

export function FlowNode({ id, data, selected }: NodeProps<FlowNodeType>) {
  const { nodeDef } = useMeta();
  const { steps, onAddAfter, onOpenStep } = useEditor();
  const node = data.node;
  const def = nodeDef(node.type);
  const step = steps[id];
  const isTrigger = def?.kind === "trigger";

  return (
    <div className={`fnode ${selected ? "selected" : ""} ${node.disabled ? "disabled" : ""}`}>
      {!isTrigger && (
        <Handle type="target" position={Position.Left} className="fhandle" style={{ top: CIRCLE_CENTER, left: HANDLE_INSET }} />
      )}
      <div className="fnode-circle" style={{ background: def?.color ?? "#94a3b8" }}>
        <AppGlyph app={def?.app ?? ""} size={42} />
        {isTrigger && (
          <span className="fnode-trigger" title="المحفّز">
            <Icon name="zap" size={16} />
          </span>
        )}
      </div>
      {step && (
        <span
          className={`fnode-bubble ${step.status}`}
          title="عرض النتيجة"
          onClick={(e) => {
            e.stopPropagation();
            onOpenStep(id);
          }}
        >
          {step.status === "success" ? "✓" : step.status === "error" ? "!" : "–"}
        </span>
      )}
      <div className="fnode-title">{node.name || def?.appName || node.type}</div>
      <div className="fnode-sub">
        {def?.name ?? "غير معروف"}
        <span className="fnode-id">{id}</span>
      </div>

      {def?.outputs ? (
        def.outputs.map((output, i) => {
          const top = CIRCLE_CENTER - 20 + i * 40;
          return (
            <Fragment key={output.key}>
              <Handle
                id={output.key}
                type="source"
                position={Position.Right}
                className="fhandle source"
                style={{ top, right: HANDLE_INSET }}
              />
              <button
                className="handle-label nodrag"
                style={{
                  top: top - 10,
                  right: -18,
                  border: 0,
                  cursor: "pointer",
                  color: output.key === "true" ? "var(--success)" : "var(--danger)",
                }}
                title={`إضافة خطوة في فرع «${output.label}»`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAfter(id, output.key);
                }}
              >
                {output.label} +
              </button>
            </Fragment>
          );
        })
      ) : (
        <>
          <Handle
            id="main"
            type="source"
            position={Position.Right}
            className="fhandle source"
            style={{ top: CIRCLE_CENTER, right: HANDLE_INSET }}
          />
          <button
            className="fnode-add nodrag"
            title="إضافة خطوة بعدها"
            onClick={(e) => {
              e.stopPropagation();
              onAddAfter(id, "main");
            }}
          >
            <Icon name="plus" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
