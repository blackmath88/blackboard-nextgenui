# Blackboard: Chat UI host / fork research

Date: 2026-11-17. Status: **proposal, not a selected migration or a deployed feature**. Research from public documentation, inspected GitHub source and existing Blackboard PRs. No apps installed and no private project data used.

## Decision in one paragraph

**Use LibreChat as the leading off-the-shelf chat/project/session host, but first integrate Blackboard as an independent MCP App rather than fork the host.** LibreChat provides project routes, per-project instructions/files, history, search, model providers, global user memory and a real MCP Apps iframe/bridge. It is actively maintained, React/TypeScript and MIT-licensed. This satisfies the commodity requirements while leaving Blackboard's novel **conversation → proposed knowledge → reviewed acceptance → adaptive, persistent visual workbench** in our own code. **A minimal LibreChat fork is the fallback**, only if the standard MCP App cannot give a sufficiently persistent project home. Continue using Happier for active remote coding agents and Knowledge Lab for evidence.

### What exactly are we choosing?

- **Host UI:** LibreChat project/chat experience (not an authority for cross-provider project knowledge).
- **Blackboard plugin:** an independently versioned, authenticated MCP server + MCP App UI, with safe, typed, versioned actions and source references; its interface is a projection of durable project state, not arbitrary generated HTML interpreted as instructions.
- **Durable memory:** Knowledge Lab's one-writer SQLite/FTS5, project map, provenance, source bytes and review/capture contracts. For pilot, use a scoped read-only facade and synthetic sources; do not turn LibreChat's file RAG or user-memory bank into a second canonical project record.
- **Execution:** Happier, linked from project and only controlled through verified supported actions.
- **Dynamic UI:** Blackboard's existing accepted-state loop and consent-driven FrameIntent, incrementally adapted to MCP Apps; br-ai-nstorm's problem-space model is optional.
- **Model route now:** configured API provider for one disposable test project; no unsupported account-token proxies. Later official Sign in with ChatGPT only under its documented local OSS/eligible client conditions.

## Evidence inspected (17 Nov)

| Candidate | Project/history baseline | Dynamic UI capability | Code & license | Outcome |
| --- | --- | --- | --- | --- |
| **LibreChat** https://github.com/LibreChat-AI/LibreChat | True projects with routes, chats, instructions/reference files; global user memory, multi-model, search, attachments; resumable streams | MCP Apps official SDK-compatible sandboxed views + React/HTML/Mermaid Artifacts; MCP/custom endpoints | **MIT**; React client, TypeScript packages, Express API; commit `d4e85d2205c7` (release v0.8.9) | **Preferred host and fork fallback** |
| **Open WebUI** https://github.com/open-webui/open-webui | Excellent folders/projects, memory, provider support, Open Terminal coding agents | MCP Apps and plugins can display embedded UI | Svelte frontend/Python backend; 0.6.6+ custom branding-restriction license, **not OSI-approved**, confirmed in license page and root LICENSE | Technically strong, **licensing conflicts** with our goal of a freely branded, OSI-licensed Blackboard fork |
| **NextChat** https://github.com/ChatGPTNextWeb/NextChat | Well-known compact chat app/masks; inspect current workflow before assuming full project organization | No verified MCP Apps host; custom work needed | MIT, React/Next.js, lighter; last inspected commit 2026-10-20 | Backup only if we abandon ready-made project/MCP Apps functionality |
| **Chatbot UI** https://github.com/mckaywrigley/chatbot-ui | Chat-first with folders/workspaces and Supabase backend | No verified MCP Apps host in research | Requires its own app/storage/security review | Doesn't save enough work relative to LibreChat |
| **assistant-ui** https://github.com/assistant-ui/assistant-ui | Reusable chat UI primitives, **not** a project/session backend | Excellent composable tool UI, AG-UI/A2A adapters | MIT React library | Good library if we later build a custom frontend; not a fork substitute |
| **Tambo** https://github.com/tambo-ai/tambo | Agent + conversational backend; not our project registry | Stateful, model-selected React components, typed schemas | MIT SDK; self-hostable, **hosted Tambo Cloud shut down Oct 31 2026** | Useful dynamic-component design reference; avoid introducing second agent/runtime now |

