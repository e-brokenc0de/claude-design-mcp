---
name: claude-design
description: >-
  Drive Anthropic's Claude Design (claude.ai/design) through the claude-design MCP
  server to create, generate, iterate, inspect, edit, and export design systems and
  design projects. Use this skill whenever the user wants to build or change a design
  system, generate UI screens/components/prototypes, pull design tokens or generated
  files into a repo (e.g. packages/ui), attach a design system to a project, revise a
  generated design with a new prompt, or manage Claude Design projects — even if they
  just say "design system", "Claude Design", "generate the UI kit", "export the
  tokens", or name a project on claude.ai/design without mentioning the tool.
---

# Claude Design (via MCP)

The `claude-design` MCP server automates claude.ai/design — which has no public API —
by attaching to a real Chrome over CDP and calling its internal RPC. It exposes clean
tools (prefix `mcp__claude-design__*`) so you can build and pull design systems straight
into a repo instead of clicking through the web app.

## Before anything: the session must be authenticated

Every tool drives a logged-in Chrome. If a tool returns `NOT_AUTHED` (or anything
mentions login), the CDP Chrome isn't signed into claude.ai. Tell the user to run, once:

```bash
cd ~/repos/mcp-servers/claude-design-mcp && pnpm run chrome:cdp
```

…then log into claude.ai in the window that opens. The session persists, so this is a
one-time step per machine (or after logout). Don't try to work around auth failures —
surface this instruction.

Generation is **asynchronous** (a full design system takes ~5 min; small projects are
faster). Never block waiting — start it, then either poll `get_status`, or watch in the
background and get auto-woken when it finishes (see below).

## Waiting for generation (background + auto-wake)

After `generate`, `iterate`, or `send_message`, don't sit and re-poll every few seconds —
that burns turns. Two options:

- **Quick manual check:** call `get_status({ projectId })` → `generating` | `ready`. Good
  for a one-off "is it done yet?".
- **Background watch with automatic wake-up (preferred for long runs):** run the watcher
  as a background command. The harness sends a completion notification the moment it
  exits, so you're woken exactly when generation settles — no polling in between:

  ```bash
  cd ~/repos/mcp-servers/claude-design-mcp && \
    pnpm run watch:status -- --project <projectId>
  ```

  Run it with the agent's background execution (e.g. Bash `run_in_background: true`).
  It connects over CDP, watches the project's files until a change is seen and then
  nothing changes for ~40s, prints `{"status":"ready", ...}` and exits 0 (exits 2 with
  `{"status":"timeout"}` if it never settles). Kick it off right after the
  generate/send_message call. Flags: `--timeout`, `--quiet`, `--interval` (ms).

Pattern: call `generate` / `iterate` / `send_message` (all return once started) → start
`watch:status` in the background → when its completion notification arrives, call
`list_files` / `read_file` / `export`. None of these tools block until the generation
finishes, so always confirm with `get_status` or the watcher before reading output.

## Core workflows

Pick the workflow that matches the user's intent. Tool names below omit the
`mcp__claude-design__` prefix for readability.

### 1. Create a new design system

```
create_design_system({ name, brief })   → { projectId, url }
generate({ projectId })                  → returns once generation has STARTED
get_status({ projectId })                → poll until { status: "ready" }   (repeat)
list_files({ projectId })                → see what was produced
read_file({ projectId, path })           → inspect a file
export({ projectId, destDir })           → write every file to a local dir
```

The `brief` is the company description / design direction (the same text you'd type in
the "Set up your design system" box). It is stored at create time and sent as the first
message by `generate`.

### 2. Create a design project (screens / app / prototype), optionally on a design system

```
create_design_project({ name, brief?, designSystemIds?, designComponents? })
generate({ projectId })   (if you gave a brief)   — or drive it with send_message
get_status → poll → export / read_file
```

`designSystemIds` binds existing design systems so generation reuses their tokens and
components. A design system must be **published** to be attachable (publish it first
with `publish` if needed). If you bind nothing, Claude Design still applies the org's
default design system automatically.

