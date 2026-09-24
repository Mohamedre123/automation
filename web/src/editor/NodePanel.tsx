import { useState } from "react";
import { AppIcon, StatusBadge, Toggle, formatDuration } from "../components/ui";
import { useMeta } from "../context";
import { Icon } from "../icons";
import { CredentialModal } from "../pages/Credentials";
import { StepDetails } from "../pages/Executions";
import type { Credential, StepLog, WorkflowNode } from "../types";
import { BotLearning } from "./BotLearning";
import { FieldInput } from "./fields";
import { isFieldVisible } from "./graph";

export function NodePanel({
  node,
  step,
  credentials,
  tab,
  setTab,
  onChange,
  onDelete,
  onClose,
  onCredentialCreated,
  onAutoFill,
  workflowId,
  triggerType,
}: {
  node: WorkflowNode;
  step?: StepLog;
  credentials: Credential[];
  tab: "settings" | "result";
  setTab: (tab: "settings" | "result") => void;
  onChange: (patch: Partial<WorkflowNode>) => void;
  onDelete: () => void;
  onClose: () => void;
  onCredentialCreated: (credential: Credential) => void;
  onAutoFill?: () => number;
  /** The scenario being edited - a chatbot step shows what it learned in this scenario. */
  workflowId?: string;
  /** What starts the scenario - the chatbot guide depends on the channel customers write on. */
  triggerType?: string;
}) {
  const { nodeDef, credType } = useMeta();
  const [credentialModal, setCredentialModal] = useState(false);
  const def = nodeDef(node.type);
  if (!def) return null;

  const setParam = (key: string, value: unknown) => onChange({ params: { ...node.params, [key]: value } });
  const matching = credentials.filter((c) => def.credentialTypes?.includes(c.type));
  const showResult = tab === "result" && step;
  const selectedType = credType(matching.find((c) => c.id === node.credentialId)?.type ?? def.credentialTypes?.[0] ?? "");
  const models = selectedType?.models ?? [];

  return (
    <aside className="panel" aria-label="إعدادات الخطوة">
      <div className="panel-head">
        <AppIcon app={def.app} size={36} />
        <input value={node.name ?? ""} placeholder={def.appName} onChange={(e) => onChange({ name: e.target.value })} aria-label="اسم الخطوة" />
        <span className="fnode-id">{node.id}</span>
        <button className="btn ghost icon sm danger" title="حذف الخطوة" onClick={onDelete}>
          <Icon name="trash" size={16} />
        </button>
        <button className="btn ghost icon sm" title="إغلاق" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="tabs">
        <button className={`tab ${!showResult ? "active" : ""}`} onClick={() => setTab("settings")}>
          الإعدادات
        </button>
        <button className={`tab ${showResult ? "active" : ""}`} onClick={() => setTab("result")} disabled={!step}>
          النتيجة {step && (step.status === "success" ? "✓" : step.status === "error" ? "⚠" : "")}
        </button>
      </div>

      <div className="panel-body">
        {showResult ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <StatusBadge status={step.status} />
              <span className="faint">{formatDuration(step.durationMs)}</span>
              {(step.attempts ?? 1) > 1 && <span className="faint">· اتجربت {step.attempts} مرات</span>}
            </div>
            <StepDetails step={step} />
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              <strong>{def.name}</strong> - {def.description}
            </p>
            {def.guide?.length ? (
              <details className="guide" open>
                <summary>
                  <Icon name="sparkles" size={14} /> إزاي بيشتغل
                </summary>
                <ol>
                  {def.guide.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              </details>
            ) : null}

            {def.credentialTypes?.length ? (
              <div className="field">
                <label className="label">
                  الحساب (Credential) {!def.credentialOptional && <span className="req">*</span>}
                </label>
                <div className="row">
                  <select
                    className="select"
                    value={node.credentialId ?? ""}
                    onChange={(e) => onChange({ credentialId: e.target.value || null })}
                  >
                    <option value="">{def.credentialOptional ? "بدون مصادقة" : "— اختار حساب —"}</option>
                    {matching.map((c) => {
                      const typeName = credType(c.type)?.name;
                      return (
                        <option key={c.id} value={c.id}>
                          {typeName && typeName !== c.name ? `${c.name} (${typeName})` : c.name}
                        </option>
                      );
                    })}
                  </select>
                  <button className="btn" onClick={() => setCredentialModal(true)}>
                    <Icon name="plus" size={15} /> ربط
                  </button>
                </div>
                {matching.length === 0 && (
                  <div className="help">مفيش حساب مربوط لسه - دوس «ربط» وهتلاقي شرح إزاي تجيب المفتاح خطوة بخطوة</div>
                )}
                {def.credentialTypes.length > 1 && (
                  <div className="help">
                    اختار الحساب اللي عندك مفتاحه ({def.credentialTypes.map((t) => credType(t)?.name ?? t).join(" أو ")}) - الخطوة هتشتغل بيه
                  </div>
                )}
              </div>
            ) : null}

            {def.fields.some((f) => f.autoFill) && (
              <div className="autofill-bar">
                <Icon name="zap" size={14} />
                <span>الكابشن والصورة والفيديو بيتربطوا تلقائي بالخطوات اللي قبلها - سيب الخانة فاضية، أو اكتب فيها لو عايز حاجة معينة</span>
              </div>
            )}

            {def.fields
              .filter((field) => isFieldVisible(def, field.key, node.params))
              .map((field) =>
                field.type === "boolean" ? (
                  <div className="field row" key={field.key} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div className="label" style={{ marginBottom: 0 }}>
                        {field.label}
                      </div>
                      {field.help && <div className="help">{field.help}</div>}
                    </div>
                    <FieldInput
                      field={field}
                      value={node.params[field.key] ?? field.default}
                      onChange={(v) => setParam(field.key, v)}
                      nodeId={node.id}
                      models={models}
                      credentialId={node.credentialId}
                      credentials={credentials}
                      onCredentialCreated={onCredentialCreated}
                    />
                  </div>
                ) : (
                  <div className="field" key={field.key}>
                    <label className="label">
                      {field.label} {field.required && <span className="req">*</span>}
                    </label>
                    <FieldInput
                      field={field}
                      value={node.params[field.key] ?? field.default}
                      onChange={(v) => setParam(field.key, v)}
                      nodeId={node.id}
                      models={models}
                      credentialId={node.credentialId}
                      credentials={credentials}
                      onCredentialCreated={onCredentialCreated}
                    />
                    {field.help && <div className="help">{field.help}</div>}
                    {(field.type === "text" || field.type === "textarea") &&
                      /image|photo|video|media|file|images/i.test(field.key) &&
                      !String(field.help ?? "").includes("@") && <div className="help">💡 اكتب @ عشان تختار صورة من مكتبة الصور</div>}
                  </div>
                ),
              )}

            {def.type === "ai.agent" && workflowId && <BotLearning workflowId={workflowId} params={node.params} triggerType={triggerType} />}

            {def.kind !== "trigger" && (
              <>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 6 }}>
                  <div className="label">إعدادات متقدمة</div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <span>كمّل السيناريو حتى لو الخطوة دي فشلت</span>
                    <Toggle on={Boolean(node.continueOnFail)} onChange={(v) => onChange({ continueOnFail: v })} />
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <span>تعطيل الخطوة (هتتخطّى هي واللي بعدها)</span>
                    <Toggle on={Boolean(node.disabled)} onChange={(v) => onChange({ disabled: v })} />
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <span>لو فشلت، جرّب تاني</span>
                    <select
                      value={String(node.retries ?? 0)}
                      onChange={(e) => onChange({ retries: Number(e.target.value) })}
                      style={{ width: 120 }}
                    >
                      <option value="0">لأ، مرة واحدة</option>
                      <option value="1">مرة كمان</option>
                      <option value="2">مرتين كمان</option>
                      <option value="3">٣ مرات كمان</option>
                      <option value="5">٥ مرات كمان</option>
                    </select>
                  </div>
                  {Number(node.retries ?? 0) > 0 && (
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>يستنى كام ثانية قبل ما يعيد</span>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={node.retryWaitSeconds ?? 5}
                        onChange={(e) => onChange({ retryWaitSeconds: Number(e.target.value) })}
                        style={{ width: 120 }}
                      />
                    </div>
                  )}
                  <div className="help" style={{ marginTop: 6 }}>
                    بيعيد المحاولة بس لما تكون المشكلة مؤقتة (النت، الخدمة زحمة، الوقت خلص). لو المشكلة في المفتاح أو حقل ناقص مش هيضيّع وقت في إعادة - وكل مرة بيستنى ضِعف اللي قبلها
                  </div>
                </div>
                <div className="alert info" style={{ marginTop: 14 }}>
                  <Icon name="braces" size={16} />
                  <span>دوس على الزرار ده جنب أي حقل عشان تستخدم بيانات من الخطوات اللي قبلها</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {credentialModal && (
        <CredentialModal
          types={def.credentialTypes}
          onClose={() => setCredentialModal(false)}
          onSaved={(credential) => {
            setCredentialModal(false);
            onCredentialCreated(credential);
            onChange({ credentialId: credential.id });
          }}
        />
      )}
    </aside>
  );
}
