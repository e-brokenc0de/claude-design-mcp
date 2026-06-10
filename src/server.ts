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
import { CdpBackend } from "./backends/cdp.js";
import type { DesignBackend } from "./backend.js";
import { DesignError } from "./errors.js";

const backend: DesignBackend = new CdpBackend();
let backendInit: Promise<void> | null = null;
let backendStarted = false;

async function ensureBackend(): Promise<void> {
  if (!backendInit) {
    backendInit = backend.init().then(() => { backendStarted = true; });
  }
  await backendInit;
}

const SERVER_INSTRUCTIONS = [
  "Drives Claude Design (claude.ai/design): create design systems AND design projects, generate, iterate/revise, inspect, edit, and export.",
  "Design systems: create_design_system. Design projects (screens/apps): create_design_project, optionally with designSystemIds to reuse a system's tokens/components; manage bindings with attach_design_system / detach_design_system / refresh_design_system.",
  "Generation is asynchronous: after create, call generate, then poll get_status until 'ready' before reading/exporting. Revise with send_message (optionally target a conversationId); list_conversations / new_conversation manage chats.",
  "Files: list_files, read_file, export (to a local dir), plus search_files (grep), write_file, edit_file, delete_file for direct edits.",
  "Requires a logged-in CDP Chrome; if a tool returns NOT_AUTHED, run `pnpm run chrome:cdp` and log in.",
].join("\n");

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

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  brief: z.string().optional(),
  designSystemIds: z.array(z.string()).optional(),
  designComponents: z.boolean().optional(),
});
const AttachSchema = ProjectIdSchema.extend({ designSystemId: z.string().min(1) });
const RefreshSchema = ProjectIdSchema.extend({ designSystemId: z.string().optional() });
const SendMessageSchema = ProjectIdSchema.extend({
  prompt: z.string().min(1),
  conversationId: z.string().optional(),
});
const SearchSchema = ProjectIdSchema.extend({ pattern: z.string().min(1) });
const WriteFileSchema = ProjectIdSchema.extend({ path: z.string().min(1), content: z.string() });
const EditFileSchema = ProjectIdSchema.extend({
  path: z.string().min(1),
  oldString: z.string().min(1),
  newString: z.string(),
});
const RenameSchema = ProjectIdSchema.extend({ name: z.string().min(1) });
const RemixSchema = ProjectIdSchema.extend({ includeChats: z.boolean().optional() });
const FavoriteSchema = ProjectIdSchema.extend({ favorite: z.boolean() });
const ClaudeCodeSchema = ProjectIdSchema.extend({ instructions: z.string().optional() });

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
    _meta: { "anthropic/maxResultSizeChars": 500000 },
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
  {
    name: "list_projects",
    description: "List ALL projects (both design systems and design projects) with their kind.",
    inputSchema: { type: "object", properties: {} },
  },
  // ---- design projects + design-system bindings ----
  {
    name: "create_design_project",
    description:
      "Create a new design PROJECT (screens/app/prototype), optionally attaching design systems. Returns { projectId, url }. Call `generate` to start from the brief, or `send_message` to drive it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name." },
        brief: { type: "string", description: "Optional brief; stored and sent on `generate`." },
        designSystemIds: {
          type: "array",
          items: { type: "string" },
          description: "Design system project ids to bind so generation reuses their tokens/components.",
        },
        designComponents: { type: "boolean", description: "Enable design-component reuse (defaults true when systems are attached)." },
      },
      required: ["name"],
    },
  },
  {
    name: "attach_design_system",
    description: "Bind a design system to a project so it reuses that system's tokens/components.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, designSystemId: { type: "string" } },
      required: ["projectId", "designSystemId"],
    },
  },
  {
    name: "detach_design_system",
    description: "Unbind a design system from a project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, designSystemId: { type: "string" } },
      required: ["projectId", "designSystemId"],
    },
  },
  {
    name: "list_attached_design_systems",
    description: "List the design systems currently bound to a project (with names).",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "refresh_design_system",
    description: "Pull the latest version of bound design system(s) into the project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, designSystemId: { type: "string", description: "Optional; refresh just this one, else all bound." } },
      required: ["projectId"],
    },
  },
  // ---- conversations / revisions ----
  {
    name: "list_conversations",
    description: "List a project's conversations (chats): { chatId, title, turns, active }.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "new_conversation",
    description: "Start a fresh conversation in the project (then use send_message).",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "send_message",
    description:
      "Send a prompt / revision to the project chat and wait for the run + verifier to settle. Optionally target a specific conversation by conversationId.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        prompt: { type: "string" },
        conversationId: { type: "string", description: "Optional chatId from list_conversations; defaults to the active one." },
      },
      required: ["projectId", "prompt"],
    },
  },
  // ---- files ----
  {
    name: "search_files",
    description: "Grep the project's files for a pattern. Returns { path, line, context } matches.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, pattern: { type: "string" } },
      required: ["projectId", "pattern"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the project with the given UTF-8 content.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, path: { type: "string" }, content: { type: "string" } },
      required: ["projectId", "path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string in a project file (single occurrence edit).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        path: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
      },
      required: ["projectId", "path", "oldString", "newString"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, path: { type: "string" } },
      required: ["projectId", "path"],
    },
  },
  // ---- management / handoff ----
  {
    name: "rename_project",
    description: "Rename a project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, name: { type: "string" } },
      required: ["projectId", "name"],
    },
  },
  {
    name: "delete_project",
    description: "Delete a project permanently.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "duplicate_project",
    description: "Duplicate a project. Returns the new { projectId, url }.",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "remix_project",
    description: "Remix a project into a new one (optionally including chats).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, includeChats: { type: "boolean" } },
      required: ["projectId"],
    },
  },
  {
    name: "set_favorite",
    description: "Mark/unmark a project as favorite.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, favorite: { type: "boolean" } },
      required: ["projectId", "favorite"],
    },
  },
  {
    name: "get_usage",
    description: "Get account usage/quota status (5-hour and 7-day windows).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_claude_code_session",
    description: "Open the project as a Claude Code session. Returns { sessionUrl }. May be gated per account.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, instructions: { type: "string" } },
      required: ["projectId"],
    },
  },
];

