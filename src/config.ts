import { configuredProfileDir, envFlag, expandPath } from "./chrome-profile.js";

export const config = {
  baseUrl: process.env.CLAUDE_DESIGN_BASE_URL ?? "https://claude.ai/design",
  profileDir: configuredProfileDir(),
  stateDir: expandPath(process.env.CLAUDE_DESIGN_STATE_DIR ?? "./.claude-design-mcp"),
  headed: envFlag("CLAUDE_DESIGN_HEADED"),
};

export type Config = typeof config;
