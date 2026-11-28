# Generative experience — session 01

Durable checkpoint for the eight-hour Blackboard build session on bruh. Engineering record in English; all new user-facing copy is German.

## Session contract (as executed)

| Field | Value |
| --- | --- |
| Session start (T0) | 2026-11-28 09:07 CET (08:07 UTC) |
| Hard stop | 17:07 CET · feature freeze 16:37 CET |
| Host | `mac-mini-bruh` (`Macmini.galaxus.box`), user `admin` — verified with `hostname` / `scutil --get ComputerName` |
| Harness | Claude Code, Claude desktop app (Code tab), local session |
| Implementation model | Claude Opus 5.5 (`claude-opus-5-5`) via the desktop app's existing sign-in. No API key was read or used. |
| Application inference | **None.** The only configured app route is the UniBas sciCORE (`pi-scicore`) launcher, an institutional API this mission excludes. Local Ollama is running but the runbook forbids starting local inference as an automatic fallback. All assistant turns in this session come from the deterministic, **synthetic director** and are labelled as such in the UI. |
| Spend | No paid API calls, no new subscriptions. Claude Code subscription usage: not observable from inside the session (recorded as unavailable). |
| Supervision / deadline | No external watchdog was installed. The session runs inside the Claude desktop app, which the user can stop at any time; the wall-clock limit was self-enforced from T0. **This does not satisfy the runbook's external-supervisor requirement** and is recorded as an open gate. |
| Base | `feat/foldkit-unibas-evaluation` at `d5865a3` (application revision `93bb790` + checkpoint-only commits). Verified 93bb790 still the last app change. |
| Branch / worktree | `claude/generative-experience-01` at `/Users/admin/Developer/blackboard-generative-01` (git worktree of the existing checkout; no other checkout touched) |
| Writable scope | `pilot/foldkit-workbench/src/studio/**`, `pilot/foldkit-workbench/studio.html`, `pilot/foldkit-workbench/scripts/studio-acceptance.mjs`, `pilot/foldkit-workbench/vite.config.ts` (second entry), `package.json`/lock (two dev deps), `docs/build/**` |
| Ports | dev server `127.0.0.1:4330` (existing 4320/4321 left free; Knowledge Lab, TAKT and other listeners untouched) |
| Storage | Browser `localStorage` key `blackboard.studio.v1` only; acceptance runs use a fresh headless Chrome context (synthetic, disposable). Legacy `pilot/app` verify scripts were not run. |

## Baseline (before)

- The existing Foldkit workbench (`/` on the dev server) is a fixture M365 rollout board: one column of linked records, “Mark done” buttons, a preview/inspector stack. Screenshot: [before-fixture-workbench-1440.jpg](screenshots/before-fixture-workbench-1440.jpg).
- The live chat shell (`/?unibas=1`) is two equal panes — a plain conversation list and an empty workspace that only fills from the UniBas route. Screenshot: [before-chat-shell-1440.jpg](screenshots/before-chat-shell-1440.jpg).
- Vocabulary: `FrameIntent` grouped lists, and a chat workspace limited to `summary | map | kanban` with string-list sections.
- Checks: `npm run check` → TypeScript, 27 tests, build — all passing at base.

## What was built (Cycle A, 09:07–09:50)

A new **studio** surface beside the untouched workbench: `studio.html` → `src/studio/*`, same Effect 4 + Foldkit 0.170 runtime.

- **Three-region shell** — rail (Projekte, Gespräche, Aktuelle Sitzung, Angeheftete Arbeitsflächen), ChatGPT-style conversation, resizable Blackboard with IDE tabs. Keyboard-resizable separator, phone segmented view.
- **Component catalogue** (`spec.ts`, Effect Schema): section, grid, text, callout, metric (literal or derived), table (selectable rows), matrix (weighted criteria), bars (literal or bound to an assumption), diagram (layered SVG with lit dependencies), timeline, board (lanes + cards), records (finding / decision / question / risk / option), sources, assumptions (human-owned sliders), action, artifact. Derived values use a closed expression algebra (`add/sub/mul/div/min/max`), no code. Ids are stable and validated; lists are bounded.
- **Synthetic director** (`director.ts`) — deterministic stand-in for a model turn. It receives only the bounded context packet plus current representations and returns Markdown with `[[object-id]]` references and an *untrusted* patch that the host decodes before use.
- **Typed interaction protocol** (`model.ts`): `select, ask-why, compare, investigate, inspect-source, edit-assumption, move-card, pin, unpin, artifact-event, reset-assumption, close-pane`, each with pane id + revision + object ids + payload + `explicit` flag. Selection never infers; explicit actions do.
- **Context packet** (`context.ts`) — request, interaction, selection with object data, human edits (proposed → value), moved cards, current values, workspace inventory, focus, recent turns; bounded to 6000 chars; stored on the user turn and readable via “Was die KI sieht”.
- **Continuity** — human values keyed by object id beside representations; pinned panes are frozen (a new version opens as `id.vN`); unpinned panes keep up to five prior revisions (“Vorherige”); everything persists and is decoded through a schema on boot.
- **Sandboxed HTML artifact** (`artifact.ts`) — `sandbox="allow-scripts"` (opaque origin), MCP-Apps default CSP (`connect-src 'none'` etc.), JSON-RPC 2.0 `ui/notifications/initialized` + `ui/event`, sender bound by `event.source === iframe.contentWindow`, schema-checked, ≤2048 chars, allow-listed event names. Accepted events become pending context, not turns.

