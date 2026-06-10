# Kickoff prompt — claude-design-mcp

> Paste the block below into a fresh Claude Code session started in this directory
> (`~/repos/mcp-servers/claude-design-mcp`). It is the build brief for the project.

---

Build an MCP server called "claude-design-mcp" that lets an agentic coding CLI (Claude Code, etc.) drive Anthropic's Claude Design (https://claude.ai/design) programmatically. Claude Design has NO public API or CLI, so this server automates the authenticated web app and exposes clean, semantic MCP tools instead of pixel-level browser clicks.

## Goal

Replace manual browser-driving of Claude Design with tools like:

- `create_design_system({ name, brief, sources? })` -> `{ projectId, url }`
- `generate({ projectId })` -> kicks off generation, returns when started
- `get_status({ projectId })` -> `"generating" | "ready" | "error"` (poll-able)
- `iterate({ projectId, prompt })` -> sends a chat message in the project to add/fix components, returns when the run + self-verifier finish
- `list_files({ projectId })` -> the generated files (`tokens/*.css`, `components/*`, `*.prompt.md`, `styles.css`, `SKILL.md`, `ui_kits/*`, `screens/*`)
- `read_file({ projectId, path })` -> file contents
- `export({ projectId, destDir })` -> writes all generated files into a local directory (THE payoff: pull the design system straight into a repo's `packages/ui`)
- `publish({ projectId })` / `set_default({ projectId })`
- `list_design_systems()` -> existing projects

## Approach (decide in this order)

1. **RECON FIRST (most important):** open claude.ai/design in a real browser with DevTools Network open, then do one full manual flow — create design system, Continue to generation, Generate (~5 min), send one chat iteration, view Design Files. Capture the underlying HTTP/WebSocket calls (endpoints, payloads, auth: cookies/CSRF/session token, how generation status is polled or streamed, how file contents are fetched). Write findings to `RECON.md`.
2. If a usable internal API exists, build the MCP on top of it (httpx/fetch + the captured auth) — far more robust than DOM scraping.
3. Otherwise, fall back to Playwright automation against the UI flow documented below, reusing a persisted authenticated session (storageState / a dedicated browser profile) so you never re-login per call.

## Known UI flow (observed — use to bootstrap recon/automation)

- Entry: `https://claude.ai/design#design-systems` → "Create" button → setup screen "Set up your design system": a "Company name and blurb" textarea (this is the brief) + optional sources (GitHub repo link, local folder, `.fig` upload, fonts/assets) → "Continue to generation" → "Generate" (generation takes ~5 min; the tab must stay open).
- Project URL pattern: `https://claude.ai/design/p/<uuid>`.
- Right pane has two tabs: "Design System" (rendered readme + specimen cards) and "Design Files" (the actual code: `tokens/`, `components/`, `ui_kits/`, `screens/`, `styles.css`, `*.prompt.md`, `SKILL.md`).
- Left pane is a chat with input "Describe what you want to create…" and a Send button (Enter submits, Shift+Enter = newline). Iteration prompts go here; a built-in verifier self-QAs after each run ("Checking the design for issues…").
- Top-right "Share" button (may expose export/template). A per-project "Published" checkbox and "Set as default". Design systems list lives at `/design#design-systems`.

## Tech

- Language: TypeScript, Node. Use `@modelcontextprotocol/sdk` (stdio transport). Use Playwright if going the automation route.
- Persist auth so tools work headless across calls. Make generation tools async/poll-friendly (generation is ~5 min) — don't block a single tool call for 5 minutes; prefer a start + `get_status` (poll) split, or long-poll with a generous timeout.
- Be resilient: the UI is a research preview and will change. Centralize all selectors/endpoints in one module. Fail loudly with clear errors.
- Provide a README with setup (how to authenticate the first time) and a `.mcp.json` snippet to register the server in Claude Code.

## Deliverables / milestones

- **M0** `RECON.md` (network + auth findings, API-vs-Playwright decision).
- **M1** Auth/session bootstrap that survives restarts.
- **M2** `create_design_system` + `generate` + `get_status` (poll to ready).
- **M3** `iterate` (send chat prompt, wait for verifier to settle).
- **M4** `list_files` / `read_file` / `export` to a local dir.
- **M5** `publish`/`set_default`/`list_design_systems`; package + README + `.mcp.json`.

## Constraints

- This automates the user's OWN authenticated Claude Design session for personal/dev use. Respect rate limits; don't hammer; keep one in-flight generation at a time per project.
- Treat captured auth tokens/cookies as secrets — never log them, never commit them; load from env or a local untracked file.

Start a fresh git repo for this project. Begin with M0 recon and report the network/auth findings before writing the server, so we choose API vs Playwright on evidence.

---

## Notes (context from the session that produced this brief)

- **Recon (M0) is the lever.** If there's an internal JSON/WS API behind claude.ai/design, the MCP is far more stable than DOM scraping. Start there.
- **Async generation:** never make one tool call wait 5 minutes — split `generate` + `get_status` (poll) to avoid timeouts.
- **Prior art:** the `claude-in-chrome` MCP is low-level/pixel-based; this server is high-level/semantic and Claude-Design-specific (different layer; it can run its own Playwright rather than going through claude-in-chrome).
- **Downstream goal:** the real payoff is `export` landing a design system into a repo's `packages/ui` as Tailwind v4 `@theme` tokens + components — e.g. for the `saru-v2` project this brief came from.
- Expect ongoing maintenance because Claude Design is a research preview; keep selectors/endpoints in one module to make UI changes cheap to absorb.
