#!/usr/bin/env node
/**
 * claude-design — a thin CLI over the claude-design MCP server.
 *
 * It does NOT re-implement any tool. It spawns the same `dist/server.js`, discovers
 * the tools via `listTools()`, and forwards arguments via `callTool()`. So the CLI's
 * commands, schemas, validation and output are exactly the server's — add a tool to
 * the server and it shows up here automatically, no edits to this file.
 *
 * Tool commands  : every MCP tool, e.g. `claude-design list-projects --json`
 * Meta commands  : chrome | scaffold | watch (the dev scripts, not MCP tools)
 *
 *   claude-design --help
 *   claude-design <command> --help
 *   claude-design create-design-system --name "Acme" --brief "..."
 *   claude-design list-projects --json
 *   claude-design watch --project <id>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---- types (loose — we only read what we use from the MCP shapes) ----
interface JsonSchema {
  type?: string;
  properties?: Record<string, { type?: string; description?: string; items?: { type?: string } }>;
  required?: string[];
}
interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

const META_COMMANDS: Record<string, { summary: string; usage: string; load: () => Promise<{ run: (a: string[]) => Promise<void> }> }> = {
  chrome: {
    summary: "Launch/attach the debug Chrome and log into claude.ai (one-time auth).",
    usage: "claude-design chrome",
    load: () => import("./lib/chrome.js"),
  },
  scaffold: {
    summary: "Turn a Claude Design export into packages/tokens + packages/ui.",
    usage: "claude-design scaffold --src <exportDir> --out <packagesDir> [--name ui] [--ds-name \"My DS\"]",
    load: () => import("./lib/scaffold.js"),
  },
  watch: {
    summary: "Block until a generation/iteration settles (good for CI / background wake).",
    usage: "claude-design watch --project <id> [--timeout ms] [--quiet ms] [--interval ms]",
    load: () => import("./lib/watch.js"),
  },
};

const version = (): string => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

// ---- name helpers ----
const toKebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const fromKebab = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
/** Tool names are snake_case on the wire; the CLI accepts kebab-case or snake_case. */
const toToolName = (cmd: string) => cmd.replace(/-/g, "_");

// ---- MCP client ----
async function connect(): Promise<Client> {
  const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));
  // Forward the full environment so the server child sees the CDP config + PATH.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env });
  const client = new Client({ name: "claude-design-cli", version: version() }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function listTools(client: Client): Promise<ToolInfo[]> {
  const res = await client.listTools();
  return res.tools as unknown as ToolInfo[];
}

// ---- flag parsing, driven entirely by the tool's JSON Schema ----
function buildArgs(schema: JsonSchema, argv: string[]): Record<string, unknown> {
  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  // map both the exact prop name and its kebab form back to the prop name
  const lookup = new Map<string, string>();
  for (const name of Object.keys(props)) {
    lookup.set(name, name);
    lookup.set(toKebab(name), name);
  }

  const out: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    let raw = tok.slice(2);
    let negate = false;
    if (raw.startsWith("no-")) { negate = true; raw = raw.slice(3); }
    let inline: string | undefined;
    const eq = raw.indexOf("=");
    if (eq >= 0) { inline = raw.slice(eq + 1); raw = raw.slice(0, eq); }

    const name = lookup.get(raw) ?? lookup.get(fromKebab(raw));
    if (!name) throw new Error(`unknown flag --${raw}`);
    const type = props[name].type;

    if (type === "boolean") {
      out[name] = negate ? false : inline !== undefined ? inline !== "false" : true;
    } else if (type === "array") {
      const val = inline ?? argv[++i];
      if (val === undefined) throw new Error(`flag --${raw} expects a value`);
      if (!Array.isArray(out[name])) out[name] = [];
      (out[name] as string[]).push(val);
    } else {
      const val = inline ?? argv[++i];
      if (val === undefined) throw new Error(`flag --${raw} expects a value`);
      out[name] = val;
    }
  }

  const missing = required.filter((r) => !(r in out));
  if (missing.length) throw new Error(`missing required: ${missing.map((m) => "--" + toKebab(m)).join(", ")}`);
  return out;
}