const server = new Server(
  { name: "claude-design-mcp", version: "0.1.0" },
  { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs = {} } = req.params;
  try {
    await ensureBackend();
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
          const { data } = await backend.readFileRaw(a.projectId, f.path);
          const out = path.join(a.destDir, f.path);
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, data);
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
      case "list_projects": {
        const list = await backend.listProjects();
        return text(JSON.stringify(list, null, 2));
      }
      case "create_design_project": {
        const a = CreateProjectSchema.parse(rawArgs);
        const ref = await backend.createDesignProject(a);
        return text(JSON.stringify(ref, null, 2));
      }
      case "attach_design_system": {
        const a = AttachSchema.parse(rawArgs);
        const bindings = await backend.attachDesignSystem(a.projectId, a.designSystemId);
        return text(JSON.stringify(bindings, null, 2));
      }
      case "detach_design_system": {
        const a = AttachSchema.parse(rawArgs);
        const bindings = await backend.detachDesignSystem(a.projectId, a.designSystemId);
        return text(JSON.stringify(bindings, null, 2));
      }
      case "list_attached_design_systems": {
        const a = ProjectIdSchema.parse(rawArgs);
        const bindings = await backend.listAttachedDesignSystems(a.projectId);
        return text(JSON.stringify(bindings, null, 2));
      }
      case "refresh_design_system": {
        const a = RefreshSchema.parse(rawArgs);
        await backend.refreshDesignSystem(a.projectId, a.designSystemId);
        return text("refreshed");
      }
      case "list_conversations": {
        const a = ProjectIdSchema.parse(rawArgs);
        const convos = await backend.listConversations(a.projectId);
        return text(JSON.stringify(convos, null, 2));
      }
      case "new_conversation": {
        const a = ProjectIdSchema.parse(rawArgs);
        await backend.newConversation(a.projectId);
        return text("new_conversation_started");
      }
      case "send_message": {
        const a = SendMessageSchema.parse(rawArgs);
        await backend.sendMessageTool(a.projectId, a.prompt, a.conversationId);
        return text("message_complete");
      }
      case "search_files": {
        const a = SearchSchema.parse(rawArgs);
        const matches = await backend.searchFiles(a.projectId, a.pattern);
        return text(JSON.stringify(matches, null, 2));
      }
      case "write_file": {
        const a = WriteFileSchema.parse(rawArgs);
        await backend.writeFile(a.projectId, a.path, a.content);
        return text(`wrote ${a.path}`);
      }
      case "edit_file": {
        const a = EditFileSchema.parse(rawArgs);
        const n = await backend.editFile(a.projectId, a.path, a.oldString, a.newString);
        return text(`edits_applied: ${n}`);
      }
      case "delete_file": {
        const a = ReadFileSchema.parse(rawArgs);
        await backend.deleteFile(a.projectId, a.path);
        return text(`deleted ${a.path}`);
      }
      case "rename_project": {
        const a = RenameSchema.parse(rawArgs);
        await backend.renameProject(a.projectId, a.name);
        return text("renamed");
      }
      case "delete_project": {
        const a = ProjectIdSchema.parse(rawArgs);
        await backend.deleteProject(a.projectId);
        return text("deleted");
      }
      case "duplicate_project": {
        const a = ProjectIdSchema.parse(rawArgs);
        const ref = await backend.duplicateProject(a.projectId);
        return text(JSON.stringify(ref, null, 2));
      }
      case "remix_project": {
        const a = RemixSchema.parse(rawArgs);
        const ref = await backend.remixProject(a.projectId, a.includeChats);
        return text(JSON.stringify(ref, null, 2));
      }
      case "set_favorite": {
        const a = FavoriteSchema.parse(rawArgs);
        await backend.setFavorite(a.projectId, a.favorite);
        return text("ok");
      }
      case "get_usage": {
        const u = await backend.getUsage();
        return text(JSON.stringify(u, null, 2));
      }
      case "create_claude_code_session": {
        const a = ClaudeCodeSchema.parse(rawArgs);
        const s = await backend.createClaudeCodeSession(a.projectId, a.instructions);
        return text(JSON.stringify(s, null, 2));
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const cleanup = async () => {
    if (backendStarted) {
      try { await backend.shutdown(); } catch { /* ignore */ }
    }
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
