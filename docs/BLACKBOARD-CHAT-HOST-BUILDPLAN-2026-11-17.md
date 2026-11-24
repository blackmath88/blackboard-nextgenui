# Blackboard — Chat UI host + dynamic workbench pilot

Date: 2026-11-17. **Plan, not completed work.** Companion: [host/fork research](./BLACKBOARD-CHAT-UI-FORK-RESEARCH-2026-11-17.md). Maintained as a docs-only Blackboard PR to preserve the existing draft implementation stack.

## Goal: usable quickly, without another chat app

**Within one reviewable vertical slice:** Open a project in LibreChat → conduct a normal API-backed model conversation → show a source-grounded Blackboard interactive Thinking/Review component within that chat → propose and accept one artifact → reopen and see the accepted state → navigate to a linked Happier coding session if needed. A project can have 0–many repositories; an approved portable global method can accompany project context. Never confuse a model proposal with user acceptance.

The first customer is a single user with several machines; **local/private access first**. No production release, no subscription proxy, no general chatbot rebuild, no all-project migration, no paid service commitment beyond explicitly configured test API usage.

## Ownership and repo placement

- **LibreChat upstream**: unmodified pinned deploy for pilot; internal chat/project/session state stays there. Do not import all ChatGPT/Claude account exports into it.
- **blackboard-nextgenui**: own the **MCP Apps adapter, stateful dynamic UI, FrameIntent schema, proposal review**, and tests. Reference PR #10's accepted-state behavior without rewriting its still-open branch. New code on an isolated branch after phase 0.
- **baselhack26-knowledge-lab**: current project identity and source-backed history. Existing #18 → #19 → #29 stacked pre-merge pilot must be reconciled before writing any shared production records. Use read-only service/proxy and synthetic fixtures first.
- **happier**: execution/approval UI, not the chat history or knowledge owner for Blackboard; start with authoritative links and read-only status.
- **GitHub**: authoritative code, issues, PRs.
- **br-ai-nstorm**: optional, linked problem-space view; do not copy its event log or require it in MVP.

## Phase 0 — pin and run LibreChat, measure the baseline

**No code fork yet.** Inspection is read-only; installation only in a new disposable local workspace after reviewing current Docker service/port usage.

1. Pin `LibreChat-AI/LibreChat` to reviewed tag/commit (research observed `d4e85d2205c7`, v0.8.9, but verify an official release/image digest). Verify MIT license and the exact current MCP Apps feature/config gates.
2. Test a **private, single-user Docker Compose deployment** on blackbird (Docker already used for separate experiments), with isolated data volumes and no public ingress. List conflicting ports/containers and available RAM/disk first; preserve existing state. Don't use unpinned `latest` images for a stable pilot.
3. Use a bounded API-key provider already legitimately available to the owner. Keep secret server-side, cap model/test spend, block cross-origin and unauthenticated access. One project, two chats, refresh/restart, model switching, mobile-width smoke.
4. Check whether the Compose RAG API/pgvector/Meilisearch are actually needed for the first test; prefer **supported** optional-service configuration rather than hand-removing dependencies. Record CPU, memory and disk footprint because the default stack includes MongoDB, Meilisearch, RAG API and Postgres.
5. Record the product baseline: Projects UI, chat persistence, project instructions, mobile/resume, Artifacts vs MCP Apps behavior and context/memory settings.

**Evidence:** exact SHA/image digest, Compose config diff with no secrets, container/service list, successful fresh-chat + resume screenshot, a short run log and rollback command. **Gate:** LibreChat chat + projects is reliably useful before any Blackboard integration. If too heavy or the repo features don't work as documented, stop and compare the lightweight backup NextChat/assistant-ui path.

## Phase 1 — Blackboard as an isolated MCP App, fixture only

