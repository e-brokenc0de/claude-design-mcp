/**
 * watch-status — block until a project's generation/iteration settles, then exit.
 *
 *   pnpm run watch:status -- --project <projectId> [--timeout 900000] [--quiet 40000] [--interval 4000]
 *
 * Run this with the agent's background-exec (run_in_background): the harness sends a
 * completion notification the moment the command exits, so you get an automatic
 * "wake-up when generation finishes" without burning turns polling.
 *
 * Detection is cross-process (works even though the MCP server owns the generating
 * page): it polls ListFiles over CDP and watches each file's version. Generation
 * writes files in bursts; when a change has been seen and then nothing changes for the
 * quiet window, the run is considered settled. Run it right after generate/send_message.
 *
 * Exit 0 + {status:"ready"} when settled; exit 2 + {status:"timeout"} if it never settles.
 */
import { chromium } from "playwright";
import { cdpConfig, cdpHttpUrl } from "../src/browser.js";

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PROJECT = arg("--project", "");
const TIMEOUT = Number(arg("--timeout", "900000")); // 15 min
const QUIET = Number(arg("--quiet", "40000")); // 40s of no file changes = settled
const INTERVAL = Number(arg("--interval", "4000"));

if (!PROJECT) {
  console.error("usage: watch:status -- --project <projectId> [--timeout ms] [--quiet ms] [--interval ms]");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const cfg = cdpConfig();
  const browser = await chromium.connectOverCDP(cdpHttpUrl(cfg));
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith("https://claude.ai")) ?? (await ctx.newPage());
  if (!page.url().startsWith("https://claude.ai")) {
    await page.goto(cfg ? "https://claude.ai/design" : "https://claude.ai/design", { waitUntil: "domcontentloaded" }).catch(() => {});
  }

  // org uuid (GetMe works without the org header)
  const org = await page.evaluate(async () => {
    const r = await fetch("https://claude.ai/design/anthropic.omelette.api.v1alpha.OmeletteService/GetMe", {
      method: "POST",
      headers: { "content-type": "application/json", "connect-protocol-version": "1" },
      credentials: "include",
      body: "{}",
    });
    const j = await r.json();
    return j.organizationUuid as string;
  });

  const start = Date.now();
  let baseline: string | null = null;
  let sawChange = false;
  let lastSig = "";
  let stableSince = Date.now();

  while (Date.now() - start < TIMEOUT) {
    const sig = await page.evaluate(
      async (args: { org: string; project: string }) => {
        const r = await fetch("https://claude.ai/design/anthropic.omelette.api.v1alpha.OmeletteService/ListFiles", {
          method: "POST",
          headers: { "content-type": "application/json", "connect-protocol-version": "1", "x-organization-uuid": args.org },
          credentials: "include",
          body: JSON.stringify({ projectId: args.project, depth: 100 }),
        });
        const j = await r.json();
        const entries = (j.entries ?? []) as { path: string; version?: string; type?: string }[];
        return entries
          .filter((e) => e.type === "file")
          .map((e) => e.path + ":" + (e.version ?? ""))
          .sort()
          .join("|");
      },
      { org, project: PROJECT },
    );

    if (baseline === null) {
      baseline = sig;
      lastSig = sig;
    } else if (sig !== lastSig) {
      if (sig !== baseline) sawChange = true;
      lastSig = sig;
      stableSince = Date.now();
    }

    const quietFor = Date.now() - stableSince;
    if (sawChange && quietFor >= QUIET) {
      const files = sig ? sig.split("|").length : 0;
      console.log(JSON.stringify({ status: "ready", files, settledAfterSeconds: Math.round((Date.now() - start) / 1000) }));
      await browser.close();
      process.exit(0);
    }

    await sleep(INTERVAL);
  }

  console.log(JSON.stringify({ status: "timeout", sawChange, note: "no settle within timeout — check get_status manually" }));
  await browser.close();
  process.exit(2);
}

main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
