# Contributing

PRs and issues are welcome. This is a small project, so there's not much process — read this once and you're good.

## What you're working on

This server talks to **claude.ai/design**, which has no public API. It works by attaching to a real Chrome over CDP and calling Claude Design's internal RPC. Two things follow from that:

- The internal API can change without warning and break a tool. When that happens, the fix almost always lives in `src/selectors.ts` (more on that below).
- Never commit anything from a logged-in session — cookies, tokens, network captures. See [SECURITY.md](./SECURITY.md).

It's also unofficial and not affiliated with Anthropic, so keep your usage within [their terms](https://www.anthropic.com/legal/consumer-terms).

## Getting set up

You'll need Node 20+, [pnpm](https://pnpm.io), and desktop Google Chrome.

```bash
pnpm install
pnpm exec playwright install chromium   # Node bindings only

# Opens a dedicated debug Chrome. Log into claude.ai once — the session sticks around.
pnpm run chrome:cdp

pnpm run build      # or: pnpm run dev  (tsc --watch)
```

Before you push, make sure it compiles — that's all CI checks:

```bash
pnpm run typecheck   # tsc --noEmit
pnpm run build
```

## How the code is laid out

| Path | What it does |
|---|---|
| `src/server.ts` | The MCP stdio server. Zod schemas + handlers, thin dispatch. |
| `src/backend.ts` | The `DesignBackend` interface every backend implements. |
| `src/backends/cdp.ts` | The CDP backend — where the actual tool logic lives. |
| `src/browser.ts` | Spawns/reuses Chrome, attaches over CDP, finds the design tab. |
| `src/selectors.ts` | Every DOM selector and RPC endpoint pattern. See below. |
| `src/registry.ts` | Caches `projectId → { url, name }` between stdio calls. |
| `src/config.ts`, `src/errors.ts` | Config from env, structured errors. |
| `scripts/` | The CLI helpers (`chrome:cdp`, `recon:capture`, `scaffold:ui`, `watch:status`). |

The one thing to internalize: **selectors and endpoints only live in `src/selectors.ts`.** When the site changes and something breaks, look there first, and keep new selectors there too. Scattering them across the backend is how this kind of project rots.

## When the API changes under you

`pnpm run recon:capture` records Claude Design's traffic while you drive the flow in the debug Chrome, which is how you find what moved and patch `src/selectors.ts`. Captures go to `recon/` and are gitignored — don't commit them.

## Sending a PR

Keep it focused — one thing per PR — and match the style around it. If you change what a tool takes or returns, update `README.md` and `.claude/skills/claude-design/references/tools.md` in the same PR. Since this hits a live, account-gated service, say which tools you actually ran when you describe your changes.

For bugs, open an issue with what you ran, what you expected, and what you got (scrub any tokens or IDs). For anything security-related, don't use a public issue — see [SECURITY.md](./SECURITY.md).
