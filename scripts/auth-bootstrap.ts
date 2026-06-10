/**
 * One-time HEADED login.
 *
 * Opens a persistent Chromium profile at CLAUDE_DESIGN_PROFILE_DIR.
 * You log into claude.ai manually. The script polls every 2s; when it can
 * load /design without being redirected to /login, it saves the verification
 * and exits. You can also just CLOSE the browser window to abort.
 *
 * Usage:
 *   pnpm run auth:bootstrap
 */
import { type BrowserContext } from "playwright";
import { launchClaudeBrowserContext, profileModeDescription, configuredProfileDir } from "../src/chrome-profile.js";

const BASE = process.env.CLAUDE_DESIGN_BASE_URL ?? "https://claude.ai/design";

async function main() {
  console.log(`[auth] launching ${profileModeDescription()}`);
  console.log(`[auth] log into claude.ai in the opened window.`);
  console.log(`[auth] this script will auto-detect once you reach ${BASE}.`);
  console.log(`[auth] (or close the browser window to abort)`);

  const ctx = await launchClaudeBrowserContext({
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  let closed = false;
  ctx.on("close", () => { closed = true; });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});

  // Poll every 2s — if we can reach /design without auth redirect, we're done.
  const start = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 min
  while (!closed) {
    if (Date.now() - start > TIMEOUT_MS) {
      console.error("[auth] ❌ timed out after 10 minutes.");
      await safeClose(ctx);
      process.exit(1);
    }
    await sleep(2000);
    if (closed) break;
    try {
      const probe = ctx.pages()[0];
      if (!probe || probe.isClosed()) continue;
      const url = probe.url();
      if (url.includes("/login") || url.includes("/auth") || url === "about:blank") continue;
      if (url.startsWith("https://claude.ai/")) {
        // We're authenticated — verify by hitting /design and checking we don't bounce to /login.
        const verify = await ctx.newPage();
        await verify.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
        const vu = verify.url();
        await verify.close().catch(() => {});
        if (!vu.includes("/login") && !vu.includes("/auth")) {
          console.log(`[auth] ✅ authenticated. Verified URL: ${vu}`);
          console.log(`[auth] profile verified at ${configuredProfileDir()}. The MCP server will reuse it headless.`);
          await safeClose(ctx);
          return;
        }
      }
    } catch { /* page may be navigating — retry next tick */ }
  }
  console.log("[auth] window closed by user — aborting without saving verification.");
  process.exit(1);
}

async function safeClose(ctx: BrowserContext) {
  try { await ctx.close(); } catch { /* ignore */ }
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); process.exit(1); });
