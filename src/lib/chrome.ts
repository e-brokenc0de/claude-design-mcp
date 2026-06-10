/**
 * Launch (or reuse) the real Chrome with a remote-debugging port, then make
 * sure you're logged into claude.ai/design. The MCP server attaches to this
 * same Chrome over CDP.
 *
 *   pnpm run chrome:cdp
 *
 * Uses a dedicated user-data-dir (.auth/cdp-chrome) so it never collides with
 * your primary Chrome. Log in once; the session persists in that dir.
 *
 * Shared by `pnpm run chrome:cdp` (scripts/chrome-cdp.ts) and the
 * `claude-design chrome` CLI subcommand. Takes no arguments.
 */
import { chromium } from "playwright";
import { cdpConfig, ensureCdpChrome, cdpHttpUrl } from "../browser.js";

export async function run(_argv: string[] = []): Promise<void> {
  const cfg = cdpConfig();
  console.log(`[cdp] ensuring Chrome at ${cdpHttpUrl(cfg)} (profile dir: ${cfg.userDataDir})`);
  await ensureCdpChrome(cfg);

  const browser = await chromium.connectOverCDP(cdpHttpUrl(cfg));
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages().find((p) => !p.url().startsWith("devtools://")) ?? (await ctx.newPage());
  await page.bringToFront().catch(() => {});
  await page.goto("https://claude.ai/design", { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("[cdp] If you see a login page, log into claude.ai in the Chrome window.");
  console.log("[cdp] Waiting until you reach /design (up to 5 min)...");

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const url = page.url();
    const title = await page.title().catch(() => "");
    if (/just a moment/i.test(title)) { process.stderr.write(`  ...cloudflare check\n`); continue; }
    if (/\/(login|auth)/.test(url)) { process.stderr.write(`  ...waiting for login (${url})\n`); continue; }
    if (url.startsWith("https://claude.ai/design")) {
      console.log(`[cdp] ✅ authenticated at ${url}`);
      console.log(`[cdp] Chrome stays running on port ${cfg.port}. The MCP server will attach to it.`);
      await browser.close(); // detaches CDP; Chrome keeps running
      return;
    }
  }
  console.error("[cdp] ❌ timed out waiting for /design.");
  await browser.close();
  process.exit(1);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
