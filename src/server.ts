#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PlaywrightBackend } from "./backends/playwright.js";
import type { DesignBackend } from "./backend.js";
import { DesignError } from "./errors.js";

const backend: DesignBackend = new PlaywrightBackend();

// ---- Tool schemas ----
const CreateSchema = z.object({
  name: z.string().min(1),
  brief: z.string().min(1),
  sources: z.array(z.string()).optional(),
});
const ProjectIdSchema = z.object({ projectId: z.string().min(1) });
const IterateSchema = ProjectIdSchema.extend({ prompt: z.string().min(1) });
const ReadFileSchema = ProjectIdSchema.extend({ path: z.string().min(1) });
const ExportSchema = ProjectIdSchema.extend({ destDir: z.string().min(1) });

const tools = [
  {
    name: "create_design_system",
    description:
      "Create a new Claude Design project. Returns { projectId, url }. Does NOT start generation — call `generate` next.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name (shown in Claude Design)." },
        brief: { type: "string", description: "Natural-language design brief / system prompt." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Optional reference URLs / inspiration sources.",
        },
      },
      required: ["name", "brief"],
    },
  },
  {
    name: "generate",
    description:
      "Start generation for an existing project. Returns immediately once generation has STARTED — generation takes ~5 minutes, poll `get_status`.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "get_status",
    description: "Poll generation status. Returns { status: 'generating'|'ready'|'error'|'draft', detail?: string }.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "iterate",
    description:
      "Send a chat message to iterate on the design. Waits for the run + self-verifier to settle before returning.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, prompt: { type: "string" } },
      required: ["projectId", "prompt"],
    },
  },
  {
    name: "list_files",
    description: "List files generated for the project (tokens, components, screens, SKILL.md, etc.).",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "read_file",
    description: "Read a single generated file by its path within the project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, path: { type: "string" } },
      required: ["projectId", "path"],
    },
  },
  {
    name: "export",
    description: "Write all generated files into destDir, preserving structure.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, destDir: { type: "string" } },
      required: ["projectId", "destDir"],
    },
  },
  {
    name: "publish",
    description: "Publish the design system (make it shareable / consumable as a Skill).",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "set_default",
    description: "Set this design system as the default one used by Claude Design.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "list_design_systems",
    description: "List all known design system projects.",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = new Server(
  { name: "claude-design-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs = {} } = req.params;
  try {
    switch (name) {
      case "create_design_system": {
        const a = CreateSchema.parse(rawArgs);
        const ref = await backend.createDesignSystem(a);
        return text(JSON.stringify(ref, null, 2));
      }
      case "generate": {
        const a = ProjectIdSchema.parse(rawArgs);
        await backend.generate(a.projectId);
        return text("generation_started");
      }
      case "get_status": {
        const a = ProjectIdSchema.parse(rawArgs);
        const s = await backend.getStatus(a.projectId);
        return text(JSON.stringify(s));
      }
      case "iterate": {
        const a = IterateSchema.parse(rawArgs);
        await backend.iterate(a.projectId, a.prompt);
        return text("iteration_complete");
      }
      case "list_files": {
        const a = ProjectIdSchema.parse(rawArgs);
        const files = await backend.listFiles(a.projectId);
        return text(JSON.stringify(files, null, 2));
      }
      case "read_file": {
        const a = ReadFileSchema.parse(rawArgs);
        const body = await backend.readFile(a.projectId, a.path);
        return text(body);
      }
      case "export": {
        const a = ExportSchema.parse(rawArgs);
        const files = await backend.listFiles(a.projectId);
        await fs.mkdir(a.destDir, { recursive: true });
        for (const f of files) {
          const body = await backend.readFile(a.projectId, f.path);
          const out = path.join(a.destDir, f.path);
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, body);
        }
        return text(`exported ${files.length} files to ${a.destDir}`);
      }
      case "publish": {
        const a = ProjectIdSchema.parse(rawArgs);
        await backend.publish(a.projectId);
        return text("published");
      }
      case "set_default": {
        const a = ProjectIdSchema.parse(rawArgs);
        await backend.setDefault(a.projectId);
        return text("set_default_ok");
      }
      case "list_design_systems": {
        const list = await backend.listDesignSystems();
        return text(JSON.stringify(list, null, 2));
      }
      default:
        return errText(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof DesignError) return errText(`[${err.code}] ${err.message}`);
    return errText(err instanceof Error ? err.message : String(err));
  }
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}
function errText(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}

async function main() {
  await backend.init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const cleanup = async () => {
    try { await backend.shutdown(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((e) => {
  // stderr only — stdout is the MCP transport.
  process.stderr.write(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
