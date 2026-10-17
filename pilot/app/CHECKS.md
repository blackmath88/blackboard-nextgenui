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
- `rules.json` is not seeded into `.pilot/` yet (P2).
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

- `/rules` and `/panes` come with P2. The `extract` role is configured and shown, but not called until P3.
