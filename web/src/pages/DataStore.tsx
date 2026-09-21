import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Empty, JsonView, Spinner, timeAgo, useToast } from "../components/ui";

interface Store {
  store: string;
  count: number;
  updatedAt: string;
}

interface Item {
  key: string;
  value: unknown;
  updatedAt: string;
}

export function DataStore() {
  const toast = useToast();
  const [stores, setStores] = useState<Store[] | null>(null);
  const [current, setCurrent] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);

  const loadStores = useCallback(() => {
    api<Store[]>("/datastore")
      .then((list) => {
        setStores(list);
        setCurrent((c) => c || list[0]?.store || "");
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  useEffect(loadStores, [loadStores]);

  useEffect(() => {
    if (!current) return;
    setItems(null);
    api<Item[]>(`/datastore/${encodeURIComponent(current)}`).then(setItems).catch((e: Error) => toast(e.message, "error"));
  }, [current, toast]);

  const remove = async (key: string) => {
    if (!window.confirm(`تمسح المفتاح «${key}»؟`)) return;
    await api(`/datastore/${encodeURIComponent(current)}/${encodeURIComponent(key)}`, { method: "DELETE" });
    setItems((list) => list?.filter((i) => i.key !== key) ?? null);
    loadStores();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>مخازن البيانات</h1>
          <p>البيانات اللي السيناريوهات بتحفظها بخطوة «حفظ في مخزن البيانات»</p>
        </div>
      </div>
      {!stores ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : stores.length === 0 ? (
        <div className="card">
          <Empty icon="database" title="مفيش بيانات محفوظة" text="استخدم خطوة «حفظ في مخزن البيانات» في أي سيناريو" />
        </div>
      ) : (
        <>
          <div className="chips">
            {stores.map((s) => (
              <button key={s.store} className={`chip ${s.store === current ? "active" : ""}`} onClick={() => setCurrent(s.store)}>
                {s.store} ({s.count})
              </button>
            ))}
          </div>
          <div className="card">
            {!items ? (
              <div className="empty">
                <Spinner />
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: "28%" }}>المفتاح</th>
                      <th>القيمة</th>
                      <th style={{ width: 110 }}>آخر تحديث</th>
                      <th style={{ width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.key}>
                        <td className="mono">{item.key}</td>
                        <td>
                          <JsonView value={item.value} />
                        </td>
                        <td className="muted">{timeAgo(item.updatedAt)}</td>
                        <td>
                          <button className="btn sm danger" onClick={() => remove(item.key)}>
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
