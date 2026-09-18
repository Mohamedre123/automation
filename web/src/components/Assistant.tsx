import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, tokenStore } from "../api";
import { useAccount } from "../context";
import { Icon } from "../icons";
import { Spinner, timeAgo } from "./ui";

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

interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}

const SUGGESTIONS = [
  "ابنيلي بوت واتساب يرد على العملاء من معلومات شركتي ويحوّلهم ليا لو طلبوا موظف",
  "عايز كل يوم الساعة 6 ينشر منتج من صوري على إنستجرام بصورة إعلانية",
  "آخر تشغيل للسيناريو فشل ليه؟ وإزاي أصلّحه؟",
  "إيه الفرق بين الفورم والـ Webhook؟",
];

const CURRENT_KEY = "tadfuq_assistant_conversation";
const MODEL_KEY = "tadfuq_assistant_model";
const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set: (key: string, value: string) => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  },
};

/* ---------- light, safe formatting for replies (no raw HTML) ---------- */
function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("**")) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    else
      parts.push(
        <a key={key} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function FormattedText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (key: number) => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `${key}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`l${key}`}>{items}</ol> : <ul key={`l${key}`}>{items}</ul>);
    list = null;
  };
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "");
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flush(index);
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      return;
    }
    flush(index);
    if (!line.trim()) {
      blocks.push(<div key={`s${index}`} className="md-gap" />);
      return;
    }
    // Stray Markdown markers the model may still emit.
    blocks.push(<p key={`p${index}`}>{inline(line.replace(/^\*\*(.+)\*\*:?$/, "**$1**"), `p${index}`)}</p>);
  });
  flush(-1);
  return <div className="md">{blocks}</div>;
}

export function AssistantLauncher() {
  const location = useLocation();
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const inEditor = location.pathname.startsWith("/app/workflows/");

  // Only plans that include the assistant (Pro, Max, the trial) see it at all.
  if (!account?.plan.assistant) return null;

  return (
    <>
      {!open && (
        <button className={`assistant-fab ${inEditor ? "raised" : ""}`} onClick={() => setOpen(true)} aria-label="افتح مساعد تدفّق">
          <Icon name="sparkles" size={20} />
          <span>المساعد الذكي</span>
        </button>
      )}
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
    </>
  );
}

const LOCKED: Record<string, { title: string; text: string }> = {
  plan: { title: "المساعد الذكي في باقة احترافي وماكس", text: "المساعد بيبنيلك السيناريو كامل من وصف بسيط، وبيقرا سجل التشغيل ويقولك سبب أي خطأ وإزاي تحلّه." },
  credits: { title: "الكريديت خلص", text: "رصيد المنصة خلص، فالسيناريوهات والمساعد واقفين لحد ما الرصيد يتجدد أو تترقّى لباقة أعلى." },
  assistant_credits: { title: "كريديت المساعد خلص الشهر ده", text: "رصيد المساعد هيتجدد مع باقتك الشهر الجاي، أو تقدر تترقّى لباقة ماكس." },
};

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const workflowId = location.pathname.match(/^\/app\/workflows\/([^/]+)/)?.[1];
  const [status, setStatus] = useState<{ available: boolean; reason?: string; defaultModel?: string } | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState(store.get(MODEL_KEY));
  const [conversationId, setConversationId] = useState(store.get(CURRENT_KEY));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottom = useRef(true);

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
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
    };
  }, []);

  useEffect(() => {
    api<{ available: boolean; reason?: string; defaultModel?: string }>("/assistant/status")
      .then((res) => {
        setStatus(res);
        if (!res.available) return;
        api<{ models: { id: string; name: string }[]; defaultModel: string }>("/assistant/models")
          .then((m) => {
            setModels(m.models);
            setModel((current) => (current && m.models.some((x) => x.id === current) ? current : m.defaultModel));
          })
          .catch(() => setModel((current) => current || res.defaultModel || "claude-opus-5"));
      })
      .catch(() => setStatus({ available: false, reason: "error" }));
  }, []);

  // Reopen the last conversation after a refresh.
  const openConversation = useCallback(async (id: string) => {
    setLoadingChat(true);
    try {
      const conversation = await api<{ id: string; messages: ChatMessage[]; model: string }>(`/assistant/conversations/${id}`);
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      store.set(CURRENT_KEY, conversation.id);
      stickToBottom.current = true;
    } catch {
      setConversationId("");
      setMessages([]);
      store.set(CURRENT_KEY, "");
    } finally {
      setLoadingChat(false);
      setShowHistory(false);
    }
  }, []);

  useEffect(() => {
    if (status?.available && conversationId) void openConversation(conversationId);
    // Only on first availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.available]);

  const loadHistory = useCallback(() => {
    api<ConversationSummary[]>("/assistant/conversations")
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy, statusLine]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const newChat = () => {
    abortRef.current?.abort();
    setConversationId("");
    setMessages([]);
    store.set(CURRENT_KEY, "");
    setShowHistory(false);
  };

  const removeConversation = async (id: string) => {
    await api(`/assistant/conversations/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (id === conversationId) newChat();
    loadHistory();
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    stickToBottom.current = true;
    setMessages((m) => [...m, { role: "user", text: trimmed }, { role: "assistant", text: "" }]);
    setInput("");
    setBusy(true);
    setStatusLine("");
    const controller = new AbortController();
    abortRef.current = controller;

    const patchLast = (update: (message: ChatMessage) => ChatMessage) =>
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = update(next[next.length - 1]);
        return next;
      });

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokenStore.get() ?? ""}` },
        body: JSON.stringify({ message: trimmed, conversationId: conversationId || undefined, workflowId, model }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `حصل خطأ (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const chunk of events) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "conversation") {
            setConversationId(event.id);
            store.set(CURRENT_KEY, event.id);
          } else if (event.type === "text") {
            setStatusLine("");
            patchLast((message) => ({ ...message, text: message.text + event.text }));
          } else if (event.type === "status") {
            setStatusLine(event.text);
          } else if (event.type === "done") {
            patchLast((message) => ({ ...message, actions: event.actions }));
          } else if (event.type === "error") {
            patchLast((message) => ({ ...message, text: message.text ? `${message.text}\n\n${event.message}` : event.message, error: true }));
          }
        }
      }
    } catch (e) {
      const stopped = controller.signal.aborted;
      patchLast((message) => ({
        ...message,
        text: stopped ? message.text || "اتوقف الرد." : `${message.text ? `${message.text}\n\n` : ""}${(e as Error).message}`,
        error: !stopped,
      }));
    } finally {
      setBusy(false);
      setStatusLine("");
      abortRef.current = null;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const last = messages[messages.length - 1];
  const waitingFirstWords = busy && last?.role === "assistant" && !last.text;

  return (
    <aside className="assistant-panel" aria-label="مساعد تدفّق">
      <div className="assistant-head">
        <span className="brand-mark" style={{ width: 34, height: 34 }}>
          <Icon name="sparkles" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>مساعد تدفّق</strong>
          {status?.available && models.length > 0 ? (
            <select
              className="assistant-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                store.set(MODEL_KEY, e.target.value);
              }}
              aria-label="الموديل"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="faint" style={{ fontSize: 12 }}>
              بيبني الأتمتة معاك ويحل الأخطاء
            </div>
          )}
        </div>
        {status?.available && (
          <>
            <button
              className={`btn ghost icon sm ${showHistory ? "active" : ""}`}
              onClick={() => {
                setShowHistory((v) => !v);
                loadHistory();
              }}
              title="المحادثات السابقة"
              aria-label="المحادثات السابقة"
            >
              <Icon name="history" size={17} />
            </button>
            <button className="btn ghost icon sm" onClick={newChat} title="محادثة جديدة" aria-label="محادثة جديدة">
              <Icon name="plus" size={17} />
            </button>
          </>
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
          <h3>{LOCKED[status.reason ?? ""]?.title ?? "المساعد لسه مش متفعّل"}</h3>
          <p className="muted">{LOCKED[status.reason ?? ""]?.text ?? "صاحب المنصة محتاج يضيف مفتاح Claude (ANTHROPIC_API_KEY) في إعدادات السيرفر."}</p>
          {status.reason && LOCKED[status.reason] && (
            <Link className="btn primary" to="/app/billing" onClick={onClose}>
              صفحة الاشتراك
            </Link>
          )}
        </div>
      ) : showHistory ? (
        <div className="assistant-body">
          {!history ? (
            <div className="empty">
              <Spinner />
            </div>
          ) : history.length === 0 ? (
            <p className="muted" style={{ textAlign: "center" }}>
              مفيش محادثات سابقة لسه.
            </p>
          ) : (
            <div className="assistant-history">
              {history.map((c) => (
                <div key={c.id} className={`history-item ${c.id === conversationId ? "active" : ""}`}>
                  <button className="history-open" onClick={() => void openConversation(c.id)}>
                    <strong className="truncate">{c.title || "محادثة"}</strong>
                    <span className="faint">{timeAgo(c.updatedAt)}</span>
                  </button>
                  <button className="btn ghost icon sm danger" onClick={() => void removeConversation(c.id)} aria-label="مسح المحادثة">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className="assistant-body"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {loadingChat ? (
              <div className="empty">
                <Spinner />
              </div>
            ) : (
              messages.length === 0 && (
                <div className="assistant-welcome">
                  <p>
                    أهلاً! قولي عايز تأتمت إيه وأنا هبنيلك السيناريو بالظبط زي ما تطلب، أو اسألني عن أي خطأ في سيناريوهاتك.
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
              )
            )}
            {messages.map((message, i) => {
              const streaming = busy && i === messages.length - 1 && message.role === "assistant";
              if (streaming && !message.text) return null;
              return (
                <div key={i} className={`bubble ${message.role} ${message.error ? "error" : ""}`}>
                  {message.role === "assistant" ? (
                    <Fragment>
                      <FormattedText text={message.text} />
                      {streaming && <span className="stream-caret" aria-hidden="true" />}
                    </Fragment>
                  ) : (
                    <div className="bubble-text">{message.text}</div>
                  )}
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
              );
            })}
            {(waitingFirstWords || statusLine) && (
              <div className="assistant-status">
                <span className="typing-dots">
                  <span />
                  <span />
                  <span />
                </span>
                {statusLine || "بيفكر..."}
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
            {busy ? (
              <button className="btn icon" onClick={() => abortRef.current?.abort()} aria-label="إيقاف الرد" title="إيقاف">
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button className="btn primary icon" onClick={() => void send(input)} disabled={!input.trim()} aria-label="إرسال">
                <Icon name="send" size={17} />
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
