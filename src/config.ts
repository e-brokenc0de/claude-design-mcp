import { expandPath } from "./browser.js";

export const config = {
  baseUrl: process.env.CLAUDE_DESIGN_BASE_URL ?? "https://claude.ai/design",
  stateDir: expandPath(process.env.CLAUDE_DESIGN_STATE_DIR ?? "./.claude-design-mcp"),
};

export type Config = typeof config;
