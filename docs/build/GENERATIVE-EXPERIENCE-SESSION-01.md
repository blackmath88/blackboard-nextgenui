# Generative experience — session 01

Durable checkpoint for the eight-hour Blackboard build session on bruh. Engineering record in English; all new user-facing copy is German.

## Session contract (as executed)

| Field | Value |
| --- | --- |
| Session start (T0) | 2026-11-28 09:07 CET (08:07 UTC) |
| Session end | 2026-11-28 ≈10:25 CET — finished early, objectives met; no new feature in the final stretch |
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

## Cycle B (09:50–10:20) — interactive visual intelligence

Driven by the midpoint gap and by a fresh-context model review of the Cycle A screenshots, which rated visual quality lower than the self-review (2, not 3) and listed eight concrete defects. All eight were addressed.

Built:
- **Promote to Blackboard.** Any table or list in an assistant reply becomes a native, persistent pane with stable ids, plus a chart when a column is numeric. This is the "emancipate in-chat visuals" move (`derive.ts`).
- **Überblick.** A pane the host derives itself: turns, panes, human edits (proposal → now), decisions, open questions and pins. It is recomputed from state, with no model call.
- **Split view.** A pinned pane sits beside the focused one (IDE style). Board width is clamped to the viewport and restored when split closes.
- **Pane rearranging.** Tab drag-and-drop and Alt+←/→. Pane order persists.
- **Live matrix weights.** Criteria weights bind to human-owned assumptions, so editing them re-ranks options locally. "Auswirkungen besprechen" then explains whether the recommendation flips, and the weighting persists into later turns.
- **Learning-plan scenario.** The fourth materially different composition: hours calculator, topic split, timeline, practice board and resources. Plan reassessment now works for any board pane.
- **Artifact continuity.** On re-initialisation the host replays the last accepted artifact state (`ui/notifications/host-context`). The artifact reports its own height (`ui/notifications/size-changed`), bounded to 120–720 px.
- **Model contract** (`catalogue.ts`). The JSON Schema is generated from the same Effect Schema the host decodes with, alongside a German prompt builder and `parseModelReply`.
- **Replay route** (`replay.ts`). Model-format replies for questions the scripted director cannot answer (PostgreSQL vs SQLite, the turn lifecycle, a deliberately invalid iframe representation) travel *only* through `parseModelReply` → `decodePatch`. They are labelled "Wiedergabe · Modellformat" in the UI. They were authored during development and are not output of an application model.
- **Review fixes.**
  - Inline reference chips no longer break text (they are now `span[role=button]`).
  - Consistent de-CH numbers with a Unicode minus.
  - A calmer composition with fewer bordered boxes.
  - A dismissible restore banner.
  - Hover-only secondary actions.
  - Semantic titles for promoted panes.
  - Tab overflow fade.
  - Text at least 12 px.
  - The bridge log is scoped to the current conversation.
  - Persisted drafts.
  - Accessible names for diagram nodes.

## Final evidence

| Check | Result |
| --- | --- |
| `npm run check` | TypeScript clean · **53 tests pass** (27 legacy + 26 studio) · production build |
| Browser acceptance `scripts/studio-acceptance.mjs` (headless Chrome, fresh context, 1440×900 / 390×844 / 1024×768, light + dark) | **46 / 46 pass** — [report.json](evidence/cycle-b-2/report.json), [trace.json](evidence/cycle-b-2/trace.json), [shots](evidence/cycle-b-2/shots) |
| axe-core 4.14.1 | **0 violations** in empty, architecture, budget, research, learning and dark-architecture states |
| Artifact isolation | in-frame probe: storage, host DOM and network blocked; 8 CSP `connect-src 'none'` refusals logged; host cannot read the artifact document (opaque origin); a rogue frame's event is rejected and the pending value is unchanged; unknown events, nested payloads, oversized and malformed messages are rejected (unit tests) |
| Continuity | reload byte-identical; human budget edit, moved card, pins, focus and draft survive; artifact state survives remount and reload |
| Overflow | none at 390, 1024 or 1440 px, nor in split view |

Interaction recordings: video capture needs Playwright's ffmpeg download, which was not fetched. The numbered screenshot sequence in `evidence/cycle-b-2/shots` (00 → 17) is the recording, and `trace.json` holds every typed interaction with the exact context packet each turn received.

### Reproducible chat ↔ workspace loop (manual)

