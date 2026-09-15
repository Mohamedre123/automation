import type { FastifyInstance } from "fastify";
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
}
