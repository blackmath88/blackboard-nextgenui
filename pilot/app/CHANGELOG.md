# CHANGELOG

P0 to P2 (skeleton, model roles, growth controller with consent and the index pane) are the pre-iteration
baseline, merged before the numbered iterations started; see `CHECKS.md` (# P0, # P1, # P2). Iterations are
tagged `pilot-v0.N` by the coordinator; each one is runnable with `npm run demo -- v0.N`.

## pilot-v0.6

Authorship and metrics, `/stats`. Still untested with a real model (fakes only).

**Adds**
- **Every line says who wrote it:** `you` (peach), `model` + the model name (sky), `controller` (lavender, next to its
  sprite), `system`. Each line also carries `data-author` and a tooltip "authored by …".
- **Every card says its author and who decided it.** Format: `dec-1 · model · morrow · confirmed · confirmed by you
  10-14 09:06`. Hand edits read "you (file edit)":
  - `confirmed by you (file edit)`: the status was changed in the file.
  - `edited by you (file edit): column`: other fields were changed in the file.
  - `task-7 · you (file edit)`: an item added in the file.
- The `proposed` tag on a card is now neutral (it used the controller's lavender pair). Times on cards and pane bars are
  local, with the ISO timestamp as tooltip.
- **Every pane bar says which rule and which answer:** `controller · messages ≥ 12 · you: yes 10-15 14:14`. An answer
  that was written into `modules.json` by hand (no matching consent event) reads `you (file edit): yes`.
- **How a hand edit is detected (write ledger):** whenever the server creates an item (extraction) or decides one
  (`POST /answer`), it appends an `item_write` event with a full copy of the item to `metrics.jsonl`.
  - An item in `state.json` that differs from its last copy was changed by hand. The differing fields are shown as
    "you (file edit)".
  - This works for edits made while the server was down. `state.json` itself gets no extra field.
  - A later server write keeps earlier hand edits attributed (`handFields`, `addedByFile`).
  - An item with no ledger entry (older data, the v0.4/v0.5 fixtures) shows its declared `author`. A `user` item can
    only come from the file, so it always reads "you (file edit)".
  - On every `state.json` change the watcher also logs `file_edit {itemId, fields}`.
- **P5 events in `metrics.jsonl`** (still append-only):
  - `server_start` with counts (lines, messages, items, panes, answers).
  - `turn` with lines and messages after each chat turn.
  - `consent` now has an `id`, which is stored as `answers.<module>.consentId`.
  - `controller_add {module, answer, answerRef}` on both paths. Before, only `always` logged an add; a `yes` that
    added a pane logged none.
  - `index_jump` from the page via `POST /metric`. Only this event is accepted, and only with an existing message id.
  - `item_write` and `file_edit` (described above).
  - Pane entries in `modules.json` now record their `rule {metric, threshold}`.
- **`/stats`** (and `npm run stats -- <pilotDir>`, same lines) prints the five P5 measures with their thresholds from
  `04-build-plan.md`, PASS or NOT YET, and the numbers behind each. They are computed in `stats.js` from
  `metrics.jsonl` and the files only: no model, no writes. Fixture data is labelled ("FIXTURE DATA: n of m …").
- **Demo `v0.6`:** three synthetic days (made by `dev/make-fixture-v06.js`, every line `"fixture": true`).
  - All three panes are present.
  - Items come from the model, from you via the page, and from file edits.
  - `/stats` shows 3 PASS and 2 NOT YET. Three index clicks turn Usefulness into PASS.
- **Dev:**
  - `browser-check.js v06`.
  - `contrast-check.js` checks the author chips on the pane bar.
  - `demo.js` fills `{app}` and `{rel}` in try lines.

**Why**
- 01-concept "every frame says whose it is" and authority rule 4. The v0.5 coordinator run found that a status
  changed by hand still rendered as the model's.
- P5 of the build plan is read from `metrics.jsonl`. Before v0.6 the file could not answer continuity, consent (for
  `yes` answers), usefulness or quiet.

**Deliberately does not**
- No authorship for hand edits of `transcript.jsonl` lines. Items and pane answers only.
- No signature field in `state.json`. Deleting or editing `metrics.jsonl` removes the evidence, and items then show
  their declared author.
- A hand-made item that claims `author: model` is not flagged when nothing in the ledger contradicts it.
- "You never re-explained the project" and the kill criterion are not measured; `/stats` says so.
- No minimum sample for Signal (1 decided proposal can PASS). Thresholds are not configurable: they are the build
  plan's, hard-coded with their wording in `stats.js`.
- No charts; `/stats` is text.

## pilot-v0.5

Live files (P4), and `c`/`r` only on a focused proposal. Still untested with a real model (fakes only).

**Adds**
- **Watcher:** `fs.watch` on the data folder (works for `PILOT_DIR`), 150 ms debounce. Any watch event re-stats every
  file in the folder (mtime, size, inode) and pushes one event per changed file, because macOS coalesces events and
  editors save by rename. The server's own temp files and other dotfiles are ignored. Watch errors are logged and the
  watch restarts; nothing in the watch path can crash the server.
- **`GET /events` (SSE, D7):** `hello {revs, extracting}`, then `change {file, rev[, error]}` for every change (own
  writes and hand edits) and `status {extracting}` when background extraction starts or ends (an extraction that
  writes nothing changes only `metrics.jsonl`). `retry: 1000`, a comment every 15 s.
- **rev:** JSON files carry `rev`, bumped on every server write (`state.json`, `modules.json`, `roles.json`;
  `rules.json` is only seeded). JSONL files: rev = number of non-empty lines.
- **Stale writes:** `/answer` takes an optional `rev` (consent: `modules.json`, confirm/reject: `state.json`). If it is
  stale the server answers 409 `{stale: true, file, rev}` and writes nothing. The page then reloads state and shows a
  short notice. A request without `rev` is accepted (curl, older checks).
- **Last good version:** a hand edit of `state.json`, `modules.json` or `roles.json` that is not valid JSON never
  crashes the server. `/state` serves the last good version with `fileErrors`, and the page says "file X is not valid
  JSON, showing last good version" until the file is fixed. The server writes none of these files while they are
  broken: the controller skips (`controller_error`), answers and decisions get 409. A broken `roles.json` keeps its
  last good pins.
- **Page:**
  - EventSource on `/events`. Reloads only the changed part (`GET /state?only=<files>`) and re-renders only areas whose
    content changed.
  - Per-part request generations, so an older response never overwrites a newer one.
  - File events are held back while this tab streams a reply.
  - Full reload after a reconnect.
  - Fallback without SSE: refresh after each action and polling during an extraction, as in v0.4.
  - Meta shows `ready · live` when connected.
- **`c`/`r` only on a focused proposal card:**
  - They never act from the chat input, empty or not.
  - ↓/↑ in the empty input moves focus to the newest proposal; Tab and click work too.
  - Only the focused card is outlined. After a decision, focus stays in the pane; Escape returns to the input.
  - y/n/a/x keep the v0.3 rule (empty input). Buttons unchanged.
- **Demo `v0.5`:** two tabs, a printed hand-edit one-liner and a break/repair one-liner. `demo.js` fills `{url}` and
  `{dir}` in try lines. The v0.4 demo's try lines now describe the new keys.
- **Dev:** `dev/sse-probe.js` (SSE client for verify), `browser-check.js v05` (second tab via CDP).

**Why**
- P4 of the build plan: hand edits appear by themselves, two tabs stay honest, and a write based on an old view is
  refused instead of silently winning.
- `c`/`r`: in v0.4 a message starting with c or r decided a proposal on the first keystroke. Models only propose; the
  person decides on purpose.

**Deliberately does not**
- No conflict detection for hand edits that keep `rev` (they are pushed and shown, but a page write based on the
  older view still goes through). No merge: one person, last valid write wins.
- No View Transition on live re-renders (pane add/remove still uses one; a content refresh is instant).
- No push for `/chat` streaming to other tabs: they see the user line, then the finished reply.
- No undo for decisions. y/n/a/x still answer from the empty input, also for a question that arrived by push (see
  QUESTIONS.md).

## pilot-v0.4

Proposals (P3). **Untested with a real model:** Morrow was not reachable, so extraction ran only against the fake
extractor in `dev/fake-model.js`.

**Adds**
- **Role `extract`** after each complete reply, in the background (queued, one run at a time, never awaited by
  `/chat`), every `everyNTurns` replies. Input: last user + assistant message + existing item titles. The closed
  `schemas/extraction.schema.json` goes along as `response_format` when the candidate has `structured: true`.
  Same rules as chat: pins, local→cloud block, stall timeout.
- **Validation, fail closed:** small hand validator (no Ajv). Malformed or schema-invalid output (including more
  than 3 items) writes nothing and logs `extract_error`. Per item: `quote` must occur in the turn (whitespace and
  case ignored), near-duplicates of non-rejected items and of the same batch are dropped (word-set Jaccard ≥ 0.75
  after stopwords, or the same url), at most `maxItems` kept; each drop is logged as `extract_drop`.
- **`.pilot/state.json`** (atomic, `rev` bumped): `status: proposed`, `author: model`, `model`, `quote`,
  `fromMessage`, ids `dec-N`/`task-N`/`src-N` (max + 1, so hand-added ids never collide). Hand edits keep every
  unknown field; a broken file is reported (`/state.stateError`) and never overwritten.
- **Panes:** reasoning map (decisions as a chain, then sources) and kanban (tasks in todo/doing/done), grown only through the
  controller and consent (`map`/`kanban` rules now count proposed + confirmed items, not rejected ones). Proposed =
  dashed lavender with "model · <name>"; confirmed = mint; rejected = rose, hidden behind a pane-bar toggle;
  hand-added (`author: user`) = solid with "you".
- **Confirm/reject:** `c` / `r` on a focused card, or in the empty chat input on the outlined proposal (the newest;
  arrows move it), plus buttons. `POST /answer {itemId, decision}` records `decidedAt` and `decidedBy: "user"`
  (schema extension in `pilot/app/schemas/state.schema.json`), a system line and a `decide` metric.
- **Fake extractor:** `--extract=good|malformed|badquote|many|dupes`, `--extract-delay=<ms>`.
- The page polls `/state` while an extraction runs, so proposals and a resulting question appear without reload.
- Fix: a consent answer now stores the count of the rule's own metric (decisions/tasks), so "no" waits for that
  count to double (it stored the message count, which was only right for the index).

**Why**
- P3 of the build plan: models only ever propose; the user decides, and every item says who authored it.

**Deliberately does not**
- No real model test (Morrow unreachable), no live file watching or SSE (v0.5; hand edits show on the next state
  load), no moving tasks between columns in the page (edit `column` by hand), no undo of a decision.
- No cap-and-keep for a response with more than 3 items: the closed schema says at most 3, so it is rejected whole
  (see QUESTIONS.md).
- No extraction after a failed or stalled reply.

## pilot-v0.3

Hardening, pastel palette, iteration infrastructure.

**Adds**
- **Explicit `/model` pins the role.** `/model chat morrow` means no fallback until `/model chat auto`, which
  returns the role to its policy starting at the first candidate. Pins persist in `.pilot/roles.json`; the status
  bar shows `chat: morrow (pinned)`. A pinned failure becomes a system line.
- **`local: true|false` per candidate** (example and dev config: frontier false, morrow true). After a local
  candidate failed, fallback never goes to a non-local one unless the role sets `allowCloudFallback: true`;
  missing `local` counts as non-local. Each block is logged (`fallback_blocked`) and shown as a system line
  "fallback to frontier blocked: morrow is local".
- **Stall timeout** `stallMs` (default 20000): once a reply has started, no new token for that long aborts it,
  keeps the partial text as an assistant line, adds a system line, logs a `stall` metric. Never falls back.
  `dev/fake-model.js --stall-after=<n>`.
- **Consent keys only on an empty input** (P2 already did this; now regression-tested in the browser, plus guards
  for IME composition and key repeat). Buttons always work, also with text in the input.
- **Pastel palette** in the pixel-terminal style, defined once as CSS custom properties; sprites use them too.
  Light variant via `prefers-color-scheme: light` and `/theme light|dark|auto` (page-only, kept in localStorage).
  `dev/contrast-check.js` checks every text/background pair (WCAG AA) in both modes.
- **Infrastructure:** `package.json` (scripts only), `npm run demo -- <version>` (`scripts/demo.js`, seeds a
  throwaway `.pilot-demo/` from `demo/fixtures/<version>/`), `npm run verify` (`scripts/verify-all.sh`),
  `scripts/try.sh <tag>`, `PILOT_DIR` env override, `ITERATIONS.md`, `QUESTIONS.md`, this file.

**Why**
- Pins: the concept's day-5 case. Switching to morrow because the topic got private must not silently send the
  text to frontier when morrow is down (open question after P2).
- Stall: an endpoint that hung mid-stream kept the request open forever.
- Palette: the amber/brown look is replaced by a calmer pastel one that also works in light mode and passes AA.
- Infrastructure: every later iteration must be runnable and checkable in 30 s by the coordinator.

**Deliberately does not**
- No per-candidate "never fall back to" lists; one `local` flag and one role-level `allowCloudFallback` only.
- No fallback after a stall, and no retry: a reply never mixes two models.
- No proposals, extraction or live file updates (v0.4, v0.5). The `.proposal` style exists but is unused.
- No change to the explainers or to anything outside `pilot/app/` except the "Pilot iterations" list in the
  root `index.html`.
