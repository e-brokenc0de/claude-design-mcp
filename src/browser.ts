import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/**
 * Browser acquisition for the Claude Design backend.
 *
 * WHY CDP (not launchPersistentContext): Cloudflare on claude.ai challenges
 * Playwright's bundled Chromium (automation fingerprint) into an endless
 * "Just a moment…" loop, regardless of cookies. A REAL Chrome launched
 * normally — no automation flags, navigator.webdriver=false — passes straight
 * through. So we spawn the real Chrome binary with a remote-debugging port and
 * attach over CDP. Chrome stays alive between stdio tool calls, so generations
 * (~5 min) keep running and we reattach instantly.
 *
 * The CDP Chrome uses a DEDICATED user-data-dir (default .auth/cdp-chrome) so
 * it never collides with the user's primary Chrome (Chrome allows only one
 * process per profile, and Chrome 136+ blocks debugging on the default dir).
 * The user logs into claude.ai once in this window; the session persists.
 */

export function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export interface CdpConfig {
  port: number;
  host: string;
  userDataDir: string;
  chromePath: string;
  profileDirectory: string;
  headed: boolean;
}

function defaultChromePath(): string {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "google-chrome";
}

export function cdpConfig(): CdpConfig {
  const port = Number(process.env.CLAUDE_DESIGN_CDP_PORT ?? 9222);
  return {
    port,
    host: process.env.CLAUDE_DESIGN_CDP_HOST ?? "127.0.0.1",
    userDataDir: expandPath(process.env.CLAUDE_DESIGN_CDP_USER_DATA_DIR ?? "./.auth/cdp-chrome"),
    chromePath: process.env.CLAUDE_DESIGN_CHROME_PATH ?? defaultChromePath(),
    profileDirectory: process.env.CLAUDE_DESIGN_CHROME_PROFILE ?? "Default",
    headed: true, // CDP Chrome is always headed; headless re-triggers Cloudflare.
  };
}

export function cdpHttpUrl(cfg: CdpConfig): string {
  return process.env.CLAUDE_DESIGN_CDP_URL ?? `http://${cfg.host}:${cfg.port}`;
}

async function probeCdp(cfg: CdpConfig, timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cdpHttpUrl(cfg)}/json/version`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Spawn real Chrome with a debugging port. No automation flags. Detached. */
async function spawnChrome(cfg: CdpConfig): Promise<void> {
  await fs.mkdir(cfg.userDataDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${cfg.port}`,
    `--remote-debugging-address=${cfg.host}`,
    `--user-data-dir=${cfg.userDataDir}`,
    `--profile-directory=${cfg.profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const child = spawn(cfg.chromePath, args, { detached: true, stdio: "ignore" });
  child.unref();

  // Wait for the endpoint to come up.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await probeCdp(cfg, 1000)) return;
    await sleep(500);
  }
  throw new Error(
    `Chrome did not expose a CDP endpoint at ${cdpHttpUrl(cfg)} within 20s. ` +
      `Check CLAUDE_DESIGN_CHROME_PATH (currently "${cfg.chromePath}").`,
  );
}

/** Ensure a CDP-capable Chrome is running, launching it if necessary. */
export async function ensureCdpChrome(cfg: CdpConfig): Promise<void> {
  if (await probeCdp(cfg)) return;
  await spawnChrome(cfg);
}

export interface AttachedBrowser {
  browser: Browser;
  context: BrowserContext;
}

/** Connect to the running CDP Chrome and return its default context. */
export async function attachBrowser(cfg: CdpConfig): Promise<AttachedBrowser> {
  await ensureCdpChrome(cfg);
  const browser = await chromium.connectOverCDP(cdpHttpUrl(cfg));
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return { browser, context };
}

/**
 * Find an existing claude.ai/design tab in the context, or open one. Returns
 * the page navigated to `baseUrl` (only navigates if not already on /design).
 */
export async function findOrOpenDesignPage(
  context: BrowserContext,
  baseUrl: string,
): Promise<Page> {
  for (const p of context.pages()) {
    if (p.url().startsWith("https://claude.ai/design")) return p;
  }
  const page = context.pages().find((p) => !p.url().startsWith("devtools://")) ?? (await context.newPage());
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  return page;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
