# claude-design-mcp

An MCP server that drives [Claude Design](https://claude.ai/design) — Anthropic's design-system generator — from agentic coding CLIs (Claude Code, Cursor, etc.). It exposes semantic tools so you can `create_design_system`, `generate`, `iterate`, `list_files`, `read_file`, and `export` without touching a browser.

> [!WARNING]
> **Unofficial — not affiliated with or endorsed by Anthropic.** Claude Design has no
> public API, so this drives a real Chrome and calls claude.ai's internal endpoints.
> Expect it to break when the site changes. Point it only at your own account, stay
> within [Anthropic's terms](https://www.anthropic.com/legal/consumer-terms), and use
> it at your own risk. Your logged-in session is sensitive — see [SECURITY.md](./SECURITY.md).

> **Status:** working. ~30 tools implemented (see the table below). Most call Claude
> Design's internal `OmeletteService` Connect-RPC API as JSON (via in-page `fetch`);
> `generate`/`iterate`/`get_status` drive the chat UI (the `Chat` RPC payload is
> opaque).

## Tools

**Create & generate**
| Tool | Purpose |
|---|---|
| `create_design_system({ name, brief, sources? })` | Create a design system. Returns `{ projectId, url }`. |
| `create_design_project({ name, brief?, designSystemIds?, designComponents? })` | Create a design PROJECT (screens/app), optionally binding design systems. |
| `generate({ projectId })` | Start generation from the stored brief. Returns once started (~5 min total). |
| `get_status({ projectId })` | Poll: `generating` \| `ready` \| `error` \| `draft`. |
| `iterate({ projectId, prompt })` | Send a chat message. Non-blocking — returns once started; poll `get_status`. |
| `send_message({ projectId, prompt, conversationId? })` | Revise/prompt; optionally target a specific conversation. |

**Design-system bindings**
| Tool | Purpose |
|---|---|
| `attach_design_system({ projectId, designSystemId })` | Bind a (published) design system to a project. |
| `detach_design_system({ projectId, designSystemId })` | Unbind a design system. |
| `list_attached_design_systems({ projectId })` | List bound systems (with names). |
| `refresh_design_system({ projectId, designSystemId? })` | Pull the latest version of bound system(s). |

**Conversations**
| Tool | Purpose |
|---|---|
| `list_conversations({ projectId })` | List chats: `{ chatId, title, turns, active }`. |
| `new_conversation({ projectId })` | Start a fresh conversation. |

**Files**
| Tool | Purpose |
|---|---|
| `list_files({ projectId })` | List files (`tokens/*.css`, `components/*`, `SKILL.md`, …). |
| `read_file({ projectId, path })` | Read a single file (utf8). |
| `export({ projectId, destDir })` | Dump all files to `destDir`, byte-faithful. |
| `mint_handoff({ projectId, includeChats?, instructions?, destDir? })` | **Primary handoff.** Official capability URL + ready Claude Code command; with `destDir`, downloads + extracts the bundle and returns `projectDir` (feed to `scaffold:ui`). |
| `export_handoff({ projectId, destDir })` | _Deprecated_ — local bundle (`project/` + `chats/` + README). Prefer `mint_handoff`. |
| `search_files({ projectId, pattern })` | Grep files → `{ path, line, context }`. |
| `write_file` / `edit_file` / `delete_file` | Direct file edits without chat. |

**Publish, listing & management**
| Tool | Purpose |
|---|---|
| `publish({ projectId })` / `set_default({ projectId })` | Publish / set default design system. |
| `list_design_systems()` / `list_projects()` | List design systems / all projects. |
| `rename_project` / `delete_project` / `duplicate_project` / `remix_project` / `set_favorite` | Project housekeeping. |
| `get_usage()` | Account usage/quota (5-hour & 7-day). |
| `create_claude_code_session({ projectId, instructions? })` | Open the project as a Claude Code session → `{ sessionUrl }`. |

## Setup

**Prerequisites:** Node ≥ 20, [pnpm](https://pnpm.io), and a desktop
**Google Chrome** installed. A claude.ai account with Claude Design access.

claude.ai is behind Cloudflare, which blocks Playwright's bundled Chromium
(automation fingerprint) with an endless "Just a moment…" loop. The server
sidesteps this by attaching to a **real Chrome** over the Chrome DevTools
Protocol (CDP) — a normally-launched Chrome passes Cloudflare cleanly.

```bash
git clone https://github.com/e-brokenc0de/claude-design-mcp.git
cd claude-design-mcp

pnpm install
pnpm exec playwright install chromium   # only the Node bindings are needed

# Start the real Chrome (dedicated debug profile in .auth/cdp-chrome) and log
# into claude.ai once. The window stays open; the session persists.
pnpm run chrome:cdp

pnpm run build
```

> Dev-only: `pnpm run recon:capture` tees Claude Design's network/RPC traffic into
> `./recon/` so you can re-map the internal API in `src/selectors.ts` if the site
> changes. Not needed for normal use. Captures can contain cookies — they're
> gitignored; never commit them.

The MCP server attaches to the same Chrome (port 9222 by default). If Chrome
isn't running, the server auto-launches it; if it's not logged in, tools return
`NOT_AUTHED` — run `pnpm run chrome:cdp` and log in.

## CLI

Every tool is also a terminal command via `claude-design`. The CLI is a thin **MCP
client** — it spawns the same server and forwards your arguments, so the commands,
schemas, and output are exactly the server's (add a tool to the server and it shows up
here automatically). Good for automation/CI, quick debugging, and one-off ops without
an agent in the loop.

```bash
claude-design --help                  # list every command (discovered from the server)
claude-design <command> --help        # flags for one command
claude-design list-projects --json    # data tools print JSON → pipe to jq
claude-design create-design-system --name "Acme" --brief "Calm, editorial, dark-first"
claude-design get-status --project-id <id>
```

- Command names accept kebab- or snake_case (`create-design-system` == `create_design_system`).
- Flags mirror each tool's arguments in kebab-case (`projectId` → `--project-id`); array
  args repeat (`--design-system-ids a --design-system-ids b`); booleans are presence flags.
- `--json` guarantees machine-readable stdout. Exit codes: `0` ok, `1` error, `2` `NOT_AUTHED`.
- Same prerequisites as the server: a logged-in Chrome (`claude-design chrome`), and
  generation is async — kick off `generate`/`iterate`, then `claude-design watch --project <id>`.

The dev scripts are folded in as subcommands too: `claude-design chrome` (auth),
`claude-design scaffold` (export → `packages/ui`), `claude-design watch` (block until a
generation settles). They're equivalent to the matching `pnpm run` scripts.

Run it without installing globally via `npx claude-design …`, or `node dist/cli.js …`
from a clone.

## Scaffold a `packages/ui` from an export

Turn a Claude Design export (the `project/` folder of a handoff bundle, or a plain
`export` dir) into a maintainable token + UI package: DTCG tokens → Style Dictionary →
Tailwind v4 `@theme`, plus a component skeleton. Components are scaffolded (not
auto-converted) with the raw export kept under `_design-source/` for Claude Code to port.

```bash
pnpm run scaffold:ui -- --src <exportDir> --out <repo>/packages --name ui --ds-name "My DS"
```

Produces `packages/tokens` (DTCG JSON source of truth + `build/theme.css` + `tokens.ts`,
rebuildable with `style-dictionary build`) and `packages/ui` (`styles/`, `primitives/`,
`components/`, `index.ts`, `CLAUDE.md`), plus a root `PROMPT.md` with porting steps.
Primitives land in `:root`; semantic tokens become Tailwind utilities via `@theme inline`,
with `var()` references preserved so a one-token re-theme still cascades.

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
- **`src/browser.ts`** — CDP acquisition: spawn/reuse real Chrome with a debug port, attach over CDP, find the design tab.
- **`src/backends/cdp.ts`** — CDP-attached backend; reattaches per call so generations survive across tool calls.
- **`src/selectors.ts`** — ⚠️ THE ONLY PLACE selectors and endpoint patterns live. UI shifts? Edit this one file.
- **`src/registry.ts`** — Persists `projectId → { url, name }` across stdio invocations.
- **`src/config.ts`** / **`src/errors.ts`** — env-driven config + structured loud errors.

Once recon captures Claude Design's internal API, tool bodies wire to in-page
`fetch` (preferred) or DOM interaction, both centralized via `src/selectors.ts`.

## Secrets

`./.auth/` (the Chrome debug profile, holding your logged-in session) and any
captures in `./recon/` are gitignored. Never commit them. See
[SECURITY.md](./SECURITY.md) for the full list and reporting policy.

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup and
the one rule that matters: when claude.ai changes, fix `src/selectors.ts` first.

## License

[MIT](./LICENSE) © Brokenc0de. Unofficial; not affiliated with Anthropic.
