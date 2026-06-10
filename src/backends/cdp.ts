import { type Browser, type BrowserContext, type Page } from "playwright";
import type {
  DesignBackend,
  ProjectRef,
  ProjectStatus,
  FileEntry,
  CreateInput,
} from "../backend.js";
import { config } from "../config.js";
import { urls, methods, projectType } from "../selectors.js";
import { E } from "../errors.js";
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

  // ---------- Chat tools (DOM — implemented next) ----------

  async generate(_projectId: string): Promise<void> {
    throw E.reconRequired("generate (chat DOM wiring)");
  }

  async iterate(_projectId: string, _prompt: string): Promise<void> {
    throw E.reconRequired("iterate (chat DOM wiring)");
  }

  async getStatus(_projectId: string): Promise<{ status: ProjectStatus; detail?: string }> {
    throw E.reconRequired("getStatus (chat DOM wiring)");
  }
}

export function extractIdFromUrl(href: string): string {
  const m = href.match(/\/design\/p\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`Cannot extract projectId from URL: ${href}`);
  return m[1];
}
