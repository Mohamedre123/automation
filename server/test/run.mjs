/**
 * Runs every *.test.mjs here against the built server (npm run build first - `npm test` does).
 *
 * Each file runs in its own process, one after another, on a brand-new database in the system's
 * temp folder: the tests never touch server/data, and two of them never share a database lock.
 *
 *   npm test                 every suite
 *   npm test -- gather mcp   only the suites whose name contains one of those words
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const only = process.argv.slice(2);
const suites = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !only.length || only.some((word) => f.includes(word)))
  .sort();

let failed = 0;
for (const file of suites) {
  const data = mkdtempSync(join(tmpdir(), "tadfuq-test-"));
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(here, file)], {
    env: { ...process.env, DATA_DIR: data, RATE_LIMITS: "off", DATABASE_URL: "" },
    encoding: "utf8",
    timeout: 10 * 60_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const summary = output.match(/\d+ passed, \d+ failed[^\r\n]*/g)?.pop() ?? "no summary";
  const passed = /\b0 failed\b/.test(summary);
  // A clean summary is the verdict. (Windows can abort a process on its way out after it has
  // already printed a clean result - that is not a failed test.)
  if (!passed) failed++;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${passed ? "✓" : "✗"} ${file.replace(".test.mjs", "").padEnd(16)} ${summary}  (${seconds}s)`);
  if (!passed) {
    const lines = output.split(/\r?\n/).filter((l) => /FAIL|Error/.test(l)).slice(0, 12);
    for (const line of lines) console.log(`    ${line.slice(0, 220)}`);
  }
  try {
    rmSync(data, { recursive: true, force: true });
  } catch {
    /* the database files can stay locked for a moment on Windows; the temp folder is cleaned anyway */
  }
}

console.log(failed ? `\n${failed} of ${suites.length} suites failed` : `\nall ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
