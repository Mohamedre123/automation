import type { FastifyInstance } from "fastify";
import { now, one, parseJson } from "../db.js";
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

  /** Public definition of a form trigger (for the hosted /form/:path page). */
  app.get("/api/forms/:path", async (req) => {
    const { path } = req.params as { path: string };
    const session = await one<{ graph: string }>(
      "SELECT graph FROM test_sessions WHERE trigger_path = $1 AND status = 'waiting' AND expires_at > $2 ORDER BY created_at DESC LIMIT 1",
      [path, now()],
    );
    const row = session ?? (await one<{ graph: string }>("SELECT graph FROM workflows WHERE trigger_path = $1 AND active = 1", [path]));
    const graph = parseJson<WorkflowGraph>(row?.graph, { nodes: [], edges: [] });
    const node = graph.nodes.find((n) => n.type === "trigger.form" && n.params?.path === path);
    if (!node) throw httpError(404, "الفورم ده مش متاح دلوقتي - لو انت صاحبه، فعّل السيناريو أو دوس «تشغيل مرة».");
    const params = node.params;
    return {
      title: String(params.title || "فورم"),
      description: String(params.description || ""),
      fields: keyValueRows(params.formFields).map((row) => ({ key: row.key, label: String(row.value || row.key) })),
      submitLabel: String(params.submitLabel || "إرسال"),
      successMessage: String(params.successMessage || "تم الإرسال بنجاح ✓"),
      testing: Boolean(session),
    };
  });
}
