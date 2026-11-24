# Pilot v0.11+ build plan — agent handoff

Status: proposed, ready for bounded implementation after state/contract checks. Do not merge or deploy automatically.

## Before any work
Read ../cli-pilot-v1/{01-concept,02-architecture,05-decisions}.md, ../app/{REPORT,QUESTIONS}.md and ARCHITECTURE.md. Inspect main, open PRs, Observatory if present and relevant Weavr project/mission/session/need state. Follow blackmath88/weavr/docs/CHATGPT-OPERATING-CONTRACT.md. This document is a plan, not permission to dispatch a mission. Use separate branch and draft PR; do not edit .weavr/inbox without an explicitly approved typed command.

## Work packages (sequential gates, small PRs)
### W0 — Baseline and safety
Inventory actual source tree, tests, configs and existing CLI semantics. Isolate all tests from real .pilot; add fixture temp-dir tests and refusal guard. Confirm npm run verify, note known failures. Produce evidence in pilot/next/evidence/. No behavior change beyond safety.

### W1 — Minimal real CLI
Create a package bin for pilot and commands init, doctor, start, help/version. Prefer Node built-ins and no heavy dependency. init must refuse destructive overwrite; doctor checks configuration, endpoint reachability, fallback policy and gives actionable failures without exposing secrets. Add tests, usage docs and a local install recipe. Gate: run from an unrelated directory against a disposable project.

### W2 — Real-model dogfood
Configure an explicitly selected available model endpoint; validate chat streaming, extraction schema, timeouts, model provenance and fail-closed fallback. No credentials in repository. Fix failures found. Gate: 20-turn real session, restart recovery, stats and reproducible sanitized report. Do not assume Morrow is reachable.

### W3 — Multi-conversation domain
Introduce project/conversation identifiers, listing, create/switch/rename/archive (archive reversible), project-scoped semantic items with origin pointers. Versioned migration for existing .pilot data, dry-run/backup/rollback. Keep existing single-conversation demos working. Gate: two conversations, no message bleed, semantic references survive restarts; stale revisions rejected.

### W4 — Workspace shell
Build explorer (projects/chats/files), central chat canvas and right contextual overview with decisions/tasks/sources. Navigation, search within project, keyboard focus, empty/loading/error states, mobile single-column mode. Initially use current HTML/CSS/JS unless ADR demonstrates need for framework. File explorer is read-only and explicitly scoped to project files; no arbitrary filesystem access. Gate: accessible keyboard and screen-reader walkthrough, reduced-motion, screenshot review.

### W5 — Adaptive views
Port existing index/map/kanban into optional context views; preserve threshold consent, fade/restore, /why and item provenance. No auto rearrangement or removal without recorded approval. Gate: replay deterministic fixture, verify proposal vs confirmation, undo/reset, no unexpected panel appearance.

### W6 — Real usage evaluation
Use one real knowledge-work project for seven days. Measure navigation friction, conversation retrieval, acceptance/rejection of proposals, pane usefulness, model latency, privacy and recovery. Decide via ADR on dockview, framework, SQLite and opt-in frame/settled-input experiments. No feature expansion before findings.

## Agent execution contract
One package per PR. Each PR includes scope, excluded changes, tests, manual verification, risks, rollback and screenshots for UI work. Stop on missing model access, data migration ambiguity, security/privacy regression, failing verification, or unclear Weavr authority. Ask rather than silently broadening scope. No merge, release or dispatch without explicit approval.

## Definition of done
Real CLI launches a safe project; browser supports multiple persistent conversations and project files; model routing is observable; proposal/consent/provenance remain intact; tests protect user data; real-model evidence exists. UI is useful without terminal styling, yet legacy pilot demo remains accessible.
