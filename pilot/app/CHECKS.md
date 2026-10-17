# CHECKS

# P0 Skeleton

All checks ran against `dev/fake-model.js` (two instances, ports 5701 and 5702) with
`PILOT_CONFIG=pilot.config.dev.json`. No real model endpoint was contacted. Node v25.9.0 locally;
requires Node >= 20.3 (`AbortSignal.any`; also `fetch`, `AbortSignal.timeout`).

Reproduce everything with `bash pilot/app/dev/verify-p0.sh` (wipes `.pilot/` first).

## Done when

- [x] **A message and its reply appear in `transcript.jsonl`.**
  `curl -N -X POST localhost:4747/chat -d '{"text":"First message: hello pilot"}'` streams the reply;
  afterwards `.pilot/transcript.jsonl` holds a `user` line (`model: null`) and an `assistant` line
  (`model: "frontier"`, text starting `[fake:frontier]`), each `{id, ts, role, text, model}`.
  The second turn's reply says "3 messages in context", so history goes to the model.
  Streaming is real: time to first byte 0.09 s, total 0.91 s (`curl -w "%{time_starttransfer} %{time_total}"`).
- [x] **Restart the server and reload: the full conversation is back.**
  After two turns the server was killed and restarted; `curl localhost:4747/state` returned
  `total 4` with all four lines in order. The page renders exclusively from `GET /state` on load,
  so a reload shows the same lines. Verified in a real browser engine: headless Chrome
  (`--headless=new --virtual-time-budget=3000 --dump-dom http://127.0.0.1:4747/`) rendered 2 `.ln`
  lines (user + assistant) before the restart and the same 2 after it. (`/state` returns the last 500 lines; the page says
  "showing last N of M" if the transcript is longer.)
- [~] **The browser network tab shows no call to any model endpoint.** Argued from code;
  **the coordinator verifies this in a browser.**
  `public/app.js` makes exactly two requests, both same-origin and relative: `fetch('/state')` and
  `fetch('/chat')`. `grep -rnE "https?://" public/` finds nothing (no CDN fonts either; system
  monospace fallback). Model URLs and keys live only in the server's config and env, and `/state`
  returns only transcript lines. Static serving is limited to `public/` (traversal requests
  `/../server.js` and `/%2e%2e/pilot.config.json` both return 404).

## Extra checks

- Running `node pilot/app/server.js` from the repo root still writes to `pilot/app/.pilot/`; nothing
  appears at the repo root.
- Atomic writes: after each run `.pilot/` contains only `transcript.jsonl`, with no temp files left.
  Writes are serialized through one promise chain.
- Fake endpoint down: the transcript gets the user line plus `system: "chat failed: fetch failed"`,
  and the error is streamed to the page.
- Client disconnect mid-stream (`curl -m 0.3`): the partial assistant text is kept as an `assistant`
  line, followed by `system: "chat failed: This operation was aborted"`. The upstream request is aborted.
- Default config with `OPENAI_API_KEY` unset (P0 behaviour): no network request; the transcript got
  `system: chat failed: environment variable OPENAI_API_KEY is not set for candidate "frontier"`.
  **Superseded by P1:** with policy `fallback` a missing key now counts as a failed attempt and the
  next candidate (`morrow`, a real host in the placeholder config) is tried. Checks therefore never
  run the default config any more.
- `fake-model.js` non-streaming (`stream` absent) returns a `chat.completion` JSON; streaming returns
  `chat.completion.chunk` SSE lines ending with `data: [DONE]`.
- ~~Not exercised in a browser: typing and streaming~~ (since P1 `dev/browser-check.js` types into
  the real page in headless Chrome).
- `node --check` passes on all JS files; `server.js` does not reference `dev/`.

## Deviations from the brief

1. **Location:** the brief's `cli-pilot/` tree lives at `pilot/app/`.
2. **`PILOT_CONFIG=<path>` env override** (resolved relative to `pilot/app/`, default
   `pilot.config.json`) so dev runs can use `pilot.config.dev.json`.
3. **Dev-only files:** `dev/fake-model.js`, `dev/verify-p0.sh`, `pilot.config.dev.json`. The normal
   start path (`node server.js`) never references them.
4. The server binds to `127.0.0.1`, not all interfaces.

## Deferred (by design, later steps)

- ~~P0 uses only `roles.chat.candidates[0]`~~ (done in P1).
- ~~`rules.json` is not seeded into `.pilot/` yet~~ (done in P2).
- `rev` is not tracked for the transcript yet (P4); appends are atomic full rewrites.
- No `/events`, SSE to the browser, `fs.watch`, extraction or proposals.
- `pixel.js` is copied from the workbench; one sprite (`teletype`) is used as the title-bar icon.

# P1 Roles and commands

Scripted: `bash pilot/app/dev/verify-p1.sh` (curl, 19 checks) and `node pilot/app/dev/browser-check.js p1`
(headless Chrome via the DevTools protocol, needs Node 22+ and Chrome). Both start their own fakes and
server with the dev config and wipe `.pilot/` first. Last run: all passed.

## Done when

