/**
 * `pnpm run watch:status -- --project <id>` — block until a generation settles.
 * Thin shim; logic lives in src/lib/watch.ts (shared with `claude-design watch`).
 */
import { run } from "../src/lib/watch.js";

run(process.argv.slice(2)).catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
