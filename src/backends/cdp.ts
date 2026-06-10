import { type Browser, type BrowserContext, type Page } from "playwright";
import type {
  DesignBackend,
  ProjectRef,
  ProjectStatus,
  FileEntry,
  CreateInput,
} from "../backend.js";
import { config } from "../config.js";
import { urls, methods, projectType, selectors } from "../selectors.js";
import { E, DesignError } from "../errors.js";
import { ProjectRegistry } from "../registry.js";
import { attachBrowser, cdpConfig, findOrOpenDesignPage, sleep, type CdpConfig } from "../browser.js";
import { OmeletteClient } from "../omelette.js";

// ---- RPC response shapes (subset; see RECON.md) ----
interface ProjectListItem {
  projectId: string;
  name: string;
  type: string;
  publishedAt?: string;
  isOwned?: boolean;
  canEdit?: boolean;
}
interface RpcFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: string;
  contentType?: string;
  updatedAt?: string;
  version?: string;
}

/** Live generation signal derived from the project page's RPC traffic. */
interface ChatActivity {
  activeChat: number; // in-flight Chat (server-streaming) requests
  lastWrite: number; // last WriteFiles/stream activity (epoch ms)
  lastChatStart: number; // last time a Chat request began
}

function kindFromPath(p: string): FileEntry["kind"] {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  if (["css"].includes(ext)) return "css";
  if (["ts"].includes(ext)) return "ts";
  if (["tsx", "jsx"].includes(ext)) return "tsx";
  if (["md"].includes(ext)) return "md";
  if (["json"].includes(ext)) return "json";
  return "other";
}

/**
 * CDP-attached backend. Most tools call the OmeletteService Connect-RPC API via
 * in-page JSON fetch; generate/iterate drive the chat UI (the Chat RPC carries
 * an opaque payload). Chrome stays alive across stdio calls.
 */
export class CdpBackend implements DesignBackend {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private cfg: CdpConfig = cdpConfig();
  private registry = new ProjectRegistry(config.stateDir);
  private rpc = new OmeletteClient(() => this.rpcPage());
  private designPage: Page | null = null;
  private projectPages = new Map<string, Page>(); // projectId -> live project page
  private activity = new Map<string, ChatActivity>(); // projectId -> live RPC activity

  async init(): Promise<void> {
    await this.registry.load();
    const { browser, context } = await attachBrowser(this.cfg);
    this.browser = browser;
    this.context = context;

    const page = await findOrOpenDesignPage(context, urls.base);
    await this.waitForCloudflare(page);
    if (/\/(login|auth)/.test(page.url())) {
      throw E.notAuthed(
        "CDP Chrome is not logged into claude.ai. Run `pnpm run chrome:cdp`, log in once, then retry.",
      );
    }
    this.designPage = page;
  }

  async shutdown(): Promise<void> {
    this.projectPages.clear();
    this.activity.clear();
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

  /** Any live claude.ai page works for same-origin in-page RPC fetches. */
  private async rpcPage(): Promise<Page> {
    if (this.designPage && !this.designPage.isClosed()) return this.designPage;
    const ctx = this.ensureContext();
    const existing = ctx.pages().find((p) => p.url().startsWith("https://claude.ai"));
    if (existing) { this.designPage = existing; return existing; }
    const page = await findOrOpenDesignPage(ctx, urls.base);
    await this.waitForCloudflare(page);
    this.designPage = page;
    return page;
  }

  private async waitForCloudflare(page: Page, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const title = await page.title().catch(() => "");
      if (!/just a moment/i.test(title)) return;
      await sleep(1500);
    }
  }

  // ---------- API tools ----------

  async listDesignSystems(): Promise<ProjectRef[]> {
    const res = await this.rpc.call<{ items?: ProjectListItem[] }>(methods.listProjects, {});
    const items = (res.items ?? []).filter((p) => p.type === projectType.designSystem);
    return items.map((p) => ({ projectId: p.projectId, url: urls.projectById(p.projectId), name: p.name }));
  }

  async createDesignSystem(input: CreateInput): Promise<ProjectRef> {
    const res = await this.rpc.call<{ projectId: string }>(methods.createProject, {
      name: input.name,
      type: projectType.designSystem,
    });
    if (!res.projectId) throw new Error("CreateProject returned no projectId.");
    const ref: ProjectRef = {
      projectId: res.projectId,
      url: urls.projectById(res.projectId),
      name: input.name,
      brief: input.brief,
    };
    this.registry.upsert(ref);
    await this.registry.save();
    return ref;
  }

