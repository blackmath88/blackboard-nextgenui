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

Scripted: `bash pilot/app/dev/verify-p1.sh` (curl, 17 checks) and `node pilot/app/dev/browser-check.js p1`
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

Scripted: `bash pilot/app/dev/verify-p2.sh` (curl, 24 checks) and `node pilot/app/dev/browser-check.js p2`
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

- ~~**Privacy vs. fallback.**~~ (decided and built in pilot-v0.3: explicit `/model` pins; local candidates never fall back to cloud.) After `/model chat morrow` under policy `fallback`, a morrow outage sends
  the (private) text on to frontier: the concept's day-5 case. Persisting the choice does not help
  here. Options: an explicit `/model` pins the role (no fallback until switched back), or a
  per-candidate "never fall back to" list. Not changed yet; needs a decision.
- ~~No stall timeout after the first token~~ (pilot-v0.3: `stallMs`).
- `transcript.jsonl` and `metrics.jsonl` are rewritten in full on every append to keep writes atomic;
  fine for a pilot, worth revisiting in P4 if a dogfood week makes the files large.
- While a question is pending, a message cannot start with lowercase y/n/a/x (see P2 decisions).
- `dev/browser-check.js` needs Node 22+ (global `WebSocket`) and Google Chrome; the app needs Node 20.3+.

# pilot-v0.3

Hardening (pins, local-only fallback, stall timeout, empty-input consent keys), pastel palette, iteration
infrastructure. Everything runs against `dev/fake-model.js`; no real model endpoint was contacted.

**Reproduce:** `bash pilot/app/dev/verify-v0.3.sh` (32 checks; one of them runs the 19 browser checks of `browser-check.js v03`, another `contrast-check.js` with 36 PASS lines; ends with
`ALL v0.3 CHECKS PASSED`, exits non-zero on failure). It uses its own ports (server 4760, fakes 5761/5762; browser
part 4765/5766/5767 and Chrome 9343; demo part 4950/5951/5952) and its own throwaway dirs (`.pilot-verify-v03/`,
`.pilot-verify-v03b/`, `.pilot-demo-verify/`), so it never touches `.pilot/` or a running demo.
**Everything:** `cd pilot/app && npm run verify` runs p0, p1, p2, v0.3 and `browser-check.js all` (p1, p2) and
prints a summary ending `ALL VERIFY SCRIPTS PASSED` (refuses to start while a `.pilot/` exists, see QUESTIONS.md).
Last run (Node v25.9.0, Chrome, macOS): all passed.

## Checks

| # | Check | How (in `verify-v0.3.sh` unless noted) |
|---|---|---|
| 1 | **Pin blocks fallback.** `/model chat morrow` answers "pinned"; `/state` has `models.chat.pinned: true`; `roles.json.active.chat = morrow`; survives a restart. With morrow down, the turn ends in `system: chat failed: morrow: … (chat is pinned to morrow, no fallback; /model chat auto unpins)`; no `fallback` metric, frontier never called. | section 1 |
| 2 | **`/model chat auto` restores the policy** from the first candidate (`active: frontier, pinned: false`); with frontier down, morrow answers and `fallback frontier→morrow` is logged. This is also the **cloud→local allowed** check. | section 2 |
| 3 | **Local→cloud blocked without the flag.** Temp config with chat order [morrow (local), frontier]; morrow down: system line `fallback to frontier blocked: morrow is local` (`kind: blocked`), metric `fallback_blocked {from: morrow, to: frontier}`, frontier never called, the turn ends in `chat failed: morrow`. Same with `local` deleted from frontier (**missing `local` = non-local**). | section 3 |
| 4 | **Local→cloud allowed with `allowCloudFallback: true`** on the role: frontier answers, `fallback morrow→frontier` logged, nothing blocked. | section 4 |
| 5 | **Stall after the first token** (temp config `stallMs: 1000`, `fake-model.js --stall-after=3`): the request ends after about 1.2 s (asserted 1.0–2.5 s), the 3 streamed tokens are kept as an `assistant` line (model frontier), then `system: reply stalled: frontier: no new token for 1000 ms; kept the partial reply, no fallback` (`kind: stall`), metric `stall {candidate, stallMs: 1000, chars}`; no fallback, morrow never called. A steady reply (40 ms/token, ~1.5 s total) under the same `stallMs` is not cut. | section 5 |
| 6 | **Consent key with non-empty input stays text** (headless Chrome, `node dev/browser-check.js v03`): with the question pending, `hello ` + keys y n a x gives `hello ynax`, no `POST /answer`, still pending; a lone space also counts as non-empty; in the empty input `n` answers (`modules.json` answer no); asked again at 8 messages, then the **button works while the input holds `my draft`** and the draft stays. | section 6 |
| 7 | **Status bar pin** (browser): `chat: frontier` → `/model chat morrow` → `chat: morrow (pinned)` → `/model chat auto` → `chat: frontier` (no "pinned"). | section 6 |
| 8 | **Palette from CSS variables** (browser): dark page background `#1e1f2b`, status bar lavender; the first brand sprite pixel has `fill="var(--px-d)"` and resolves to `#9a97b0` in dark and to lavender in light; with `prefers-color-scheme: light` emulated the page is `#f4f5fa`; `/theme dark` overrides it, `/theme auto` follows the OS again; `/theme` never reaches the server. | section 6 |
| 9 | **Contrast passes** (`node dev/contrast-check.js`): parses the token blocks from `public/style.css`, checks 15 text/background pairs per mode (30) at ≥ 4.5:1, that both light blocks are identical, that no pastel is a text colour in light mode, and that no colour literal exists outside the token blocks (also not in `app.js`, `pixel.js`, `index.html`). Lowest ratios: dark `--muted` on panel 5.15:1, light controller label ink on lavender 6.87:1. | section 7 |
| 10 | **Demo starts and serves `/state` within 30 s** (`DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR=.pilot-demo-verify node scripts/demo.js v0.3`): up in < 1 s; state has chat pinned to morrow, index pending, ≥ 10 seeded lines; URL and "try this" printed; SIGINT leaves no process on its ports; unknown version lists `v0.3` and exits 2. | section 8 |
| 11 | **Old checks still pass:** `verify-p0.sh`, `verify-p1.sh` (17), `verify-p2.sh` (24), `browser-check.js all` (p1 + p2). | `npm run verify` |

Done by hand (coordinator may repeat): the demo toggle. Under a pty, `m` + Enter stopped the morrow fake; a pinned
message then ended in `chat failed: morrow: fetch failed (chat is pinned…)`; after `/model chat auto` the next one
produced `fallback to frontier blocked: morrow is local`; `m` + Enter again brought morrow back and it answered.
Screenshots of the page in dark and light mode looked as intended (labels as ink on pastel fills in light mode).
`scripts/try.sh`: the unknown-tag and no-argument paths print the available `pilot-v*` tags (none yet) and exit 2;
the positive path was run with `TRY_REF=<commit>` (no tags exist yet; the coordinator tags).

## Adapted assertions in earlier checks (deliberate behaviour changes)

- `dev/verify-p1.sh`, before "fallback: frontier stopped": `cmd "/model chat frontier"` → `cmd "/model chat auto"`.
  Reason: decision A1, `/model chat frontier` now pins frontier, so the following fallback check could never
  see morrow answer. The assertions themselves are unchanged.
- `dev/browser-check.js p1`: (a) "status bar shows chat: morrow after /model" accepts `chat: morrow (pinned)`;
  (b) `/model chat frontier` before stopping frontier → `/model chat auto` (same reason). Consequence: the p1
  check "status bar after restart shows the persisted choice" now shows an unpinned role; pin persistence across
  restarts is covered by v0.3 check 1.
- Wording of the system line on `/model`: `model for chat switched to morrow (pinned)` (P1 greps for the prefix,
  unchanged assertion).

## Decisions

- **Pins:** a role listed in `roles.json.active` is pinned (so a P1-era `roles.json` reads as pinned, the
  privacy-safe reading). `/model <role> auto` removes the entry and clears the "a→b" marker. A pinned role tries
  only its pinned candidate, regardless of policy.
- **`allowCloudFallback` is per role** (not top level), default false. Blocked candidates are skipped (each
  block is logged and shown), a later local candidate would still be tried.
- **Stall vs. timeout:** `timeoutMs` (per candidate) = wait for the first token, may fall back (rule 1 applies);
  `stallMs` (top level, per-candidate override allowed, default 20000) = gap between tokens after the first,
  never falls back because a reply never mixes two models.
- **Consent keys:** P2 already answered only on an empty input at keydown; v0.3 keeps that and adds
  `isComposing`/`repeat` guards and a clearer placeholder ("Empty input: press y / n / a / x …").
- **Palette tokens:** palette values exactly as given; role tokens (`--you-fg/-bg`, `--pilot-…`, `--ctl-…`,
  `--ok-…`, `--bad-…`) give pastel text with no fill in dark mode and ink text on a pastel fill in light mode.
  Light mode adds panel `#ffffff`, line `#cfd0e0` and a darker secondary `--muted: #5a5873` (6.8:1 on white),
  because `#9a97b0` on `#f4f5fa` is 2.6:1. Usage changes instead of palette changes: error/blocked/stall lines
  use `--text` with a rose left border (rose is never text in light mode); answered questions use `--muted`
  instead of `opacity: .6` (which made contrast unmeasurable); the index jump highlight is an outline instead of
  a tinted background.
  The scanline effect moved from an overlay on top of the terminal (which darkened the text as well, so dark
  `--muted` text fell to about 3.9:1) into the log's background, under the text; the contrast check models
  exactly that (text on `--scan` over `--panel`).
