import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";

export interface LibraryItem {
  id: string;
  url: string;
  name: string;
  folder: string;
  mimeType: string;
}

let cache: { at: number; promise: Promise<LibraryItem[]> } | null = null;

/** The customer's image library, shared by every field (refreshed every minute). */
export function loadLibrary(force = false) {
  if (force || !cache || Date.now() - cache.at > 60_000) {
    cache = { at: Date.now(), promise: api<LibraryItem[]>("/media").catch(() => []) };
  }
  return cache.promise;
}

export function useLibrary(active: boolean) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void loadLibrary().then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
  }, [active]);
  return items;
}

export const MENTION = /@\{([^{}\n]{1,120})\}/g;

/** "@que|" right before the caret (at the start or after a space) = an open mention. */
export function openMention(text: string, caret: number) {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/[{}\n]/.test(query) || query.length > 40) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  return { start: at, query };
}

export function MentionMenu({
  query,
  activeIndex,
  onPick,
  onHover,
}: {
  query: string;
  activeIndex: number;
  onPick: (item: LibraryItem) => void;
  onHover: (index: number) => void;
}) {
  const items = useLibrary(true);
  const matches = useMemo(() => filterLibrary(items ?? [], query), [items, query]);
  return (
    <div className="mention-menu" role="listbox" onMouseDown={(e) => e.preventDefault()}>
      {!items ? (
        <div className="mention-empty">بحمّل صورك...</div>
      ) : matches.length === 0 ? (
        <div className="mention-empty">{items.length ? "مفيش صورة بالاسم ده" : "مكتبة الصور فاضية - ارفع صور من صفحة «الصور»"}</div>
      ) : (
        matches.map((item, i) => (
          <button
            type="button"
            key={item.id}
            role="option"
            aria-selected={i === activeIndex}
            className={`mention-item ${i === activeIndex ? "active" : ""}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(item)}
          >
            {item.mimeType.startsWith("video/") ? (
              <span className="mention-thumb video">
                <Icon name="play" size={14} />
              </span>
            ) : (
              <img className="mention-thumb" src={item.url} alt="" loading="lazy" />
            )}
            <span className="mention-text">
              <strong className="truncate">{item.name}</strong>
              {item.folder && <span className="faint truncate">{item.folder}</span>}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

export function filterLibrary(items: LibraryItem[], query: string) {
  const q = query.trim().toLowerCase();
  return items.filter((item) => !q || item.name.toLowerCase().includes(q) || item.folder.toLowerCase().includes(q)).slice(0, 8);
}

/** Thumbnails of the images a field mentions, so the customer sees exactly what the step will use. */
export function MentionChips({ value }: { value: string }) {
  const names = useMemo(() => [...new Set([...value.matchAll(MENTION)].map((m) => m[1].trim()))], [value]);
  const items = useLibrary(names.length > 0);
  if (!names.length) return null;
  return (
    <div className="mention-chips">
      {names.map((name, i) => {
        const item = items?.find((it) => it.name.toLowerCase() === name.toLowerCase());
        return (
          <span key={name} className={`mention-chip ${items && !item ? "missing" : ""}`} title={item ? item.folder : "الصورة دي مش في المكتبة"}>
            {item && !item.mimeType.startsWith("video/") ? <img src={item.url} alt="" /> : <Icon name={item ? "play" : "alert"} size={13} />}
            <span className="truncate">
              {names.length > 1 ? `${i + 1}. ` : ""}
              {name}
            </span>
          </span>
        );
      })}
    </div>
  );
}
