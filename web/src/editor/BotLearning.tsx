import { useEffect, useState } from "react";
import { api } from "../api";
import { timeAgo, useToast } from "../components/ui";
import { Icon } from "../icons";

/*
 * What the chatbot in this scenario has learned, shown inside the AI Agent step: every fact it keeps
 * and where it came from, the customers' questions waiting for the owner, and ways to teach it more.
 * The owner can correct anything here - a bot that learned something wrong must be easy to fix.
 */

interface Fact {
  id: number;
  text: string;
  source: "owner" | "answer" | "reply" | "import" | "app";
  question?: string;
  at: string;
}
interface OpenQuestion {
  id: number;
  question: string;
  customer: string;
  chat: string;
  at: string;
}
interface Learning {
  facts: Fact[];
  open: OpenQuestion[];
}

const SOURCE: Record<Fact["source"], string> = {
  owner: "علّمته من الشات",
  answer: "إجابتك على سؤال عميل",
  reply: "ردك على عميل من موبايلك",
  import: "من المحادثات القديمة",
  app: "كتبتها هنا",
};

export function BotLearning({ workflowId, enabled }: { workflowId: string; enabled: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Learning | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newFact, setNewFact] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [importText, setImportText] = useState("");

  const base = `/workflows/${workflowId}/learning`;
  useEffect(() => {
    api<Learning>(base)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [base]);

  /** One request at a time, with the result replacing what is shown. */
  const act = async (key: string, request: () => Promise<Learning & { message?: string; added?: number }>, done?: (r: Learning & { message?: string; added?: number }) => void) => {
    setBusy(key);
    try {
      const result = await request();
      setData({ facts: result.facts, open: result.open });
      done?.(result);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const readFile = (file: File) => {
    if (file.size > 2_000_000) return toast("الملف كبير أوي - صدّر محادثة واحدة أو انسخ جزء منها", "error");
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result ?? "").slice(0, 60_000));
    reader.readAsText(file);
  };

  if (error) return <div className="alert error" style={{ marginTop: 14 }}>{error}</div>;

  return (
    <section className="learn" aria-label="اللي البوت اتعلمه">
      <div className="learn-head">
        <Icon name="sparkles" size={17} />
        <strong>اللي البوت اتعلمه</strong>
        {data && <span className="learn-count">{data.facts.length}</span>}
      </div>
      {!enabled && <div className="help">التعلّم مقفول في الخطوة دي - فعّل «يتعلم لوحده من ردودك» فوق عشان البوت يستخدم المعلومات دي</div>}

      {!data ? (
        <div className="help">بيحمّل...</div>
      ) : (
        <>
          {data.open.length > 0 && (
            <div className="learn-block">
              <div className="label">أسئلة عملاء مستنية إجابتك ({data.open.length})</div>
              {data.open.map((q) => (
                <div className="learn-question" key={q.id}>
                  <div className="learn-question-top">
                    <span className="learn-num">{q.id}</span>
                    <span className="learn-who">{q.customer || q.chat || "عميل"}</span>
                    <span className="faint">{timeAgo(q.at)}</span>
                    <button
                      className="btn ghost icon sm"
                      title="تجاهل السؤال"
                      aria-label="تجاهل السؤال"
                      disabled={busy !== null}
                      onClick={() => act(`drop-${q.id}`, () => api(`${base}/open/${q.id}`, { method: "DELETE" }))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  <div className="learn-question-text">{q.question}</div>
                  <textarea
                    rows={2}
                    placeholder="اكتب الإجابة زي ما هتقولها للعميل"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((all) => ({ ...all, [q.id]: e.target.value }))}
                  />
                  <button
                    className="btn primary sm"
                    disabled={busy !== null || !(answers[q.id] ?? "").trim()}
                    onClick={() =>
                      act(
                        `answer-${q.id}`,
                        () => api(`${base}/open/${q.id}/answer`, { body: { text: answers[q.id] } }),
                        (r) => {
                          toast(r.message ?? "اتبعتت ✓", r.message?.startsWith("⚠️") ? "error" : "success");
                          setAnswers((all) => ({ ...all, [q.id]: "" }));
                        },
                      )
                    }
                  >
                    {busy === `answer-${q.id}` ? "بيبعت..." : "ابعتها للعميل واحفظها"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="learn-block">
            <div className="label">علّمه معلومة</div>
            <div className="learn-add">
              <input
                placeholder="مثلاً: التوصيل لإسكندرية 60 جنيه وبيوصل في يومين"
                value={newFact}
                onChange={(e) => setNewFact(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFact.trim() && busy === null) {
                    act("add", () => api(`${base}/facts`, { body: { text: newFact } }), () => setNewFact(""));
                  }
                }}
              />
              <button
                className="btn sm"
                disabled={busy !== null || !newFact.trim()}
                onClick={() => act("add", () => api(`${base}/facts`, { body: { text: newFact } }), () => setNewFact(""))}
              >
                احفظ
              </button>
            </div>
          </div>

          <div className="learn-block">
            {data.facts.length === 0 ? (
              <div className="help">لسه متعلمش حاجة. أول ما ترد على سؤال عميل أو تعلّمه معلومة هتظهر هنا</div>
            ) : (
              <ul className="learn-facts">
                {data.facts.map((f) => (
                  <li key={f.id}>
                    {editing?.id === f.id ? (
                      <div className="learn-add">
                        <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: f.id, text: e.target.value })} />
                        <button
                          className="btn sm primary"
                          disabled={busy !== null || !editing.text.trim()}
                          onClick={() => act(`edit-${f.id}`, () => api(`${base}/facts/${f.id}`, { method: "PUT", body: { text: editing.text } }), () => setEditing(null))}
                        >
                          احفظ
                        </button>
                        <button className="btn sm ghost" onClick={() => setEditing(null)}>
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="learn-fact-text">{f.text}</div>
                        <div className="learn-fact-meta">
                          <span>{SOURCE[f.source] ?? ""}</span>
                          <span>·</span>
                          <span>{timeAgo(f.at)}</span>
                          {f.question && <span title={f.question}>· على سؤال: «{f.question.slice(0, 40)}{f.question.length > 40 ? "…" : ""}»</span>}
                          <span className="learn-fact-actions">
                            <button className="btn ghost icon sm" title="عدّلها" aria-label="عدّلها" onClick={() => setEditing({ id: f.id, text: f.text })}>
                              <Icon name="edit" size={13} />
                            </button>
                            <button
                              className="btn ghost icon sm danger"
                              title="امسحها"
                              aria-label="امسحها"
                              disabled={busy !== null}
                              onClick={() => act(`del-${f.id}`, () => api(`${base}/facts/${f.id}`, { method: "DELETE" }))}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </span>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <details className="learn-block learn-import">
            <summary>درّبه من محادثات قديمة أو أسئلة شائعة</summary>
            <div className="help">
              صدّر محادثة من واتساب (افتح المحادثة ← ⋮ ← المزيد ← تصدير الدردشة ← بدون وسائط) وارفع الملف، أو الصق أي كلام فيه أسعار وإجابات. الذكاء الاصطناعي بيطلّع منها المعلومات اللي تنفع العملاء - اللي انت قلته بس، مش كلام العملاء
            </div>
            <textarea rows={5} placeholder="الصق هنا..." value={importText} onChange={(e) => setImportText(e.target.value)} />
            <div className="learn-add">
              <label className="btn sm ghost" style={{ cursor: "pointer" }}>
                <Icon name="upload" size={14} /> ارفع ملف .txt
                <input type="file" accept=".txt,text/plain" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              </label>
              <button
                className="btn sm primary"
                disabled={busy !== null || !importText.trim()}
                onClick={() =>
                  act(
                    "import",
                    () => api(`${base}/import`, { body: { text: importText } }),
                    (r) => {
                      toast(r.added ? `اتعلم ${r.added} معلومة ✓ - راجعها تحت` : "ملقاش معلومات جديدة في الكلام ده", r.added ? "success" : "info");
                      if (r.added) setImportText("");
                    },
                  )
                }
              >
                {busy === "import" ? "بيقرا..." : "طلّع المعلومات منها"}
              </button>
            </div>
          </details>

          <details className="learn-block">
            <summary>تعلّمه إزاي من موبايلك</summary>
            <div className="help learn-commands">
              من رقمك انت (اللي في «رقمك انت» فوق)، ابعت للبوت:
              <br />• <b>اتعلم:</b> المعلومة
              <br />• <b>انسى:</b> الموضوع أو رقمه
              <br />• <b>اللي اتعلمته</b> - يعرضلك كل حاجة بأرقامها
              <br />• <b>الأسئلة</b> - الأسئلة اللي مستنية إجابتك
              <br />• <b>رد 3:</b> الإجابة - توصل للعميل صاحب السؤال 3 ويحفظها
              <br />
              <br />
              على واتساب WasenderAPI كمان: ردّ على العميل عادي من موبايلك، والبوت هيتعلم من ردك (فعّل Message Upsert في Webhooks بتاعة WasenderAPI)
            </div>
          </details>
        </>
      )}
    </section>
  );
}