- **Sprites:** `pixel.js` writes `fill="var(--px-a|d|c|w)"`; the browser resolves them, so sprites follow
  `/theme` and OS changes live. Chosen over `getComputedStyle` (the brief's example), which would freeze the
  colours at render time.
- **Demo v0.3:** fixture transcript of 12 lines (privacy story; assistant lines marked `[fixture]`), chat pinned
  to morrow, index threshold 10 with the question already pending, and a demo config that lists **morrow first**
  (privacy-first order) so a morrow outage after `/model chat auto` shows the blocked fallback. The demo terminal
  accepts `m` + Enter to stop/start the morrow fake.

## Deviations

1. `PILOT_DIR` env override (relative to `pilot/app/`, must stay inside it) for demos and checks.
2. System lines may carry `kind: blocked | stall | error` (extra field, used for colour only).
3. The demo config is derived from the dev config with its own ports and morrow first (see Decisions).
4. `scripts/try.sh` accepts `TRY_REF=<commit>` to test it before tags exist.
5. `scripts/demo.js` honours `DEMO_PORT_SHIFT` and `PILOT_DEMO_DIR` (used by `verify-v0.3.sh`).
6. `pilot/app/.gitignore` ignores `.pilot-demo*/` and `.pilot-verify-*/` (the root `.gitignore` is out of scope).

## pilot-v0.3: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder:
- Scope: diff vs main touches only `pilot/app/**` and the new "Pilot iterations" section of `index.html`.
- `npm run verify`: exit 0, all scripts passed (p0, p1, p2, v0.3, browser p1+p2+v03).
- `npm run demo -- v0.3`: `/state` answered 200 after 0.3 s; the page shows `chat: morrow (pinned)` and the pending index question. No orphan processes after stopping it.
- Consent rule in the browser: typing "ok, any news" with the question pending kept the text in the input; `pending` stayed `index`.
- Pin: with morrow down and chat pinned, the reply is "chat failed … pinned to morrow, no fallback". After `/model chat auto`: `fallback_blocked {from: morrow, to: frontier, reason: "morrow is local"}` in metrics and a `blocked` system line.
- Stall: fake with `--stall-after=3`, `stallMs` 1500: reply cut at 1.69 s, partial text kept, `stall` metric logged, no fallback.
- `dev/contrast-check.js`: all pass; light mode uses `--muted #5a5873` because `#9a97b0` on `#f4f5fa` is 2.60:1. Dark and light screenshots checked: pastels are fills/borders only in light mode; `pixel.js` and `app.js` contain no hard-coded hex colours.
- Not tested by the coordinator: the `m` + Enter morrow toggle (it needs a real TTY); the same behaviour was tested by stopping the fake directly.

# pilot-v0.4

Proposals (P3). **Untested with a real model:** every check runs against the fake extractor in
`dev/fake-model.js` (`--extract=good|malformed|badquote|many|dupes`, `--extract-delay`); no real endpoint was
contacted and Morrow was not reachable.

**Reproduce:** `bash pilot/app/dev/verify-v0.4.sh` (61 checks; one of them runs the 25 browser checks of
`browser-check.js v04`; ends with `ALL v0.4 CHECKS PASSED`, exits non-zero on failure). Own ports (server 4770, chat
fakes 5771/5772, extract fake 5773; browser part 4775/5776/5777 and Chrome 9353; demo part 4954/5954/5955) and own
throwaway dirs (`.pilot-verify-v04/`, `.pilot-verify-v04b/`, `.pilot-demo-verify04/`).
**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3, v0.4, browser p1 + p2).
Last run (Node v25.9.0, Chrome, macOS): all passed.

## P3 "done when" (04-build-plan.md)

| Done when | How (section of `verify-v0.4.sh`) |
|---|---|
| After a turn with a clear decision, a proposed item appears, dashed, with author `model` and the model name. | 1: `Decision: … Task: … https://…` → `state.json` has `dec-1`, `task-1`, `src-1`, `status: proposed`, `author: model`, `model: morrow`, `quote`, `fromMessage`, `createdAt`, rev 1. 12 (browser): the card has a dashed lavender border and "dec-N · model · morrow · proposed"; after one message a new dashed card appears without a reload. 13: the demo does the same. |
| Malformed extractor output writes nothing and is logged. | 3: `--extract=malformed` → no `state.json` written; an existing hand-edited one stays byte-identical; `extract_error {reason: malformed}`. |
| A proposal whose `quote` is not in the turn is dropped. | 4: `--extract=badquote` → the decision with the invented quote is dropped (`extract_drop {reason: quote}`), the task with a real quote is written; quotes match case- and whitespace-insensitively. |
| `c` confirms, `r` rejects; both are recorded with time and author. | 7: `POST /answer {itemId, decision}` → `status`, `decidedAt`, `decidedBy: "user"`, rev + 1, system line `dec-3 confirmed: …`, `decide` metric (with the item's author/model); again → 409, unknown → 404, bad word → 400. 12 (browser): `c`/`r` in the empty input on the outlined proposal, `c` on a focused card, reject button. |
| Never more than 3 proposals per turn; near-duplicates are dropped. | 5: `--extract=many` (5 items) → rejected whole by the closed schema (`extract_error {reason: schema}`, "5 items, at most 3"); config `maxItems: 2` → 2 of 3 kept, 1 `extract_drop maxItems`. 6: `--extract=dupes` → of "X", "X!" in capitals and "the <existing title>", only X is written; two `extract_drop duplicate` (one `of: dec-1`). |

## Other checks

| # | Check | How |
|---|---|---|
| 1 | `structured: true` sends `response_format` (fake logs `response_format=yes`); `structured: false` does not, the fake recognises the `PILOT-EXTRACT` marker and it still works. Extraction never goes to the chat fakes. | section 1 |
| 2 | **Extraction never delays the chat reply:** extract fake answers after 4 s; `/chat` returns in ~1.3 s, right after it the assistant line exists, no item yet, `/state.extracting: true`; a second turn meanwhile is not blocked either; the proposal arrives afterwards (runs are queued). | section 2 |
| 3 | Hand edits survive: unknown top-level and item fields kept, rev 3 → 4; ids continue after hand-added ones (`task-7` → `task-8`); a near-duplicate of a **rejected** item is proposed again. A hand-added proposal (`author: user`) can be decided. | sections 6, 7 |
| 4 | **Broken `state.json`** (invalid JSON): unchanged after a turn, `extract_error {reason: state}`, `/state.stateError` set, chat works, deciding → 409. | section 8 |
| 5 | `everyNTurns: 2`: no extract call after reply 1, one after reply 2. | section 9 |
| 6 | **Extract follows the v0.3 rules:** with candidates [morrow (local, down), frontier] and policy fallback, the fallback to frontier is blocked (`fallback_blocked role extract`, system line), frontier never extracts, nothing written; with `allowCloudFallback: true` frontier extracts and the item records `model: frontier`; `/model extract frontier` pins it (frontier extracts although morrow is up); `--stall-after=2` with `stallMs: 1000` → `stall` metric for role extract, `extract_error {reason: stall}`, nothing written, chat not delayed. | section 10 |
| 7 | **Consent for map/kanban:** thresholds 2: one decision → no question; two (proposed) → "2 decisions so far…" asked after the extraction; no pane before the answer; `y` → map pane, answer count 2 (decisions, not messages); kanban `n` at 2 tasks → not asked at 3, asked again at 4; after rejecting 2 of 4 tasks `/rules` shows `tasks 2`; `/rules` no longer says "not built yet". | section 11 |
| 8 | **Page** (`browser-check.js v04`): map shown, kanban not (no answer); proposed dashed lavender, confirmed solid mint, rejected hidden behind "rejected: 1 (show)" and solid rose when shown; `crcr` typed in a non-empty input stays text and decides nothing; kanban question appears after the extraction without reload and counts 3 tasks; `y` → kanban with task-1 (hand-added, solid, "you") in done; highlight = newest proposal; ArrowDown moves focus between cards; real Tab presses from the input reach a card, which is then highlighted; the map draws decisions as a chain (connector between cards); decisions appear as system lines; a hand edit (`author: user`, `column: doing`) shows after the next state load; no page errors, no request outside its own server. | section 12 |
| 9 | Contrast still passes (new styles use only existing tokens; status tags reuse the `--ctl/--ok/--bad` label pairs). | section 12 |
| 10 | **Demo:** `npm run demo -- v0.4` serves `/state` in ~1 s with the map pane and the proposal dec-2; one message (`Decision: we send the letter by registered mail. Task: draft the letter tonight.`) gives `dec-4` and `task-3` proposed and the kanban question pending in ~1.7 s; Ctrl+C leaves no process. | section 13 |
| 11 | Old checks unchanged and passing: p0, p1, p2, v0.3, browser p1/p2/v03. | `npm run verify` |

Done by hand: the demo in the Browser pane (light theme): one message → dashed dec-4 outlined → `c` confirmed it,
`r` rejected dec-2, `y` added the kanban with task-2/task-3 dashed in todo and task-1 solid in done.

## Decisions

- **Fail closed vs. cap:** more than 3 items breaks the closed schema → the whole response is rejected. Config
  `maxItems` (≤ 3) caps survivors one by one. Order per item: quote check, duplicate check, cap.
- **Similarity rule:** lowercase, split on non-letters/digits, drop stopwords (`a an the to of and or we i you it is
  are be will for on in at this that with as by our so`); near-duplicate when the Jaccard similarity of the word
  sets is ≥ 0.75 (equal sets included), or two sources share a url. Compared across kinds, against non-rejected
  items in `state.json` and earlier survivors of the same batch.
- **When extraction runs:** only after a complete reply (not after a failed or stalled one), queued before
  `res.end()` so `/state` already reports `extracting: true`; the controller runs again after the write.
- **Map as a chain** (01-concept, day 2): decisions in the order they came up, joined by a connector; no graph
  layout or links between decisions in this iteration.
- **Rejected items:** hidden by default behind a pane-bar toggle "rejected: n (show)" (page-only, not saved).
- **Focus and keys:** `c`/`r` act on a focused card, or from the empty chat input on the outlined proposal; a new
  proposal takes the outline (newest first). Same guards as the consent keys (composition, repeat, modifiers).
  Placeholder wording changed to "Empty input: y/n/a/x answer the question · c/r confirm/reject the outlined
  proposal".
- **`decidedBy`:** added to `pilot/app/schemas/state.schema.json` (the original in `pilot/cli-pilot-v1/` is
  unchanged). `pilot/app/schemas/extraction.schema.json` is an identical copy of the original.
- **Pickup without SSE:** the page polls `/state` every 300 ms while `extracting` is true (see ITERATIONS.md).

## Deviations

1. `/answer` also accepts `{itemId, decision}`; decisions add a system line to the transcript.
2. Consent answers now record the count of the rule's metric (bug fix; only changes map/kanban, index unchanged).
3. `dev/fake-model.js` ignores its own chat echo `(you said: "…")` when extracting, so it does not re-propose.

## pilot-v0.4: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder. Still untested with a real model (Morrow unreachable).
- Scope: only `pilot/app/**` plus one new line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; every earlier script passes (p0, p1, p2, v0.3, browser p1/p2/v03), plus v0.4.
- `npm run demo -- v0.3` and `-- v0.4`: `/state` 200 in under 1 s each; no orphan processes after stopping.
- Browser, demo v0.4: sent "Decision: … Task: …"; about 2 s later dec-4 appeared dashed with "model · morrow" and the kanban question asked. `c` confirmed dec-4 (`decidedBy: user`, `decidedAt` set, mint); `y` added the kanban with task-2/task-3 dashed and the hand-added task-1 solid, "you". No text on the page fell below 4.5:1 (computed in the page, opacity included).
- Own fake runs (separate dir and ports): `--extract=badquote` kept 2 of 3 and logged `extract_drop reason: quote`; `malformed` wrote no state and logged `extract_error malformed`; `many` (5 items) wrote nothing and logged `extract_error schema`.
- Known risk carried into v0.5: `c`/`r` from the empty chat input decide a proposal on the first keystroke of a message starting with c or r (see QUESTIONS.md). Fixed in v0.5.

# pilot-v0.5

Live files (P4), and `c`/`r` only on a focused proposal. Everything runs against `dev/fake-model.js`; no real
endpoint was contacted.

**Reproduce:** `bash pilot/app/dev/verify-v0.5.sh`. It has 39 checks; one of them runs the 22 browser checks of
`browser-check.js v05`, plus that script's 2 global checks. It ends with `ALL v0.5 CHECKS PASSED` and exits non-zero
on failure.
- Own ports: server 4780, fakes 5781/5782; browser part 4785/5786/5787 and Chrome 9363; demo part 4958/5958/5959.
- Own throwaway dirs: `.pilot-verify-v05/`, `.pilot-verify-v05b/`, `.pilot-demo-verify05/`.
- The whole run uses `PILOT_DIR`, so the watcher is checked on a non-default dir.

**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3, v0.4, v0.5, browser p1 + p2; v03/v04/v05
browser checks run inside their verify scripts).
Last run (Node v25.9.0, Chrome, macOS): all passed. `npm run demo -- v0.3`, `-- v0.4` and `-- v0.5` each served
`/state` in about 1 s (timed with 1 s resolution), and SIGINT to the process group left no process behind.