- [x] **`/model chat morrow` switches the chat model; the next assistant line records it.**
  `POST /command {"text":"/model chat morrow"}`, then a chat turn: the assistant line has
  `model: "morrow"` *and* text starting `[fake:morrow]` (so the morrow endpoint really answered, not
  just the label). A `system` line "model for chat switched to morrow" and a `model_switch` metric
  are written. In the browser: typing `/model chat morrow` and then a message renders the reply with
  model tag `morrow`.
- [x] **With policy `fallback`, stopping the first endpoint makes the second answer; `metrics.jsonl`
  logs it.** The frontier fake was killed; the next reply came from `[fake:morrow]` and
  `metrics.jsonl` got `model_call {candidate: frontier, ok: false, error: "fetch failed"}`,
  `fallback {from: frontier, to: morrow}`, `model_call {candidate: morrow, ok: true, latencyMs}`.
  Also verified: HTTP 500 from frontier (`fake-model.js --status=500`) and a timeout
  (`--delay=5000` with a temp config `timeoutMs: 1000`; fell back after about 1 s, error
  "no reply within 1000 ms"). With policy `manual` the same failure becomes a `system` line and
  morrow is not tried.
- [x] **The status bar always shows the active model per role.** Headless Chrome read the status bar:
  on load `chat: frontier · extract: morrow · title: none`; after `/model chat morrow` it shows
  `chat: morrow`; after a fallback `chat: frontier→morrow` (configured choice → candidate that
  answered last); after a server restart the persisted choice. It refreshes after every turn and
  every command (no push yet, that is P4). Hover shows policy and candidates per role.

## Other P1 checks

- **`net::ERR_ABORTED` on `POST /chat` (coordinator report): fixed.** Reproduced in headless Chrome:
  the reply was complete and saved, but DevTools logged the request as canceled. Isolated with a
  minimal server: Chrome reports `ERR_ABORTED` whenever a chunked response with
  `cache-control: no-store` is read through `response.body.getReader()`; `res.text()` or
  `no-cache` do not. The wire was clean (`curl --raw` shows the terminating `0` chunk). `/chat` now
  sends `cache-control: no-cache`; `browser-check.js` asserts the request finishes without failure.
- Commands never reach a model and are not stored as `user` lines; their output is shown locally
  in the page only. `/model` without arguments lists roles, policies and candidates. Unknown
  roles, candidates or commands return `400 {ok: false}`.
- The browser made no request outside `http://127.0.0.1:4747/` and threw no page errors (`browser-check.js`).

## Decisions

- **A `/model` choice persists across restarts**, in `.pilot/roles.json` (`{rev, active: {role: name}}`).
  Reason: concept day 5 switches to morrow *because the topic got private*; silently reverting to
  frontier on restart would send private text to the wrong model. A saved name that no longer exists
  in the config is ignored (the first candidate is used).
- **Fallback order:** the active candidate first, then the others in config order.
- **Fallback only before the first streamed delta.** If a candidate fails mid-reply, the partial text
  is kept as an `assistant` line plus a `system` line; a reply never mixes two models.
- **`timeoutMs` bounds the wait for the first delta**, not the whole reply, so a long healthy reply
  from a slow local model is not cut off.
- A missing `keyEnv` variable or an HTTP error counts as a failed attempt (falls back under `fallback`).
- The status bar's `a→b` marks "configured a, last answered by b" since server start (in memory).

## Deviations

1. New file `.pilot/roles.json` for persisted `/model` choices (not in the architecture's file table;
   `modules.json`/`state.json` have closed schemas so it cannot live there).
2. `dev/fake-model.js` gained `--delay=<ms>` and `--status=<code>`; new dev-only `dev/verify-p1.sh`
   and `dev/browser-check.js`.

## Deferred

- ~~`/rules` and `/panes` come with P2~~ (done). The `extract` role is configured and shown, but not called until P3.

# P2 Growth

Scripted: `bash pilot/app/dev/verify-p2.sh` (curl, 25 checks) and `node pilot/app/dev/browser-check.js p2`
(headless Chrome, 16 checks). Both wipe `.pilot/` and use the dev config. Last run: all passed;
`verify-p0.sh` and `verify-p1.sh` still pass on the P2 code.

## Done when

