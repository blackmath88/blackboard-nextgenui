# Blackboard product vision

Status: product direction captured for review · 28 November 2026

Companion: [bruh four-hour Claude Code build-session runbook](bruh-four-hour-build-runbook.md)

## The experience we are building

**Chat is the conversation. Blackboard is the evolving representation of what we are thinking about together.**

Bring the quality and expressive range of ChatGPT's in-chat generative visuals into a persistent, resizable right-hand workspace with IDE-style panes. Keep projects and conversations in the left rail, a capable chat in the centre, and the current summary, overview, plan and working representations on the right. The workspace changes with the question and remains available across turns and sessions.

A research conversation may become an evidence map; a comparison may become a matrix; a budget may become an interactive calculator and chart; a plan may become a timeline. The model should compose useful visual forms rather than only rearrange a fixed set of cards. The quality reference is the user's ChatGPT experience, not a claim that its internal renderer or proprietary implementation is public.

**The workspace talks back.** Selecting a decision establishes context; asking “Warum?” can bring its rationale into chat. Comparing selected items, changing an assumption, moving a task or selecting a chart region creates a meaningful, typed interaction that the conversation can respond to. Selection alone need not make a model call. Explicit requests and permitted state-changing actions have distinct effects.

Continuity is a product requirement. Stable record and pane identities, provenance, human edits, drafts, selection, pins and accepted decisions survive view changes. A new representation does not erase the previous work. Users can keep, rearrange, reopen and continue through a visual object.

## Scope and relationship to existing work