Do not assign fake numerical scores to these products; the fork choice is driven by **project support + extensible interactive UI + public/open-source license + minimal integration work**.

## Source-level fit of LibreChat

Inspected on `d4e85d2205c78413ee27d631d7e3b7313556f21d`:

- `client/src/components/Projects/ProjectsView.tsx`: actual ProjectCard view, create/edit/delete, project navigation.
- `client/src/data-provider/Projects/queries.ts` and `packages/api/src/projects/handlers.ts`: real backend project queries and mutation handlers with validation and user/tenant checks.
- `client/src/components/MCPUIResource/MCPAppViews.tsx`, `client/src/hooks/MCP/useMCPAppFrame.ts`: lazily opened, sandboxed interactive app frame, lifecycle and fallback.
- `packages/api/src/mcp/apps.ts`: MCP App tool metadata, capability visibility, authenticated connection context and server-side validation.
- `client/src/components/Artifacts/Artifacts.tsx`: separate artifact panel; do not mistake ephemeral generated React artifacts for a durable reviewed notebook.
- `LICENSE`: MIT. Keep upstream notice if we ever fork.
- https://github.com/LibreChat-AI/LibreChat/blob/main/docs/mcp-apps.md documents the stable 2026-01-26 MCP Apps profile and its **limits**: view requires user open; app UI is message-owned, views do not automatically become permanent project home pages; limits on active views; authenticated bridge, browser gets no MCP server credentials.
- https://www.librechat.ai/docs/features/projects describes project instructions/files and per-chat model selection.
- https://www.librechat.ai/docs/features/mcp documents interactive app confirmation and MCP server permissions.

**Key product caveat:** LibreChat's own project database is authoritative for *which conversations belong to a LibreChat project*; Knowledge Lab's project map remains authoritative for *cross-provider project identity and context*. Use a versioned mapping `librechat_project_id → knowledge_project_id`. Do not automatically create/merge the owner's ~36 ChatGPT projects based on title resemblance.

**Key UX caveat:** A tool-created MCP App is an **in-conversation component**, not a persistent project-home route. That means the first experiment MUST test whether the notebook is one click away and usable after close/reopen and across desktop/mobile, while preserving its accepted state. If not, selectively add a project-home tab in a carefully pinned LibreChat fork. Never rebuild the chat composer/history/session engine.

**Deployment cost caveat:** LibreChat's default Docker Compose starts its API, MongoDB, Meilisearch, RAG API and PostgreSQL/pgvector (plus optional admin panel). We must assess memory/disk/reliability and prune only supported optional services for a private single-user pilot. Do not introduce a second RAG source authority just because it ships in the compose. Ref: https://www.librechat.ai/docs/local/docker .

## MCP Apps vs Artifacts vs agent UI protocols

- **MCP Apps is the first pilot integration path:** an independently hosted tool advertises `_meta.ui.resourceUri` (a `ui://` resource with `text/html;profile=mcp-app`). The host displays a sandboxed iframe; the app can use the official bridge to send messages and request allowed tool operations. It works with more than one compatible client. Spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx .
- **Artifacts** are excellent for generated mockups, but an arbitrary HTML/React artifact is not a trusted canonical project workbench and does not replace a versioned review protocol.
- **AG-UI** is an agent-event protocol, not a project/chat database or UI layout engine. Blackboard #8 proposed it as an optional removable adapter; #10 found that existing HTTP/SSE already suffices for the accepted-state loop. Do not add AG-UI until it eliminates demonstrable code or enables a real consumer.
- **Tambo** proves registered/typed interactive components can create a compelling dynamic UI, but its own agent backend duplicates LibreChat. Borrow the closed component-registry idea rather than adopting a second harness.

## Why preserve Blackboard's core

