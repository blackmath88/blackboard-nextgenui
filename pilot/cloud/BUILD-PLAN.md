# Pilot Cloud — personal hosted workspace build plan

Status: approved direction for bounded implementation, not permission to merge or deploy production resources without confirmation.
Owner: single personal user first. Target: browser URL across Mac/Linux/Windows, no git fetch or terminal for everyday use.

## Current evidence and dependency
- Pilot v0.12 local integration is draft PR #5 (pilot/v012-integration); W0 PR #4 and earlier plan PR #3 are unmerged.
- PR #5 documents functional browser E2E using fake Mistral, not a verified real-provider call.
- Current server.js uses Node fs, fs.watch, JSONL, SSE, local secrets and 127.0.0.1-only request guards. It cannot be deployed unchanged to Workers.
- Inspect live GitHub, Orca and Weavr/Observatory state before implementation. Do not silently merge or overwrite existing work.

## Product goal
One private URL with authenticated access to Pilot, real Claude/Mistral chat, multiple persistent conversations, project overview and explicit model/context sharing. Keep local Pilot functional.

## Architecture
- Cloudflare Worker serves frontend and API; Cloudflare Access protects the entire private application including APIs and SSE/streaming endpoints. Validate identity server-side, not merely in frontend.
- One Durable Object per workspace/project (SQLite-backed) owns conversations, items, consent, revision and ordered writes. Define schema/migrations and export before migration. D1 only if concrete cross-project queries demand it; R2 later for large attachments.
- Provider adapter for Anthropic and Mistral, server-side secrets for this personal instance. Never send provider secrets to browser; no key management endpoint exposed until multi-user secret model is designed.
- Preserve blackboard domain semantics (proposed/confirmed, origin, /why, deterministic growth). Separate domain logic from filesystem and transport with a narrow storage interface; do not port Node fs APIs to Worker.
- Local mode remains available; export/import versioned portable data for transition. No implicit sync or destructive migration.
- Local Nebu/NUC compute is future optional adapter behind authenticated outbound relay; do not expose local model ports to internet.
- Privacy: conversation-only default, project context requires explicit opt-in; every model role audited. Log no prompts, responses, keys or sensitive project content.
- Lightweight OTel-aligned GenAI telemetry: provider/model, request/trace ID, latency, first token, token counts if available, error category, context mode; local diagnostics and configurable retention. No full observability stack initially.

## Build slices and gates
### C0 — Reconnaissance and executable plan
Inspect current branch/PR dependencies, Cloudflare account access, Wrangler config, credentials availability, current domain modules and API routes. Produce a concrete migration/compatibility matrix and ADR for storage boundaries. No production writes.

### C1 — Small hosted vertical slice
Worker + static UI + Cloudflare Access (or equivalent verified server-side authentication), one Durable Object conversation, real provider streaming, safe server-side key. Preview deployment only after user explicitly approves deployment and target account/domain. Gate: authenticated two-device access, unauthorized requests denied, restart persistence.

### C2 — Usable workspace
Multiple conversations, project files metadata/read-only preview where available, decisions/tasks/sources, consent and provenance. Reuse v0.12 UI, adapt data API. Gate: create/switch/reopen chats across devices, no data bleed; responsive screenshot review.

### C3 — Portability and diagnostics
Versioned export/import from local .pilot, dry-run, backup, idempotency and rollback. OTel-aligned metadata-only traces and a simple diagnostic report. Gate: restore test, no secret/content leakage, no lost confirmations.

### C4 — Dogfood
One-week personal trial; fix actual blockers and assess whether hybrid NUC model relay is warranted. No automatic self-modification.

## Engineering delivery
- Claude on NUC coordinates Orca; one builder and independent reviewer for bounded slices. Separate branch/worktree from PR #5; reuse integration code, don't cherry-pick blindly.
- Each slice: tests, exact SHA review, rollback, draft PR, short reproducible launch instructions.
- Never auto-merge, deploy to production, buy resources, configure DNS, create cloud secrets, or dispatch Weavr missions without explicit authorization.
- Stop for Cloudflare credentials, Access policy choice, account/domain and first preview deployment approval.
- Success means user can open one URL, authenticate, chat with Claude or Mistral, switch chats and retain state across devices; local mode still works.

## First task for Orca
Start C0, then build C1 code and local Worker/DO tests in an isolated branch. Stop before remote deployment for approval. Keep scope small and report exact next user action.
