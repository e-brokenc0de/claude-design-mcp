# Security

## Reporting something

Don't open a public issue for a security problem. Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability) or reach the maintainer directly. Tell me what you found, how to reproduce it, and what the impact is. I'll get back to you as soon as I can.

## Don't commit your session

This server runs on top of a logged-in Chrome, so that session is effectively your password. These are gitignored and need to stay that way:

- `.auth/` — the Chrome debug profile with your claude.ai login.
- `.env` and `.env.*` (except `.env.example`).
- `recon/*.har`, `recon/*.json`, `recon/*.jsonl` — network captures can hold cookies and bearer tokens. Never share a raw HAR.
- `.claude-design-mcp/` — the local metadata cache.

If you paste logs or captures into an issue or PR, strip cookies, `authorization` headers, and project/org UUIDs first.

## What this is

`claude-design-mcp` is unofficial and not affiliated with Anthropic. It automates claude.ai/design — which has no public API — by driving a browser and calling internal endpoints. So: it can break whenever the site changes, you should only point it at your own account, stay within [Anthropic's terms](https://www.anthropic.com/legal/consumer-terms), and run it at your own risk. The [README](./README.md) says the same up top.