The actual Blackboard branch [PR #10](https://github.com/blackmath88/blackboard-nextgenui/pull/10), stacked on #9 and #5, already has:
- persistent multi-chat transcripts and read-only files;
- proposed vs accepted tasks/decisions/sources and evidence-linked review;
- Summary/Index/Kanban as views of the same accepted records;
- revisions, idempotent acceptance, recovery and source history;
- the next model context uses current accepted state;
- reversible, consent-driven pane/layout behavior.

Its last reported cross-platform gate passed 19 deterministic test groups, but **not real model quality**; all code remains in draft PRs and uses local single-writer storage. **Do not throw this away or mistake it for production readiness.** Extract its invariant behavior into a thin independently tested dynamic-workbench/MCP Apps module. Treat current `.pilot/state.json` as a prototype ledger; decide a single canonical project record and migration before exposing multi-user writes.

## Proposed boundaries

| Layer | Authority | Read/write operations |
| --- | --- | --- |
| LibreChat | Native chats, message streaming, project chat membership, auth | Normal built-in UI/API; no code fork for initial spike |
| Knowledge Lab | Project identity across sources, citations, reviewed source history, global/project context | Project-scoped read-only proxy initially; later reviewed capture/update commands |
| Blackboard | Review of proposed structured workbench state, accepted view layout, consent preferences | Version-bound propose/accept/decline; own storage only for isolated pilot, later one agreed ledger |
| Happier | Native coding agent sessions, approvals and execution | Read-only status/deep-links initially; use supported actions only after verified authorization |
| GitHub | Code, PRs, issues | Link authoritative issue/PR status; don't duplicate task system |
| br-ai-nstorm | Optional problem-space contributions/relations | Source-reference projection or reviewed room, no mandatory service |

A **ChatGPT plan login** is not a drop-in LibreChat API endpoint. Official open-source Sign in with ChatGPT supports eligible local OSS clients and approved uses of Responses API, not arbitrary remotely hosted apps or access to native ChatGPT conversations. See https://developers.openai.com/siwc/token-sharing-open-source and https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt . **Start API-backed**; test native plan authorization separately later with proper scope/host checks.

## Fork decision, explicitly deferred

**Do not fork now.** First run a pinned, unmodified LibreChat container and build one independently testable Blackboard MCP App with synthetic project state. Fork only if:
1. users repeatedly need the notebook as a **persistent first-class project home** rather than an opened tool app, and
2. native project navigation/extensions cannot offer a stable route or a supported lightweight link, and
3. the marginal maintenance cost of a minimal sidebar/project tab is lower than a separate launcher/home.

If these gates pass, fork `LibreChat-AI/LibreChat` **at a reviewed release SHA/tag, preserve MIT and notices**, and keep changes confined to a route, project navigation/tab, and a client API wrapper. All knowledge and workbench logic stays in the independent Blackboard server/MCP App. Upstream merges should be reviewed, not auto-applied. Start a fresh branch under the existing Blackboard repo for the adapter; a fork can be a separate upstream-tracking repo only after proof.

## Information-security checkpoints

- Public source ≠ public instance or public user data. Blackboard's public repository still lacks a root license; [Issue #11](https://github.com/blackmath88/blackboard-nextgenui/issues/11) tracks OSI licensing and secret/data audits.
- The MCP App iframe is untrusted relative to host. Keep browser-origin data separate from project API credentials; use host-authenticated tool calls with project authorization and revision IDs. The model's text cannot issue a write or accept a decision by itself.
- Retrieval result bodies and imported transcripts are **data**, not executable prompt instructions. Use project-specific grants, redacted snippets, source IDs and real restricted-project canaries. A signed-in user/agent does not imply universal project access.
- Default MongoDB in the LibreChat Compose has no auth on its internal network; keep backend DB and Meilisearch private, no exposed admin/open registration, rotate any trial secrets, and evaluate supported auth hardening before remote access.
- Don't proxy Happier/Claude subscription cookies or ChatGPT plan tokens through an unsupported shared backend. For the pilot use a deliberate API key held server-side, with spend cap and explicit disclosure of provider routing.
- No model-authored JS/HTML executed as a trusted React component. Use a **closed, versioned FrameIntent schema** that picks from audited UI components; sandbox any arbitrary output separately and never make it an authority for decisions.
- CI budget: run test and image builds locally; one small PR, docs-only changes should not trigger heavy hosted suites. Record known code commit and tests without claiming deployment.

## Next file

[Blackboard Chat-Host Pilot Build Plan](./BLACKBOARD-CHAT-HOST-BUILDPLAN-2026-11-17.md) — shortest path from existing code to a real chat, knowledge and dynamic-UI demonstration.
