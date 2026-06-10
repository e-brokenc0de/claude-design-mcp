import { type Page } from "playwright";
import { rpc, methods } from "./selectors.js";
import { DesignError } from "./errors.js";

/**
 * Connect-RPC JSON client for Claude Design's OmeletteService.
 *
 * Calls run INSIDE the page via fetch (credentials:"include") so the real
 * Chrome session + Cloudflare clearance apply. Connect accepts application/json
 * on every endpoint and returns JSON (see RECON.md).
 */
export class OmeletteClient {
  private orgUuid: string | null = null;

  constructor(private getPage: () => Promise<Page>) {}

  /** Resolve and cache the org uuid (GetMe works without the org header). */
  async ensureOrg(): Promise<string> {
    if (this.orgUuid) return this.orgUuid;
    const me = await this.call<{ organizationUuid: string }>(methods.getMe, {}, { org: false });
    if (!me.organizationUuid) throw new DesignError("NO_ORG", "GetMe returned no organizationUuid.");
    this.orgUuid = me.organizationUuid;
    return this.orgUuid;
  }

  /**
   * Invoke an OmeletteService method with a JSON body, returning parsed JSON.
   * Throws DesignError on non-2xx (Connect error shape: { code, message }).
   */
  async call<T = unknown>(method: string, body: unknown, opts?: { org?: boolean }): Promise<T> {
    const withOrg = opts?.org !== false;
    const org = withOrg ? await this.ensureOrg() : "";
    const page = await this.getPage();
    const url = rpc.url(method);

    const result = await page.evaluate(
      async (args: { url: string; body: string; org: string }) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "connect-protocol-version": "1",
        };
        if (args.org) headers["x-organization-uuid"] = args.org;
        const res = await fetch(args.url, {
          method: "POST",
          headers,
          credentials: "include",
          body: args.body,
        });
        const text = await res.text();
        return { status: res.status, ok: res.ok, text };
      },
      { url, body: JSON.stringify(body ?? {}), org },
    );

    if (!result.ok) {
      let msg = result.text;
      try {
        const j = JSON.parse(result.text) as { code?: string; message?: string };
        msg = `${j.code ?? result.status}: ${j.message ?? result.text}`;
      } catch { /* keep raw */ }
      throw new DesignError("RPC_ERROR", `${method} failed [${result.status}] ${msg}`);
    }

    if (!result.text) return {} as T;
    try {
      return JSON.parse(result.text) as T;
    } catch {
      throw new DesignError("RPC_PARSE", `${method} returned non-JSON: ${result.text.slice(0, 200)}`);
    }
  }
}
