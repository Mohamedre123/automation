import { waitUntil } from "@vercel/functions";
import { config } from "./config.js";

/** Work that continues after the HTTP response is sent (Vercel keeps the function alive until it settles). */
export function runInBackground(task: Promise<unknown>) {
  const guarded = task.catch((error) => console.error("[background]", error));
  if (config.isVercel) waitUntil(guarded);
}
