# CHANGELOG

P0 to P2 (skeleton, model roles, growth controller with consent and the index pane) are the pre-iteration
baseline, merged before the numbered iterations started; see `CHECKS.md` (# P0, # P1, # P2). Iterations are
tagged `pilot-v0.N` by the coordinator; each one is runnable with `npm run demo -- v0.N`.

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
- **Panes:** reasoning map (decisions, sources) and kanban (tasks in todo/doing/done), grown only through the
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
