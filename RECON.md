# Claude Design — RECON

**Status:** capture pending. Run `pnpm run auth:bootstrap` then `pnpm run recon:capture`, drive the full flow, then fill the sections below from `recon/network.jsonl`, `recon/websocket.jsonl`, and `recon/console.log`.

---

## 1. Auth model
- Cookie names / storage location:
- CSRF / anti-replay header:
- Bearer / session token (where carried — header, body, query):
- Organization scoping (org_id / workspace_id in URL or body):

## 2. Endpoints observed
| Action | Method | URL pattern | Notes |
|---|---|---|---|
| Create project |  |  |  |
| Start generation |  |  |  |
| Poll status |  |  | polling? push? |
| Stream events |  |  | SSE? WebSocket? |
| List files |  |  |  |
| Read file |  |  |  |
| Send chat message |  |  |  |
| Publish |  |  |  |
| Set default |  |  |  |
| List projects |  |  |  |

## 3. Generation progress signal
How does the UI know generation finished?
- [ ] Polled REST endpoint
- [ ] WebSocket frame with `status: "ready"`
- [ ] SSE event stream
- [ ] DOM-only (no network signal)

Field name / event type:

## 4. Iteration verifier ("Checking the design for issues…")
Selector / network signal that the verifier started:
Selector / network signal that the verifier settled:

## 5. File access
- Are file contents accessible via an HTTP/JSON endpoint? (yes/no)
- If yes: endpoint pattern + auth needed
- If no: which DOM nodes hold the rendered file contents

## 6. Verdict
- **Recommended backend:** [ ] API   [ ] Playwright   [ ] Hybrid (which tools per backend)
- **Reasoning:**

## 7. Selector mapping (to fill `src/selectors.ts`)
```
newProjectNameInput:
newProjectBriefTextarea:
createProjectButton:
generateButton:
chatInput:
sendButton:
verifierIndicator:
filesTabButton:
fileTreeItem:
fileContentPane:
generatingIndicator:
readyIndicator:
errorIndicator:
```
