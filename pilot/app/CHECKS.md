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
