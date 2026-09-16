import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api } from "../api";
import { Empty, Spinner, copyText, timeAgo, useToast } from "../components/ui";
import { Icon } from "../icons";

interface MediaItem {
  id: string;
  url: string;
  name: string;
  folder: string;
  source: "generated" | "upload";
  mimeType: string;
  createdAt: string;
  sizeKb: number;
}

/** Big photos are scaled to 1600px JPEG in the browser so uploads stay under the request size limit. */
async function toDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (file.type === "image/gif" || file.size < 600_000) return raw;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("الصورة مش سليمة"));
    img.src = raw;
  });
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // JPEG has no transparency (Instagram needs JPEG)
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export function MediaLibrary() {
  const toast = useToast();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [folder, setFolder] = useState("الكل");
  const [uploadFolder, setUploadFolder] = useState("منتجات");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<MediaItem[]>("/media").then(setItems).catch((e: Error) => toast(e.message, "error"));
  }, [toast]);
  useEffect(load, [load]);

  const folders = useMemo(() => ["الكل", ...new Set((items ?? []).map((i) => i.folder).filter(Boolean))], [items]);
  const visible = (items ?? []).filter((i) => folder === "الكل" || i.folder === folder);

  const upload = async (files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      toast("اختار صور بس (PNG, JPG, WEBP, GIF)", "error");
      return;
    }
    setProgress({ done: 0, total: images.length });
    let failed = 0;
    for (const [i, file] of images.entries()) {
      try {
        const dataUrl = await toDataUrl(file);
        await api("/media", { body: { name: file.name.replace(/\.[^.]+$/, ""), folder: uploadFolder.trim(), dataUrl } });
      } catch (e) {
        failed++;
        toast(`${file.name}: ${(e as Error).message}`, "error");
      }
      setProgress({ done: i + 1, total: images.length });
    }
    setProgress(null);
    if (failed < images.length) toast(`اترفع ${images.length - failed} صورة في «${uploadFolder || "بدون فولدر"}»`, "success");
    setFolder(uploadFolder.trim() || "الكل");
    load();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  const remove = async (item: MediaItem) => {
    if (!window.confirm(`تمسح «${item.name}»؟ أي سيناريو بيستخدم رابطها مش هيلاقيها.`)) return;
    await api(`/media/${item.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "error"));
    setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>مكتبة الصور</h1>
          <p>ارفع صور منتجاتك وشغلك، والصور اللي الذكاء الاصطناعي بيعملها بتتحفظ هنا برضو. كل صورة ليها رابط جاهز للنشر.</p>
        </div>
      </div>

      <div
        className={`card upload-zone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="upload-icon">
          <Icon name="upload" size={26} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>اسحب الصور هنا أو اختارها من جهازك</strong>
          <div className="help" style={{ marginTop: 2 }}>
            الصور الكبيرة بتتصغّر تلقائياً. استخدم خطوة «صورة من المكتبة» عشان سيناريو ياخد منها.
          </div>
        </div>
        <div className="upload-controls">
          <input
            className="input"
            value={uploadFolder}
            onChange={(e) => setUploadFolder(e.target.value)}
            placeholder="الفولدر (مثلاً: منتجات)"
            aria-label="الفولدر"
          />
          <button className="btn primary" onClick={() => fileInput.current?.click()} disabled={Boolean(progress)}>
            {progress ? (
              <>
                <Spinner size={15} /> {progress.done}/{progress.total}
              </>
            ) : (
              <>
                <Icon name="upload" size={16} /> رفع صور
              </>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="chips" style={{ marginTop: 18 }}>
        {folders.map((f) => (
          <button key={f} className={`chip ${f === folder ? "active" : ""}`} onClick={() => setFolder(f)}>
            {f}
          </button>
        ))}
      </div>

      {!items ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <Empty icon="image" title="مفيش صور هنا لسه" text="ارفع صور منتجاتك، أو شغّل سيناريو بيولّد صور." />
        </div>
      ) : (
        <div className="media-grid">
          {visible.map((item) => (
            <article className="card media-card" key={item.id}>
              <a href={item.url} target="_blank" rel="noreferrer" className="media-thumb">
                <img src={item.url} alt={item.name} loading="lazy" />
              </a>
              <div className="media-info">
                <strong className="truncate" title={item.name}>
                  {item.name}
                </strong>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {item.folder && <span className="badge">{item.folder}</span>}
                  <span className={`badge ${item.source === "generated" ? "brand" : ""}`}>
                    {item.source === "generated" ? "مولّدة بالـ AI" : "مرفوعة"}
                  </span>
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {timeAgo(item.createdAt)} · {item.sizeKb} KB
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn sm"
                    style={{ flex: 1 }}
                    onClick={() => copyText(item.url).then((ok) => ok && toast("الرابط اتنسخ", "success"))}
                  >
                    <Icon name="copy" size={14} /> نسخ الرابط
                  </button>
                  <button className="btn sm icon danger" title="حذف" onClick={() => remove(item)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
