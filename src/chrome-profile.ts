import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium, type BrowserContext } from "playwright";

export type ChromeChannel = "chrome" | "chrome-beta" | "chrome-dev" | "chrome-canary";

export interface BrowserProfileOptions {
  headless: boolean;
  viewport?: { width: number; height: number };
}

export function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v?.toLowerCase() === "true";
}

export const DEFAULT_PLAYWRIGHT_PROFILE_DIR = "./.auth/profile";

/**
 * macOS default Chrome profile root. This lets us reuse cookies from the real
 * browser when the user opts in with CLAUDE_DESIGN_USE_SYSTEM_CHROME=1.
 *
 * Important caveat: Chrome keeps an exclusive lock on an active profile. Close
 * all regular Chrome windows before launching with this profile, or use the
 * dedicated Playwright profile fallback.
 */
export function defaultSystemChromeUserDataDir(): string {
  return path.join(os.homedir(), "Library/Application Support/Google/Chrome");
}

export function configuredProfileDir(): string {
  if (envFlag("CLAUDE_DESIGN_USE_SYSTEM_CHROME")) {
    return expandPath(process.env.CLAUDE_DESIGN_CHROME_USER_DATA_DIR ?? defaultSystemChromeUserDataDir());
  }
  return expandPath(process.env.CLAUDE_DESIGN_PROFILE_DIR ?? DEFAULT_PLAYWRIGHT_PROFILE_DIR);
}

export async function launchClaudeBrowserContext(opts: BrowserProfileOptions): Promise<BrowserContext> {
  const useSystemChrome = envFlag("CLAUDE_DESIGN_USE_SYSTEM_CHROME");
  const userDataDir = configuredProfileDir();
  await fs.mkdir(userDataDir, { recursive: true });

  const launchOpts = {
    headless: opts.headless,
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    args: ["--profile-directory=Default"],
    ...(useSystemChrome ? { channel: (process.env.CLAUDE_DESIGN_CHROME_CHANNEL ?? "chrome") as ChromeChannel } : {}),
  };

  return chromium.launchPersistentContext(userDataDir, launchOpts);
}

export function profileModeDescription(): string {
  if (envFlag("CLAUDE_DESIGN_USE_SYSTEM_CHROME")) {
    return `system Google Chrome profile at ${configuredProfileDir()}`;
  }
  return `dedicated Playwright profile at ${configuredProfileDir()}`;
}
