import type { FastifyInstance } from "fastify";
import { query, run } from "../db.js";
import { httpError, requireString } from "../errors.js";
import { loadMedia, MAX_UPLOAD_BYTES, mediaUrlFor, storeMedia } from "../nodes/media.js";

/** Public so WhatsApp, Instagram and Facebook can fetch images by URL. */
export async function mediaRoutes(app: FastifyInstance) {
  app.get("/media/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await loadMedia(id);
    if (!file) return reply.status(404).send({ error: "الملف مش موجود" });
    if (!file.data && file.url) return reply.redirect(file.url, 302);
    const html = file.mime_type === "text/html";
    return reply
      .type(file.mime_type)
      .header("cache-control", html ? "no-store" : "public, max-age=604800, immutable")
      // A generated report is a document, not an app: no scripts, no fetching, nothing but itself.
      .header(
        "content-security-policy",
        html ? "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; script-src 'unsafe-inline'" : "default-src 'none'",
      )
      .send(Buffer.from(file.data, "base64"));
  });
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** The customer's image library (logged-in). */
export async function mediaLibraryRoutes(app: FastifyInstance) {
  app.get("/api/media", async (req) => {
    const rows = await query(
      `SELECT id, name, folder, source, mime_type, url, created_at, length(data) AS size
       FROM media WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [req.user.id],
    );
    return rows.map((row) => ({
      id: row.id,
      url: mediaUrlFor(row),
      name: row.name,
      folder: row.folder,
      source: row.source,
      mimeType: row.mime_type,
      createdAt: row.created_at,
      sizeKb: Math.round((Number(row.size) * 0.75) / 1024),
    }));
  });

  app.post("/api/media", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dataUrl = requireString(body.dataUrl, "الصورة", 10_000_000);
    const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!match || !ALLOWED_TYPES.has(match[1])) throw httpError(400, "الملف لازم يكون صورة PNG أو JPG أو WEBP أو GIF");
    if (match[2].length * 0.75 > MAX_UPLOAD_BYTES) throw httpError(413, "الصورة أكبر من 2.8 ميجا");
    // "IMG_2031.jpg" -> "IMG_2031": the name is what customers type after @.
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[{}]/g, "").slice(0, 120) || "صورة"
        : "صورة";
    const folder = typeof body.folder === "string" ? body.folder.trim().slice(0, 60) : "";
    const stored = await storeMedia(req.user.id, match[2], match[1], { name, folder, source: "upload" });
    return { ...stored, name, folder, source: "upload" };
  });

  app.put("/api/media/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.replace(/[{}\n]/g, "").trim().slice(0, 120) : "";
    if (!name) throw httpError(400, "اكتب اسم الصورة");
    const folder = typeof body.folder === "string" ? body.folder.trim().slice(0, 60) : undefined;
    const updated = folder === undefined
      ? await run("UPDATE media SET name = $1 WHERE id = $2 AND user_id = $3", [name, id, req.user.id])
      : await run("UPDATE media SET name = $1, folder = $2 WHERE id = $3 AND user_id = $4", [name, folder, id, req.user.id]);
    if (!updated) throw httpError(404, "الصورة مش موجودة");
    return { ok: true, name };
  });

  app.delete("/api/media/:id", async (req) => {
    const { id } = req.params as { id: string };
    const deleted = await run("DELETE FROM media WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (!deleted) throw httpError(404, "الصورة مش موجودة");
    return { ok: true };
  });
}
