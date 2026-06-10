import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type {
  DesignBackend,
  ProjectRef,
  ProjectStatus,
  FileEntry,
  CreateInput,
} from "../backend.js";
import { config } from "../config.js";
import { selectors, urls } from "../selectors.js";
import { E } from "../errors.js";
import { ProjectRegistry } from "../registry.js";

/**
 * Playwright backend with a long-lived persistent context. Each tool call
 * is short, but the browser stays open across calls within the same MCP
 * server process so generations (~5 min) keep running.
 *
 * KEY: we use launchPersistentContext(profileDir) so cookies/localStorage
 * survive process restarts. The user runs `auth:bootstrap` once headed to
 * log in; all subsequent runs are headless.
 */
export class PlaywrightBackend implements DesignBackend {
  private context: BrowserContext | null = null;
  private pages = new Map<string, Page>(); // projectId -> Page
  private registry = new ProjectRegistry(config.stateDir);

  async init(): Promise<void> {
    await fs.mkdir(config.profileDir, { recursive: true });
    await fs.mkdir(config.stateDir, { recursive: true });
    await this.registry.load();
    this.context = await chromium.launchPersistentContext(config.profileDir, {
      headless: !config.headed,
      viewport: { width: 1440, height: 900 },
    });
    // Sanity: ensure we're authed by hitting the base URL once.
    const page = await this.context.newPage();
    await page.goto(urls.base, { waitUntil: "domcontentloaded" });
    const url = page.url();
    if (url.includes("/login") || url.includes("/auth")) {
      await page.close();
      throw E.notAuthed();
    }
    await page.close();
  }

  async shutdown(): Promise<void> {
    for (const p of this.pages.values()) {
      try { await p.close(); } catch { /* ignore */ }
    }
    this.pages.clear();
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    await this.registry.save();
  }

  private ensureContext(): BrowserContext {
    if (!this.context) throw new Error("Backend not initialized. Call init() first.");
    return this.context;
  }

  private async pageFor(projectId: string): Promise<Page> {
    let page = this.pages.get(projectId);
    if (page && !page.isClosed()) return page;
    const ref = this.registry.get(projectId);
    if (!ref) throw E.unknownProject(projectId);
    page = await this.ensureContext().newPage();
    await page.goto(ref.url, { waitUntil: "domcontentloaded" });
    this.pages.set(projectId, page);
    return page;
  }

  // ---------- Tool implementations ----------

  async createDesignSystem(_input: CreateInput): Promise<ProjectRef> {
    // BLOCKED ON RECON: exact selectors for name input, brief textarea, create button.
    // Once recon fills selectors.ts, fill in:
    //   const page = await this.ensureContext().newPage();
    //   await page.goto(urls.base);
    //   await page.fill(selectors.newProjectNameInput, input.name);
    //   await page.fill(selectors.newProjectBriefTextarea, input.brief);
    //   await page.click(selectors.createProjectButton);
    //   await page.waitForURL(/\/design\/p\//);
    //   const projectId = extractIdFromUrl(page.url());
    //   const ref = { projectId, url: page.url(), name: input.name };
    //   this.registry.upsert(ref);
    //   await this.registry.save();
    //   this.pages.set(projectId, page);
    //   return ref;
    throw E.reconRequired("createDesignSystem");
  }

  async generate(_projectId: string): Promise<void> {
    // BLOCKED ON RECON: generate button selector + detection that generation STARTED
    // (so we can return immediately without awaiting completion).
    throw E.reconRequired("generate");
  }

  async getStatus(_projectId: string): Promise<{ status: ProjectStatus; detail?: string }> {
    // BLOCKED ON RECON: how to read "generating | ready | error" from DOM/network.
    throw E.reconRequired("getStatus");
  }

  async iterate(_projectId: string, _prompt: string): Promise<void> {
    // BLOCKED ON RECON: chat input + send + wait for verifier ("Checking the design for issues…") to clear.
    throw E.reconRequired("iterate");
  }

  async listFiles(_projectId: string): Promise<FileEntry[]> {
    // BLOCKED ON RECON: file tree selector OR internal file API.
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

// Helper: pulled out so it's covered when we wire createDesignSystem.
export function extractIdFromUrl(href: string): string {
  const m = href.match(/\/design\/p\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`Cannot extract projectId from URL: ${href}`);
  return m[1];
}

// Silence unused-helper lint until M1 wiring uses it.
void path;
