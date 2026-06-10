# claude-design MCP — full tool reference

All tools are exposed as `mcp__claude-design__<name>`. Arguments are JSON. Project ids
are UUIDs returned by create/list tools.

## Create & generate

| Tool | Args | Returns / notes |
|---|---|---|
| `create_design_system` | `{ name, brief, sources? }` | `{ projectId, url }`. Brief stored, sent by `generate`. |
| `create_design_project` | `{ name, brief?, designSystemIds?, designComponents? }` | `{ projectId, url }`. Binds design systems if given (`designComponents` defaults true when bound). |
| `generate` | `{ projectId }` | Returns once generation has STARTED (~5 min total for systems). Poll `get_status`. |
| `get_status` | `{ projectId }` | `{ status: "generating"|"ready"|"error"|"draft", detail? }`. |
| `iterate` | `{ projectId, prompt }` | Sends to active chat. Non-blocking: returns once STARTED; poll `get_status` / `watch:status`. |
| `send_message` | `{ projectId, prompt, conversationId? }` | Like iterate (non-blocking); targets a specific conversation when `conversationId` given. |

## Conversations

| Tool | Args | Returns |
|---|---|---|
| `list_conversations` | `{ projectId }` | `[{ chatId, title, turns, active }]` (most-recent first). |
| `new_conversation` | `{ projectId }` | `{ chatId }` — a fresh thread, then `send_message` to it. |

## Design-system bindings

| Tool | Args | Returns / notes |
|---|---|---|
| `list_attached_design_systems` | `{ projectId }` | `[{ dsProjectId, name, hasV2Layout }]`. |
| `attach_design_system` | `{ projectId, designSystemId }` | Bind a **published** design system. Returns updated bindings. |
| `detach_design_system` | `{ projectId, designSystemId }` | Unbind. Returns updated bindings. |
| `refresh_design_system` | `{ projectId, designSystemId? }` | Pull latest version of one / all bound systems. |

## Files

| Tool | Args | Returns / notes |
|---|---|---|
| `list_files` | `{ projectId }` | `[{ path, size, kind }]` (files only, recursive). |
| `read_file` | `{ projectId, path }` | UTF-8 contents. |
| `export` | `{ projectId, destDir }` | Writes all files (binary-safe) to `destDir`. Returns a summary. |
| `mint_handoff` | `{ projectId, includeChats?, instructions?, destDir? }` | **Primary handoff.** Mints the official capability URL + ready command (`Fetch … <url>` / `Implement: …`); URL is auth-free & short-lived. With `destDir`, also downloads + extracts the bundle and returns `projectDir` (feed it to `scaffold:ui`). |
| `export_handoff` | `{ projectId, destDir }` | DEPRECATED — prefer `mint_handoff`. Local bundle (`project/` + `chats/` + README) read over CDP; for offline use / committing transcripts. |
| `search_files` | `{ projectId, pattern }` | `[{ path, line, context }]` (grep). |
| `write_file` | `{ projectId, path, content }` | Create/overwrite a UTF-8 file. |
| `edit_file` | `{ projectId, path, oldString, newString }` | Single exact-string replace. Returns edits applied. |
| `delete_file` | `{ projectId, path }` | Delete a file. |

## Publish, listing & management

| Tool | Args | Returns / notes |
|---|---|---|
| `publish` | `{ projectId }` | Publish a design system (required before others can attach it). |
| `set_default` | `{ projectId }` | Set the org's default design system. |
| `list_design_systems` | `{}` | `[{ projectId, url, name }]`. |
| `list_projects` | `{}` | `[{ projectId, url, name, kind }]` — both kinds. |
| `rename_project` | `{ projectId, name }` | Rename. |
| `delete_project` | `{ projectId }` | Delete permanently. |
| `duplicate_project` | `{ projectId }` | `{ projectId, url }` of the copy. |
| `remix_project` | `{ projectId, includeChats? }` | `{ projectId, url }` of the remix. |
| `set_favorite` | `{ projectId, favorite }` | Star / unstar. |
| `get_usage` | `{}` | `{ fiveHour, sevenDay, extraUsage }` quota windows. |
| `create_claude_code_session` | `{ projectId, instructions? }` | `{ sessionId, sessionUrl }` — continue the project in Claude Code. |

## `claude-design` CLI (alternative to MCP)

Every tool is also a terminal command via `claude-design <command> [flags]` — a thin MCP
client over the same server (so it stays in sync automatically). Useful for scripting/CI
or quick checks outside an agent: `claude-design list-projects --json`,
`claude-design get-status --project-id <id>`, `claude-design --help`. Flags mirror tool
args in kebab-case (`projectId` → `--project-id`); `--json` for machine output; exit `2`
on `NOT_AUTHED`. The scripts below are also CLI subcommands (`claude-design chrome|scaffold|watch`).

## Companion CLI scripts (run from the server repo)

Not MCP tools — run with `pnpm run …` in the `claude-design-mcp` server repo.

| Script | Purpose |
|---|---|
| `chrome:cdp` | Launch/attach the real Chrome on the debug port and log into claude.ai (one-time). |
| `watch:status -- --project <id>` | Block until a generation/iteration settles, then exit. Run with background execution to get auto-woken on completion. Flags: `--timeout`, `--quiet`, `--interval` (ms). |
| `scaffold:ui -- --src <exportDir> --out <packagesDir> [--name ui] [--ds-name "…"]` | Turn an export into `packages/tokens` (DTCG → Style Dictionary → Tailwind v4 `@theme`) + a `packages/ui` skeleton. Components are scaffolded, not auto-converted. |
| `recon:capture` | Dev-only: tee Claude Design's network/RPC traffic for re-mapping the API if it changes. |

## Error codes

- `NOT_AUTHED` — CDP Chrome isn't logged in. Run `pnpm run chrome:cdp` in the server repo and sign in.
- `RPC_ERROR [400] … not published` — tried to attach an unpublished design system; `publish` it first.
- `UNKNOWN_CONVERSATION` — bad `conversationId`; call `list_conversations`.

## Handoff chain (recommended)

```
mint_handoff({ projectId, instructions })            → official URL + command for Claude Code
mint_handoff({ projectId, destDir })                 → also downloads + extracts → projectDir
pnpm run scaffold:ui -- --src <projectDir> --out <repo>/packages   → packages/tokens + packages/ui
```

The bundle (tar.gz) extracts to `<slug>/project/` (+ `<slug>/chats/`, `<slug>/README.md`).
`scaffold:ui` reads tokens from `system/tokens.css`, a project's `_ds/<ds>/tokens/*.css`,
or root token CSS — so point `--src` at the extracted `project/` dir.

## Not available (gated on some accounts)

- The design-sync CLI code (`MintDesignSyncCode`) returns `501` on some accounts.
  Use `mint_handoff` (official bundle URL) or `export` for a local copy.
