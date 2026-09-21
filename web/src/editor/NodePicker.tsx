import { useMemo, useState } from "react";
import { AppIcon, Modal } from "../components/ui";
import { useMeta } from "../context";
import { Icon } from "../icons";
import type { NodeDefinition } from "../types";

interface AppGroup {
  app: string;
  name: string;
  nodes: NodeDefinition[];
}

/** Make-style picker: choose the app first, then one of its triggers or actions. Search looks across everything. */
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
  const [app, setApp] = useState<string | null>(null);

  const pool = useMemo(
    () => meta.nodes.filter((n) => (onlyTriggers ? n.kind === "trigger" : n.kind !== "trigger")),
    [meta.nodes, onlyTriggers],
  );

  const groups = useMemo(() => {
    const map = new Map<string, AppGroup>();
    for (const node of pool) {
      const group = map.get(node.app) ?? { app: node.app, name: node.app === "whatsapp" ? "واتساب" : node.appName, nodes: [] };
      group.nodes.push(node);
      map.set(node.app, group);
    }
    return [...map.values()];
  }, [pool]);

  const q = query.trim().toLowerCase();
  const results = q ? pool.filter((n) => `${n.name} ${n.appName} ${n.description} ${n.type}`.toLowerCase().includes(q)) : null;
  const selected = groups.find((g) => g.app === app);

  const nodeList = (nodes: NodeDefinition[], showApp: boolean) => (
    <div className="picker-list">
      {nodes.map((n) => (
        <button key={n.type} className="node-option" onClick={() => onPick(n)}>
          <AppIcon app={n.app} size={40} />
          <div style={{ minWidth: 0 }}>
            <strong>{showApp ? `${n.appName} · ${n.name}` : n.name}</strong>
            <span className="desc">{n.description}</span>
          </div>
        </button>
      ))}
      {!nodes.length && <div className="faint">مفيش نتائج - جرّب كلمة تانية، أو استخدم خطوة HTTP لأي API</div>}
    </div>
  );

  return (
    <Modal wide title={onlyTriggers ? "اختار المحفّز - إيه اللي يشغّل السيناريو؟" : "إضافة خطوة"} onClose={onClose}>
      <div className="search-box" style={{ margin: "0 0 16px", maxWidth: "none" }}>
        <Icon name="search" size={18} />
        <input
          autoFocus
          placeholder={onlyTriggers ? "ابحث: واتساب، فورم، طلب جديد، RSS..." : "ابحث: إيميل، شيت، Claude، شرط، تكرار..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {results ? (
        nodeList(results, true)
      ) : selected ? (
        <>
          <button className="btn ghost sm" style={{ marginBottom: 10 }} onClick={() => setApp(null)}>
            <Icon name="arrowRight" size={15} /> كل التطبيقات
          </button>
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <AppIcon app={selected.app} size={44} />
            <div>
              <strong style={{ fontSize: 16 }}>{selected.name}</strong>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {selected.nodes.length} {onlyTriggers ? "محفّز" : "خطوة"}
              </div>
            </div>
          </div>
          {nodeList(selected.nodes, false)}
        </>
      ) : (
        <div className="app-grid">
          {groups.map((group) => (
            <button
              key={group.app}
              className="app-tile"
              onClick={() => (group.nodes.length === 1 ? onPick(group.nodes[0]) : setApp(group.app))}
            >
              <AppIcon app={group.app} size={46} />
              <strong>{group.name}</strong>
              <span className="faint">
                {group.nodes.length === 1 ? group.nodes[0].name : `${group.nodes.length} ${onlyTriggers ? "محفّزات" : "خطوات"}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
