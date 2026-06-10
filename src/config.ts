import path from "node:path";
import os from "node:os";

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v?.toLowerCase() === "true";
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export const config = {
  baseUrl: process.env.CLAUDE_DESIGN_BASE_URL ?? "https://claude.ai/design",
  profileDir: expandPath(process.env.CLAUDE_DESIGN_PROFILE_DIR ?? "./.auth/profile"),
  stateDir: expandPath(process.env.CLAUDE_DESIGN_STATE_DIR ?? "./.claude-design-mcp"),
  headed: envFlag("CLAUDE_DESIGN_HEADED"),
};

export type Config = typeof config;