- [x] **At the message threshold, the controller asks exactly once.** With the index threshold set to 4,
  the 4th message (2 turns) produces one `controller` line ("4 messages. Scrolling back gets slow. Add
  an index pane?", `{n}` filled in) and `modules.json.pending = "index"`. Two more turns, a server
  restart and another turn: still exactly one controller line for `index`. Two `POST /chat` fired in
  parallel across the threshold also produce exactly one question (controller runs inside the same
  serialized write chain as the transcript).
- [x] **`y` adds the index; `x` (never) survives a server restart and is never asked again.**
  Browser: pressing `y` in the empty input adds the index pane (`bench n1` → `bench n2`), the keystroke
  is not typed into the input, and `modules.json` records `answers.index = {answer: "yes", at, count}`
  plus `panes[0] = {module: "index", addedAt, atCount}`. curl: after `POST /answer {module: "index",
  answer: "x"}` and a restart, five more turns (20 messages, more than twice the threshold) bring no new
  question; `/state` shows no pane and nothing pending.
- [x] **Editing a threshold in `rules.json` takes effect on the next turn without restart.** Start with
  the seeded threshold 12, one turn (2 messages, no question), edit `.pilot/rules.json` to 4 while the
  server runs, next turn asks. The controller reads `rules.json` on every turn.
- [x] **Clicking an index entry scrolls the chat to that message.** Browser: after 8 turns the first
  user line lies outside the log pane's bounding rect; clicking index entry 01 brings it inside the
  rect and highlights it (`flash`).

## Other P2 checks

- `rules.json` is seeded verbatim from `rules.example.json` on first run (`cmp`); never overwritten.
- `n` (no): asked at 4 messages, answered `n`; no question at 6; asked again at 8 (count doubled).
- `a` (always): pane added. If the pane is later removed from `modules.json` by hand, the next turn
  re-adds it without asking and writes a controller line "… Added the index pane (you said always)".
- No pane without a recorded answer: a `map` pane added to `modules.json.panes` by hand without an
  answer is not returned by `/state` and not shown.
- Malformed `rules.json`: the turn still completes; the controller is skipped and `controller_error`
  is logged to `metrics.jsonl`. `/rules` reports the parse error.
- `POST /answer` with nothing pending → 409; with an unknown answer → 400.
- Every `modules.json` write bumps `rev`. Metrics: `controller_ask`, `consent`, `controller_add`.
- Layouts: with `map` and `kanban` added by hand (with answers), the page uses the `n3` and `n4`
  templates; in `n4` chat is on the left and the three side panes stack on the right (bounding rects
  checked at 1280×800). Below 800 px width the panes stack vertically.
- View Transitions: adding the index called `document.startViewTransition` once; with
  `prefers-reduced-motion: reduce` emulated, the n3/n4 swaps happened without a transition (instant).
  The initial page load never animates.
- Visual check: screenshots of the pending question and of the 2-pane layout looked as intended.

## Decisions

- **Consent keys follow the spec**, which overrides the coordinator's suggested "a = ask later":
  `02-architecture.md` and `modules.schema.json` define `[y] yes [n] no [a] always [x] never`.
  - `yes`: add the pane now. If it is later removed by hand, the controller may ask again.
  - `no`: ask again once the count reaches twice the count at the time of the answer (`afterNo`).
  - `always`: add the pane now; if it is ever missing again, re-add without asking.
  - `never`: the rule is silenced permanently.
- **Key handling:** while a question is pending, a single lowercase `y`/`n`/`a`/`x` typed into the
  *empty* input answers it (the placeholder says so). Any other first character types normally, an
  uppercase letter types normally, and the four buttons on the question can be clicked instead.
  Trade-off: a message starting with lowercase "y", "n", "a" or "x" cannot be typed while a question is
  pending without first typing something else.
- **One question at a time:** while `pending` is set, the controller asks nothing else.
- **Only `index` is evaluated** (`BUILT = ['index']`); `decisions`, `tasks` and `sources` counts are 0
  until P3. `messages` counts `user` and `assistant` lines only (not system, controller or commands).
- The answer is also written as a short `system` line ("index: yes, pane added") so the transcript
  reads as a complete record.
- `map` and `kanban` panes render a placeholder ("Arrives in P3") if they are ever shown by hand edit.

## Deviations

1. `pilot/app/rules.example.json` is a verbatim copy of `schemas/rules.example.json`, used to seed
   `.pilot/rules.json` (the spec path is outside the repo).
2. Controller lines in `transcript.jsonl` carry an extra `module` field (`{id, ts, role, text, model,
   module}`) so the page can attach the y/n/a/x keys to the right question.
3. New dev-only `dev/verify-p2.sh`; `dev/browser-check.js` gained the `p2` scenario.
4. `/rules` and `/panes` are implemented now (they belong to the brief's command list).

## Deferred

- `rev` checks on writes (stale `rev` rejected) and live updates of hand edits are P4; today a hand
  edit shows up on the next page reload, turn or command.
- Reasoning map and kanban content, decision/task/source counts: P3.

# Open questions and known limits (after P2)

- **Privacy vs. fallback.** After `/model chat morrow` under policy `fallback`, a morrow outage sends
  the (private) text on to frontier: the concept's day-5 case. Persisting the choice does not help
  here. Options: an explicit `/model` pins the role (no fallback until switched back), or a
  per-candidate "never fall back to" list. Not changed yet; needs a decision.
- No stall timeout after the first token: an endpoint that hangs mid-stream keeps the request open.
- `transcript.jsonl` and `metrics.jsonl` are rewritten in full on every append to keep writes atomic;
  fine for a pilot, worth revisiting in P4 if a dogfood week makes the files large.
- While a question is pending, a message cannot start with lowercase y/n/a/x (see P2 decisions).
- `dev/browser-check.js` needs Node 22+ (global `WebSocket`) and Google Chrome; the app needs Node 20.3+.