  async listFiles(projectId: string): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    let offset = 0;
    // depth large enough to flatten the tree; page via offset if truncated.
    for (;;) {
      const res = await this.rpc.call<{ entries?: RpcFileEntry[]; truncated?: boolean }>(
        methods.listFiles,
        { projectId, depth: 100, offset },
      );
      const entries = res.entries ?? [];
      for (const e of entries) {
        if (e.type !== "file") continue;
        out.push({
          path: e.path,
          size: e.size ? Number(e.size) : undefined,
          kind: kindFromPath(e.path),
        });
      }
      if (!res.truncated || entries.length === 0) break;
      offset += entries.length;
    }
    return out;
  }

  async readFileRaw(projectId: string, filePath: string): Promise<{ data: Buffer; contentType?: string }> {
    const res = await this.rpc.call<{ content?: string; contentType?: string; isBase64?: boolean }>(
      methods.getFile,
      { projectId, path: filePath },
    );
    // Connect-JSON serializes the `bytes` content field as base64.
    const data = Buffer.from(res.content ?? "", "base64");
    return { data, contentType: res.contentType };
  }

  async readFile(projectId: string, filePath: string): Promise<string> {
    const { data } = await this.readFileRaw(projectId, filePath);
    return data.toString("utf8");
  }

  async publish(projectId: string): Promise<void> {
    await this.rpc.call(methods.setProjectPublished, { projectId, published: true });
  }

  async setDefault(projectId: string): Promise<void> {
    await this.rpc.call(methods.updateOrgSettings, { defaultDesignSystemProjectUuid: projectId });
  }

  // ---------- Chat tools (DOM-driven; the Chat RPC payload is opaque) ----------

  /** Open + keep a live page for the project (reused across tool calls). */
  private async projectPage(projectId: string): Promise<Page> {
    const ref = this.registry.get(projectId);
    const url = ref?.url ?? urls.projectById(projectId);
    const existing = this.projectPages.get(projectId);
    if (existing && !existing.isClosed()) return existing;
    const ctx = this.ensureContext();
    const page =
      ctx.pages().find((p) => p.url().startsWith(url)) ?? (await ctx.newPage());
    this.trackActivity(projectId, page);
    if (!page.url().startsWith(url)) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    await this.waitForCloudflare(page);
    this.projectPages.set(projectId, page);
    return page;
  }

  /**
   * Observe the project page's RPC traffic to know when generation is active.
   * Chat is server-streaming (request stays open while generating); WriteFiles
   * fire in bursts as files are written. Far more reliable than DOM state.
   */
  private trackActivity(projectId: string, page: Page): void {
    if (this.activity.has(projectId)) return;
    const a: ChatActivity = { activeChat: 0, lastWrite: 0, lastChatStart: 0 };
    this.activity.set(projectId, a);
    const isChat = (u: string) => /OmeletteService\/Chat$/.test(u);
    const isWrite = (u: string) =>
      /OmeletteService\/(WriteFiles|CreateFileStream|WriteFileStream)$/.test(u);
    page.on("request", (r) => {
      const u = r.url();
      if (isChat(u)) { a.activeChat += 1; a.lastChatStart = Date.now(); }
      else if (isWrite(u)) { a.lastWrite = Date.now(); }
    });
    const done = (u: string) => { if (isChat(u) && a.activeChat > 0) a.activeChat -= 1; };
    page.on("requestfinished", (r) => done(r.url()));
    page.on("requestfailed", (r) => done(r.url()));
  }

  /** Generating if a Chat stream is open or files were just written. */
  private isBusy(projectId: string): boolean {
    const a = this.activity.get(projectId);
    if (!a) return false;
    if (a.activeChat > 0) return true;
    return Date.now() - a.lastWrite < 12_000;
  }

  private async verifierRunning(page: Page): Promise<boolean> {
    try {
      const body = (await page.locator("body").innerText()).toLowerCase();
      return selectors.verifierText.test(body);
    } catch {
      return false;
    }
  }

  /** Type a message into the chat and submit it. */
  private async sendMessage(page: Page, message: string): Promise<void> {
    const editor = page.locator(selectors.chatInput).first();
    await editor.waitFor({ state: "visible", timeout: 30_000 });
    await editor.click();
    await page.keyboard.insertText(message);
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
  }

  /** Wait until a turn has visibly STARTED (a Chat stream opened), or timeout. */
  private async waitStarted(projectId: string, timeoutMs = 25_000): Promise<boolean> {
    const a = this.activity.get(projectId);
    const baseline = a?.lastChatStart ?? 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.isBusy(projectId)) return true;
      if ((this.activity.get(projectId)?.lastChatStart ?? 0) > baseline) return true;
      await sleep(750);
    }
    return false;
  }

  /** Wait until the turn + verifier settle (RPC quiet for a window), or timeout. */
  private async waitSettled(projectId: string, page: Page, timeoutMs = 15 * 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (Date.now() < deadline) {
      const busy = this.isBusy(projectId) || (await this.verifierRunning(page));
      if (busy) {
        quiet = 0;
      } else {
        quiet += 1;
        if (quiet >= 3) return; // ~9s of quiet → settled
      }
      await sleep(3000);
    }
  }

  async generate(projectId: string): Promise<void> {
    const ref = this.registry.get(projectId);
    const brief = ref?.brief;
    if (!brief) {
      throw new DesignError(
        "NO_BRIEF",
        `No stored brief for ${projectId}. Pass the brief to create_design_system, or use iterate to send a prompt.`,
      );
    }
    const page = await this.projectPage(projectId);
    await this.sendMessage(page, brief);
    await this.waitStarted(projectId);
    // Return promptly; generation continues — poll get_status.
  }

  async iterate(projectId: string, prompt: string): Promise<void> {
    const page = await this.projectPage(projectId);
    await this.sendMessage(page, prompt);
    await this.waitStarted(projectId);
    await this.waitSettled(projectId, page);
  }

  async getStatus(projectId: string): Promise<{ status: ProjectStatus; detail?: string }> {
    const page = await this.projectPage(projectId);
    if (this.isBusy(projectId)) return { status: "generating" };
    if (await this.verifierRunning(page)) return { status: "generating", detail: "verifying" };
    return { status: "ready" };
  }
}

export function extractIdFromUrl(href: string): string {
  const m = href.match(/\/design\/p\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`Cannot extract projectId from URL: ${href}`);
  return m[1];
}