Implement a small MCP server inside Blackboard (own package/dir, separate from `pilot/app`; avoid a wholesale merge of the PR #10 stack).

- One command to run a fixture-backed **Blackboard Thinking** server locally; expose Streamable HTTP to the private LibreChat container through a controlled, authenticated channel. The existing Knowledge Lab `project-knowledge` MCP is **stdio** and tunneled over SSH; **do not publicly expose it** or pretend LibreChat's HTTP MCP can call it directly.
- Register the official MCP Apps UI resource `ui://blackboard/project-thinking` with `text/html;profile=mcp-app`; keep payload small and CSP restrictive.
- Tools:
  - `blackboard_project_overview(projectId)` — model-readable concise synthetic summary and source refs; declares UI resource.
  - `blackboard_get_workbench(projectId)` — read-only canonical state with revision, provenance, allowed component specs.
  - `blackboard_propose_change(projectId, type, payload, expectedRevision)` — stores proposal only.
  - `blackboard_review_change(projectId, proposalId, expectedRevision, operationId, decision)` — user-initiated, version-checked accept/reject with idempotent outcome.
  - Optional `blackboard_set_view(projectId, frameIntent, expectedRevision)` — user choice to apply/reset view; presentation never rewrites accepted item content.
- **Design:** model can select from a closed versioned list `summary | index | kanban | questions | evidence` with strict input schemas. No arbitrary model-authored JS or fetching private browser secrets. Only the user can approve accepting decisions.
- Retain Blackboard #10 invariants: source IDs/quotes, proposed vs accepted, stale-write refusal, deduplication, restart/recovery, actual provider disclosure and reversible presentation.
- Run a two-project synthetic separation test and an unrelated restricted canary. Capture what happens if an MCP App is closed, the message is reopened or a tool call fails/host disconnects.

**Gate:** real LibreChat chat tool call opens interactive Blackboard view, user accepts one synthetic proposal, refresh/reopen displays it, model cannot directly mark it accepted, and project B cannot see project A's restricted fixture. If this needs core UI changes, write the smallest missing capability, do not immediately fork.

## Phase 2 — project context: real source reads without a second memory system

- Create an explicit mapping between one *approved* LibreChat project and one Knowledge Lab project ID; include source permission scope and map version. Do not auto-map all ~36 ChatGPT projects by title.
- Define a small **context envelope**: approved universal working-method packet, project brief, timestamp/freshness, optional source links and retrieval instructions. Initially configure as project instructions and/or explicit first MCP read, depending on which yields reproducible results. Test actual new-session model request body (with no secrets).
- A restricted **read-only** Knowledge Lab adapter exposes `project_brief`, `search_project`, `inspect_source` with only that project's explicit grant. Use the existing locally mediated SSH/stdio setup behind a host-controlled adapter; avoid direct browser-to-SSH or raw ledger reads.
- Preserve Knowledge Lab citations and evidence status. Agent summaries and native LibreChat memory are **not** automatically global/project truth. Turn off or scope native automatic memory writes until an explicit sync/authority rule is decided.
- Side-by-side questions in two fresh conversations: baseline without context vs global+project envelope vs on-demand source retrieval. Verify language, citations, latency, input size and no project leak. If linuc is unreachable, show cache age / degraded state rather than a confident answer.

**Gate:** a new LibreChat chat can answer what the project is and what was accepted, with source IDs, plus an explicitly approved cross-project general working method, without a manual intro. No restricted canary in unrelated project output.

## Phase 3 — connect existing Blackboard accepted-state work

Do not replace #10's tested workflow with a new generic React state library. Review effective diffs across #5, #9, #10, and extract the domain invariants to a testable module. Keep the old local demo runnable.

- One project, one user, one canonical state. **Pilot:** a new isolated file-backed workbench can be acceptable for synthetic testing, but production must have an explicit migration/ownership agreement with Knowledge Lab for reviewed project knowledge. No dual-writes into LibreChat projects, br-ai-nstorm, and Blackboard for the same accepted fact.
- The dynamic UI retains the provenance/source inspector and visible proposal queue; it may offer new layouts, but only from a bounded FrameIntent registry. Rejected/withdrawn proposals remain review history, not facts.
- Persist UI state independently of iframe lifecycle; render from source truth after reopen. Include schema version, project ID, entity ID and expected revision in all write calls.
- Add tests that prove editing an accepted record changes the next model context after consent, a stale browser tab gets conflict resolution, and a lost response/retry doesn't duplicate review.
- Never interpret a model reply as a direct agent instruction with execution authority.

**Gate:** actual chat → proposal → review/edit → multiple views → next model response correctly references *accepted* latest state → restart → same outcome, with traceable source and no lost or doubled decision.

## Phase 4 — Happier as executor, not the chat store

- Start with **Link to existing Happier session**, machine and project/repo deep-link if verified; read-only session observations via supported interfaces only. If no stable deep-link or read API, present explicit manual-open link and no invented statuses.
- A future reviewed `launch_work` action may collect project, repo, host, agent and finish condition. Approval must be explicit; agent sessions and permission prompts remain owned by Happier. Don't start by recreating an agent runner.
- Knowledge Lab ingests actual Happier transcripts and GitHub evidence; Blackboard offers source-backed findings for user review. Mark stale evidence and timestamps.

**Gate:** the user can find a session, inspect its progress and return to the originating project without a parallel writable copy of the execution transcript.

## Phase 5 — decide if a LibreChat fork is necessary

Evaluate the **actual UI** on desktop and Android:

| Journey | Standard MCP App test | Trigger for thin fork |
| --- | --- | --- |
| Open project and see current knowledge | Project instructions + open inline Blackboard tool | Repeatedly needs permanent first-class overview before any message |
| Chat with interactive questions, cards, map | Open sandboxed app from result | Persistent multiple panels beside chat indispensable |
| Review proposal and see new model answer | App tool review then chat continuation | Unsupported user-initiated return/callback contract |
| Switch projects, resume conversation | Native projects/sidebar/history | Mapping cannot be made stable through config or an external project index |
| Continue coding session | External Happier linked session | No stable, supported way to present session action |

If the above works satisfactorily: **no fork; keep Blackboard as an MCP App and optional external project landing page.** If the gaps are material: fork LibreChat **at the same pinned reviewed version**, preserve upstream MIT notices and keep local diffs thin and frontend-only:

- project home tab/route under existing `client/src/components/Projects/` + router;
- one secure client connector to Blackboard's *read-only project projection*;
- perhaps a stable split-pane component that holds a sanctioned MCP App;
- no changes to conversation storage, stream transport, project schema, model routing or user auth unless absolutely necessary and reviewed.

Track upstream merges and regression checks. Do not rename/rebrand LibreChat before OSS attribution is verified.

## Phase 6 — model subscriptions and production hardening (deliberately later)

Use API keys for the pilot. Do **not** confuse a ChatGPT paid subscription with a general API key. The official Sign in with ChatGPT OSS flow can grant eligible **local-app** users plan-backed Responses API calls, but remotely hosted/paid apps require the published separate access path. This is **not** a free-form token proxy, nor access to native ChatGPT projects/memory. Qualify eligibility and OAuth credentials in a separate small local test. Claude.ai subscriber tokens are not generic Anthropic API credentials; rely on supported Happier/Claude Code execution for that workflow.

Before any external hosting: choose OSI license for Blackboard (#11), review third-party assets, run secret/history scans, harden login, project source grants, backup/restore, exports/deletion, CSRF/CSP, iframe bridge, rate limits and remote execution permissions. No Docker socket/SSH mounted directly into browser-facing containers.

## Test inventory / evidence definition

- **Unit:** closed FrameIntent parser, source/role/status typing, rejected proposal exclusion, owner-reviewed promotion, revisions/idempotency.
- **Integration:** MCP Apps resource/read + tool-call handshake, auth/grant enforcement, project ID mapping, Knowledge Lab timeout/degraded result, future event replay.
- **Browser (Playwright or existing runner):** two chat projects, two conversations, 375px Android-like viewport and desktop, keyboard/focus, open/close/reopen App, model tool prompt confirmation, multi-tab stale revision.
- **Security:** synthetic "secret" source in project B absent from A; untrusted transcript says "ignore instructions" and remains data; blocked write to wrong project; forged project ID/revision; model-authored `accepted` status rejected; app iframe cannot read provider keys.
- **Provider:** initially fake inference; one *explicitly paid and capped* real API smoke. Record the exact provider/model and cost. Do not claim ChatGPT/Claude subscription support until separate eligibility test.
- **Operational:** one-command start/stop, local backup/recovery, cache freshness, no impact on existing Happier/Knowledge Lab host units, CI local (avoid action spending).

**Stop/rollback:** no merges or service restarts until local pilot gates pass; use disposable bind mounts and project fixtures; revert/remove adapter registration to restore vanilla LibreChat; keep raw source originals on linuc, not in app repo or test volumes.

## First concrete engineering package

Make one small implementation PR, **not a giant integration effort**:

1. Unmodified LibreChat private local deploy at pinned version, one synthetic project, API-backed chat.
2. A standalone Blackboard MCP Apps server exposing `blackboard_project_overview` + `blackboard_propose_change` + `blackboard_review_change` with synthetic state.
3. One authorized interactive view: **Questions → Proposed approach → Accept/Reject → Evidence**.
4. One browser test for persistence, reviewer identity and session reopening; one no-leak canary test.
5. README with screenshots, commands, actual limits and what was deliberately not wired.

After this, decide *from the demo* whether to fork LibreChat for a first-class notebook tab, or to keep the plugin approach.

## Links / decision checklist

- Research: [host & fork assessment](./BLACKBOARD-CHAT-UI-FORK-RESEARCH-2026-11-17.md)
- Current Blackboard prototype: https://github.com/blackmath88/blackboard-nextgenui/pull/10
- Existing Blackboard UI/protocol concept: https://github.com/blackmath88/blackboard-nextgenui/pull/8
- Open-source readiness: https://github.com/blackmath88/blackboard-nextgenui/issues/11
- Knowledge Lab: https://github.com/blackmath88/baselhack26-knowledge-lab/pull/29
- Living Project Notebook: https://github.com/blackmath88/baselhack26-knowledge-lab/pull/30
- LibreChat MIT/source: https://github.com/LibreChat-AI/LibreChat/blob/main/LICENSE
- LibreChat MCP Apps: https://github.com/LibreChat-AI/LibreChat/blob/main/docs/mcp-apps.md
- MCP Apps spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

**Decision requested after first pilot:** Is a conversation-opened, interactive Blackboard panel enough, or do you need the Notebook to be the default first-class project home? Only that decision should force a UI fork.
