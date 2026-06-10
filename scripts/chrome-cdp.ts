/**
 * `pnpm run chrome:cdp` — launch/attach the debug Chrome and log into claude.ai.
 * Thin shim; logic lives in src/lib/chrome.ts (shared with `claude-design chrome`).
 */
import { run } from "../src/lib/chrome.js";

run(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
