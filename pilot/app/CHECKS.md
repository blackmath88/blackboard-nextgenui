# CHECKS: P0 Skeleton

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
- Default config with `OPENAI_API_KEY` unset: no network request; the transcript gets
  `system: chat failed: environment variable OPENAI_API_KEY is not set for candidate "frontier"`.
- `fake-model.js` non-streaming (`stream` absent) returns a `chat.completion` JSON; streaming returns
  `chat.completion.chunk` SSE lines ending with `data: [DONE]`.
- Not exercised in a browser: typing into the input and watching the reply stream in (headless
  Chrome only loaded the page). The coordinator should try one message by hand.
- `node --check` passes on all JS files; `server.js` does not reference `dev/`.

## Deviations from the brief

1. **Location:** the brief's `cli-pilot/` tree lives at `pilot/app/`.
2. **`PILOT_CONFIG=<path>` env override** (resolved relative to `pilot/app/`, default
   `pilot.config.json`) so dev runs can use `pilot.config.dev.json`.
3. **Dev-only files:** `dev/fake-model.js`, `dev/verify-p0.sh`, `pilot.config.dev.json`. The normal
   start path (`node server.js`) never references them.
4. The server binds to `127.0.0.1`, not all interfaces.

## Deferred (by design, later steps)

- P0 uses only `roles.chat.candidates[0]`; `policy` (manual/fallback), `/model` and the status bar
  are P1. The dev config's `fallback` policy is therefore ignored for now.
- `rules.json` is not seeded into `.pilot/` yet (P2).
- `rev` is not tracked for the transcript yet (P4); appends are atomic full rewrites.
- No `/events`, SSE to the browser, `fs.watch`, extraction or proposals.
- `pixel.js` is copied from the workbench; one sprite (`teletype`) is used as the title-bar icon.
