/**
 * `pnpm run scaffold:ui -- --src <dir> --out <dir>` — build packages/tokens + ui.
 * Thin shim; logic lives in src/lib/scaffold.ts (shared with `claude-design scaffold`).
 */
import { run } from "../src/lib/scaffold.js";

run(process.argv.slice(2)).catch((e) => {
  console.error("ERR:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
