import type { IncomingMessage, ServerResponse } from "node:http";

// Vercel Function entry: api/index.mjs re-exports this. Rewrites pass the original path in ?__route=.
let appPromise: Promise<any> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    appPromise ??= import("./app.js").then(async ({ buildApp }) => {
      const app = await buildApp();
      await app.ready();
      return app;
    });
    const app = await appPromise;

    const url = new URL(req.url ?? "/", "http://localhost");
    const route = url.searchParams.get("__route");
    if (route) {
      url.searchParams.delete("__route");
      const search = url.searchParams.toString();
      req.url = `${route}${search ? `?${search}` : ""}`;
    }
    app.server.emit("request", req, res);
  } catch (error) {
    appPromise = null;
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
