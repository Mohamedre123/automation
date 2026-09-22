import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { copyText, Empty, Modal, Spinner, timeAgo, useToast } from "../components/ui";
import { Icon } from "../icons";

type Mode = "build" | "run";

interface Toolbox {
  id: string;
  name: string;
  mode: Mode;
  tokenHint: string;
  workflowIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface Scenario {
  id: string;
  name: string;
  trigger: string;
  usable: boolean;
}

export function McpSetup({ url }: { url: string }) {
  const toast = useToast();
  const cursorJson = JSON.stringify({ mcpServers: { tadfuq: { url } } }, null, 2);
  const desktopJson = JSON.stringify({ mcpServers: { tadfuq: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2);
  const copy = (text: string) => copyText(text).then(() => toast("اتنسخ ✓", "success"));
  return (
    <div className="mcp-setup">
      <div className="mcp-url">
        <span className="mono">{url}</span>
        <button className="btn sm primary" onClick={() => copy(url)}>
          <Icon name="copy" size={14} /> نسخ
        </button>
      </div>
      <p className="alert error" style={{ fontSize: 13 }}>
        الرابط ده زي كلمة السر: أي حد معاه يقدر يشغّل السيناريوهات دي. مش هيظهر تاني - لو ضاع اعمل رابط جديد
      </p>
      <details className="guide" open>
        <summary>
          <Icon name="sparkles" size={15} /> Claude (claude.ai أو التطبيق)
        </summary>
        <ol>
          <li>افتح Settings ← Connectors ← Add custom connector</li>
          <li>اكتب اسم (مثلاً تدفّق) والصق الرابط، ودوس Add</li>
          <li>في أي محادثة فعّل الـ connector، وقول لـ Claude يشغّل السيناريو اللي انت عايزه</li>
        </ol>
      </details>
      <details className="guide">
        <summary>
          <Icon name="sparkles" size={15} /> ChatGPT
        </summary>
        <ol>
          <li>Settings ← Apps & Connectors ← Advanced settings ← فعّل Developer mode</li>
          <li>ارجع لـ Apps & Connectors ← Create، والصق الرابط في MCP Server URL، واختار Authentication: No authentication</li>
          <li>في المحادثة اختار الـ connector من علامة + وقوله يشغّل السيناريو</li>
        </ol>
      </details>
      <details className="guide">
        <summary>
          <Icon name="braces" size={15} /> Cursor / VS Code / أي برنامج بيدعم MCP
        </summary>
        <p className="muted">ضيف ده في ملف إعدادات MCP (مثلاً ‎.cursor/mcp.json):</p>
        <pre className="code-block">{cursorJson}</pre>
        <button className="btn sm" onClick={() => copy(cursorJson)}>
          <Icon name="copy" size={14} /> نسخ
        </button>
      </details>
      <details className="guide">
        <summary>
          <Icon name="braces" size={15} /> Claude Desktop (ملف الإعدادات)
        </summary>
        <p className="muted">لو نسختك مفيهاش Custom connector، ضيف ده في claude_desktop_config.json (محتاج Node.js):</p>
        <pre className="code-block">{desktopJson}</pre>
        <button className="btn sm" onClick={() => copy(desktopJson)}>
          <Icon name="copy" size={14} /> نسخ
        </button>
      </details>
    </div>
  );
}

function ToolboxModal({
  existing,
  scenarios,
  onClose,
  onSaved,
}: {
  existing?: Toolbox;
  scenarios: Scenario[];
  onClose: () => void;
  onSaved: (url?: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [mode, setMode] = useState<Mode>(existing?.mode ?? "build");
  const [selected, setSelected] = useState<string[]>(existing?.workflowIds ?? []);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const save = async () => {
    setBusy(true);
    try {
      if (existing) {
        await api(`/mcp/toolboxes/${existing.id}`, { method: "PUT", body: { name, mode, workflowIds: selected } });
        onSaved();
      } else {
        const res = await api<{ url: string }>("/mcp/toolboxes", { body: { name, mode, workflowIds: selected } });
        onSaved(res.url);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? "تعديل الـ Toolbox" : "Toolbox جديد"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Spinner size={14} /> : existing ? "حفظ" : "اعمل الرابط"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label">الاسم</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: تدفّق" />
      </div>

      <label className="label">الذكاء الاصطناعي يقدر يعمل إيه؟</label>
      <div className="mcp-modes">
        <button type="button" className={`mcp-mode ${mode === "build" ? "on" : ""}`} onClick={() => setMode("build")}>
          <strong>
            <Icon name="sparkles" size={15} /> يبني ويعدّل سيناريوهات
          </strong>
          <span>
            بيشوف كل خطوات المنصة والتيمبلت وحساباتك، ويعمل سيناريوهات جديدة ويصلّحها ويجرّبها - وتلاقيها ظهرت في حسابك على طول
          </span>
        </button>
        <button type="button" className={`mcp-mode ${mode === "run" ? "on" : ""}`} onClick={() => setMode("run")}>
          <strong>
            <Icon name="play" size={15} /> يشغّل سيناريوهات محددة بس
          </strong>
          <span>مش هيقدر يبني ولا يعدّل - هيشوف السيناريوهات اللي تختارها تحت ويشغّلها لما تطلب منه</span>
        </button>
      </div>

      <label className="label">
        سيناريوهات يقدر يشغّلها {mode === "build" ? "(اختياري - هو أصلاً بيشوفهم كلهم)" : ""}
      </label>
      <div className="mcp-pick">
        {scenarios.map((s) => (
          <label key={s.id} className={`mcp-pick-row ${s.usable ? "" : "disabled"}`}>
            <input type="checkbox" disabled={!s.usable} checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
            <span>
              {s.name}
              {!s.usable && <span className="faint"> - محفّزه لازم يكون Webhook أو فورم أو تشغيل يدوي</span>}
            </span>
          </label>
        ))}
        {!scenarios.length && <div className="faint">مفيش سيناريوهات لسه - اعمل سيناريو بمحفّز Webhook أو فورم الأول</div>}
      </div>
      <p className="help">
        {mode === "build"
          ? "الرابط ده بيدي الذكاء الاصطناعي نفس صلاحياتك في بناء السيناريوهات. أي سيناريو بيتعمل بيبقى متوقف لحد ما تفعّله انت، والتشغيل بياخد كريديت عادي"
          : "كل سيناريو بيظهر كأداة: الذكاء الاصطناعي يبعتله البيانات ويستلم النتيجة. التشغيل بياخد كريديت عادي"}
      </p>
    </Modal>
  );
}

export function Mcp() {
  const toast = useToast();
  const [data, setData] = useState<{ toolboxes: Toolbox[]; scenarios: Scenario[] } | null>(null);
  const [editing, setEditing] = useState<{ existing?: Toolbox } | null>(null);
  const [freshUrl, setFreshUrl] = useState("");

  const load = useCallback(() => {
    api<{ toolboxes: Toolbox[]; scenarios: Scenario[] }>("/mcp/toolboxes")
      .then(setData)
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  const rotate = async (t: Toolbox) => {
    if (!window.confirm("الرابط القديم هيبطل يشتغل فوراً. تعمل رابط جديد؟")) return;
    const res = await api<{ url: string }>(`/mcp/toolboxes/${t.id}/rotate`, { method: "POST" }).catch((e: Error) => {
      toast(e.message, "error");
      return null;
    });
    if (res) setFreshUrl(res.url);
    load();
  };

  const remove = async (t: Toolbox) => {
    if (!window.confirm(`تمسح «${t.name}»؟ أي برنامج متوصل بيه هيفصل`)) return;
    await api(`/mcp/toolboxes/${t.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "error"));
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>MCP - شغّل سيناريوهاتك من Claude و ChatGPT</h1>
          <p>اعمل Toolbox فيه السيناريوهات اللي عايزها، وخد رابط واحد تحطه في أي مساعد ذكي بيدعم MCP</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={16} /> Toolbox جديد
        </button>
      </div>

      {!data ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : data.toolboxes.length === 0 ? (
        <div className="card">
          <Empty
            icon="plug"
            title="مفيش Toolbox لسه"
            text="مثلاً: قول لـ Claude «سجّل العميل ده في الشيت وابعتله رسالة ترحيب» وهو يشغّل السيناريو بتاعك بنفسه"
            action={
              <button className="btn primary" onClick={() => setEditing({})}>
                اعمل أول Toolbox
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid">
          {data.toolboxes.map((t) => (
            <div key={t.id} className="card tpl">
              <div className="row" style={{ gap: 12 }}>
                <span className="app-icon" style={{ width: 40, height: 40, background: "var(--grad)" }}>
                  <Icon name="plug" size={20} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <h3>{t.name}</h3>
                  <div className="faint" style={{ fontSize: 12 }}>
                    الرابط بينتهي بـ …{t.tokenHint} · {t.lastUsedAt ? `آخر استخدام ${timeAgo(t.lastUsedAt)}` : "لسه ما اتستخدمش"}
                  </div>
                </div>
              </div>
              <div className="chips">
                <span className={`badge ${t.mode === "build" ? "success" : ""}`} style={{ marginInlineEnd: 6 }}>
                  {t.mode === "build" ? "بيبني ويعدّل" : "بيشغّل بس"}
                </span>
                {t.workflowIds.map((id) => (
                  <span key={id} className="chip">
                    {data.scenarios.find((s) => s.id === id)?.name ?? "سيناريو اتمسح"}
                  </span>
                ))}
                {!t.workflowIds.length && t.mode !== "build" && <span className="faint">مفيش سيناريوهات - دوس تعديل وضيف</span>}
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn sm" onClick={() => setEditing({ existing: t })}>
                  تعديل
                </button>
                <button className="btn sm" onClick={() => rotate(t)}>
                  رابط جديد
                </button>
                <button className="btn sm danger" onClick={() => remove(t)}>
                  حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 18, marginTop: 22 }}>
        <h3 style={{ marginBottom: 8 }}>
          <Icon name="sparkles" size={16} /> وبالعكس: استخدم أدوات MCP جوه السيناريو
        </h3>
        <p className="muted" style={{ margin: 0 }}>
          خطوة «أداة من خادم MCP» بتخلّي أي سيناريو يشغّل أدوات من خدمات تانية بتدعم MCP. ضيفها من المحرر، واربط رابط الخادم من{" "}
          <Link to="/app/credentials">الحسابات</Link>.
        </p>
      </div>

      {editing && data && (
        <ToolboxModal
          existing={editing.existing}
          scenarios={data.scenarios}
          onClose={() => setEditing(null)}
          onSaved={(url) => {
            setEditing(null);
            if (url) setFreshUrl(url);
            else toast("اتحفظ ✓", "success");
            load();
          }}
        />
      )}
      {freshUrl && (
        <Modal title="رابط MCP بتاعك جاهز" onClose={() => setFreshUrl("")} wide>
          <McpSetup url={freshUrl} />
        </Modal>
      )}
    </div>
  );
}