## P4 "done when" (04-build-plan.md)

| Done when | How (section of `verify-v0.5.sh`) | Measured |
|---|---|---|
| A hand edit of `state.json` appears in the page within a second. | 2: `dev/sse-probe.js latency` flips an item's status 10 times with a plain `writeFileSync`. Each run times hand edit → SSE `change` event for `state.json`, and hand edit → `GET /state` showing the new status. 7 (browser): hand edit → the text in the DOM of tab B, 3 runs. | Event: median 165 ms, max 166 ms (150 ms of it is the debounce). `/state` shows it at max 169 ms. **Hand edit → DOM: 164–207 ms** (4 runs of `browser-check.js v05`, 3 edits each). |
| Two open tabs stay in sync. | 7: two tabs in one headless Chrome. In tab A, Tab presses reach dec-2 and `c` confirms it. Tab B shows it confirmed without a reload. Hand edits show in both. | Tab A keypress → tab B DOM: 177–179 ms. |
| A write with a stale `rev` is rejected and the page reloads state. | 5 (HTTP): decide with rev − 1 → 409 `{stale: true, file: "state.json", rev}`, file byte-identical. Current rev → 200; no rev → 200; consent with a stale `modules.json` rev → 409 stale, still pending. 7 (browser): tab B closes its EventSource; the file changes behind it (rev + 1); `c` on dec-5 → rejected, tab B reloads (shows the hidden change) and shows the notice "state.json changed since this page last saw it (rev 2, now 3); reloaded, try again" (not an error line); the same key again goes through. | |

## Other checks

| # | Check | How |
|---|---|---|
| 1 | `GET /events` sends `hello` with the revs of the files in the dir, then `change {file, rev}` for own writes. `transcript.jsonl` rev = its line count; `state.json` rev = the file's `rev` after the extraction write; `modules.json` when the controller asks; `metrics.jsonl` with a line count; `status` extracting true → false; temp files never pushed. | section 1 |
| 2 | Debounce: 5 hand writes within ~50 ms → exactly one `state.json` event; a second SSE client gets the same event. | section 3 |
| 3 | Server writes bump rev: decide (`state.json`), consent (`modules.json`), `/model` (`roles.json`). `/state` reports `stateRev` and `modulesRev`. | sections 4, 5 |
| 4 | An already-decided item stays a plain 409 (no `stale`), so the page shows it as an error line, not as a reload notice. | section 5 |
| 5 | **Invalid JSON never crashes the server:** broken `state.json` → `/state` answers with the last good items, `stateError` and `fileErrors`; SSE event with `rev: null` and the error; deciding → 409; a chat turn with extraction leaves the file alone; fixing it clears the error. Broken `modules.json` → last good panes, a turn does not overwrite it (`controller_error`), answering → 409. Broken `roles.json` → the pin is kept and the next reply still comes from the pinned morrow. Same server PID throughout, no uncaught error in its log. | section 6 |
| 6 | **Page** (`browser-check.js v05`): both tabs live; `c`/`r` typed in the empty input are text; placeholder offers Tab, not c/r; notice "file state.json is not valid JSON, showing last good version" within 1 s (179 ms) with the cards still shown; confirm while broken → error line, file untouched; fix → notice gone; same for `modules.json` (map pane stays); **reconnect:** server stopped, file edited, server started → tab A shows the edit by itself (~0.9 s after the restart); **fallback:** a tab without `EventSource` makes no `/events` request, says `ready`, updates after its own reject button, and shows a proposal from a background extraction without a reload (polling); no page errors in any tab. | section 7 |
| 7 | Contrast still passes (the notice uses `--text` on the panel). | section 7 |
| 8 | **Demo:** `npm run demo -- v0.5` serves `/state` in ~1 s with the map pane and dec-2 proposed; the try lines say two tabs; the printed flip one-liner, run **literally from the demo output**, causes an SSE event and dec-2 confirmed; the printed break one-liner sets `fileErrors`, run again repairs it; Ctrl+C leaves no process. | section 8 |
| 9 | Old checks unchanged except the adapted assertions below, and passing: p0, p1, p2, v0.3, v0.4, browser p1/p2/v03/v04. | `npm run verify` |

## Adapted assertions (c/r fix)

In `dev/browser-check.js v04`, each marked `ADAPTED in pilot-v0.5` in the code:
1. "proposal dec-2 … highlighted" → "… not outlined before it has focus". Only the focused card is outlined now.
2. "empty input: c confirms the highlighted proposal" → three checks:
   - "empty input: c is text and decides nothing"
   - "ArrowDown from the empty input focuses the proposal dec-2, which is then outlined"
   - "c on the focused card confirms it"
3. "confirmed card turns solid mint, focus back in the input" → "… focus stays on the card", plus a new "Escape on a
   card returns focus to the chat input".
4. "page loaded once (pickup by polling /state, no navigation)" → "page loaded once (pickup without navigation)".
   Only the wording changed; pickup is by SSE now.
5. "highlight = newest proposal (task-3)" and "empty input: r rejects it" → three checks:
   - "empty input: r is text and decides nothing"
   - "ArrowDown from the empty input focuses and outlines the newest proposal (task-3)"
   - "r on the focused card rejects it"
6. "hand edit of state.json shows after the next state load" (it sent `/panes` first) → "shows without any action".

`browser-check.js v04` now has 29 checks (27 + 2 global; it had 25). `verify-v0.4.sh` still counts it as 1 of its
61. The v0.4 shell checks needed no change: requests without `rev` are still accepted.

## Decisions

- **Change detection by stat, not by watch filename:** any `fs.watch` event (debounced 150 ms) re-stats every
  non-dot, non-`.tmp` file in the dir and pushes those whose mtime, size or inode changed. It also pushes for a deleted
  file (rev 0).
- **rev for JSONL = non-empty line count.** A hand edit that keeps the count keeps the rev. It is still pushed (the
  event fires on any change), and the page compares content, not rev.
