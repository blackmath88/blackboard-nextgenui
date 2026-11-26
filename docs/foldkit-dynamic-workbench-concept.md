# Blackboard dynamic workbench in Foldkit

**Concept for review · 26 November 2026**  
**Related work:** [Blackboard Foldkit experiment #13](https://github.com/blackmath88/blackboard-nextgenui/issues/13)

## Goal

Build a project workbench that can grow out of a conversation. When the work calls for a map, a comparison, an evidence inspector or a task board, the workspace can offer that form. People can then work directly on the objects, move or pin panes, and return later with their edits, decisions, sources and place in the work intact. The next model turn can use the current accepted project state under the user's sharing settings.

The first experiment asks whether a model can compose a genuinely useful arrangement of existing project records, whether the user can take over that arrangement with ordinary controls, and whether both can keep working on the same records after the view changes. Use a narrow, workspace-first Foldkit slice to answer that question.

## Where the idea comes from

The original Blackboard design conversation treated language as a way into the workbench. Visual and spatial forms then give people a way to inspect and act on what emerges. One persistent project can have several conversations and several views. Selection, provenance and meaningful edits carry across those views. The model is one participant in the workbench, with a specific job and an explicit point at which the application calls it.

| Prior work | What we carry forward |
| --- | --- |
| [Hearsay-II / Blackboard explainer](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/01-blackboard) | Shared state and an agenda that decides when a capability should act. A click, explicit request or meaningful state change can feed a deterministic controller. |
| [Morph](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/02-morph) | A model proposes a bounded `FrameIntent`. The application validates it and compiles a scene from current state. Direct manipulation and pinned items constrain what a proposal can rearrange. |
| [Rolle und Kodex](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/03-rolle-und-kodex) | A conversation and a durable workbench have different jobs. Keep source references and authorship attached as the same material appears in different forms. |
| [The Growing Workbench](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/04-growing-workbench) | Panes can emerge by consent, fade to tabs and be restored. The user can decline an offered pane. |
| [Observstory Project Map](https://github.com/blackmath88/observstory) | A nearby example of compiling a typed, evidence-backed project model into a visual projection. The map stays grounded in records people and agents can inspect. |

[Original session summary](https://github.com/blackmath88/blackboard-nextgenui/blob/main/notes/summaries/generative-ui-shared-state-summary.json)

## Repository baseline

- **Main** documents Pilot v0.13. Earlier iterations introduced human-reviewed proposals, authored state, `/why`, consent-driven pane lifecycles, presentation-only frame proposals, then pointer and keyboard Kanban moves. v0.13 adds projects that group chats, with separate project boards and project-scoped event streams. Its demo uses fake providers. [Current Pilot README](https://github.com/blackmath88/blackboard-nextgenui/blob/main/pilot/app/README.md) · [Changelog](https://github.com/blackmath88/blackboard-nextgenui/blob/main/pilot/app/CHANGELOG.md) · [Existing frame validation](https://github.com/blackmath88/blackboard-nextgenui/blob/main/pilot/app/frame.js)
- **Draft PRs #8, #9 and #10** provide a workspace-first plan, Summary/Index/Kanban over the same accepted records, and a recorded fake-provider demonstration of the accepted-state loop. The #10 demo edits and moves a task, preserves the original evidence, and includes the latest accepted title and stage in a later request when sharing is enabled. It also records conflict and recovery behavior. These are parallel draft references. Compare them with current main before reusing code. [Workspace plan #8](https://github.com/blackmath88/blackboard-nextgenui/pull/8) · [Knowledge views #9](https://github.com/blackmath88/blackboard-nextgenui/pull/9) · [Continuity evidence #10](https://github.com/blackmath88/blackboard-nextgenui/blob/ac02cff0d5491f412ef55c4e761e55acdd6b1657/docs/accepted-state-loop.md)
- **Draft PR #12 and issue #13** cover complementary experiments. #12 proposes testing the Thinking/Review UI inside an existing chat host through MCP Apps. #13 proposes a direct Foldkit + Effect vertical slice. This concept expands the UI architecture for #13. The workbench can later expose a focused review surface through the adapter discussed in #12. [Chat-host experiment #12](https://github.com/blackmath88/blackboard-nextgenui/pull/12) · [Foldkit experiment #13](https://github.com/blackmath88/blackboard-nextgenui/issues/13)

For this concept, the existing Morph compiler and Pilot frame parser were exercised against their source fixtures in an isolated Node process. The checks covered stable membership in a focus layout, priority for a pinned item, rejection of explicit hide and unknown IDs, and rejection of model-defined actions in the Pilot's frame format. The listed Rune and GPUI examples were inspected in source. Native demos, the proposed Foldkit implementation and a live-model round trip remain to be run.

## What to adopt from GPUI and Rune

| Source example | What the example demonstrates | Foldkit translation |
| --- | --- | --- |
| [GPUI architecture](https://github.com/zed-industries/zed/blob/main/crates/gpui/README.md) and [Zed PaneGroup](https://github.com/zed-industries/zed/blob/main/crates/workspace/src/pane_group.rs) / [Dock](https://github.com/zed-industries/zed/blob/main/crates/workspace/src/dock.rs) | GPUI views are renderable entities. Zed composes persistent pane identities in a split tree and gives dock panels an explicit focus contract. | The parent Model owns pane placement and selection. Model-backed Submodels own pane interactions and use OutMessages for cross-pane facts. Start with a center, a side pane and tabs. Add a recursive split layout when a second independent split earns it. |
| [GPUI drag and drop](https://github.com/zed-industries/zed/blob/main/crates/gpui/examples/drag_drop.rs) | Typed drag payloads give previews and targets a clear contract. | Distinguish a pane move, a local record rearrangement and a task-stage change in typed Messages. Use the pointer, keyboard and announcement patterns in the [Foldkit Kanban example](https://github.com/foldkit/foldkit/tree/foldkit%400.170.0/examples/kanban). |
| [Rune matched](https://github.com/anomalyco/rune/blob/dev/examples/matched/src/main.rs) and [todo](https://github.com/anomalyco/rune/blob/dev/examples/todo/src/main.rs) | A tile expands into detail and returns under one matched identity. Keyed rows can move while the view describes the target state. | Use stable record IDs across views and the [Foldkit View Transitions example](https://github.com/foldkit/foldkit/tree/foldkit%400.170.0/examples/view-transitions) as a starting point. Keep selection and drafts in the Model, restore keyboard focus explicitly when a view remounts, and support reduced motion. Give each rendered transition target a unique name if a record appears twice. |
| [Rune playground](https://github.com/anomalyco/rune/blob/dev/examples/playground/src/main.rs) and [kit gallery](https://github.com/anomalyco/rune/blob/dev/examples/kit-gallery/src/main.rs) | Named scenes and variants make the same UI easy to open, exercise and compare. | Run the real Foldkit view against named fixtures. Story checks the update, Scene exercises semantic controls, and a browser run captures screenshots, accessibility snapshots and focus behavior at desktop and phone sizes. |
| [Rune Luau panel](https://github.com/anomalyco/rune/blob/dev/examples/luau-panel/src/lib.rs) and [agent UI research](https://github.com/anomalyco/rune/blob/dev/research/16-research-agent-generative-ui.md) | The panel is a working script-host example with explicit bindings. The research proposes a schema-constrained component catalog, separate data and stable element IDs. | Adopt the host boundary and the semantic vocabulary. The first Foldkit renderer accepts validated data describing sections, grouping and emphasis. Rendering, tokens and action bindings come from application code. A broader catalog is a follow-up if the initial frame grammar proves too limited. [Foldworks reference](https://github.com/bjacobso/foldworks/blob/main/packages/generative-ui/README.md) |

The target is an Effect/Foldkit web application. GPUI informs workspace composition and interaction. Rune informs identity across transitions, fixture-driven inspection and the runtime UI boundary. A native companion would be a separate experiment with its own reason to exist.

## Proposed architecture

| Layer | Owns |
| --- | --- |
| **Project** | Accepted tasks, decisions, sources, stable record IDs, revisions and provenance. Read/write operations sit behind one Effect service. Application code checks authority and the current revision at commit. |
| **Workbench** | Pane lifecycle, docking and tabs, selected record, draft edit and user pins. Keep edits keyed by record identity so changing panes or grouping does not destroy them. Persist the applied frame and meaningful personal workspace choices in the experiment's fixture store. |
| **Frame proposal** | A versioned presentation intent containing a target, base revision, proposed sections or groups, record IDs and a reason. The model supplies semantic group labels and membership. The renderer resolves record content from current Project state. |
| **Scene and interaction** | A pure compiler combines accepted records, allowed intent and current user preferences. Foldkit renders the result. Direct manipulation emits typed Messages. Side effects such as inference, persistence and focus restoration run through Commands. |

Start with explicit invocation. Decode model output with Effect Schema, then check record IDs against the visible, project-scoped snapshot. Reject unknown or disallowed records, extra authority-bearing fields and invalid structures. During preview, keep the current frame recoverable. Applying a frame changes presentation state. A task-stage change goes through the project operation and creates its own provenance entry. If the relevant project revision changes before apply, show that the proposal is stale and offer regeneration from the latest snapshot. A launchable fixture version can share the shape of the current Pilot data without taking a dependency on an open PR's store.

This gives the model enough latitude to find a useful grouping and name it. The first vocabulary should cover ordered sections, one focused record and an optional evidence inspector affordance provided by the host. Keep every permitted record reachable in the workbench. Add a richer section or component after a concrete user request shows why the simpler form falls short.

## First experiment and acceptance check

Use one fictional Microsoft 365 rollout project with a short accepted board, two conversations and traceable source excerpts. Give it a quiet workspace shell with Conversation, Work and Evidence. Begin with an isolated fixture in Blackboard, using the [Effect/Foldkit starter](https://github.com/blackmath88/effect-foldkit-alchemy-template) as a reference. The versions inspected for the concept were Foldkit / `@foldkit/ui` 0.170.0 and Effect 4.1.4. Check compatibility again at implementation.

1. Open a decision from a conversation into Evidence, then pin it and start editing a task. Request **“Show me what’s blocking rollout readiness, grouped by what we’re waiting on.”**
2. Preview a grouping over existing references. Apply it, rearrange it with the keyboard or pointer, then undo. Confirm the selected decision, evidence link, open draft and pinned item survive. Compare against a deterministic grouping baseline to see what the model adds.
3. Move a task to Done using a normal workbench action. Reopen the project. With board sharing enabled, ask what is still blocked and inspect the actual bounded context used for the new turn. The current accepted stage and revision should appear. The source excerpt should still resolve, and `/why` should distinguish the model's frame suggestion from the user's task move.
4. Re-run with stale data, a cross-project or unknown record ID, a malformed frame and sharing disabled. Capture the resulting screens and state. The old working view or current accepted state should remain available. The disabled-sharing request should omit the board snapshot.
5. Run the scenario first with a deterministic provider and then, if a model/provider is selected for the spike, with the same fixture and a real structured-output call. Assess whether the result changes how quickly someone understands the blockers and gets back to the record they were editing.

Useful proof artifacts are one short interaction recording, desktop and phone screenshots, Story and Scene results, and a trace from the proposed frame through the accepted task edit to the next model context. Initially exclude a freeform drawing engine, a general component marketplace, collaboration sync and a hosting change from this experiment. They each have independent costs and can be evaluated after the loop works.

## Questions for an independent reviewer

1. Is the model doing useful semantic work here? Give one case where a fixed grouping beats generation and one case that would justify a richer frame grammar.
2. Are pane identity, record identity and revision ownership clear enough? Find a plausible sequence involving drag, regroup, edit, refresh or undo that could lose the user's place or change the wrong thing.
3. Which GPUI or Rune technique has been carried over too literally, and which example contains an idea worth adopting earlier?
4. Can the first proof be made smaller while retaining the generated frame, direct human manipulation and the next model turn? State the smallest convincing demonstration and a stop condition.
5. What would you change before implementation? Distinguish concerns supported by the linked code from architectural guesses.
