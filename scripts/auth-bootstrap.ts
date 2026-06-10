/**
 * One-time HEADED login.
 *
 * Opens a persistent Chromium profile at CLAUDE_DESIGN_PROFILE_DIR.
 * You log into claude.ai manually. We then verify the session reaches
 * /design without redirecting to login, and exit. All future runs of the
 * MCP server reuse this profile headless.
 *
 * Usage:
 *   pnpm run auth:bootstrap
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const PROFILE_DIR = path.resolve(process.env.CLAUDE_DESIGN_PROFILE_DIR ?? "./.auth/profile");
const BASE = process.env.CLAUDE_DESIGN_BASE_URL ?? "https://claude.ai/design";

async function main() {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  console.log(`[auth] launching persistent profile at: ${PROFILE_DIR}`);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  console.log("[auth] Log into claude.ai in the opened window.");
  console.log("[auth] When you can SEE claude.ai/design without being redirected to login,");
  console.log("[auth] return here and press ENTER to verify and finish.");

  await waitForEnter();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const url = page.url();
  if (url.includes("/login") || url.includes("/auth")) {
    console.error(`[auth] ❌ Still at auth URL: ${url}`);
    console.error("[auth] Log in fully, then re-run.");
    await ctx.close();
    process.exit(1);
  }
  console.log(`[auth] ✅ Authenticated. Current URL: ${url}`);
  console.log(`[auth] Profile saved at ${PROFILE_DIR}. The MCP server will reuse it headless.`);
  await ctx.close();
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
