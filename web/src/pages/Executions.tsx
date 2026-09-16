import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  AppIcon,
  Empty,
  JsonView,
  Modal,
  Spinner,
  StatusBadge,
  formatDateTime,
  formatDuration,
  modeLabels,
  timeAgo,
  useToast,
} from "../components/ui";
import { useMeta } from "../context";
import type { Execution, StepLog } from "../types";

export function StepDetails({ step }: { step: StepLog }) {
  return (
    <div className="steps" style={{ gap: 12 }}>
      {step.error && <div className="alert error">{step.error}</div>}
      {step.branch && (
        <div className="muted">
          الفرع اللي اتمشى فيه: <strong>{step.branch === "true" ? "نعم" : step.branch === "false" ? "لا" : step.branch}</strong>
        </div>
      )}
      {step.input !== undefined && (
        <div>
          <div className="label">المدخلات (بعد تعويض المتغيرات)</div>
          <JsonView value={step.input} />
        </div>
      )}
      {step.output !== undefined && (
        <div>
          <div className="label">المخرجات</div>
          <JsonView value={step.output} />
        </div>
      )}
    </div>
  );
}

export function ExecutionSteps({ execution }: { execution: Execution }) {
  const { nodeDef } = useMeta();
  const firstError = execution.steps.findIndex((s) => s.status === "error");
  const [open, setOpen] = useState<number>(firstError >= 0 ? firstError : execution.steps.length - 1);
  return (
    <div className="steps">
      {execution.error && <div className="alert error">{execution.error}</div>}
      {execution.steps.map((step, i) => (
        <div className="step" key={`${step.nodeId}-${i}`}>
          <div className="step-head" onClick={() => setOpen(open === i ? -1 : i)}>
            <AppIcon app={nodeDef(step.type)?.app ?? ""} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{step.name}</strong> <span className="fnode-id">{step.nodeId}</span>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>
              {formatDuration(step.durationMs)}
            </span>
            <StatusBadge status={step.status} />
          </div>
          {open === i && (
            <div className="step-body">
              <StepDetails step={step} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ExecutionModal({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Execution>(`/executions/${executionId}`).then(setExecution).catch((e: Error) => setError(e.message));
  }, [executionId]);
  return (
    <Modal
      wide
      title={execution ? `تشغيل «${execution.workflowName ?? ""}»` : "تفاصيل التشغيل"}
      onClose={onClose}
      footer={
        execution && (
          <Link className="btn" to={`/app/workflows/${execution.workflowId}`}>
            فتح السيناريو
          </Link>
        )
      }
    >
      {error && <div className="alert error">{error}</div>}
      {!execution && !error && <Spinner />}
      {execution && (
        <>
          <div className="row muted" style={{ gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <StatusBadge status={execution.status} />
            <span>{modeLabels[execution.mode]}</span>
            <span>{formatDateTime(execution.startedAt)}</span>
            <span>المدة: {formatDuration(execution.durationMs)}</span>
          </div>
          <ExecutionSteps execution={execution} />
        </>
      )}
    </Modal>
  );
}

export function Executions() {
  const toast = useToast();
  const [items, setItems] = useState<Execution[] | null>(null);
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState("");

  const load = useCallback(() => {
    api<Execution[]>(`/executions?limit=100${status ? `&status=${status}` : ""}`)
      .then(setItems)
      .catch((e: Error) => toast(e.message, "error"));
  }, [status, toast]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>سجل التشغيلات</h1>
          <p>كل مرة سيناريو اشتغل: نجح ولا فشل، وإيه اللي حصل في كل خطوة.</p>
        </div>
        <button className="btn" onClick={load}>
          تحديث
        </button>
      </div>
      <div className="chips">
        {[
          ["", "الكل"],
          ["success", "نجح"],
          ["error", "فشل"],
        ].map(([value, label]) => (
          <button key={value} className={`chip ${status === value ? "active" : ""}`} onClick={() => setStatus(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        {!items ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty icon="history" title="مفيش تشغيلات" text="أول ما سيناريو يشتغل هيظهر هنا." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>السيناريو</th>
                  <th>الحالة</th>
                  <th>المصدر</th>
                  <th>الخطوات</th>
                  <th>المدة</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => setOpenId(e.id)}>
                    <td>
                      <strong>{e.workflowName}</strong>
                      {e.error && (
                        <div style={{ color: "var(--danger)", fontSize: 12, maxWidth: 380 }} className="truncate">
                          {e.error}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="muted">{modeLabels[e.mode]}</td>
                    <td>{e.stepCount}</td>
                    <td className="muted">{formatDuration(e.durationMs)}</td>
                    <td className="muted" title={formatDateTime(e.startedAt)}>
                      {timeAgo(e.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openId && <ExecutionModal executionId={openId} onClose={() => setOpenId("")} />}
    </div>
  );
}