This is the expanded product target requested in **Plan Passion Projects**. It extends the narrow first experiment in [PR #14](https://github.com/blackmath88/blackboard-nextgenui/pull/14); it does not retrospectively change that experiment's acceptance criteria or merge any open branch. Implementation slices still follow the selected checkout's PLAN.md, when present, and repository instructions.

The documentation base is [main at 8be2227](https://github.com/blackmath88/blackboard-nextgenui/commit/8be222715d8db677c1d56ccd1120ffe3460b53ad). Its complete tree contains no PLAN.md, AGENTS.md or Observstory configuration. The inspected [Pilot README](https://github.com/blackmath88/blackboard-nextgenui/blob/8be222715d8db677c1d56ccd1120ffe3460b53ad/pilot/app/README.md), package scripts and [frame schema](https://github.com/blackmath88/blackboard-nextgenui/blob/8be222715d8db677c1d56ccd1120ffe3460b53ad/pilot/app/schemas/frame-intent.schema.json) describe a dependency-free Node/browser pilot with persisted records, proposals, pane consent and a constrained map/Kanban presentation vocabulary. That is useful existing work.

Effect + Foldkit is the selected direction in the conversation and the [dynamic-workbench concept](https://github.com/blackmath88/blackboard-nextgenui/blob/8c3dac163e4e069783e63464cae712cafb2da532/docs/foldkit-dynamic-workbench-concept.md), not a claim that main already uses it. The latest bruh prototype, its source, active ownership and rendered quality have not been inspected in this documentation task. Locate and preserve that work before any build; do not recreate a prototype merely because it is absent from main.

The source answer below mentions building on Blackbird. The user's subsequent instruction selects **bruh, the Mac mini**, for future Claude Code build sessions. The historical answer remains preserved; the companion runbook records the current placement.

## Three levels of visual capability

| Level | User-visible outcome | Implementation boundary |
| --- | --- | --- |
| Projection | Select a useful existing view over accepted records. | Preserve the existing bounded frame path and deterministic views. |
| Composition | Compose charts, tables, diagrams, cards, inputs and controls appropriate to the question. | Validate a component specification and render through a host-owned native catalogue. |
| Generative artifact | Create a bespoke interactive HTML visualisation or mini-application. | Render in isolation, with a narrow, validated interaction bridge. |

Levels two and three are part of the vision. Neither must fit into one four-hour session. Use several conversations—research, planning, architecture, budgeting, learning and comparison—to prevent the experiment becoming only a blocker board.

## Shared state and two rendering paths

Chat and the workspace operate on the same semantic session state: findings, tasks, decisions, sources, selection and revisions. Keep accepted facts, proposed changes and presentation state distinguishable. Reuse existing record, provenance, persistence and context mechanisms where they work.

The native path uses Effect/Foldkit and a constrained component catalogue for stateful interaction. The artifact path supplies bespoke HTML when the native vocabulary cannot express the useful representation. Both emit the same host-defined interaction intents; the renderer never grants authority.

An interaction carries stable session/project and object references, a type and validated payload, and a relevant revision. Host code checks scope and permission, applies or proposes the change, records provenance and supplies bounded, permitted state to the next model turn. Duplicate or stale events must not silently overwrite later edits. Disabled sharing must remain disabled.

Generated HTML receives only the data needed for its task. It must not receive credentials, unrestricted project access or arbitrary tool execution. Require an isolated execution context, restrictive network/content policy, a sender-bound validated bridge, bounded payloads and explicit allowed actions. A plain iframe or an arbitrary postMessage handler is not sufficient evidence of that boundary. Preserve the last working view when generation or validation fails.

## Public technology research — checked 28 November 2026

These are source-backed capabilities and proposed uses, not a compatibility-tested package set. Pin and test versions against the actual prototype before adopting anything.

| Source | What the public source establishes | Proposed use in Blackboard |
| --- | --- | --- |
| [Foldkit](https://foldkit.dev/) and [Effect](https://effect.website/) | Foldkit uses explicit Model/Message/update/Command state and effects on Effect; Story and Scene provide behavioural checks. | Continue the selected runtime and native renderer direction; reuse the working implementation. |
| [Foldworks generative-ui README](https://github.com/bjacobso/foldworks/blob/main/packages/generative-ui/README.md) | Effect Schema validates a component graph; a registry renders allowed views and actions remain host-owned intents. The documented slice includes layouts, content, status, tables and buttons, but excludes mutable form state, streaming patches and agent-defined HTML/CSS. | Closest concrete candidate for a richer native catalogue. Test reuse before extending it; do not assume it already supplies every interaction in this vision. |
| [A2UI](https://a2ui.org/) | Describes declarative composition from an application component catalogue and two-way data binding. | Compare its vocabulary with the needed native specification. No migration until a concrete consumer or reduction in implementation work justifies it. |
| [AG-UI](https://docs.ag-ui.com/introduction) | Defines an event-based, bidirectional connection between agent backends and user interfaces. | Optional adapter for agent/UI events; it does not choose the visual design or replace canonical project state. |
| [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) | Tools can expose interactive HTML resources inside supporting hosts, with bidirectional app/host communication. | Optional embedding/integration boundary; not a substitute for Blackboard's own persistent right-hand workspace. |
| [Existing GPUI, Rune and tldraw research](https://github.com/blackmath88/blackboard-nextgenui/blob/8c3dac163e4e069783e63464cae712cafb2da532/docs/foldkit-dynamic-workbench-concept.md) | The repository concept records prior source inspection of pane composition, identity, transitions and interaction patterns. | Design references. Their native engines or canvas stacks are not automatically new dependencies. |

The earlier [workspace/protocol plan](https://github.com/blackmath88/blackboard-nextgenui/blob/a955c541f9e38e5b0cfc7bd0a7d91049b2670733/docs/workspace-ui-protocol-plan.md) remains useful for state ownership, consent, recovery and removable adapters. The broader generative ambition here does not require adopting every listed protocol.

## Evidence that the experience is improving

A convincing demonstration completes a loop: ask in chat → compose a useful workspace → interact there → observe the correct chat response → reopen with human changes intact. Capture before/after screenshots and an interaction trace or recording against the same fixture and viewport.

Evaluate visual quality, representation usefulness, bidirectional interaction, continuity, accessibility and reliability. Passing tests alone does not establish ChatGPT-level quality. Use the companion runbook's weighted rubric as a proposal for comparing iterations; security, permissions, data preservation and technical reliability remain mandatory gates.

New UI copy stays German. Engineering documentation and build reports stay English. Prototype fixtures are explicitly synthetic; a deterministic demo must not be presented as a real model result.

## Source answer preserved

Source: [Plan Passion Projects](https://chatgpt.com/c/6b093136-cbd8-83ed-8d2b-e56b69c4fb5b), assistant message `d005b0c1-b723-4ff5-a38d-be192fd894f6`, immediately before the user's request to put that answer in the repository. Retrieved on 28 November 2026.

The complete retrieved textual answer follows. Only heading depth, escaped punctuation and ChatGPT citation markup were normalised for Markdown. Interactive visuals are represented only by the text available in the export. The answer's historical observations, status statements and recommendations remain source material, not a new verification of local runtime state. The implementation and operational clarifications above are editorial synthesis.

---

Yes. And after going back through our discussions and the Blackboard repository, I think we have gradually drifted away from the original vision.

We've been concentrating on whether a model can generate a valid layout, whether the records persist, whether the context is correct and whether the tests pass.

All of that matters. But **the actual innovation is the experience of thinking together with an AI inside an evolving, interactive workspace.**

ChatGPT's current in-chat visualisations are a very good reference for the quality we're aiming for. What you want is to emancipate those visualisations from the chronological chat stream.

Not another dashboard. Not a Kanban application with an AI chatbot attached. Not a terminal with some cards beside it.

**Chat is the conversation. Blackboard is the evolving representation of what we are thinking about together.**

### 1. The original product vision

The interface should feel like a combination of ChatGPT, an IDE and a dynamic canvas for knowledge work.

Illustrative product design: persistent chat on the left and an evolving interactive workbench on the right. The layout is resizable; the content isn't a fixed dashboard.

The left rail provides the familiar projects and conversations. The centre is a normal, high-quality chat experience. The right-hand window is where the conversation acquires structure, visual form and interactive controls.

And that right-hand window should be different depending on what we are discussing.

### 2. The interface evolves as the conversation evolves

But this shouldn't be a predetermined four-step workflow. Sometimes we need a comparison matrix, sometimes a graph, sometimes a little interactive calculator, sometimes an entire HTML representation of a concept.

The AI should be able to compose the appropriate representation, much like ChatGPT does here.

The difference is **continuity**. The things we have learned, decided and edited don't disappear when a new visualisation replaces the previous one.

### 3. The most important capability: the interface talks back

This is the part that makes Blackboard fundamentally different from a generated dashboard.

Try the following miniature simulation. Select something in the right-hand workspace and watch how the conversation responds.

#### Blackboard interaction experiment

Scripted demo

Conversation

What should we focus on next?

Workspace

Local illustrative interaction only. No model calls or project changes are made.

In the real application, the selected record becomes part of the conversational context. An edit becomes a typed state-change event. The AI can react, explain the implications and propose an updated representation.

This creates several modes of interaction beyond typing:

| User interaction | Possible AI reaction |
|--------|--------|
| Click a decision | Explain its rationale |
| Select several cards | Compare them |
| Move a task | Reassess the remaining plan |
| Edit an assumption | Recalculate the implications |
| Click a source | Explain its relevance |
| Select part of a chart | Investigate that specific pattern |
| Pin a visualisation | Preserve it while the conversation continues |

Not every click needs an inference call. Selection can simply establish context; meaningful actions or explicit requests can trigger the model.

### 4. Yes, we have already researched the technology stack

I've reopened our actual [Foldkit dynamic workbench concept — PR #14](https://github.com/blackmath88/blackboard-nextgenui/pull/14), written on 26 November, and our earlier [Workspace UI and protocol plan](https://github.com/blackmath88/blackboard-nextgenui/blob/docs/workspace-ui-protocol-plan/docs/workspace-ui-protocol-plan.md).

Our research was extensive.

| Technology | What we wanted to adopt |
|--------|--------|
| [Effect.ts](https://effect.website/) | Typed services, event streams, schemas, persistence and model integration |
| [Foldkit](https://github.com/foldkit/foldkit) | Model → Message → Update → View; predictable interactive state |
| [Foldworks Generative UI](https://github.com/bjacobso/foldworks/tree/main/packages/generative-ui) | Schema-constrained generative component composition |
| [Rune](https://github.com/anomalyco/rune) | Stable visual identity, transitions, runtime composition and inspectable scenes |
| [GPUI / Zed](https://github.com/zed-industries/zed) | IDE-style panes, docking, focus management and typed drag-and-drop |
| [tldraw](https://github.com/tldraw/tldraw) | Spatial interaction and shared canvas concepts |
| [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | Bidirectional agent events and frontend interaction |
| [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) | Interactive application surfaces connected to models |
| [Wardic](https://github.com/blackmath88/takt/pull/5) | Spatial navigation patterns already explored in TAKT |

Rune and GPUI are architectural references, not dependencies we need to install in a web application.

The selected implementation direction remains **Effect.ts + Foldkit**. AG-UI and MCP Apps were candidate integration mechanisms, not mandatory foundations.

#### The architecture we discussed

LLM — conversational intelligence

Understands, synthesises, proposes visual representations

Effect — interaction runtime

Streaming · Schemas · Context assembly · Typed actions

Shared semantic session state

Findings · Tasks · Decisions · Sources · Selection · Revisions

Foldkit — generative experience

Chat

Dynamic workbench

Both interfaces operate on the same session state. Neither is merely an output of the other.

### 5. Where we are falling short

I think we made our `FrameIntent` approach too restrictive for the full vision.

It's excellent for safely rearranging existing records. But grouping decisions into predefined sections is not equivalent to the richness of ChatGPT's generative UI.

We need to explore three levels of visual intelligence.

| Level | Capability |
|--------|--------|
| 1 — Projection | Choose and configure an existing view, such as Kanban |
| 2 — Composition | Generate a novel arrangement of charts, tables, cards, inputs and controls |
| 3 — Generative artifact | Produce a bespoke interactive HTML application for the current question |

Our current prototype is largely exploring level 1.

Your vision requires levels 2 and 3 as well.

I would support two rendering paths: a native Foldkit component catalogue for reliable, stateful interaction, and a sandboxed HTML renderer for bespoke visualisations and mini-applications.

Both should communicate through the same typed interaction protocol.

🔐 The interesting boundary is that generated HTML may be executable code. We should allow it to communicate selected interaction events back to Blackboard without granting it access to authentication credentials, arbitrary project data or unrestricted application operations.

### 6. Our existing research history

This isn't a new idea. We've developed it through several experiments.

| Reference | Contribution |
|--------|--------|
| [Hearsay-II / Blackboard](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/01-blackboard) | Shared state and an intelligent interaction agenda |
| [Morph](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/02-morph) | Model-proposed visual transformations |
| [Rolle und Kodex](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/03-rolle-und-kodex) | Answer-shaped versus workspace-shaped UI |
| [Growing Workbench](https://github.com/blackmath88/blackboard-nextgenui/tree/main/explainers/04-growing-workbench) | Panes that emerge, persist and fade |
| [Accepted state loop — #10](https://github.com/blackmath88/blackboard-nextgenui/pull/10) | Changes in the workspace affect subsequent model context |
| [Chat-host experiment — #12](https://github.com/blackmath88/blackboard-nextgenui/pull/12) | Reuse established chat infrastructure |
| [Foldkit experiment — #13](https://github.com/blackmath88/blackboard-nextgenui/issues/13) | Direct Effect/Foldkit implementation |
| [Dynamic workbench — #14](https://github.com/blackmath88/blackboard-nextgenui/pull/14) | Rune, GPUI and Foldkit architecture |
| [Context-aware execution — #16](https://github.com/blackmath88/blackboard-nextgenui/pull/16) | Consultation and execution traces |

Yesterday's prototype work on bruh established useful technical foundations. However, I haven't inspected its latest local source or rendered interface on Blackbird, so I cannot make a fresh assessment of its visual quality.

### 7. What I would build on Blackbird now

Rather than extend yesterday's blocker-management prototype indefinitely, I would create a focused **Blackboard Generative Experience Lab** inside the existing repository.

Its purpose would be to reproduce the visual and interaction richness that you experience in ChatGPT.

Not just a single project-management fixture. Give it several very different conversations: research, planning, architecture, budgeting, learning and comparison. Let the model decide how to represent each one.

The evaluation criteria should include visual quality, usefulness, interaction richness, continuity between model turns and preservation of human edits.

We already have considerable evidence that the underlying state machinery is possible. Now we need to find out whether the experience is actually compelling.

---

**The north star:** everything that ChatGPT can visually express inside a conversation should have a meaningful equivalent in Blackboard's persistent workspace — with the additional ability to interact with it, change it, keep it, rearrange it and continue the conversation through it.

That is the Blackboard I remember us envisioning. And that is the part I would invest our Claude tokens in next.