1. Open `http://127.0.0.1:4330/studio.html` and choose **Architektur erkunden**.
2. On *Alternativen*, click options A and B. The tray shows both; nothing is sent.
3. Choose **Vergleichen**. The reply names both, and a *Gegenüberstellung* pane opens. Open **Was die KI sieht** to see the packet.
4. Move the *Mehrbenutzer* weight to 5 and *Nachvollziehbarkeit* and *Schutz menschlicher Änderungen* to 1. The matrix re-ranks immediately.
5. Choose **Auswirkungen besprechen**. The reply says the recommendation flips to CRDT.
6. Reload: weights, panes and focus are intact, and *Überblick* lists your edits.

## Cycle A vs Cycle B

| Aspect | Midpoint (A) | End (B) |
| --- | --- | --- |
| Scenarios | 3 fixture conversations | 4 fixture conversations, plus 3 replayed model-format replies through the model contract |
| Workspace → chat | select, compare, why, investigate, relevance, budget edit, card move, artifact event | plus weight edits that flip recommendations, promote from chat, learning edits |
| Continuity | reload, pins, revisions, human values | plus Überblick, split, reorder, drafts, artifact state replay |
| Model readiness | none | JSON Schema contract, prompt builder, reply parser, refusal shown in the UI |
| Visual | first pass; review found card nesting, chip wrapping, number inconsistencies | review fixes applied; dark mode verified |
| Checks | 44 tests · 28 browser checks · axe clean (4 states) | 53 tests · 45 browser checks · axe clean (6 states) |

## Rubric — final self-assessment (not independent)

| Dimension (weight) | Rating | Evidence / limitation |
| --- | --- | --- |
| Visual quality (25) | 3 | Calm, typographic, consistent in light, dark and phone; distinct forms per question. Still a recognisable shared pane template (title / purpose / Rev.), and the system-map details truncate. |
| Bidirectional interaction (25) | 3 | Every vision example is implemented and tested: click decision → why; select several → compare; change value → recalculate → discuss; select chart item → investigate; move task → reassess; click source → relevance; pin; modify an assumption and keep it across turns. All replies are scripted. |
| Generative richness (20) | 2 | 16 primitives, 4 + 3 materially different compositions, promote from chat, a bespoke HTML artifact. No model chooses compositions live; free text outside the fixtures is shallow. |
| Persistence & continuity (15) | 4 | Stable ids, human-owned values beside representations, frozen pins, revision history, Überblick, split, reorder, drafts, artifact state — all verified across reload. |
| Usability & accessibility (10) | 3 | axe clean in 6 states; keyboard selection, resize and reorder; reduced motion; no overflow. No screen-reader walkthrough; drag-and-drop has keyboard alternatives but no announced feedback. |
| Technical reliability (5) | 4 | 53 tests, 45 browser checks, invalid representations refused in the UI with the last view kept. |

Weighted: 18.75 + 18.75 + 10 + 15 + 7.5 + 5 = **75 / 100** (self-assessed; see the fresh-context review below).

## Fresh-context model reviews (not independent human acceptance)

Two read-only subagents with no prior context reviewed the screenshots against the product vision. They are a different context of the same model family: useful for catching blind spots, but **not independent validation**. Codex was not available on this host (`codex` not installed), so no cross-vendor review was run.

| Review | Visual | Interaction | Richness | Continuity | Usability | Reliability | Weighted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| After Cycle A (09:58) | 2 | 3 | 3 | 3 | 2 | — | not computed |
| After Cycle B (10:18) | 2.5 | 3 | 2.5 | 3.5 | 2.5 | 3 | **70 / 100** |
| Self-assessment (final) | 3 | 3 | 2 | 4 | 3 | 4 | 75 / 100 |

Verdict of the second review (paraphrased): the work sits between a scripted demo and the vision. The persistence, provenance and typed-interaction foundations are real, but replies and most representations are authored fixtures. The single biggest next step is a live model on the existing composition contract.

Defects from the second review, fixed after it (10:18–10:25) and covered by the 46-check run:
- The budget reading text contradicted the state. Callouts now take a generic `showIf` on a derived value, so an *Überzeichnet* or *Reserve knapp* warning replaces stale advice.
- The developer log appeared in screenshots. It is off by default, and the acceptance run now closes it after its one screenshot.
- The simulator chart was weak. It now has a comparison baseline, a chosen-week marker, axis labels and the delta to the baseline.
- The timeline had no legend. A legend now appears when tones or milestones are present.
- The comparison sign was confusing. It now reads "+2 für CRDT-Dokument".
- Promoted pane titles were long. They are now short.