### 3. Revise / iterate (send a new prompt)

```
iterate({ projectId, prompt })                          — sends to the active chat; returns once STARTED (non-blocking)
send_message({ projectId, prompt, conversationId? })    — same; can target a specific conversation
```

Both are **non-blocking** — they return in seconds once generation starts. Then poll
`get_status` until `ready`, or run `watch:status` in the background (see above) before
reading/exporting.

Conversations are separate chat threads inside one project. To work across threads:

```
list_conversations({ projectId })   → [{ chatId, title, turns, active }]
new_conversation({ projectId })     → { chatId }   (start a fresh thread)
send_message({ projectId, prompt, conversationId: chatId })
```

Use `send_message` with a `conversationId` when the user refers to "that earlier
conversation/thread"; otherwise `iterate` (active thread) is fine.

### 4. Export into a repo (the payoff)

```
list_files({ projectId })
export({ projectId, destDir: "<repo>/packages/ui" })
```

`export` writes all files byte-faithfully (CSS tokens, components, `SKILL.md`,
`styles.css`, images, etc.). Read a couple of files first to confirm structure, then
export to the target the user names.

### 5. Attach / detach a design system to an existing project

```
list_attached_design_systems({ projectId })
attach_design_system({ projectId, designSystemId })     — designSystemId must be a published design system project id
detach_design_system({ projectId, designSystemId })
refresh_design_system({ projectId })                    — pull the latest version of bound system(s)
```

### 6. Direct file edits (no chat round-trip)

For small, surgical changes use the file tools instead of a generation turn — they're
instant and don't consume a chat turn:

```
search_files({ projectId, pattern })             — grep across files
write_file / edit_file / delete_file
```

Prefer `iterate`/`send_message` for design changes you want Claude Design's model to make
(it keeps the system coherent and runs its self-verifier); prefer the file tools for
mechanical fixes you already know exactly how to make.

## Finding projects

`list_design_systems()` lists design systems; `list_projects()` lists everything (each
item has `kind: "design_system" | "project"`). Resolve a name the user mentions to a
`projectId` with these before calling project-scoped tools.

## Gotchas worth remembering

- **Poll, don't block.** After `generate`/`create`, loop `get_status` (a few seconds
  apart) until `ready` before reading or exporting — files appear progressively.
- **Publish before attach.** `attach_design_system` rejects unpublished design systems.
- **Default DS is implicit.** A project with no bound system still uses the org default.
- **One Chrome, shared session.** The server reuses one logged-in Chrome across calls;
  generations keep running between tool calls.
- **`create_claude_code_session({ projectId })`** returns a `sessionUrl`
  (`https://claude.ai/code/cse_…`) to continue a project as a Claude Code session.

## Generating clean, maintainable, handoff-ready output

When the user cares about structure, maintainability, avoiding files piling up, or a clean
handoff to Claude Code, read `references/best-practices.md` and apply it. The essentials:

- **System vs project**: keep tokens in a published *design system* (the durable source of
  truth); *projects* bind to it and never fork tokens. Pull updates with `refresh_design_system`.
- **Prevent pile-up**: one `new_conversation` per screen/feature (not one mega-thread);
  iterate in place — never hand-version (`foo-v2`, "Final", spaces); use `edit_file`/`search_files`
  for mechanical fixes instead of a full generation turn; `export` into a clean dir and let git diff.
- **Put structure in the brief**: it becomes the system's durable rules. Require token layering
  (primitive → semantic → component, semantic-only consumption) and naming/folder rules
  (kebab-case by identity, `tokens/ components/ screens/`, one folder per component). A ready
  fill-in brief (with a worked example) is in `assets/brief-template.md`.
- **Handoff**: prefer `publish` (Skill, reusable) for stable systems; include chat transcripts;
  recreate in the target stack, read HTML/CSS directly, don't screenshot.

## Full tool reference

For the complete list (signatures, return shapes, management tools like
`rename_project` / `duplicate_project` / `remix_project` / `set_favorite` /
`set_default` / `get_usage`), read `references/tools.md`.
