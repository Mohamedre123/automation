import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Icon } from "../icons";
import { Spinner } from "./ui";

interface AssistantAction {
  type: "workflow_created" | "workflow_updated";
  workflowId: string;
  name?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  actions?: AssistantAction[];
  error?: boolean;
}

const SUGGESTIONS = [
  "ابنيلي بوت واتساب يرد على العملاء من معلومات شركتي ويحوّلهم ليا لو طلبوا موظف",
  "عايز كل يوم الساعة 6 ينشر منتج من صوري على إنستجرام بصورة إعلانية",
  "آخر تشغيل للسيناريو فشل ليه؟ وإزاي أصلّحه؟",
  "إيه الفرق بين الفورم والـ Webhook؟",
];

export function AssistantLauncher() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inEditor = location.pathname.startsWith("/app/workflows/");

  return (
    <>
      {!open && (
        <button className={`assistant-fab ${inEditor ? "raised" : ""}`} onClick={() => setOpen(true)} aria-label="افتح مساعد تدفّق">
          <Icon name="sparkles" size={20} />
          <span>المساعد الذكي</span>
        </button>
      )}
      {open && <AssistantPanel messages={messages} setMessages={setMessages} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantPanel({
  messages,
  setMessages,
  onClose,
}: {
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  onClose: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const workflowId = location.pathname.match(/^\/app\/workflows\/([^/]+)/)?.[1];
  const [status, setStatus] = useState<{ available: boolean; reason?: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ available: boolean; reason?: string }>("/assistant/status")
      .then(setStatus)
      .catch(() => setStatus({ available: false, reason: "error" }));
  }, []);

  // Phones: size the panel to the *visible* viewport so the input stays above browser bars and the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--vv-height", `${vv.height}px`);
      root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    document.body.classList.add("assistant-open");
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      document.body.classList.remove("assistant-open");
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", text: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api<{ reply: string; actions: AssistantAction[] }>("/assistant/chat", {
        body: { messages: next.filter((m) => !m.error).map(({ role, text: content }) => ({ role, text: content })), workflowId },
      });
      setMessages([...next, { role: "assistant", text: res.reply, actions: res.actions }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", text: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <aside className="assistant-panel" aria-label="مساعد تدفّق">
      <div className="assistant-head">
        <span className="brand-mark" style={{ width: 34, height: 34 }}>
          <Icon name="sparkles" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>مساعد تدفّق</strong>
          <div className="faint" style={{ fontSize: 12 }}>
            بيبني الأتمتة معاك ويحل الأخطاء
          </div>
        </div>
        {messages.length > 0 && (
          <button className="btn ghost sm" onClick={() => setMessages([])} title="محادثة جديدة">
            جديد
          </button>
        )}
        <button className="btn ghost icon sm" onClick={onClose} aria-label="إغلاق">
          <Icon name="x" size={17} />
        </button>
      </div>

      {!status ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !status.available ? (
        <div className="assistant-locked">
          <div className="empty-icon">
            <Icon name="sparkles" size={28} />
          </div>
          <h3>{status.reason === "plan" ? "المساعد الذكي في الباقة الاحترافية" : "المساعد لسه مش متفعّل"}</h3>
          <p className="muted">
            {status.reason === "plan"
              ? "المساعد بيبنيلك السيناريو كامل من وصف بسيط، وبيقرا سجل التشغيل ويقولك سبب أي خطأ وإزاي تحلّه. هيكون متاح مع الباقة الاحترافية قريباً."
              : "صاحب المنصة محتاج يضيف مفتاح Claude (ANTHROPIC_API_KEY) في إعدادات السيرفر."}
          </p>
          {status.reason === "plan" && (
            <Link className="btn primary" to="/pricing" onClick={onClose}>
              شوف الباقات
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="assistant-body" ref={scroller}>
            {messages.length === 0 && (
              <div className="assistant-welcome">
                <p>
                  أهلاً! قولي عايز تأتمت إيه وأنا هبنيلك السيناريو، أو اسألني عن أي خطأ في سيناريوهاتك.
                  {workflowId && " (شايف إنك فاتح سيناريو دلوقتي - تقدر تسألني عنه مباشرة.)"}
                </p>
                <div className="suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} className="suggestion" onClick={() => void send(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, i) => (
              <div key={i} className={`bubble ${message.role} ${message.error ? "error" : ""}`}>
                <div className="bubble-text">{message.text}</div>
                {message.actions?.map((action) => (
                  <button
                    key={`${action.type}-${action.workflowId}`}
                    className="btn primary sm"
                    onClick={() => {
                      if (action.type === "workflow_updated" && action.workflowId === workflowId) window.location.reload();
                      else {
                        navigate(`/app/workflows/${action.workflowId}`);
                        onClose();
                      }
                    }}
                  >
                    <Icon name="flows" size={14} />
                    {action.type === "workflow_created"
                      ? `افتح «${action.name ?? "السيناريو"}»`
                      : action.workflowId === workflowId
                        ? "حدّث المحرر لرؤية التعديل"
                        : "افتح السيناريو المعدّل"}
                  </button>
                ))}
              </div>
            ))}
            {busy && (
              <div className="bubble assistant typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
          <div className="assistant-input">
            <textarea
              className="textarea"
              rows={2}
              dir="auto"
              placeholder="اكتب طلبك... (Enter للإرسال)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
            />
            <button className="btn primary icon" onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label="إرسال">
              <Icon name="send" size={17} />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
