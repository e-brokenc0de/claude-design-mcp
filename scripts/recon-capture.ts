/**
 * M0 RECON — capture every HTTP + WebSocket call Claude Design makes while
 * you drive a full flow (create → generate → iterate → view files → publish).
 *
 * Run:
 *   pnpm run recon:capture
 *
 * Opens a HEADED browser using the persistent profile from `auth:bootstrap`.
 * Capture ends when you CLOSE THE BROWSER WINDOW. Streams to:
 *   - recon/network.jsonl        (one JSON record per request/response)
 *   - recon/websocket.jsonl      (WS frames, both directions)
 *   - recon/console.log          (page console output)
 *
 * Privacy: Cookie request headers are redacted. Authorization headers ARE
 * captured (we need them for the API backend); recon/ is gitignored.
 */
import { type Request, type Response, type WebSocket } from "playwright";
import fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import { launchClaudeBrowserContext, profileModeDescription } from "../src/chrome-profile.js";

const BASE = process.env.CLAUDE_DESIGN_BASE_URL ?? "https://claude.ai/design";
const OUT_DIR = path.resolve("./recon");

function ts() { return new Date().toISOString(); }

function safeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^cookie$/i.test(k)) { out[k] = "[REDACTED]"; continue; }
    out[k] = v;
  }
  return out;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const netStream: WriteStream = createWriteStream(path.join(OUT_DIR, "network.jsonl"), { flags: "a" });
  const wsStream: WriteStream = createWriteStream(path.join(OUT_DIR, "websocket.jsonl"), { flags: "a" });
  const conStream: WriteStream = createWriteStream(path.join(OUT_DIR, "console.log"), { flags: "a" });

  console.log(`[recon] using ${profileModeDescription()}`);
  const ctx = await launchClaudeBrowserContext({
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  let closed = false;
  ctx.on("close", () => { closed = true; });

  ctx.on("request", (req: Request) => {
    netStream.write(JSON.stringify({
      t: ts(), kind: "request",
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      headers: safeHeaders(req.headers()),
      postData: req.postData()?.slice(0, 20_000) ?? null,
    }) + "\n");
  });

  ctx.on("response", async (res: Response) => {
    let bodyPreview: string | null = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("event-stream") || ct.includes("javascript")) {
        const buf = await res.body();
        bodyPreview = buf.toString("utf8").slice(0, 40_000);
      }
    } catch { /* ignore */ }
    netStream.write(JSON.stringify({
      t: ts(), kind: "response",
      status: res.status(),
      url: res.url(),
      headers: safeHeaders(res.headers()),
      bodyPreview,
    }) + "\n");
  });

  ctx.on("page", (page) => {
    page.on("console", (msg) => {
      conStream.write(`[${ts()}] ${msg.type()}: ${msg.text()}\n`);
    });
    page.on("websocket", (ws: WebSocket) => {
      wsStream.write(JSON.stringify({ t: ts(), kind: "ws_open", url: ws.url() }) + "\n");
      ws.on("framesent", (f) => wsStream.write(JSON.stringify({ t: ts(), kind: "ws_send", url: ws.url(), payload: String(f.payload).slice(0, 20_000) }) + "\n"));
      ws.on("framereceived", (f) => wsStream.write(JSON.stringify({ t: ts(), kind: "ws_recv", url: ws.url(), payload: String(f.payload).slice(0, 20_000) }) + "\n"));
      ws.on("close", () => wsStream.write(JSON.stringify({ t: ts(), kind: "ws_close", url: ws.url() }) + "\n"));
    });
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  if (/\/(login|auth)/.test(page.url())) {
    console.error("[recon] ❌ not authenticated. Run `pnpm run auth:bootstrap` first.");
    try { await ctx.close(); } catch { /* ignore */ }
    process.exit(1);
  }

  console.log("");
  console.log("================ RECON CAPTURE ACTIVE ================");
  console.log(" Drive the full flow in the opened browser:");
  console.log("   1. Create a NEW design project (name + brief)");
  console.log("   2. Press Generate; wait until ready (~5 min)");
  console.log("   3. Open the Files tab; click a few files");
  console.log("   4. Send ONE chat iteration message; wait for verifier");
  console.log("   5. Publish; set as default");
  console.log(" CLOSE the browser window when done — capture ends automatically.");
  console.log("======================================================");
  console.log("");

  // Wait for browser close
  while (!closed) {
    await sleep(1000);
  }

  netStream.end();
  wsStream.end();
  conStream.end();

  // Give streams a tick to flush
  await sleep(200);

  console.log("");
  console.log(`[recon] wrote ${path.join(OUT_DIR, "network.jsonl")}`);
  console.log(`[recon] wrote ${path.join(OUT_DIR, "websocket.jsonl")}`);
  console.log(`[recon] wrote ${path.join(OUT_DIR, "console.log")}`);
  console.log(`[recon] next: I'll read these and fill RECON.md.`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); process.exit(1); });