Not addressed, and carried to the next mission:
- The learning plan still reuses the board + timeline form.
- The timeline has no dependency arrows, and its bars don't move with edits.
- Split view narrows the chat to about 440 px at 1440 px.
- There is no tab overflow menu (only an edge fade).
- The Überblick is thin in early turns.


## Mandatory gates

- **Security boundary:** tested as above. Generated HTML gets no credentials, storage, DOM, network or authority, only the allow-listed event names.
- **Data preservation:** no real project data was touched. The original worktrees (`blackboard-source`, `blackboard-foldkit-worktree`, `blackboard-unibas-eval`) and their branches are unchanged. The legacy `pilot/app` verification scripts (which delete `.pilot/`) were not run.
- **Cost:** no application inference and no paid API. Claude plan usage observed at 10:15 CET: 5-hour window 25 %, weekly 65 %, extra usage disabled.
- **Ownership:** one implementation worker (this session) plus two read-only research/review subagents. The dev server on 4330 was stopped at the end of the session; no owned processes remain. Knowledge Lab, TAKT and the other listeners were not touched.
- **Open gate — supervision:** no external watchdog enforced the deadline. The session ended well inside it (≈ 1 h 20 min of the 8 h maximum) because the objectives were met. Future unattended sessions still need the runbook's external supervisor.
- **TAKT reporting:** not used. No verified scoped session-reporting operation was established, and the runbook says not to build one mid-session.

## Known limitations

- All assistant intelligence is scripted (director) or replayed (authored model-format). Real-model composition quality is **unverified**.
- Free-text questions outside the fixtures get a generic answer. The replay table matches by keyword.
- Artifact sandbox relies on `srcdoc` + `sandbox="allow-scripts"` + meta CSP in the same top-level origin. A separate artifact origin (as MCP Apps requires for `allow-same-origin`) would add defence in depth.
- Host-side DOM code could still forge an iframe with a `data-artifact-id` attribute. The threat model covers generated HTML, not host-side script injection.
- The Szenarien table is a snapshot of its turn; it does not live-update when sliders move afterwards (deliberate, but can surprise).
- Diagram layout is a simple layered layout without edge-crossing minimisation; node details truncate.
- No multi-user sync, no server persistence (localStorage only), no undo for pane closing.
- Video recordings not produced (ffmpeg download avoided).
- Pre-existing: `pilot/foldkit-workbench/.gitignore` contains `> node_modules` / `> dist` (with a stray `>`), so build output is tracked. This branch restores `dist/` to its base content; it does not change the `.gitignore`.

## Launch and reproduction

See `pilot/foldkit-workbench/README.md` § Blackboard studio. In short: `npm ci && npm run dev -- --port 4330`, open `/studio.html`; `node scripts/studio-acceptance.mjs` reproduces all evidence into `docs/build/evidence/run`.

## Proposed next mission — session 02: real composition

Goal: replace the director with an **authorised model route**, keeping every boundary.

1. Obtain an explicit, budgeted model route for application inference: a provider, a spend cap and data-handling approval.
2. Wire `catalogPrompt` + `parseModelReply` into a Command with streaming (the existing NDJSON path in `chat-stream.ts`). Keep the director as the offline fallback.
3. Evaluate the same four scenarios plus five unseen questions on these measures:
   - schema acceptance rate;
   - representation fit (blind-rated against the fixtures);
   - human-edit preservation (does the model respect `humanEdits`?);
   - latency and tokens per turn.
4. Serve artifacts from a separate origin and add a model-generated artifact path with the same bridge.
5. Add an external deadline supervisor before any unattended run.

## Commits

| Commit | Content |
| --- | --- |
| `361298b` | Studio: catalogue, director, interaction loop, artifact bridge |
| `f905c79` | Tests, budget recomposition, diagram legibility, source excerpts |
| `768a5c8` | Cycle A midpoint: acceptance script, accessibility fixes, evidence, this record |
| `fe3ea03` | Promote to Blackboard, Überblick, split view, artifact state and size |
| `3e7e3f9` | Model contract, Cycle B tests and acceptance |
| `1341ebf` | Live matrix weights, learning-plan scenario, review fixes |
| `3c484a9` | Replay route through the model contract, generic weight explanations |
| `90bb7a4` | Pane reordering, persisted drafts, legibility, accessible diagram names, dark mode |
| `37442a3` | Review fixes (state-aware callouts, simulator baseline, timeline legend), final evidence, this record |

Draft PR: https://github.com/blackmath88/blackboard-nextgenui/pull/18 (not merged, not deployed).