- **Which writes carry rev:** `/answer` (consent → `modules.json` rev, confirm/reject → `state.json` rev), as the
  brief lists. `/chat` and `/command` only append or change server-owned files and carry none. `rev` is optional, so
  curl and the older checks work unchanged.
- **Stale vs. other 409s:** only `{stale: true}` triggers reload + notice (5 s); "already decided" or "file broken"
  stay error lines.
- **Last good version** is used for display and counts only, never written back. A broken file is never overwritten.
  `roles.json` was added to `state.json` and `modules.json` here, because losing a pin silently could send a private
  chat to the cloud.
- **Outline = focus.** The arrow target (newest proposal) is not outlined until it has focus, so nothing on screen
  suggests that a key in the input would act on it.
- **Page reload granularity:** one `/state?only=<file>` request per `change` event. Files the page does not render
  (e.g. `metrics.jsonl`) cost none. Areas are re-rendered only when their content signature changed, so scroll and focus survive unrelated events. A focused card keeps focus across
  re-renders.

## Deviations

1. 02-architecture says "re-renders the affected pane with a View Transition". Live content refreshes are instant;
   View Transitions stay for adding and removing panes (as in P2). A transition on every hand edit or tab-sync event
   would flicker and delay the 1 s target.
2. The v0.4 demo's try lines were reworded for the new keys (`demo/fixtures/v0.4/demo.json`); the fixture data is
   unchanged.
3. `/state` gained `?only=`, `modulesRev` and `fileErrors`; without `only` it returns what it did before plus those
   fields.

## pilot-v0.5: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder.
- Scope: only `pilot/app/**` plus one line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; all earlier scripts pass (p0, p1, p2, v0.3, v0.4, browser), plus v0.5.
- Demos v0.3, v0.4, v0.5: `/state` 200 within about 1 s each; no orphan processes.
- Hand edit: flipping dec-2 in `.pilot-demo/state.json` with the demo's own one-liner showed up in a second browser tab 221 ms later (MutationObserver vs. the write timestamp).
- Two tabs: confirming dec-2 in tab A by keyboard (empty input → ↓ focuses dec-2 → `c`) appeared in tab B within 1 s.
- c/r fix: typing "can you check" with a proposal on screen left the text in the input and dec-2 proposed; `c` from the input is text.
- Stale rev: `POST /answer {itemId: task-2, decision: r, rev: 2}` while stateRev was 6 → 409 `{stale: true}`; task-2 stayed proposed.
- Seen, left for v0.6: a status change made by hand edit still renders as authored "by-model". v0.6 adds file-edit authorship.

# pilot-v0.6

Authorship and metrics, `/stats`. Everything runs against `dev/fake-model.js`; no real endpoint was contacted.

**Reproduce:** `bash pilot/app/dev/verify-v0.6.sh`. It has 51 checks; one of them runs the 26 checks of
`browser-check.js v06` (24 + 2 global). It ends with `ALL v0.6 CHECKS PASSED` and exits non-zero on failure.
- Own ports: server 4790, fakes 5791/5792; browser part 4795/5796/5797 and Chrome 9373; demo part 4964/5964/5965.
- Own throwaway dirs: `.pilot-verify-v06/`, `.pilot-verify-v06c/`, `.pilot-verify-v06b/`, `.pilot-demo-verify06/`.

**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3–v0.6, browser p1 + p2; the v03–v06 browser checks
run inside their verify scripts).
Last run (Node v25.9.0, Chrome, macOS): all passed (after the one adapted v04 assertion below). `npm run demo -- v0.3`,
`-- v0.4`, `-- v0.5` and `-- v0.6` each served `/state` within about 1 s, and SIGINT left no process behind.

## Definitions (used by `/stats`, `stats.js`)

| Term | Definition |
|---|---|
| Work session | Activity timestamps (user/assistant lines in `transcript.jsonl`, plus `index_jump` events for Usefulness) sorted; a gap of more than 30 min starts a new session. |
| Hour of work | Sum of the gaps between consecutive user/assistant lines that are at most 30 min. Longer gaps are breaks and count as nothing. |
| Restart | Every `server_start` after the first. |
| Lost (continuity) | A `server_start` reports fewer transcript lines than the previous run's last `turn` (or its own start), or fewer consent answers than the previous start. Items are not compared: deleting an item by hand is allowed. |
| Recorded answer | A `consent` event whose `id` equals `answers.<module>.consentId` (older data: same module and timestamp). |
| File edit (items) | A field that differs from the item's last `item_write` copy in `metrics.jsonl` (plus `handFields` carried by that write); an item without a ledger entry and `author: user`. |

## P5 measures (`04-build-plan.md`, proposed thresholds)

| Measure | PASS when | NOT YET when |
|---|---|---|
| Continuity | at least 1 restart and nothing lost | no restart yet, or something was lost (the lines say what) |
| Consent | at least 1 pane shown, every shown pane has a recorded answer, every `controller_add` references a yes/always consent | no pane yet, or a pane/add without a recorded answer |
| Usefulness | 3 or more `index_jump` events in one work session | fewer |
| Signal | at least 1 model proposal decided and confirmed ≥ rejected. Counted from `state.json` (`author: model`, confirmed/rejected, hand decisions included); `decide` events shown alongside. | nothing decided, or more rejected than confirmed |
| Quiet | at least 1 h of work and controller asks ≤ ceil(hours of work) | less than 1 h of work, or more asks |

Quiet uses ceil, so a single question in the first 20 minutes does not read as "3 per hour".

## Checks

