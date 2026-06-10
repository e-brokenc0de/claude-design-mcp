# claude-design-mcp

An MCP server that drives [Claude Design](https://claude.ai/design) — Anthropic's design-system generator — from agentic coding CLIs (Claude Code, Cursor, etc.). It exposes semantic tools so you can `create_design_system`, `generate`, `iterate`, `list_files`, `read_file`, and `export` without touching a browser.

> **Status:** scaffolding + Playwright backend skeleton landed. Tool implementations are blocked on M0 reconnaissance — run the recon harness below to capture the network/auth surface, then the tool bodies wire up against `src/selectors.ts`.

## Tools

| Tool | Purpose |
|---|---|
| `create_design_system({ name, brief, sources? })` | Create a new project. Returns `{ projectId, url }`. |
| `generate({ projectId })` | Start generation. Returns immediately; generation takes ~5 min. |
| `get_status({ projectId })` | Poll: `generating` \| `ready` \| `error` \| `draft`. |
| `iterate({ projectId, prompt })` | Send a chat message; waits for the self-verifier to settle. |
| `list_files({ projectId })` | List generated files (`tokens/*.css`, `components/*`, `SKILL.md`, …). |
| `read_file({ projectId, path })` | Read a single generated file. |
| `export({ projectId, destDir })` | Dump all files to `destDir`, preserving structure. |
| `publish({ projectId })` | Publish the design system. |
| `set_default({ projectId })` | Set as the default Claude Design system. |
| `list_design_systems()` | List known projects. |

## Setup

```bash
pnpm install
pnpm exec playwright install chromium

# One-time headed login — opens a Chromium window, you log into claude.ai,
# press ENTER in the terminal to save the auth profile. Reused headless after.
pnpm run auth:bootstrap

# M0 recon: drive the full flow yourself in a headed browser while we tee
# every HTTP + WebSocket call into ./recon/. When done, fill RECON.md.
pnpm run recon:capture

pnpm run build
```

## Registering with Claude Code / Cursor

Copy `.mcp.json` into your project, or add an entry to your existing MCP config:

```json
{
  "mcpServers": {
    "claude-design": {
      "command": "node",
      "args": ["/absolute/path/to/claude-design-mcp/dist/server.js"]
    }
  }
}
```

## Architecture

- **`src/server.ts`** — MCP stdio server; thin tool dispatcher.
- **`src/backend.ts`** — `DesignBackend` interface (the contract every backend implements).
- **`src/backends/playwright.ts`** — Playwright backend; long-lived persistent context so generations survive across tool calls.
- **`src/selectors.ts`** — ⚠️ THE ONLY PLACE selectors and endpoint patterns live. UI shifts? Edit this one file.
- **`src/registry.ts`** — Persists `projectId → { url, name }` across stdio invocations.
- **`src/config.ts`** / **`src/errors.ts`** — env-driven config + structured loud errors.

A future `src/backends/api.ts` will implement the same interface against the captured HTTP/WebSocket API once recon lands.

## Secrets

`./.auth/profile` (persistent Chromium profile) and any HARs in `./recon/` are gitignored. Never commit them.
