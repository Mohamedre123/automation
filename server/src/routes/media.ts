import type { FastifyInstance } from "fastify";
import { loadMedia } from "../nodes/media.js";

/** Public so WhatsApp, Instagram and Facebook can fetch generated images by URL. */
export async function mediaRoutes(app: FastifyInstance) {
  app.get("/media/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await loadMedia(id);
    if (!file) return reply.status(404).send({ error: "الملف مش موجود" });
    return reply
      .type(file.mime_type)
      .header("cache-control", "public, max-age=604800, immutable")
      .send(Buffer.from(file.data, "base64"));
  });
}