// ---- help ----
function flagHelp(schema: JsonSchema): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const names = Object.keys(props);
  if (!names.length) return "  (no arguments)";
  return names
    .map((n) => {
      const p = props[n];
      const kind = p.type === "boolean" ? "" : p.type === "array" ? " <value> (repeatable)" : " <value>";
      const tag = required.has(n) ? "  (required)" : "";
      const desc = p.description ? `  — ${p.description}` : "";
      return `  --${toKebab(n)}${kind}${tag}${desc}`;
    })
    .join("\n");
}

function firstLine(s?: string): string {
  if (!s) return "";
  const line = s.split("\n")[0];
  return line.length > 100 ? line.slice(0, 97) + "…" : line;
}

async function topHelp(): Promise<void> {
  let tools: ToolInfo[] = [];
  try {
    const client = await connect();
    tools = await listTools(client);
    await client.close();
  } catch {
    // server unreachable — still show meta commands + usage
  }
  const lines: string[] = [];
  lines.push("claude-design — drive Claude Design (claude.ai/design) from the terminal\n");
  lines.push("Usage: claude-design <command> [flags]   (add --help to any command)\n");
  if (tools.length) {
    lines.push("Tool commands:");
    for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${t.name.replace(/_/g, "-").padEnd(28)} ${firstLine(t.description)}`);
    }
    lines.push("");
  }
  lines.push("Meta commands:");
  for (const [name, m] of Object.entries(META_COMMANDS)) {
    lines.push(`  ${name.padEnd(28)} ${m.summary}`);
  }
  lines.push("\nGlobal: --json (machine-readable stdout), --version, --help");
  console.log(lines.join("\n"));
}

// ---- output ----
function printResult(content: unknown, json: boolean): void {
  const parts = Array.isArray(content) ? content : [];
  const text = parts
    .filter((c): c is { type: string; text: string } => !!c && (c as { type?: string }).type === "text")
    .map((c) => c.text)
    .join("\n");
  if (json) {
    try {
      console.log(JSON.stringify(JSON.parse(text)));
    } catch {
      console.log(JSON.stringify({ result: text }));
    }
  } else {
    console.log(text);
  }
}

// ---- main ----
async function main(): Promise<void> {
  let argv = process.argv.slice(2);

  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(version());
    return;
  }

  // pull the global --json out of the stream
  const json = argv.includes("--json");
  argv = argv.filter((a) => a !== "--json");

  const cmd = argv[0];
  const rest = argv.slice(1);
  const wantsHelp = rest.includes("--help") || rest.includes("-h");

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    await topHelp();
    return;
  }

  // meta commands (chrome / scaffold / watch) — run the shared lib directly, no MCP
  const meta = META_COMMANDS[cmd];
  if (meta) {
    if (wantsHelp) {
      console.log(`${meta.summary}\n\nUsage: ${meta.usage}`);
      return;
    }
    try {
      const mod = await meta.load();
      await mod.run(rest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cmd === "scaffold" && /style-dictionary/.test(msg)) {
        console.error("scaffold needs 'style-dictionary' (a dev dependency). Run it from a cloned repo with `pnpm install`.");
      } else {
        console.error(msg);
      }
      process.exit(1);
    }
    return;
  }

  // tool commands — discovered from the server
  let client: Client | undefined;
  try {
    client = await connect();
    const tools = await listTools(client);
    const tool = tools.find((t) => t.name === toToolName(cmd));
    if (!tool) {
      await client.close();
      console.error(`unknown command: ${cmd}\nRun \`claude-design --help\` to list commands.`);
      process.exit(1);
    }

    if (wantsHelp) {
      await client.close();
      console.log(`${tool.name}\n${tool.description ?? ""}\n\nUsage: claude-design ${cmd} [flags]\n\nFlags:\n${flagHelp(tool.inputSchema)}`);
      return;
    }

    const args = buildArgs(tool.inputSchema, rest);
    const res = await client.callTool({ name: tool.name, arguments: args });
    await client.close();

    if (res.isError) {
      const text = (Array.isArray(res.content) ? res.content : [])
        .map((c: { text?: string }) => c?.text ?? "")
        .join("\n");
      console.error(text);
      process.exit(/NOT_AUTHED/.test(text) ? 2 : 1);
    }
    printResult(res.content, json);
  } catch (err) {
    try { await client?.close(); } catch { /* ignore */ }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
