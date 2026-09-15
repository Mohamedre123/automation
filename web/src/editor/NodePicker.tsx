import { useState } from "react";
import { AppIcon, Modal } from "../components/ui";
import { useMeta } from "../context";
import type { NodeDefinition } from "../types";

const GROUPS: [string, string][] = [
  ["all", "الكل"],
  ["ai", "الذكاء الاصطناعي"],
  ["apps", "التطبيقات"],
  ["logic", "التحكم في المسار"],
  ["data", "البيانات"],
];

export function NodePicker({
  onlyTriggers,
  onPick,
  onClose,
}: {
  onlyTriggers: boolean;
  onPick: (def: NodeDefinition) => void;
  onClose: () => void;
}) {
  const { meta } = useMeta();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");

  const pool = meta.nodes.filter((n) => (onlyTriggers ? n.kind === "trigger" : n.kind !== "trigger"));
  const q = query.trim().toLowerCase();
  const list = pool
    .filter((n) => onlyTriggers || group === "all" || n.group === group)
    .filter((n) => !q || `${n.name} ${n.appName} ${n.description} ${n.type}`.toLowerCase().includes(q));

  return (
    <Modal title={onlyTriggers ? "اختار المحفّز - إيه اللي يشغّل السيناريو؟" : "إضافة خطوة"} onClose={onClose}>
      <input
        autoFocus
        className="input"
        style={{ marginBottom: 12 }}
        placeholder="ابحث: تيليجرام، Claude، HTTP، شرط..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!onlyTriggers && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {GROUPS.filter(([g]) => g === "all" || pool.some((n) => n.group === g)).map(([g, label]) => (
            <button key={g} className={`chip ${group === g ? "active" : ""}`} onClick={() => setGroup(g)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="picker-list">
        {list.map((n) => (
          <button key={n.type} className="node-option" onClick={() => onPick(n)}>
            <AppIcon app={n.app} size={40} />
            <div>
              <strong>
                {n.appName} · {n.name}
              </strong>
              <span className="desc">{n.description}</span>
            </div>
          </button>
        ))}
        {!list.length && <div className="faint">مفيش نتائج</div>}
      </div>
    </Modal>
  );
}