Technology reuse decision (sources inspected by a research subagent, see conversation record): naming and boundaries follow foldworks generative-ui (host-owned registry, inert action intents), A2UI (action = name + source component + context; local two-way binding for inputs), AG-UI (snapshot-vs-delta semantics as a future sync target) and MCP Apps (bridge method names, CSP, sender check). None is adopted as a dependency; the nested tree differs from foldworks' flat `elements` graph — a deliberate, reversible simplification.

## Midpoint evaluation (09:50) — self-review, not independent

Evidence: [evidence/cycle-a-midpoint/report.json](evidence/cycle-a-midpoint/report.json), screenshots in [evidence/cycle-a-midpoint/shots](evidence/cycle-a-midpoint/shots), interaction trace [trace.json](evidence/cycle-a-midpoint/trace.json). Acceptance: **28/28 checks pass**, axe-core: 0 violations in empty, architecture, budget and research states. Unit/behaviour tests: 44 pass (27 existing + 17 studio).

| Dimension (weight) | Rating 0–4 | Evidence / limitation |
| --- | --- | --- |
| Visual quality (25) | 3 | Calm, typographic, Mac-like; three scenarios look materially different (diagram + matrix; calculator; evidence synthesis). Gaps: diagram detail text truncates; pin glyph; chips show current rather than historical revision. |
| Bidirectional interaction (25) | 3 | Select → compare / why / investigate / relevance; slider edit → implications; card move → reassessment; artifact event → reply. All typed and logged. Gap: replies are scripted; free text outside the three scenarios is shallow. |
| Generative richness (20) | 2 | 16 primitives, compositions differ by scenario and evolve (Gegenüberstellung, Szenarien, plan Rev. 2, Simulator). But compositions are authored fixtures — no real model chooses them yet. |
| Persistence & continuity (15) | 3 | Reload byte-identical; edits, moved cards, pins, panes, selection survive; pinned pane frozen; revision history. Gap: artifact internal state resets on remount. |
| Usability & accessibility (10) | 3 | axe clean, keyboard-operable objects and resize handle, no overflow at 390/1024/1440, dark mode. Gap: no screen-reader walkthrough; drag-and-drop has arrow-button fallback only on hover/focus. |
| Technical reliability (5) | 4 | typecheck, 44 tests, build, 28 browser checks; refused patches keep the previous view (observed live when an id pattern bug refused the budget patch). |

Weighted: 25·3/4 + 25·3/4 + 20·2/4 + 15·3/4 + 10·3/4 + 5·4/4 = **70/100** (self-assessed).

Mandatory gates: security boundary tested (sandbox self-check, CSP refusal, rogue-frame rejection, host cannot read artifact document); no real data touched; no paid inference. **Open gate:** external supervisor not installed.

**Biggest remaining experience gap:** the workspace is rich inside the three fixtures but cannot yet turn *arbitrary* conversation content into persistent visual objects, and there is no standing “overview” that accumulates what we decided and changed. Cycle B priorities follow from that.

## Cycle B plan (from the midpoint)

1. Promote structure from any assistant reply (tables, lists) into native Blackboard panes — emancipating in-chat visuals into the workspace.
2. A host-derived **Überblick** pane: decisions, human edits, pins, open questions — continuity without a model call.
3. Side-by-side view of a pinned pane next to the focused one (IDE split).
4. Artifact continuity: the host re-initialises an artifact with its last accepted state; artifact-reported size.
5. A model-ready catalogue contract (JSON Schema from the same Effect Schema) so a future authorised route can compose with the identical validator.
6. Visual fixes noted above.

## Commits

| Commit | Content |
| --- | --- |
| `361298b` | Studio: catalogue, director, interaction loop, artifact bridge |
| `f905c79` | Tests, budget recomposition, diagram legibility, source excerpts |