| # | Check | How (section of `verify-v0.6.sh`) |
|---|---|---|
| 1 | `server_start` at boot with counts; `turn` after a reply; `consent` has an `id` equal to `modules.json` `answers.index.consentId`; `controller_add` with `answerRef` = that id on a `yes`; the pane entry records `rule`; `/state.paneInfo` has rule, answer, `recorded`. Always path: map removed by hand from `modules.json`, the controller re-adds it with `answerRef` = the always answer. `metrics.jsonl` stays append-only (old content is a byte prefix). | 1 |
| 2 | `POST /metric`: `index_jump` to an existing message → 200, logged with target and position; unknown target, any other event, non-JSON → 400 and nothing logged. | 2 |
| 3 | Ledger: one `item_write` per extracted item, equal to the item in `state.json`; untouched items have no `prov`; decide → `item_write` (via decide) then `decide` as the last line. Hand edit of a text → `prov.fields [text]` and a `file_edit` event; a later confirm through the page keeps `[text]` (`handFields`); an edit undone by hand → no `prov`. Edits made while the server was down (status) are found after the restart; a hand-added user item → `added`; a model item without a ledger entry → no `prov`. `state.json` has no field the server added for authorship. | 3 |
| 4 | Continuity: the second `server_start` ≥ the last `turn`; `/stats` continuity PASS after 1 restart. A transcript cut while the server was down → NOT YET with "LOST … transcript lines". | 4 |
| 5 | `npm run stats -- <dir>` on a copy of the v0.6 fixture: exit 0, five measures, verdicts continuity PASS, consent PASS, usefulness NOT YET, signal PASS, quiet NOT YET; "FIXTURE DATA: 130 of 130 metrics events and 64 of 64 transcript lines"; thresholds and numbers present. Same output from another directory with an absolute path, and with a relative path from `pilot/` (INIT_CWD). Read-only: every file byte-identical. A missing dir → exit 2, nothing created. `/stats` in a server on the same dir prints exactly the same lines. 3 jumps → usefulness PASS. A hand-written `consentId` → consent NOT YET naming the pane. Signal shows "1 decided by file edit". | 5 |
| 6 | **Page** (`browser-check.js v06`, seeded from the v0.6 fixture): lines say you / model + frontier / controller / system with `data-author` and tooltip, and their labels use the role pairs (`--you-*`, `--pilot-*`, `--ctl-*`); card bylines for: decided by you (with time), pristine proposal, status flipped by hand, column moved by hand, item added by hand; chip colours; the proposed tag is not in the controller's pair; times are local (the check pins the page to UTC) with the
ISO timestamp as tooltip; pane bars "controller · messages ≥ 12 · you: yes 10-15 14:14" etc.; hand edit dec-7 → "confirmed by you (file edit)" within 1 s (180–189 ms, 2 runs) and a `file_edit` event; flipped back → pristine; hand-written `consentId` → "you (file edit): yes"; `c` on a focused card → "confirmed by you <time>", then a hand edit of its text → "… · edited by you (file edit): text"; 3 index clicks → 3 `index_jump` events; `/stats` in the page → 5 verdict lines (usefulness now PASS) and the fixture label; a live reply "model frontier" and a live proposal without file-edit mark; no page errors; no request outside the server. | 6 |
| 7 | Contrast passes, including the new pairs "you/model/controller author chip on pane bar" (both themes). | 6 |
| 8 | **Demo:** `npm run demo -- v0.6` serves `/state` within ~1 s with three panes (rule + recorded answer) and items of every author kind; `/stats` says "3 PASS, 2 NOT YET" and "FIXTURE DATA: 130 of 131 metrics events" (the 131st is the demo's own `server_start`); the try lines name /stats, the index clicks, `npm run stats` and the flip one-liner; the printed one-liner and the printed `npm run stats` line work as printed; Ctrl+C leaves no process. | 7 |
| 9 | Old checks passing: p0, p1, p2, v0.3, v0.4, v0.5, browser p1/p2/v03/v04/v05; one assertion adapted (below). | `npm run verify` |

## Adapted assertions

In `dev/browser-check.js v04`, marked `ADAPTED in pilot-v0.6`: "kanban question counts proposed + confirmed tasks (3)"
read the whole controller line (`/^3 tasks/`). The line now starts with its author label `controller`, so it reads the
question part (`.text`). Same assertion, same count.

## Decisions

- **Ledger in `metrics.jsonl`, not a signature in `state.json`.** The file stays exactly as the schema describes, the
  changed fields are known (not just "something changed"), and it survives restarts. Cost: the evidence lives in a
  second file. If `metrics.jsonl` is lost, items fall back to their declared author.
- **No evidence ≠ file edit.** A model item without a ledger entry shows its declared author. Otherwise every v0.4/v0.5
  fixture item and every item from an older build would wrongly read "you (file edit)".
- **The page shows authorship but computes none.** `/state` items carry `prov {added, fields}` and `/state.paneInfo`
  carries `recorded`. Both are derived when they are read and never written to a file.
- **`/stats` is `stats.js`.** `server.js` requires it; `scripts/stats.js` requires it without starting a server.
  `stats.js` has no side effects and writes nothing.
- **Thresholds are hard-coded** with the build plan's wording. Reading `04-build-plan.md` at runtime would couple the app
  to a doc outside `pilot/app/`.
- **Fixture data** is marked per line (`"fixture": true`) and counted in the `/stats` header, so a demo can never pass
  for a real week.

## Deviations

1. The proposal border stays dashed lavender (as since v0.4; v04 checks its colour). There the dash marks status, not
   author. The author is named by the sky `model · morrow` chip. The `proposed` tag was lavender (the controller's pair)
   and is now neutral (text with a dashed outline), so no lavender label on a card names an author.
4. Times on cards and pane bars are the browser's local time (tooltip: the ISO timestamp from the file). `/stats`
   prints UTC and says so ("Times in UTC"), because `npm run stats` has no browser.
2. The assistant label changed from `pilot` to `model` (the model name follows it). Command output lines (`/stats`,
   `/rules`, …) have no author label: they are not stored and nobody authored them.
3. `/state` gained `paneInfo` and per-item `prov`. Without them it returns what it did before.

## pilot-v0.6: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder.
- Scope: only `pilot/app/**` plus one line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; every earlier script passes, plus v0.6.
- Demos v0.3 to v0.6: `/state` 200 within about 1 s each; no orphan processes.
- `/stats` in demo v0.6 and `npm run stats -- .pilot-demo` print the same report. It marks fixture data as such, shows 3 PASS / 2 NOT YET with the numbers behind each, and names what files cannot measure.
- Authorship in the browser: every chat line is labelled (you / model + candidate / controller / system), every card shows author, model and who decided it, and every pane bar shows its rule and answer.
- Hand edit of dec-2's text → `/state` gives `prov.fields: ["text"]`; the card reads "edited by you (file edit): text".
- Seen, planned for v0.7: at 800 px the 4-pane layout is cramped (the "controller" label breaks mid-word, kanban columns about 6 characters wide).

# pilot-v0.7

`/why` and the layout fix. Everything runs against `dev/fake-model.js`; no real endpoint was contacted.

**Reproduce:** `bash pilot/app/dev/verify-v0.7.sh`. It has 35 checks; one of them runs the 22 checks of
`browser-check.js v07` (20 + 2 global). It ends with `ALL v0.7 CHECKS PASSED` and exits non-zero on failure.
- Own ports: server 4800, fakes 5801/5802; browser part 4805/5806/5807 and Chrome 9383; demo part 4968/5968/5969.
- Own throwaway dirs: `.pilot-verify-v07/`, `.pilot-verify-v07c/`, `.pilot-verify-v07b/`, `.pilot-demo-verify07/`.
- Screenshots of the layout check: `SHOT=<dir> node dev/browser-check.js v07` writes `v07-<width>.png`.

**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3–v0.7, browser p1 + p2; the v03–v07 browser checks
run inside their verify scripts).
Last run (Node v25.9.0, Chrome, macOS): all passed, no earlier assertion adapted. `npm run demo -- v0.3` to `-- v0.7`
each served `/state` within about 1–2 s, and SIGINT left no process behind.

## Citation format

| Source | Cited as | Resolved by `dev/why-cites.js` as |
|---|---|---|
| a `metrics.jsonl` event | `metrics.jsonl:60 controller_ask`, `metrics.jsonl:65 consent c-f03`, `metrics.jsonl:18 decide dec-2` | physical line 60 parses as JSON, `event` is the first word, `id`/`itemId` the second |
| a transcript line | `transcript.jsonl:5 m-f005` | line 5 has `id` m-f005 |
| a JSON entry | `state.json:18 items dec-2`, `modules.json:14 panes index`, `modules.json:39 answers.index`, `rules.json:9 rules map` | line 18 holds `"id": "dec-2"` (`"module": "index"`, `"index":`, …) |
| an absence or a count | `modules.json answers.kanban (absent)`, `metrics.jsonl (no consent c-hand)`, `metrics.jsonl decide ×10` | no line number, the reason in the label |

## Checks

| # | Check | How (section of `verify-v0.7.sh`) |
|---|---|---|
| 1 | v0.7 fixture: `/why` has one line per pane with rule, count when asked, your answer and the add, exact text and sources for index; the item summary. The rule is cited twice: as recorded with the pane (`modules.json`) and in `rules.json` while the two agree (when `rules.json` changed later, the change is its own statement). `/why map` question (count, threshold, text, transcript line), answer, add. `/why index` full history (12 → no, 24 → yes). `/why dec-2`: proposed by morrow, from your message m-f003 (the item's `fromMessage`, not the extract event's m-f004), quote found, confirmed by you with its `decide` line. `/why dec-8` "set by you (file edit), when is not recorded". `/why task-7` "added by you (file edit) at 2026-10-16T18:30:04" citing `metrics.jsonl:131 file_edit task-7`. `/why task-1` column: server "todo", file "done". `/why chat`. Unknown name → 400 listing panes and items. | 1 |
| 2 | **Every cited source resolves** (`dev/why-cites.js`): `/why`, the four panes and all 17 items; also `lines` equals the formatted `why` statements, every statement cites something, every link names a message in the transcript. | 1, 2, 3 |
| 3 | **Read-only:** every file byte-identical after 31 explanations (fixture) and after 8 more on live data; no file added. | 1, 3 |
| 4 | Live data (fresh dir, real turns through the fakes, consent through `/answer`, a confirm): `/why` from the real lines; `/why dec-1` from the real user message, confirmed through the page. | 2 |
| 5 | Missing or hand-made facts, made while the server runs: a text edit → "text edited by you (file edit) at <ts>" citing its `file_edit`; a hand-added item → "added by you (file edit) at <ts>"; a model item without ledger → "the server never wrote it"; a `fromMessage` not in the transcript → said; a pane entry without an answer → not in `/state.panes`, `/why` "no recorded answer" and "no controller_add event: added by file edit, when is not recorded"; a hand-written yes → shown, "written by file edit, when is not recorded"; a `rules.json` threshold changed later → recorded rule plus "rules.json says messages ≥ 5 now"; broken `state.json` → `/why dec-1` 400 naming the error, `/why` says items cannot be explained, server alive; broken `modules.json` → "cannot explain". `/help` lists `/why`. | 3 |
| 6 | **Page** (`browser-check.js v07`, v0.7 fixture): typed `/why` renders heading, 6 statements, hint; every statement's sources match `[file:line …]`; `/why map` lines with sources; "show m-f005" scrolls the message into view and flashes it, and logs no `index_jump`; `/why dec-2` text and its "show m-f003"; dec-8 and task-7 missing/recorded facts; "why?" on the kanban bar shows exactly the lines of typed `/why kanban`; every pane bar and card has a "why?" button outside the byline; Tab from the input reaches the index "why?" (18 tabs), Enter shows `/why index`; `c` on the focused "why?" of proposal dec-7 does not confirm it. | 4 |
| 7 | **Layout** at 800, 1280 and 1600 px, plus 820 and 1000 (where side panes are narrowest), with a controller question made long enough to wrap: no horizontal page scroll; no label (who, controller, chips, times, tags, headings, pane titles, why?, keys) has its text on more than one line; no label sticks out of its pane; the kanban is stacked exactly when its body is under 420 px, otherwise every column is at least 134 px. Measured: 800 → 712 px, 3 columns; 820 → 259 px, stacked; 1000 → 328 px, stacked; 1280/1600 → 436 px, 3 × 140 px. Without the v0.7 CSS the same check fails at every width ("controller" on two lines; at 820 columns of 81 px and chips overflowing). | 4 |
| 8 | Contrast passes, including "why? button on pane bar", the card/source pair and the `/why` statement pair (both themes). | 4 |
| 9 | **Demo:** `npm run demo -- v0.7` serves `/state` within about 1 s with map, index and kanban, each with rule and recorded answer; `/why dec-2` answers from the demo's files; the try lines name `/why`, `/why map`, `/why dec-2` and the why? click; Ctrl+C leaves no process. | 5 |
| 10 | Old checks still passing: p0, p1, p2, v0.3–v0.6, browser p1/p2/v03/v04/v05/v06. | `npm run verify` |

## Decisions

- **`why.js` beside `stats.js`.** Pure: it reads the dir and returns statements. The server adds nothing but the label.
  So the page, curl and the checks see the same facts, and the "why?" button runs the same command as typing it.
- **Citations are line numbers as the files are now.** JSONL lines never move (append-only, or a hand edit the person
  made). JSON entries are found by their key line. Line numbers are physical, so a blank or broken line still counts.
- **Recorded vs declared.** A time is "recorded" only when an event says it: `consent`, `controller_add`, `decide`,
  `file_edit`, `item_write`. A `createdAt` or `addedAt` someone wrote into a file is quoted as "the file says …". A
  missing event is reported, not inferred. "The server was not running" is not said, because the files cannot show it.
- **The item's message is its `fromMessage`.** The `extract` event names the reply that triggered extraction, but the
  quote may come from the user line before it (dec-2 is from m-f003, a user line; its extract event names m-f004).
- **The question line** is the controller transcript line with the same module and timestamp as the `controller_ask`
  event. The server writes both with one `ts`.
- **Kanban threshold 420 px** of body width, about 134 px per column. At 1280 px the three columns stay (436 px);
  narrower layouts stack. Measured instead of a viewport breakpoint, because pane width depends on how many panes
  there are.

## Deviations

1. The brief asks for checks at 800 px with 3–4 panes. At exactly 800 px the existing `@media (max-width: 800px)`
   already stacks the panes full width, so nothing was cramped there. The cramped layout appears just above 800 (the
   coordinator's "800 px" window was probably a little wider than its viewport). The check therefore covers 800, 1280
   and 1600 as asked, plus 820 and 1000. ITERATIONS.md has the note.
2. The "show m-…" link reuses the index's scroll-and-flash but not its `index_jump` metric (see Decisions in v0.6:
   Usefulness counts index use only).
3. `/why` prints recorded ISO times verbatim. Cards and pane bars stay local time.

## pilot-v0.7: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder.
- Scope: only `pilot/app/**` plus one line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; every earlier script passes, plus v0.7.
- Demos v0.3 to v0.7: `/state` 200 within about 1 s each; no orphan processes.
- `/why`, `/why map`, `/why dec-2` on demo v0.7 give concrete statements, each with a source. Spot-checked by hand: `metrics.jsonl:12` is the map `controller_ask` at count 2 / threshold 2, and `transcript.jsonl:3` is m-f003 holding the quoted words.
- The "why?" button on the dec-2 card printed the same explanation in the chat.
- Layout at 820 px: "controller" stays whole, the kanban stacks its columns, no horizontal page scroll.

# pilot-v0.8

Panes can go. Everything runs against `dev/fake-model.js`; no real endpoint was contacted.

**Reproduce:** `bash pilot/app/dev/verify-v0.8.sh`. It has 44 checks; one of them runs the 24 checks of
`browser-check.js v08` (22 + 2 global). It ends with `ALL v0.8 CHECKS PASSED` and exits non-zero on failure.
- Own ports: server 4810, fakes 5811/5812; browser part 4815/5816/5817 and Chrome 9393; demo part 4972/5972/5973.
- Own throwaway dirs: `.pilot-verify-v08/`, `.pilot-verify-v08c/`, `.pilot-verify-v08b/`, `.pilot-demo-verify08/`.
- Screenshots: `SHOT=<dir> node dev/browser-check.js v08` writes `v08-1-kanban-tab.png`, `v08-2-two-tabs-question.png`,
  `v08-3-all-back.png` and `v08-4-tab-<width>.png`.
- The fixture is generated: `node dev/make-fixture-v08.js` (deterministic, from `demo/fixtures/v0.7/`).

**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3–v0.8, browser p1 + p2; the v03–v08 browser checks
run inside their verify scripts).
Last run (Node v25.9.0, Chrome, macOS): all passed, no earlier assertion adapted. `rules.example.json` now enables
fading (8/8); the p0–v0.7 checks pass with it. `npm run demo -- v0.3` to `-- v0.8` each served `/state` within about
1 s, and SIGINT left no process behind.

