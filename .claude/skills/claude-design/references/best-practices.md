# Best practices — structured, maintainable, handoff-ready Claude Design output

Goal: make Claude Design generate output that stays navigable, doesn't pile up
duplicate/overlapping files, and hands off cleanly to Claude Code. Grounded in (a)
inspecting real projects via this MCP, (b) Claude Design's own generated conventions,
(c) Anthropic's handoff docs, and (d) industry token/structure consensus.

## The one mental model: system = durable, project = disposable

Claude Design has two project kinds and the distinction is load-bearing:

- **Design system** (`create_design_system`) — the reusable foundation: layered tokens,
  components, UI kit, a generated `SKILL.md` + `_ds_manifest.json`. Create it once,
  **publish** it, **set_default**. This is the single source of truth.
- **Design project** (`create_design_project`) — screens / app / prototype work. It
  **binds** to design systems (`designSystemIds`) and reuses their tokens/components.

**Rule:** tokens live in the *system*; *projects* consume them, never fork them. A
project that re-generates its own `colors_and_type.css` is fine for a throwaway, but the
repo's token source must be the published system (export it once into `packages/ui` /
`packages/tokens`). Use `refresh_design_system` to pull the latest system version into a
project instead of copy-pasting tokens.

This matters because design systems generate *well*: real output uses 3-layer oklch
tokens (`primitive → semantic → tenant` in `system/tokens.css`), semantic-only component
rules, `preview/*.html` spec cards, `ui_kits/<kit>/`, and a `SKILL.md` with "hard rules"
lifted straight from the brief. Projects are where things rot.

## Why projects pile up (the failure mode to design against)

A real design project inspected via this MCP had **239 flat files at the root**:
`APEX Signup.html` **and** `APEX Signup v2.html`; four different `*Shell.html`;
`admin-branding.jsx` **and** `admin-branding-studio.jsx`; spaces in names; no folders.
A clean design system next to it had 64 files in tidy folders.

Cause: **accretion across chat turns.** Each new prompt in one long thread adds new
files (and the model hand-versions with `v2` / "Final" / near-duplicate names) instead of
editing existing ones. Long threads also drift — they reintroduce already-corrected
styles ("context rot").

## How to prevent pile-up

1. **One conversation per screen/feature, not one mega-thread.** Use
   `new_conversation` to start a fresh thread per screen; it keeps context small and
   stops cross-screen drift. (Conversations are separate chats inside a project.)
2. **Iterate in place; never hand-version.** Tell the model to *edit the existing file*,
   not create `*-v2`. Let git carry history — *"the problem with 'final' is it's never
   final."*
3. **Use the file tools for mechanical edits, not regeneration.** `search_files` →
   `edit_file`/`write_file` is instant, surgical, and doesn't spawn duplicates. Reserve
   `iterate`/`send_message` (a generation turn) for design changes you want the model's
   judgment + self-verifier on.
4. **Export into a clean directory.** `export` overwrites a target dir faithfully; export
   into a fresh/cleaned folder so stale files from a previous run don't linger, and let
   git diff show what changed.
5. **Batch related work in one prompt.** Ask for a set of related components/screens
   together so the system context is explained once (cheaper, more consistent) rather
   than dribbling one prompt at a time.

## Writing the brief (the highest-leverage lever)

The `brief` is stored at create time and sent as the first message — it shapes the
"hard rules" the system enforces forever. Put your *full* direction here, structured.

Anthropic's official prompt guidance: state **goal, layout, content, audience**; start
simple then layer; ask for 2–3 variations. Community consensus: be specific (vague
prompts cause revision cycles), reference components by name, batch.

**Brief template:**

