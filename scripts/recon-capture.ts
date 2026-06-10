/**
 * M0 RECON over CDP — attach to the real Chrome (started by `pnpm run chrome:cdp`)
 * and capture every HTTP + WebSocket call Claude Design makes while you drive a
 * full flow (create → generate → iterate → view files → publish).
 *
 *   pnpm run recon:capture
 *
 * Capture ends when you press ENTER in this terminal (the Chrome window stays
 * open). Streams to:
 *   - recon/network.jsonl     (one JSON record per request/response)
 *   - recon/websocket.jsonl   (WS frames, both directions)
 *   - recon/console.log       (page console output)
 *
 * Privacy: Cookie request headers are redacted. Authorization headers ARE
 * captured (needed for an API backend); recon/ is gitignored.
 */
import { chromium, type Request, type Response, type WebSocket, type Page } from "playwright";
import fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import { cdpConfig, ensureCdpChrome, cdpHttpUrl } from "../src/browser.js";

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

  const cfg = cdpConfig();
  await ensureCdpChrome(cfg);
  const browser = await chromium.connectOverCDP(cdpHttpUrl(cfg));
  const ctx = browser.contexts()[0] ?? (await browser.newContext());

  const wire = (req: Request) => {
    netStream.write(JSON.stringify({
      t: ts(), kind: "request",
      method: req.method(), url: req.url(), resourceType: req.resourceType(),
      headers: safeHeaders(req.headers()),
      postData: req.postData()?.slice(0, 20_000) ?? null,
    }) + "\n");
  };
  const wireRes = async (res: Response) => {
    let bodyPreview: string | null = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("event-stream") || ct.includes("javascript")) {
        bodyPreview = (await res.body()).toString("utf8").slice(0, 40_000);
      }
    } catch { /* ignore */ }
    netStream.write(JSON.stringify({
      t: ts(), kind: "response", status: res.status(), url: res.url(),
      headers: safeHeaders(res.headers()), bodyPreview,
    }) + "\n");
  };
  const wireWs = (ws: WebSocket) => {
    wsStream.write(JSON.stringify({ t: ts(), kind: "ws_open", url: ws.url() }) + "\n");
    ws.on("framesent", (f) => wsStream.write(JSON.stringify({ t: ts(), kind: "ws_send", url: ws.url(), payload: String(f.payload).slice(0, 20_000) }) + "\n"));
    ws.on("framereceived", (f) => wsStream.write(JSON.stringify({ t: ts(), kind: "ws_recv", url: ws.url(), payload: String(f.payload).slice(0, 20_000) }) + "\n"));
    ws.on("close", () => wsStream.write(JSON.stringify({ t: ts(), kind: "ws_close", url: ws.url() }) + "\n"));
  };
  const attachPage = (page: Page) => {
    page.on("request", wire);
    page.on("response", wireRes);
    page.on("websocket", wireWs);
    page.on("console", (m) => conStream.write(`[${ts()}] ${m.type()}: ${m.text()}\n`));
  };

  ctx.on("page", attachPage);
  ctx.pages().forEach(attachPage);

  const page = ctx.pages().find((p) => p.url().startsWith("https://claude.ai")) ?? ctx.pages()[0];
  if (page) { await page.bringToFront().catch(() => {}); }

  // Flush + detach cleanly when stopped (works when run in background too).
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    netStream.end(); wsStream.end(); conStream.end();
    await sleep(200);
    try { await browser.close(); } catch { /* ignore */ }
    console.log("[recon] flushed recon/*.jsonl");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("");
  console.log("================ RECON CAPTURE ACTIVE (CDP) ================");
  console.log(" Drive the full flow in the Chrome window:");
  console.log("   1. Create a NEW design project (name + brief)");
  console.log("   2. Press Generate; wait until ready (~5 min)");
  console.log("   3. Open the Files tab; click a few files");
  console.log("   4. Send ONE chat iteration message; wait for verifier");
  console.log("   5. Publish; set as default");
  console.log(" Press ENTER here when done (the Chrome window stays open).");
  console.log("===========================================================");

  await waitForEnter();

  netStream.end(); wsStream.end(); conStream.end();
  await sleep(200);
  await browser.close(); // detach; Chrome keeps running
  console.log(`[recon] wrote recon/network.jsonl, recon/websocket.jsonl, recon/console.log`);
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.pause(); resolve(); });
  });
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); process.exit(1); });
