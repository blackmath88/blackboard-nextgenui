# Perplexity brief: Blackboard prior art and UI direction

Act as a critical product designer, HCI researcher and software architect. Research concrete prior art and UI inspiration for evolving Blackboard from its current local pilot into a coherent human–AI workbench. Recommend a direction we can implement incrementally. Do not assume AG-UI adoption or a frontend rewrite is the answer.

## Read our actual project first
Repository: https://github.com/blackmath88/blackboard-nextgenui
Plan branch: https://github.com/blackmath88/blackboard-nextgenui/tree/docs/workspace-ui-protocol-plan
Concept and plan: https://github.com/blackmath88/blackboard-nextgenui/blob/docs/workspace-ui-protocol-plan/docs/workspace-ui-protocol-plan.md
Inspected baseline: 7234e628db5a0dff2802493e5b7f5ca0a9561e25

Read README.md, pilot/app/README.md, pilot/app/public/index.html, public/app.js, public/style.css, frame.js, server.js, and the existing assessments in docs/. Distinguish the static overview/explainers from the actual pilot under pilot/app/. Report inaccessible files and do not invent a visual inspection.

Current source-inspected baseline:
- Local Node server, vanilla frontend, no runtime package dependencies.
- Terminal-looking chat with growing index/map/kanban side panes.
- File-backed proposals, confirm/reject, provenance and /why explanations.
- Revision checks, SSE updates and reconnect reload.
- Bounded model-proposed frames: focus/order/group, apply/dismiss/reset.
- Chat request currently builds context from transcript; separate frame model receives board items.
- README explicitly labels real-model extraction untested.
These are source findings, not fresh runtime validation.

## Product goal
Ongoing work survives the conversation. Findings, sources, decisions and tasks retain identity and evidence while their presentation changes. The project owns state; models are replaceable semantic capabilities. People can inspect proposals, accept useful changes, and continue later with another model.

Three distinct states matter: accepted work, pending proposals and running activity.
Human control should not become constant permission dialogs. Ordinary direct manipulation should remain fast.

## Research focus
1. What should we preserve from the pilot, and what prevents it feeling like a capable everyday workspace?
2. Which existing products and older HCI systems offer transferable mechanisms for persistent work, multiple views, evidence inspection, proposal review, mixed-initiative interaction and stable spatial context?
3. What can AG-UI demos teach us about interaction quality, independent of protocol adoption?
   Start with https://docs.ag-ui.com/ and https://dojo.ag-ui.com/ .
   Separate the documentation site's visual styling, the demos' interaction patterns, and protocol features. Do not treat “AG-UI level” as a visual specification.
4. Explore a focused shortlist of 6–8 references. Possible leads include IDE diff/review interfaces, research notebooks, spatial knowledge tools, task/document workspaces and mixed-initiative systems. Choose for relevance, not popularity. Include historical precedents where useful.
5. Show the specific mechanism from each reference: what the person does, what the system does, what state persists, how authority is visible, and how it maps to Blackboard.
6. Compare three plausible UI directions: refined terminal/workbench; document-and-board workspace with contextual chat; spatial research surface. Challenge these candidates if better ones emerge.
7. Recommend one direction for a first visual checkpoint without sacrificing keyboard access, narrow-screen usability, provenance or low operational overhead.

## Concrete journey to design
Return to a project → find accepted decisions and sources → select related items → ask for thematic organisation → inspect the proposed arrangement and evidence → edit or accept → change view → return later with the same accepted work.

The existing domain uses decisions/tasks/sources. A richer “finding” entity is a proposal, not existing functionality. Distinguish layout changes from content changes and acceptance from execution.

## Output
- A candid current-state assessment tied to code paths.
- A reference matrix: direct source/demo link, screenshot or timestamp if available, concrete transferable interaction, limitations and implementation cost.
- Three visual directions with layout, typography, density, navigation, motion and proposal/status treatments; explain tradeoffs.
- One recommended direction and an annotated screen-by-screen storyboard for the journey.
- Explicit states: empty, loading, running, preview, accepted, rejected, stale/conflict, failed, reconnecting and restored.
- A practical mapping from existing panes/endpoints to the proposed interface; identify reusable code versus new requirements.
- A small first checkpoint and staged follow-up, with observable usability criteria.
- Anti-patterns to avoid: generic chatbot plus dashboard cards, arbitrary model-generated layouts, hidden proposal acceptance, decorative graphs, or a mandatory framework migration without evidence.

Use primary product documentation, actual demos and original HCI research where available. Provide a research date. Label verified observations, inferences and proposed designs separately. Screenshots should show real references; do not claim to have tested an interface from marketing copy. Deliver concrete design material rather than a list of links or adjectives.
