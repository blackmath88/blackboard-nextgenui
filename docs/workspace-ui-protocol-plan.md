# Blackboard: workspace UI and protocol adoption
Date: 2026-11-02
Status: proposed concept and implementation plan. Documentation only; no migration or protocol adoption committed.
Companion: [Perplexity research brief](perplexity-workspace-ui-brief.md).

## Outcome
A persistent workspace in which people can discuss, inspect, organise and revise the same work across sessions and model providers. The interface makes accepted work, AI proposals and running activity distinguishable. It preserves identity and evidence when presentation changes.

AG-UI is a possible runtime adapter, not a visual design system or the project store. Improving interaction quality does not require adopting its protocol first.

## Inspected baseline
Repository main at `7234e628db5a0dff2802493e5b7f5ca0a9561e25`. Source/documentation inspection only: no browser screenshots, runtime checks or live-model validation performed for this plan. No AGENTS.md found in the complete tree.

| Evidence | What exists |
| --- | --- |
| `pilot/app/package.json`, README | Dependency-free local Node server; pilot-v0.10; vanilla browser UI |
| `pilot/app/public/index.html`, style.css | Terminal-style conversation, single-line composer, chat-dominant pane grids, narrow-screen stacking, themes, reduced-motion rules |
| `pilot/app/server.js`, public/app.js | File-backed state; SSE file-change notifications; frontend reload/reconnect handling; revision-aware confirm/reject operations |
| `pilot/app/frame.js`, schemas/frame-intent.schema.json | Closed presentation vocabulary: map/kanban, focus/order/group; cannot mutate items or add/remove panes |
| `pilot/app/README.md`, why.js | Provenance, evidence explanations, consent-based pane growth/removal and metrics |
| `server.js:1092–1108` | Chat input built from recent user/assistant transcript; accepted board state is not added here |
| `server.js:719` frameMessages | Separate frame role receives non-rejected board items with their status and applied presentation |
| `server.js:343–344,897–898` | Revision arguments remain optional for legacy callers; existing checks are not a complete external-client concurrency contract |

The README explicitly says real-model extraction is untested. Existing verification scripts are evidence of test infrastructure, not evidence that this review ran them. Root overview/explainers are educational simulations; they are not the live pilot application.

Do not describe this as a greenfield build. Persistent proposals, acceptance, frame reset, SSE and provenance already exist. The important gap is a consistent accepted-state context path and a usable workspace experience around those mechanisms.

## Product and interaction vision
Suggested direction: a calm, dense, readable workbench with a recognisable identity. Retain authorship/status semantics and selective pixel character if useful; improve hierarchy and readability before adding decoration. This is a direction for research, not a selected design.

- Project/workspace header: current context, saved/reconnecting status, useful actions.
- Main work surface: findings/decisions/tasks and their relationships; board or document becomes primary when that is the task.
- Conversation: persistent, accessible panel whose prominence follows the work; retain keyboard interaction.
- Review: visible proposal count, inspectable changes, edit/select/accept/reject, explicit stale/conflict state.
- Evidence inspector: source excerpt, origin, who changed/accepted an item, and existing /why explanations.
- Activity: concise running/completed/failed/cancelled status. Completion and accepted commit are separate facts.
- View controls: explicit user selection and reversible suggested arrangements. Preserve IDs, evidence and selection.
- Narrow screens: one focused surface with deliberate navigation between work, conversation and review; avoid an endless stack of cramped panes.
- Accessibility: keyboard navigation, focus retention, readable contrast, non-colour status cues, reduced motion, honest loading/error/empty states.

Human control does not require a modal for every view change. Direct user view choices and draft generation can be immediate. Existing consent behaviour remains until an explicit replacement is designed; meaningful project changes follow acceptance or a defined delegation policy.

## Ownership and protocol choices
1. Accepted workspace: canonical entities, evidence, relationships and accepted view definitions.
2. Proposal/review state: durable suggestions with versions, provenance and input revisions; not accepted truth.
3. Execution/session state: progress, streamed messages and provider-specific continuation.
Logical separation does not require three databases.

Application services validate and apply changes. All future entrances call the same operations. The renderer projects entities; it must not keep independently authoritative copies.

