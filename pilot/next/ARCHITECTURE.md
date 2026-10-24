# Pilot: from CLI experiment to knowledge workspace

Status: proposed architecture, not execution authorization. Scope: Pilot only.

## Product thesis
A local-first conversational workbench for non-coding knowledge work. Chat remains the immediate interaction surface; an explorer navigates projects, conversations and files; a contextual overview shows confirmed and proposed decisions, tasks, sources and optional reasoning views. No autonomous actions.

## Current baseline
pilot/app is dependency-free Node + HTML/CSS/JS. .pilot/ stores transcript.jsonl, state.json, modules.json, rules.json, metrics.jsonl. SSE watches files. The controller proposes panes using deterministic thresholds, extractor proposes typed items, /why explains provenance. v0.9 settled input and v0.10 frame proposals are opt-in. REPORT.md (2026-10-17) states all v0.3-v0.10 demos used fake models; no real-model dogfood. Do not claim otherwise without new evidence.

## Architectural boundaries
- CLI is a launcher and headless command surface, NOT a terminal emulator. Browser is the primary UI.
- Core owns project/conversation IDs, persistence, models, proposals, consent, provenance and events; CLI and browser use the same core API.
- Project owns many conversations; conversation owns ordered messages; semantic items belong to a project and reference origin conversation/message. Keep stable IDs and explicit authorship.
- Preserve files-as-blackboard: append-only per-conversation JSONL and project JSON state, atomic writes and revision checks. Migrate existing single .pilot/ data with backup, dry-run and reversible import; never silently overwrite.
- Keep local model credentials server-side, explicit privacy routing and cloud-fallback prohibition unless approved. Never execute shell commands from chat.
- UI: explorer left, chat/canvas center, context overview right. Optional panes are earned and consented to; support keyboard, responsive layout, reduced motion and /why provenance.
- No framework rewrite by default. Evaluate TanStack Start and Dockview/Paneview against current app after real-use gate; choose only with measured need. CLI candidates: Node bin entrypoint with built-in parser initially; compare Commander, citty, Ink only if required. Avoid building a second TUI.
- Weavr is a separate governed semantic control plane. No direct mission dispatch, need waiver, or scope widening; future integration via explicit typed intent and documented command ingress, not implicit actions.

## Initial commands
pilot init [path] (safe non-destructive initialization); pilot doctor (runtime/config/model connectivity and privacy diagnostics); pilot start [path] (localhost server); pilot chat [--project] [--conversation] (headless optional, streaming, no shell); pilot help/version. Each command must have documented exit codes, --help, error paths and tests.

## Non-goals
Remote multi-user collaboration, terminal shell execution, autonomous mission execution, full IDE/code editor, cross-device sync, wholesale frontend rewrite, database migration before measured conflicts.

## Evidence gates
1. Verify existing test safety: old P0-P2 scripts can wipe .pilot; tests must use isolated fixtures and refuse production data.
2. Real model chat and extractor run, logs and privacy routing inspected, no surprise fallback.
3. Existing data survives migration and restart; old demo remains runnable.
4. Two conversations in one project stay distinct while project-level items retain source links.
5. UI can show origin and consent for every derived item and adaptive pane.
6. Run a week-long dogfood before enabling experimental adaptive input/frame defaults.

## Design decisions requiring evidence
Whether filesystem state needs SQLite; whether frontend complexity warrants TanStack Start; whether drag docking beats fixed layout; whether model proposals add value beyond deterministic rules. Record ADRs before reversing previous decisions.