```
Build a <design system | product> for <company>: <one-line what it is + audience>.

Design direction:
- Look & feel: <e.g. cinematic dark, one vivid accent, flat depth>
- Type: <display family> + <text family> + <mono>; Icons: <lucide, single weight>
- Color: <accent + how it's themed/overridable>
- Voice/locale: <language, casing, currency formatting>

Token architecture (REQUIRED):
- Three layers — primitive (raw oklch ramps) → semantic aliases
  (--background, --foreground, --card, --primary, --muted, --border, --ring,
   --success/--warning/--destructive) → component tokens.
- Components consume SEMANTIC tokens only. Never raw hex, never a primitive directly.

Structure & naming (REQUIRED):
- One file per component; kebab-case names by identity, never by iteration
  (no foo-v2, no "Final", no spaces).
- Group files: tokens/ , components/ , screens/ , preview/ . No loose files at root.
- When revising, EDIT the existing file in place — do not create a near-duplicate.

Start with: <the smallest first slice — e.g. tokens + 3 core components>.
Then I'll add screens one conversation at a time.
```

The "Token architecture" and "Structure & naming" blocks are what keep output clean —
they become the system's durable rules.

## Project-level instructions (`claude_md`)

A project carries a `claude_md` (the README addressed to coding agents). Treat it as the
persistent contract for *that* project: restate the naming/folder/edit-in-place rules and
which design system it binds to, so every generation turn re-reads them. (Today this MCP
sets it implicitly; if you need to enforce structure mid-project, encode the rules in your
prompts and, for the repo copy, in a root `CLAUDE.md`.)

## Target repo structure (where the export should land)

```
packages/
  tokens/            # source of truth, DTCG JSON ($value/$type, {alias} refs)
    primitive/  semantic/  component/
    build/           # Style Dictionary output: theme.css, tokens.ts
  ui/
    src/
      styles/        theme.css (@theme)  styles.css (@import tailwindcss + theme)
      primitives/    Button/  Input/         # one folder per primitive
      components/    Card/  Dialog/          # composites from primitives
      index.ts       # barrel manifest of the public surface
    CLAUDE.md        # scoped module context for agents
```

- **Tailwind v4**: put primitives + semantic tokens in `@theme` (they become utilities +
  `:root` vars); component vars reference semantics; use `@theme inline` when a theme var
  references another var; add `@source` so a consuming app scans `packages/ui` for classes.
- **Generated vs hand-written**: tokens + `theme.css` are *generated* (never hand-edit);
  components are hand-written but reference only semantic tokens.
- **AI-navigable**: predictable paths, deep modules (small interface, hidden detail), a
  root `CLAUDE.md` plus scoped `packages/ui/CLAUDE.md`, and an `index.ts` manifest. *"The
  architecture is the prompt."*

## Handoff to Claude Code

Three routes (in order of reuse value):

1. **Publish as a Skill** — `publish` the design system; its `SKILL.md` becomes durable
   Claude Code context (tokens + component rules), reusable across sessions. Best when the
   system is stable and many projects depend on it.
2. **Handoff bundle** — Claude Design's "Handoff to Claude Code" packages a `PROMPT.md`/
   `README.md` ("CODING AGENTS: READ THIS FIRST"), the chat transcripts, the machine-
   readable component spec, and the tokens actually used. Best for a one-shot build.
3. **MCP export** — `export({projectId, destDir})` writes every file byte-faithfully into
   the repo; `create_claude_code_session` returns a `claude.ai/code/cse_…` URL to continue
   a project as a Claude Code session.

What Anthropic's bundle README tells the receiving agent (mirror this when you hand off):
**read the chat transcripts first** (intent lives there) → read the primary design file
and follow its imports → **recreate in the target tech stack** (don't copy prototype
structure) → read the HTML/CSS directly, **don't screenshot**.

**Anti-drift:** code is the source of truth; tokens are the only auto-syncable layer
(DTCG JSON → Style Dictionary → `theme.css`); keep design↔code naming hierarchy matched;
re-export tokens on a cadence rather than ad-hoc copy.

## Quick checklist

- [ ] Separate published design system (tokens) from projects (screens).
- [ ] Brief includes explicit token-layering + structure/naming rules.
- [ ] New conversation per screen/feature; edit in place; no `-v2` files.
- [ ] Mechanical fixes via `edit_file`, not regeneration.
- [ ] Export tokens once into `packages/tokens`/`packages/ui`; projects bind + `refresh`.
- [ ] Repo has root + scoped `CLAUDE.md`, `index.ts` manifest, predictable folders.
- [ ] Handoff includes chats/PROMPT; recreate in target stack; don't screenshot.