## Definitions

| Term | Definition |
|---|---|
| turn | one message you sent: the turn number is the count of `user` lines in `transcript.jsonl` (commands are not turns) |
| touch | `click` (pointerdown inside a shown pane: cards, buttons, index entries, the scrollbar), `scroll` (wheel or touchmove inside it), `focus` (keyboard focus moved into it by you: a keydown less than 500 ms before), `decide` (c/r or the buttons on one of its cards, recorded by the server), `tab` (click/Enter/Space on a faded pane's tab). Not: typing `/why <pane>`, the "show m-…" link, focus restored by the page |
| recorded touch | the first touch of a pane in a turn: `lastTouch {at, turn, how}` in its `modules.json` entry and a `pane_touch` event. Later touches in the same turn write nothing. A touch on a tab is always recorded (`unfaded: true`) |
| idle | turn now − `lastTouch.turn` (an entry without `lastTouch` counts from the turn of its `addedAt`) |
| fades | after a turn, when idle ≥ `fadeAfterTurns` (the rule's own value, else the top-level default; neither = never) and the pane holds no proposal |
| removal question due | a tab for ≥ `askRemoveAfterTurns` turns (turn now − `fadedTurn`), not answered for this pane entry (a withdrawn question does not count), no proposal held, no other question open |

## Checks

| # | Check | How (section of `verify-v0.8.sh`) |
|---|---|---|
| 1 | v0.8 fixture before: kanban a tab since turn 30, turn 37; `/why map` "last touch: click … (turn 30)" citing its `pane_touch`, "turns since: 7", "fades after turn 38 if nobody touches it" citing `rules.json:N fadeAfterTurns`. | 1 |
| 2 | One message: the map fades (`state: "faded"`, `fadedTurn` 38, still in `modules.json`), `pane_fade` with idle 8 and last touch turn 30, a controller line; the removal question for the kanban is asked once (`pending` kanban, `pendingKind` remove, `controller_ask` question remove, the transcript line). `/why map` explains the fade and when the removal question would come (turn 46); `/why` marks "(tab)". | 1 |
| 3 | The removal question refuses `a` (400, still pending). `n` keeps the tab, is recorded (`removals.kanban`, `consent` with question remove and id), leaves the growth answer alone, and the question is not asked again after two more turns. `/why kanban` shows the question, your no, "asked once per pane". `/stats` Consent still PASS. | 1 |
| 4 | Every cited source resolves (`dev/why-cites.js`) on the fixture and on live data. | 1, 3 |
| 5 | `POST /touch`: chat 400 ("never fades"), unknown `how` 400, a pane not shown 404. A touch bumps the rev once and logs one `pane_touch`; a second one in the same turn returns `changed: false` and writes nothing. New panes start with `lastTouch.how: "added"`. | 2 |
| 6 | **Proposal guard:** the map holding proposal dec-1 does not fade after 6 idle turns (its own `fadeAfterTurns` 4, the default 3); the index does. `/why map` says it holds dec-1 and cites the per-rule threshold and the item. | 2 |
| 7 | The removal question for the index comes after 2 turns as a tab; a touch on its tab brings it back and withdraws the question (`controller_withdraw`, system line). Confirming dec-1 is a `decide` touch of the map. Four turns later the map fades (rule 4) and the index again (default 3). A proposal written into `state.json` brings the faded map back on the next turn (`pane_unfade` reason proposal, a controller line, no touch). After the withdrawn question the index fades again and is asked again 2 turns later (a withdrawn question does not count as asked); after `n` it is not asked again. | 2 |
| 8 | **Removal yes:** the entry leaves `panes`, `removals.index` yes, `pane_remove` with `answerRef` = the consent id. The old "always" does not re-add it; the rule stays quiet until its count has doubled, then asks a growth question (no auto-add). `/why` says "removed … its rule is asking again now". Yes adds a new pane, which fades and gets its own removal question. **Removal never:** removed, and no growth question even after the count more than doubled. Every `pane_remove` has a removal consent yes/never. `/rules` and `/panes` show it. Without `fadeAfterTurns` fading is off. | 3 |
| 9 | **Page** (`browser-check.js v08`, v0.8 fixture, 1280 px): the kanban is a tab button below map and index, about 32 px high, map 344 px. After one message the map is a tab too and the index takes the height (655 px); the fade line has no keys; the removal question has exactly y/n/x buttons; the placeholder says y/n/x; `a` in the empty input stays text. A wheel over the index logs `pane_touch` scroll; a second pointerdown in that turn logs nothing. A click on the map tab shows the map within about 25 ms (before the server answers), through a View Transition; the server records `tab`, `unfaded`. Reduced motion: Enter on the focused kanban tab shows the kanban in the same frame without a View Transition, and withdraws its open removal question. Next turn: focus set by script is not a touch; Tab into the index (18 tabs) is a `focus` touch. The chat has no tab and no touch. At 800, 820 and 1280 px with a tab: no horizontal scroll, the tab label on one line, about 32 px high. All three side panes faded (by hand): the tabs stack at the top of a column as wide as the tabs but at most 18rem (288 px), the chat keeps the full height, no horizontal scroll. | 4 |
| 10 | Contrast passes. The tab uses the pane-title pair (`--accent-fg` on `--base`) and the meta pair (`--muted` on `--base`), both already checked; the fade line uses `--muted` on the panel. | 4 |
| 11 | **Demo:** `npm run demo -- v0.8` serves `/state` within about 1 s with the kanban as a tab; one message fades the map and asks to remove the kanban; the try lines name the tab, `/why map`, the removal question and clicking a tab; Ctrl+C leaves no process. | 5 |
| 12 | Old checks still passing: p0, p1, p2, v0.3–v0.7, browser p1/p2/v03–v07. | `npm run verify` |

## Deviations

1. The brief's example "remove the map pane? [y/n]" got a third answer, `x` (remove for good), because the brief also
   says a removed pane can come back "only if its answer was not `x`". `a` is refused. See QUESTIONS.md.
2. The brief lists "index jump" as a touch. An index jump starts with a pointerdown inside the index, so it is recorded
   as `click` (the first touch of the turn). The `index_jump` metric is unchanged.
3. The brief lists "focus" and "scroll inside it". They are narrowed to focus you moved with a key and to wheel/touchmove,
   because the page re-renders panes (scroll resets, focus restored by script) and would otherwise touch its own panes.
   ITERATIONS.md has the reasoning.

## pilot-v0.8: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder.
- Scope: only `pilot/app/**` plus one line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; every earlier script passes, plus v0.8.
- Demos v0.3 to v0.8: `/state` 200 within about 1 s each; no orphan processes.
- Browser, demo v0.8: sent "what is left for Monday?" → the map faded to a tab with a controller line, and "Remove the kanban pane? (y/n/x)" asked once. `n` was recorded as `consent {question: remove, answer: no}`; the kanban stays in `modules.json` as `faded`. Clicking the map tab brought it back (`pane_touch how: tab, unfaded: true`).
- An existing `.pilot/rules.json` without `fadeAfterTurns` never fades (CHANGELOG states it; not re-tested by hand).

# pilot-v0.9

Enter, diffused (experiment behind a flag, default off). Everything runs against `dev/fake-model.js`; the experiment
itself uses no model.

**Reproduce:** `bash pilot/app/dev/verify-v0.9.sh`. It has 35 checks; one of them runs the 28 checks of
`browser-check.js v09` (26 + 2 global). It ends with `ALL v0.9 CHECKS PASSED` and exits non-zero on failure.
- Own ports: server 4820, fakes 5821/5822; browser part 4825/5826/5827 and Chrome 9403; demo part 4976/5978/5979.
- Own throwaway dirs: `.pilot-verify-v09/`, `.pilot-verify-v09b/`, `.pilot-demo-verify09/`.
- The browser part runs with `settleMs: 400` so it is fast; the 1800 ms default is checked on the server and the demo.
- The fixture is generated: `node dev/make-fixture-v09.js` (deterministic, from `demo/fixtures/v0.8/`).

**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3–v0.9, browser p1 + p2; the v03–v09 browser checks
run inside their verify scripts).
Last run (Node v25.9.0, Chrome, macOS): `npm run verify` all passed (p0–p2, v0.3–v0.9, browser p1 + p2), no earlier
assertion adapted. `browser-check.js v09` passed 4 runs in a row after the test waits for the page's metric writes.
`npm run demo -- v0.3` to `-- v0.9` each served `/state` within about 1 s, and SIGINT left no process behind.

## Definitions

| Term | Definition |
|---|---|
| flag | `experiments.settledInput`: `.pilot/flags.json` if it sets it (written by `/flag`), else the config, else off |
| last keystroke | the last change of the input's value (`input` event: typing, deleting, pasting, IME text). Keys that change nothing (arrows, Tab) do not count |
| T | `experiments.settleMs` in the config, default 1800, clamped to 300–10000 |
| offer | after T ms without a change, input focused and enabled, flag on, `looksFinished(text)` true (public/settle.js, cases in CHANGELOG.md # pilot-v0.9): `send? (Tab to send, keep typing to ignore)` next to the input; `settle_offer` |
| outcome | `settle_accept` (Tab), `settle_ignore` how `typed` (any change of the value) or `escape`, or `enter_send` with `offerShowing: true`; at most one per offer |
| unresolved | an offer without an outcome: focus left the input, the page was reloaded, the flag went off |
| time to send | `sinceKeyMs` on `settle_accept` and `enter_send`: ms from the last keystroke to the send |

## Checks

| # | Check | How (section of `verify-v0.9.sh`) |
|---|---|---|
| 1 | The heuristic table: 24 cases (finished with cue punct/question; trailing off, `,`, `e.g.`, `Step 3.`, a URL, an open bracket or code span, a command, too short, empty) give the documented verdict. | 1 |
| 2 | **Off by default:** a config without `experiments` is off ("default (off)", T 1800); `experiments.settledInput: false` is off from the config; both shipped configs say false / 1800. `/flag` shows it; `/help` lists `/flag`. While off `POST /metric` settle events → 400 and nothing is logged; no `flags.json` is written. | 2 |
| 3 | **On:** `experiments.settledInput: true` is on; `settleMs: 50` is clamped to 300. `/flag nope on` and `/flag settled-input maybe` → 400. `/flag settled-input off` writes `flags.json` (rev 1), a system line, a `flag` event, and wins over the config; the system line is not a turn. After a restart with a config that says off, `flags.json` (on) still wins. | 3 |
| 4 | **`POST /metric`:** a bad offer id, cue or missing number → 400; a valid offer → 200 with extra fields (a text) dropped, numbers rounded, `settleMs` and `turn` added; an outcome for an unknown offer → 400; `enter_send` with offerShowing true needs `offerRef` and false must not have one; a second outcome for an offer → 400, also after a restart. | 4 |
| 5 | **`/stats` experiments block:** 4 offers (1 Tab, 1 Escape, 1 Enter while showing, 1 unresolved), 3 Enter sends (1 with, 2 without), the medians 2.4 / 2.1 / 0.4 s, the flag and its 2 switches; still exactly five PASS/NOT YET lines and none in the block; `npm run stats` prints the same lines. | 5 |
| 6 | **Broken `flags.json`:** reported in `fileErrors`, the last good value (on) kept, `/flag` refuses (400) and leaves the file as it is; a repaired hand edit is read (off). `/flag` pushes `change {file: flags.json, rev}` over SSE. | 6 |
| 7 | **Page off** (`browser-check.js v09`, v0.9 fixture, config off, T 400): no offer element, the old placeholder; a finished sentence and 3×T pause show nothing; Tab moves focus into a pane; Enter sends; no settle event. | 7 |
| 8 | **Page on** (after `/flag settled-input on` in the page): no offer before T; after T `send? (Tab to send, keep typing to ignore)` with `aria-describedby`; `settle_offer` has cue, length, words, never the text; 1.5 s with the offer showing sends nothing; Tab sends (`settle_accept`, that offer, focus stays, no pane touch); `this is not done,` gets no offer; typing drops the offer (`settle_ignore typed`); Enter with an offer showing → `enter_send` offerShowing true with that offer; Enter before any offer → offerShowing false; Escape drops it and keeps the text; then Tab moves focus; a command (`/stats.`) gets no offer and is no `enter_send`; `/stats` shows the block with 4 offers, 1 Tab, 2 ignored, 1 Enter while showing, and still five verdict lines; every offer has at most one outcome. At 800 and 390 px the offer is on screen, the input keeps at least 120 px, no horizontal scroll. `/flag settled-input off` removes the element; off survives a reload. | 7 |
| 9 | Contrast passes (the offer uses `--muted` on the panel, already checked for the fade line). | 7 |
| 10 | **Demo:** `npm run demo -- v0.9` serves `/state` within about 1 s with the flag on from the demo config and T 1800; a message neither fades nor asks (thresholds 20); the try lines name the pause, Tab, keep typing, Enter still sends and `/flag settled-input off`; that command turns it off; Ctrl+C leaves no process. The v0.8 fixture is unchanged. | 8 |
| 11 | Old checks still passing: p0, p1, p2, v0.3–v0.8, browser p1/p2/v03–v08. | `npm run verify` |

## Deviations

1. The brief says "after the person stops typing". The timer runs on value changes (the `input` event), not on key
   presses, so a paste or an IME commit counts as typing and keys that change nothing (arrows) do not restart it.
2. Escape is a second way to ignore an offer (`settle_ignore how: escape`) besides keeping typing; the brief names
   only the latter. Without it, the only way to get rid of an offer on a finished line would be to change the text.
3. Commands (lines starting with `/`) never get an offer and their Enter is not logged as `enter_send`: Tab must never
   run a command such as `/flag settled-input off`, and `/stats` should time messages only.

## pilot-v0.9: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder.
- Scope: only `pilot/app/**` plus one line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; every earlier script passes, plus v0.9. Demos v0.3 to v0.9: `/state` 200 within about 1 s each; no orphan processes.
- Browser, demo v0.9 (flag on in the demo config only):
  - "Is the letter ready to print?" + a pause showed "send? (Tab to send, keep typing to ignore)". Nothing was sent until Tab: transcript total stayed 100, then 102 after Tab.
  - "And the envelope is ready." + a pause showed the offer; Enter sent it.
  - "Then I go to the post office" (no final punctuation) + a pause showed no offer.
  - `/stats` experiments block matched the session exactly: 3 offers, 1 Tab, 1 Enter while showing, 1 unresolved.
- Usability note, not fixed: at about 800 px the offer takes roughly half the input row, so the end of the line being typed is cut off where you would read it. Behind a flag; worth a look before anyone measures with it for real.

# pilot-v0.10

Frame proposals (experiment behind a flag, default off). Everything runs against `dev/fake-model.js`.

**Reproduce:** `bash pilot/app/dev/verify-v0.10.sh`. It has 63 checks; one of them runs the 32 checks of
`browser-check.js v10` (30 + 2 global). It ends with `ALL v0.10 CHECKS PASSED` and exits non-zero on failure.
- Own ports: server 4830; fakes 5831/5832 (chat, extract), 5833 (frame, morrow) and 5834 (frame, frontier, for the pin
  and fallback checks); browser part 4835/5836/5837 and Chrome 9413; demo part 4978/5983/5984.
- Own throwaway dirs: `.pilot-verify-v10/`, `.pilot-verify-v10b/`, `.pilot-demo-verify10/`.
- The server part seeds from `demo/fixtures/v0.10/` with `fadeAfterTurns`/`askRemoveAfterTurns` raised to 100, so its
  ~16 turns never fade a pane.
- The fixture is generated: `node dev/make-fixture-v10.js` (deterministic, from `demo/fixtures/v0.9/`).

**Everything:** `cd pilot/app && npm run verify` (p0, p1, p2, v0.3–v0.10, browser p1 + p2; the v03–v10 browser checks
run inside their verify scripts).
Last run (Node v25.9.0, Chrome, macOS): `npm run verify` all passed (p0–p2, v0.3–v0.10, browser p1 + p2), no earlier
assertion adapted (old configs gain a `frame` role that is never called while the flag is off). `npm run demo -- v0.3` to
`-- v0.10` each served `/state` within about 1 s, and SIGINT left no process behind.

## Definitions

| Term | Definition |
|---|---|
| flag | `experiments.frameProposals`: `.pilot/flags.json` if it sets it (`/flag frame-proposals on\|off`), else the config, else off |
| FrameIntent | `{pane: map\|kanban, focus?: id, order?: [ids], group?: status\|author}`, `schemas/frame-intent.schema.json`, closed; `{}` = no suggestion |
| fits | the pane is shown with consent and not a tab; every id is a card of that pane (map: decisions, sources; kanban: tasks) and not rejected; no id twice in `order`; at least one of focus, order, group (`frame.check`) |
| proposal | a FrameIntent that fits, written to `frames.json` `pending.<pane>` with `author: model`, the candidate, `fromMessage`, `turn`; `frame_propose` |
| rejected whole | not JSON, not schema-valid, or not fitting: `frame_reject {reason: malformed\|schema\|id\|empty\|pane\|same\|stale, errors}`, nothing written |
| applied | you pressed `f` (focus in that pane) or the apply button: `applied.<pane>` with `appliedBy: user`, `appliedAt`; `frame_apply` |
| reset | `/frame reset [pane]` (or the reset button): `applied.<pane>` removed, `resets.<pane>` `{at, by: user, frame}`; `frame_reset` |

## Checks

| # | Check | How (section of `verify-v0.10.sh`) |
|---|---|---|
| 1 | The FrameIntent table: 29 cases (valid: focus+order, group, order+group, a ```json fence; `{}` = none; not JSON; not an object; no pane; pane index/chat; the unknown keys hide, status, text, add; a number as focus; order not a list; group kind; an empty id; 61 ids; unknown ids; a task in the map; a rejected id; an id twice; nothing to do; a faded kanban; a kanban without consent; a shown kanban) give the documented verdict. The schema has exactly the keys pane, focus, order, group and `additionalProperties: false`. | 1 |
| 2 | **Off by default:** no `experiments` → off, from the default; `frameProposals: false` → off from the config; both shipped configs ship it false with a local, structured `frame` role. `/flag` keeps the settled-input line unchanged and first, then `frame-proposals: off`. `/help` lists `/frame`. A turn makes no frame call (the frame fake sees nothing), writes no `frames.json`, logs no frame event; `POST /frame` → 409; `/frame` says it is off. | 2 |
| 3 | **On:** `/flag frame-proposals on` writes `flags.json`, a system line, a `flag` event (was false) and leaves settled-input alone. The next turn yields `fr-1` for the map (focus dec-2, author model, model morrow, fromMessage, turn 39), `model_call role frame`, `frame_propose`; the request carried `response_format`; the prompt listed only the shown, non-faded map and no rejected card. | 3 |
| 4 | **`POST /frame`:** bad pane or action → 400; stale rev → 409 `{stale, file: frames.json}`; a wrong id → 409. Apply → `applied.map` with `appliedBy`/`appliedAt`, `frame_apply`, a system line naming morrow; apply again → 409. `/frame` lists it. The same suggestion again → `frame_reject same`. Dismiss → `frame_dismiss`, a system line, the applied frame kept. `modules.json` and `state.json` are byte-identical across propose, apply and dismiss. **Re-check on apply:** a proposal whose focus card you then reject by hand → 409 "no longer fits", dropped, `frame_reject stale`. | 4 |
| 5 | **`/why map`** explains the applied frame (what it does; suggested by model morrow after message m-… at turn 39, allographic; applied by you through the page; 2 suggestions rejected whole); every source of `/why`, `/why map`, `kanban`, `index`, `chat` resolves (`why-cites.js`); `/why` has one `frames:` line. `/frame reset kanban` → nothing to reset; `/frame reset map` → `resets.map`, `frame_reset`, a system line; `/why map` then says it was reset; `/frame reset index` → 400. No `item_write` since the flag went on. | 5 |
| 6 | **Every rejection mode of the fake** (`bad`, `badid`, `badkey`, `wrongpane`, `malformed`): rejected whole and logged with its reason, `frames.json` unchanged; `none` → `frame_none`. `bad` (unknown key and unknown id) is refused by the schema before any id is looked at. `state.json` and `modules.json` still untouched. | 6 |
| 7 | **Pins, local-only, stall** (a frame role with local morrow and cloud frontier, policy fallback): morrow down → `fallback_blocked role frame`, `frame_error`, nothing proposed, frontier never asked; `/model frame frontier` → the proposal comes from frontier; pinned frontier down → `frame_error` "pinned", morrow not asked; a frame reply that stalls (`--stall-after=1`, `stallMs` 600) → `stall role frame`, `frame_error stall`, nothing written. | 7 |
| 8 | **Broken `frames.json`:** in `fileErrors`, the last good proposal kept; `POST /frame` 409, `/frame reset` 400, the file unchanged; a turn logs `frame_error frames`; a repaired edit is read. `fade.status` counts card proposals only. A map faded by hand gets no frame call and stays a tab; with the kanban shown instead (by hand) the proposal is for the kanban (focus task-2, task ids only). `/stats` still has five verdict lines and equals `npm run stats`. | 8 |
| 9 | **Page off** (`browser-check.js v10`, v0.10 fixture, flag off): after a turn no frame call, no `frames.json`, no note; `f` on a card does nothing; the status bar does not list the frame role (on: `frame: morrow`). | 9 |
| 10 | **Page on** (`/flag frame-proposals on` in the page): the next turn shows the note within about 0.5 s: `model suggests: focus dec-2 · order dec-2, dec-4, src-1, dec-1, …`, `suggested by morrow, not by you`, dashed, focusable, `f apply \| dismiss \| why?`; the map keeps its own order. `f` in the chat input is text; `f` on a focused button does nothing; Escape on the note returns to the input. `f` on a card applies: order dec-2, dec-4, dec-1, dec-8, dec-7, dec-5, dec-2 marked `frame focus, suggested by morrow` and focused, the frame line `frame fr-1: … · suggested by morrow · applied by you <time> · reset`, sources follow. `/why map` in the page shows the frame with sources. Reset button → own order. Dismiss → no note, nothing applied. At 800 and 390 px the note fits its pane, no horizontal scroll. Real Tab presses from the empty input reach the note (3: the bar's why?, the rejected toggle, the note) and `f` there applies. Flag off hides the applied frame (kept in the file), on shows it again, `/frame reset` restores the order. With the map faded and the kanban shown (by hand) the next proposal is for the kanban; its apply button marks task-2 and puts it first in its column, every column keeps its cards, the map stays a tab. No frame step wrote an item. | 9 |
| 11 | Contrast passes, including the note text, its byline and its keys (`--text`, `--muted`, `--accent-fg` on `--panel`). | 9 |
| 12 | **Demo:** `npm run demo -- v0.10` serves `/state` within about 1 s with frame-proposals on (demo config only), settled-input off, the map shown with 6 decisions (+3 rejected, hidden); the next message yields a proposal for the map (focus dec-2, morrow); the try lines name the note, `f`, `/why map`, `/frame reset map`; Ctrl+C leaves no process; the v0.9 fixture is unchanged. | 10 |
| 13 | Old checks still passing: p0, p1, p2, v0.3–v0.9, browser p1/p2/v03–v09. | `npm run verify` |

## Deviations

1. The brief's demo has "map with 5 decisions". The v0.10 fixture is the v0.9 workbench unchanged: its map shows 6
   decisions (dec-1, 2, 4, 5, 7, 8) and hides 3 rejected ones. Dropping one would mean editing `state.json` after the
   fact, which the pilot's own provenance would then show as a hand edit.
2. The brief leaves `group` open (`group?: ...`). It is a closed enum, `status` or `author`: sub-headings, nothing else
   (QUESTIONS.md).
3. "`f` only when focus is in that pane, same rule as c/r": `c`/`r` act on a focused card only. A frame belongs to the
   pane, not to one card, so `f` works with focus anywhere in that pane (a card, the note, the pane body), with the
   same guards (never the chat input, never a focused button, no modifier, not composing, not a repeat).
4. Dismiss has a button, no key (the brief names only `f`).
5. Besides `good|bad` the fake knows `group`, `none`, `badid`, `badkey`, `wrongpane`, `malformed`, so each rejection
   path is checked on its own.
6. "Off = the old behaviour" holds for the page (no note, no frame line, own order, the status bar without the frame
   role) and the files (no call, no `frames.json`, no event). `/model` and `/state.models` do list the `frame` role
   while it is off, because it is in the config.

## pilot-v0.10: coordinator re-run (2026-10-17)

Run by the coordinator, not the builder.
- Scope: only `pilot/app/**` plus one line in the "Pilot iterations" list of `index.html`.
- `npm run verify`: exit 0; every earlier script passes, plus v0.10. Demos v0.3 to v0.10: `/state` 200 within about 1 s each; no orphan processes.
- Browser, demo v0.10 (flag on in the demo config only):
  - Sent "what about keeping the claim local?" → a dashed note "model suggests: focus dec-2 · order …", "suggested by morrow, not by you". Card order and `state.json` items were unchanged.
  - "apply" reordered the map (dec-2 first); items stayed byte-identical.
  - `/why map` named the frame, the model, the message, who applied it and when, each with a source.
  - `/frame reset map` restored the original order and kept the reset in `frames.json`.
