import type { FastifyInstance } from "fastify";
import { now, one, parseJson } from "../db.js";
import { MAX_UPLOAD_BYTES, storeMedia } from "../nodes/media.js";
import { clientIp, rateLimit } from "../protection.js";
import type { WorkflowGraph } from "../engine/types.js";
import { httpError } from "../errors.js";
import { keyValueRows } from "../nodes/util.js";
import { handleWebhook } from "../triggers/manager.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/webhook/:path",
    handler: async (req, reply) => {
      const { path } = req.params as { path: string };
      const { cookie, ...headers } = req.headers;
      const response = await handleWebhook(path, {
        method: req.method,
        headers,
        query: req.query ?? {},
        body: req.body ?? {},
      });
      reply.status(response.status);
      for (const [key, value] of Object.entries(response.headers)) reply.header(key, value);
      if (typeof response.body === "string") {
        if (!reply.hasHeader("content-type")) reply.type("text/plain; charset=utf-8");
        return reply.send(response.body);
      }
      return reply.send(response.body ?? {});
    },
  });

  /** The live form (a waiting test run first, then the active workflow) and who owns it. */
  async function findForm(path: string) {
    const session = await one<{ graph: string; user_id: string }>(
      "SELECT graph, user_id FROM test_sessions WHERE trigger_path = $1 AND status = 'waiting' AND expires_at > $2 ORDER BY created_at DESC LIMIT 1",
      [path, now()],
    );
    const row =
      session ?? (await one<{ graph: string; user_id: string }>("SELECT graph, user_id FROM workflows WHERE trigger_path = $1 AND active = 1", [path]));
    const graph = parseJson<WorkflowGraph>(row?.graph, { nodes: [], edges: [] });
    const node = graph.nodes.find((n) => n.type === "trigger.form" && n.params?.path === path);
    if (!row || !node) throw httpError(404, "الفورم ده مش متاح دلوقتي - لو انت صاحبه، فعّل السيناريو أو دوس «تشغيل مرة»");
    return { node, userId: row.user_id, testing: Boolean(session) };
  }

  /** Question suffixes pick the input: "صورة المنتج (صورة)", "فيديو؟ (نعم/لا)", "ميعاد النشر (ساعة)", "ملاحظات (اختياري)". */
  const FIELD_KINDS: [RegExp, string][] = [
    [/\((صورة|image)\)\s*$/i, "image"],
    [/\((نعم\/لا|yes\/no)\)\s*$/i, "yesno"],
    [/\((ساعة|وقت|time)\)\s*$/i, "time"],
    [/\((اختياري|optional)\)\s*$/i, "optional"],
  ];

  /** Public definition of a form trigger (for the hosted /form/:path page). */
  app.get("/api/forms/:path", async (req) => {
    const { path } = req.params as { path: string };
    const { node, testing } = await findForm(path);
    const params = node.params;
    return {
      title: String(params.title || "فورم"),
      description: String(params.description || ""),
      fields: keyValueRows(params.formFields).map((row) => {
        const label = String(row.value || row.key);
        const match = FIELD_KINDS.find(([pattern]) => pattern.test(label));
        return { key: row.key, label: match ? label.replace(match[0], "").trim() : label, kind: match?.[1] ?? "text" };
      }),
      submitLabel: String(params.submitLabel || "إرسال"),
      successMessage: String(params.successMessage || "تم الإرسال بنجاح ✓"),
      testing,
    };
  });

  /** Image questions upload first, then the form sends the image's public URL. */
  app.post("/api/forms/:path/upload", async (req) => {
    const { path } = req.params as { path: string };
    await rateLimit(`form-upload:${clientIp(req)}`, 10, 600, "رفعت صور كتير - استنى شوية وجرّب تاني");
    const { userId } = await findForm(path);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) throw httpError(400, "الملف لازم يكون صورة PNG أو JPG أو WEBP");
    if (match[2].length * 0.75 > MAX_UPLOAD_BYTES) throw httpError(413, "الصورة أكبر من 2.8 ميجا");
    const name = typeof body.name === "string" ? body.name.slice(0, 120) : "صورة من الفورم";
    const stored = await storeMedia(userId, match[2], match[1], { name, folder: "من الفورم", source: "upload" });
    return { url: stored.url };
  });
}
