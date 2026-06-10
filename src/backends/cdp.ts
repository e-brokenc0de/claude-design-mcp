import { type Browser, type BrowserContext, type Page } from "playwright";
import type {
  DesignBackend,
  ProjectRef,
  ProjectStatus,
  FileEntry,
  CreateInput,
} from "../backend.js";
import { config } from "../config.js";
import { urls } from "../selectors.js";
import { E } from "../errors.js";
import { ProjectRegistry } from "../registry.js";
import { attachBrowser, cdpConfig, findOrOpenDesignPage, sleep, type CdpConfig } from "../browser.js";

/**
 * CDP-attached backend. Connects to a real Chrome (launched with a remote
 * debugging port) instead of Playwright's bundled Chromium, so claude.ai's
 * Cloudflare protection treats it as a genuine browser. Chrome stays alive
 * across stdio tool calls; we reattach each time the backend is used.
 *
 * Tool bodies are still BLOCKED ON RECON — once the network/DOM surface is
 * captured we wire each tool either to an in-page fetch (preferred) or a DOM
 * interaction, both centralized via src/selectors.ts.
 */
export class CdpBackend implements DesignBackend {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private cfg: CdpConfig = cdpConfig();
  private registry = new ProjectRegistry(config.stateDir);

  async init(): Promise<void> {
    await this.registry.load();
    const { browser, context } = await attachBrowser(this.cfg);
    this.browser = browser;
    this.context = context;

    // Auth sanity check: open /design, wait out any brief Cloudflare check,
    // and fail loudly if we land on /login.
    const page = await findOrOpenDesignPage(context, urls.base);
    await this.waitForCloudflare(page);
    if (/\/(login|auth)/.test(page.url())) {
      throw E.notAuthed(
        "CDP Chrome is not logged into claude.ai. Run `pnpm run chrome:cdp`, log in once, then retry.",
      );
    }
  }

  async shutdown(): Promise<void> {
    // Detach only — leave Chrome running so the session persists and the next
    // server start reattaches instantly.
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      this.context = null;
    }
    await this.registry.save();
  }

  private ensureContext(): BrowserContext {
    if (!this.context) throw new Error("Backend not initialized. Call init() first.");
    return this.context;
  }

  /** Wait out Cloudflare's "Just a moment…" interstitial if present. */
  private async waitForCloudflare(page: Page, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const title = await page.title().catch(() => "");
      if (!/just a moment/i.test(title)) return;
      await sleep(1500);
    }
  }

  private async pageFor(projectId: string): Promise<Page> {
    const ref = this.registry.get(projectId);
    if (!ref) throw E.unknownProject(projectId);
    const ctx = this.ensureContext();
    for (const p of ctx.pages()) {
      if (p.url().startsWith(ref.url)) return p;
    }
    const page = await ctx.newPage();
    await page.goto(ref.url, { waitUntil: "domcontentloaded" });
    await this.waitForCloudflare(page);
    return page;
  }

  // ---------- Tool implementations (BLOCKED ON RECON) ----------

  async createDesignSystem(_input: CreateInput): Promise<ProjectRef> {
    throw E.reconRequired("createDesignSystem");
  }

  async generate(_projectId: string): Promise<void> {
    throw E.reconRequired("generate");
  }

  async getStatus(_projectId: string): Promise<{ status: ProjectStatus; detail?: string }> {
    throw E.reconRequired("getStatus");
  }

  async iterate(_projectId: string, _prompt: string): Promise<void> {
    throw E.reconRequired("iterate");
  }

  async listFiles(_projectId: string): Promise<FileEntry[]> {
    throw E.reconRequired("listFiles");
  }

  async readFile(_projectId: string, _filePath: string): Promise<string> {
    throw E.reconRequired("readFile");
  }

  async publish(_projectId: string): Promise<void> {
    throw E.reconRequired("publish");
  }

  async setDefault(_projectId: string): Promise<void> {
    throw E.reconRequired("setDefault");
  }

  async listDesignSystems(): Promise<ProjectRef[]> {
    return this.registry.list();
  }
}

export function extractIdFromUrl(href: string): string {
  const m = href.match(/\/design\/p\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`Cannot extract projectId from URL: ${href}`);
  return m[1];
}
