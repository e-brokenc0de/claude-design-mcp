# Claude Design — RECON (M0)

**Status:** ✅ Complete. Internal JSON API fully mapped and verified (read + write).

## Verdict

**Backend = Connect-RPC JSON API, called via in-page `fetch` over a CDP-attached
real Chrome.**

- Claude Design is a SPA backed by a **Connect-RPC** service,
  `anthropic.omelette.api.v1alpha.OmeletteService` (internal codename "Omelette").
- The app speaks `application/proto` (binary), but Connect also accepts
  **`application/json`** on the same endpoints and returns JSON — verified for
  read (`ListProjects`, `GetProject`, `ListFiles`, `GetOrgSettings`, `GetMe`) and
  write (`CreateProject`, `DeleteProject`). No protobuf tooling needed at runtime.
- Cloudflare blocks Playwright's bundled Chromium (automation fingerprint) with
  an endless "Just a moment…" challenge. A **real Chrome** launched normally
  (no automation flags, `navigator.webdriver=false`) passes cleanly. We attach to
  it over CDP and issue the RPCs from inside the page (`credentials:"include"`),
  so the real session cookies + Cloudflare clearance apply automatically.

One exception: **`Chat`** (generate/iterate) carries an opaque `messages_request`
(`bytes`) payload, so those two tools drive the chat UI via DOM instead of
reconstructing that payload. Everything else uses the JSON API.

## Auth model

- **Transport:** real Chrome over CDP (`--remote-debugging-port`), dedicated
  user-data-dir `.auth/cdp-chrome`. Log in once; session persists.
- **Per-request:** same-origin `fetch` with `credentials:"include"` (session
  cookie is automatic). Required headers:
  - `content-type: application/json`
  - `connect-protocol-version: 1`
  - `x-organization-uuid: <org uuid>` (org-scoped calls)
- **Org uuid:** obtained at runtime from `GetMe` → `organizationUuid` (works
  without the org header). Cache it.
- No CSRF token, no bearer token in headers — cookie session only.
- Base path: `https://claude.ai/design/anthropic.omelette.api.v1alpha.OmeletteService/<Method>`

## Tool → RPC mapping (verified shapes)

| MCP tool | RPC | Request (camelCase JSON) | Response |
|---|---|---|---|
| `list_design_systems` | `ListProjects` | `{ cursor?, filter?, q? }` | `{ items: ProjectListItem[], cursor }` |
| `create_design_system` | `CreateProject` | `{ name, type:"PROJECT_TYPE_DESIGN_SYSTEM" }` | `{ projectId }` |
| (project info) | `GetProject` | `{ projectId }` | `{ projectId, name, data(b64 JSON), claudeMd, type, sharing, ... }` |
| `list_files` | `ListFiles` | `{ projectId, path?, depth?, offset?, filter? }` | `{ entries: FileEntry[], total, offset, limit, truncated }` |
| `read_file` | `GetFile` | `{ projectId, path, raw?, srcmap? }` | `{ content(bytes/b64), contentType, isBase64, version }` |
| `export` | `ListFiles(depth:large)` + `GetFile` each | — | files written to dir |
| `publish` | `SetProjectPublished` | `{ projectId, published:true }` | `{ publishedAt }` |
| `set_default` | `UpdateOrgSettings` | `{ defaultDesignSystemProjectUuid: projectId }` | `{}` |
| (default check) | `GetOrgSettings` | `{}` | `{ defaultDesignSystemProjectUuid, updatedAt }` |
| `generate` / `iterate` | `Chat` (server-streaming) | `{ projectId, messagesRequest(bytes), chatId, ... }` | stream of `ChatResponse` | → **DOM** |
| `get_status` | `GetChatMessages` | `{ projectId, chatId }` | `{ messages }` (+ DOM verifier signal) |

`FileEntry`: `{ name, path, type:"file"|"directory", size, contentType, updatedAt, version }`.

`ProjectType` enum: `PROJECT_TYPE_PROJECT`, `PROJECT_TYPE_TEMPLATE`, `PROJECT_TYPE_DESIGN_SYSTEM`.

## Generation model

- A design system is created empty (`CreateProject`), then the **brief is sent as
  the first chat message** (`Chat`), which triggers generation (~5 min). So
  `generate` = send the brief; `iterate` = send a follow-up message. Both go
  through `Chat`.
- Completion: the `Chat` stream emits `message_stop` (`stop_reason`); the UI then
  runs a self-verifier ("Checking the design for issues…"). For status across
  separate stdio calls we observe the DOM (verifier indicator) and/or
  `GetChatMessages` last-message completion.
- A turn-lock system exists (`SendMultiplayerMessage` → `acquiredEpoch`,
  `RenewTurn`, `ReleaseTurn`) for multiplayer; the `pagehide` beacon calls
  `ReleaseTurn` with `{ projectId, chatId, epoch }` as JSON.

## Other notable RPCs (88 total)

- `GetMe`, `GetUsageStatus`, `ListExperiences`, `ListOrgProjects`
- Files: `WriteFiles`, `EditFile`, `DeleteFile(s)`, `CopyFile`, `GrepFiles`, `UploadFile`, `CreateFileStream`/`WriteFileStream`
- Project: `UpdateProject`, `DuplicateProject`, `RemixProject`, `UpdateSharing`, `SetProjectFavorite`, `UpdateProjectType`, `UpdateProjectInfo`
- Design systems: `UpdateProjectDesignSystems`, `PatchDesignSystemBinding`, `RefreshBoundDesignSystem`
- Export/handoff: **`BundleProject` → `{ url, sizeBytes }`** (server-built bundle), `MintHandoffToken`, **`MintDesignSyncCode` → `{ code }`** (the design-sync CLI code), `MintPreviewToken`
- Integrations: `CreateClaudeCodeSession` → `{ sessionId, sessionUrl }`, Figma* , Github* , Mcp*
- Comments: `ListComments`, `CreateComment`, etc.

## How recon was captured

1. `pnpm run chrome:cdp` — real Chrome on port 9222, logged into claude.ai.
2. `pnpm run recon:capture` — CDP network tee to `recon/*.jsonl` while loading /design.
3. The full protobuf `FileDescriptor` was extracted from the JS bundle
   (`index-DWa5J5J9.js`) as a base64 string and decoded with `@bufbuild/protobuf`
   → exact method names, message fields, field numbers, streaming kinds.
4. Read + write JSON calls verified live (throwaway project created and deleted).

`recon/*.jsonl` and `recon/*.bin` are gitignored (may contain auth metadata).