- Keep existing HTTP and SSE as baseline. AG-UI supplies event semantics over transports such as HTTP/SSE; it is not a competing transport.
- Test a removable AG-UI adapter only after a useful loop works. Start with lifecycle/text events and a proposal-reference notification; fetch the durable proposal through application operations.
- Keep bounded FrameIntent; extend only for demonstrated use cases. No A2UI migration without an actual independent UI consumer.
- Remote MCP becomes relevant when a named chat client needs read/propose access. Initial proposal review may deep-link to Blackboard; MCP Apps is conditional on a demonstrated embedded-review need.
- WebMCP is an optional page/browser-agent entrance, not a replacement for remote MCP. Feature-detect and validate the exact supported combination.
- Do not require CopilotKit, an agent framework, hosted service, cloud migration or paid infrastructure just to adopt a protocol.

Sources consulted: https://docs.ag-ui.com/introduction and https://github.com/ag-ui-protocol/ag-ui .
WebMCP scope reference: https://webmachinelearning.github.io/webmcp/ .
The user-supplied Perplexity review informed this synthesis; protocol version/implementation claims from it must be reverified before coding.

## Reference journey
Select accepted findings → request thematic grouping → controller loads relevant accepted entities and evidence → model proposes grouping and optional new tasks → application validates and persists proposal → renderer previews with pending changes identified → user edits/selects/accepts → conditional commit → reload and next model run use the accepted result.

Known-template views should be deterministic. Semantic grouping may need a model. A different view may need missing data: ask or propose enrichment rather than inventing it.

## Phased delivery
### Phase 0 — record and reproduce
Run the existing no-key v0.10 demo in an isolated data directory. Capture desktop and narrow screenshots plus keyboard/reduced-motion behaviour. Trace selection/state → model input → proposal → acceptance → persistence.
Deliver: baseline evidence, route/state inventory, current checks and precise gaps. Preserve existing demos and explainers.

### Phase 1 — accepted-state continuity
Extract/reuse a context builder that supplies relevant confirmed items, stable IDs, provenance and revisions to chat. Label any included proposals separately; exclude rejected items from accepted facts. Keep context bounded. Add a fixture demonstrating that a confirmed decision changes the next model input independently of transcript truncation.
Deliver: reproducible continuity trace and tests. No framework migration.

### Phase 2 — one workspace-first visual checkpoint
Use the current services and renderer capabilities to improve one concrete journey: select existing decisions/sources → propose an arrangement → inspect origin → apply/reset. Research may justify introducing a finding entity; do not silently rename existing kinds or invent a schema migration.
Deliver: real desktop/narrow screenshots; readable evidence/review surface; keyboard path; loading, empty, error and reconnect states. Preserve the existing pilot as a comparison fixture if practical.
Evaluate whether the user can locate accepted work, identify a proposal and inspect evidence without memorising slash commands.

### Phase 3 — durable review and recovery
Reuse and strengthen existing revision checks. Bind acceptance to the reviewed proposal version and relevant input revisions. Audit optional rev compatibility, file-edit revision semantics, serial writes and multi-file commit/audit consistency before selecting a storage change.
Deliver: stale-change handling, repeated-command idempotency, persisted operation outcome, restart/reconnect recovery and no duplicate commit after a lost response. Cancellation does not promise rollback of committed changes.
Keep proposal review independent of a suspended model run.

### Phase 4 — AG-UI experiment
Wrap the same operation with a small pinned-version adapter. Compare with the existing path; do not build two new stacks.
Deliver: preview parity, no domain-schema/storage dependency on AG-UI, replay/reconnect checks, concrete code removed or compatible consumer enabled. Drop the adapter if most traffic is custom and it adds a duplicate reducer/store without useful reuse.

### Phase 5 — additional entrances when justified
Name the target user journey and client first. Chat read/propose access uses an appropriate authenticated remote API/MCP adapter; browser collaboration can test WebMCP. Apply the same domain operations and permissions.
The present localhost pilot is not ready to expose publicly simply because an adapter exists: assess authentication, authorization and deployment boundaries first.

## Acceptance evidence
- The next model sees accepted workspace context; rejected proposals are not facts.
- Proposed and accepted data remain distinguishable through reload and view changes.
- Model-generated layout cannot silently mutate entities or grant authority.
- Duplicate acceptance returns the same durable outcome; stale acceptance surfaces changed inputs.
- Evidence and item identity survive presentation changes.
- Desktop/narrow layouts, keyboard focus and reduced motion work in the actual UI.
- Real-provider checks are labelled separately from deterministic fixtures and only run with configured, authorised credentials/budgets.
- The adapter can be removed without changing saved project data.
- Existing relevant regressions pass; avoid adding tests that only mirror markup.

## Next decision
Use the research brief to choose a visual and interaction direction from concrete precedents. Then implement one reviewed checkpoint. Documentation here authorises no automatic framework migration, merge, deployment or broad redesign.
