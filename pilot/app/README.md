# CLI Pilot v1 (steps P0 to P3, iteration pilot-v0.4)

**Quick look (no key, no model, 30 s):** `cd pilot/app && npm run demo -- v0.4` (proposals; v0.3: pins and
fallback), open the printed URL, follow the "try this" lines. A tagged iteration without touching your checkout:
`bash pilot/app/scripts/try.sh pilot-v0.4`.
**pilot-v0.4 extraction is untested with a real model:** it runs against the fake extractor in `dev/fake-model.js`.
What changed per iteration: `CHANGELOG.md`; checks: `CHECKS.md`; open questions: `QUESTIONS.md`.

A local, terminal-looking chat page served by a small Node server. The server proxies
chat to an OpenAI-compatible endpoint and keeps the conversation in `.pilot/transcript.jsonl`.
Node 20.3+, no dependencies, nothing to install.

## Run normally

1. Edit `pilot.config.json`. The model names and hosts in it are placeholders. Each role has an
   ordered list of `candidates` and a `policy`: `manual` uses the active candidate only;
   `fallback` tries the active one first, then the others in order, on error or timeout
   (`timeoutMs` = wait for the first token). Mark candidates on your own machine or network with `local: true`:
   after a local candidate failed, fallback never goes to a non-local one unless the role sets
   `allowCloudFallback: true` (missing `local` = non-local). `stallMs` (top level, default 20000) aborts a reply
   that stops sending tokens after it started; the partial text is kept and nothing falls back.
2. For every candidate with `keyEnv`, export that variable. Keys never go into the config or the
   browser. A missing key counts as a failure, so under `fallback` the next candidate is tried.
3. Start the server and open the page:

```sh
cd pilot/app
export OPENAI_API_KEY=...        # only if the first chat candidate names keyEnv
node server.js
# open http://127.0.0.1:4747
```

The server listens on `127.0.0.1` only and creates `.pilot/` next to `server.js` on first run
(regardless of the directory you start it from).

In the page, type a message and press Enter. Lines starting with `/` are commands:

| Command | Effect |
|---|---|
| `/model` | show roles, policies and candidates |
| `/model <role> <candidate>` | pin a role to a candidate: no fallback until `/model <role> auto`; kept across restarts in `.pilot/roles.json`; the status bar shows `(pinned)` |
| `/model <role> auto` | unpin: back to the role's policy, starting at its first candidate |
| `/theme light\|dark\|auto` | colour theme of this page (handled in the browser, kept in localStorage); `auto` follows the OS |
| `/rules` | the growth rules from `.pilot/rules.json` with current counts |
| `/panes` | panes and your consent answers |
| `/help` | list commands |

**Growth.** After each turn a deterministic controller checks `.pilot/rules.json` (seeded from
`rules.example.json` on first run, re-read every turn, edit it by hand). When a count reaches a
threshold it asks once, e.g. "12 messages. Scrolling back gets slow. Add an index pane?". Answer with
the buttons (always), or press a key while the input is empty (once anything is typed, keys are text): `y` yes, `n` no (ask again when the count has
doubled), `a` always, `x` never. Answers and panes are kept in `.pilot/modules.json`; no pane appears
without a recorded answer. In this build only the index pane exists; click an entry to jump to that
message.

**Proposals (pilot-v0.4).** After each complete reply the `extract` role runs in the background (it never delays
the reply; every `everyNTurns` replies). It gets the last user and assistant message and the existing item titles,
and must return JSON per `schemas/extraction.schema.json` (sent as `response_format` when the candidate has
`structured: true`). The server validates it (fail closed: malformed or schema-invalid output, e.g. more than 3
items, writes nothing and logs `extract_error`), drops items whose `quote` is not in the turn (whitespace/case
ignored) and near-duplicates of existing non-rejected items, keeps at most `maxItems`, and writes the rest to
`.pilot/state.json` as `status: proposed, author: model` with `model`, `quote`, `fromMessage` and ids
`dec-N`/`task-N`/`src-N`. The extract role follows the same pin, local→cloud and stall rules as chat.
Decisions and sources show in the reasoning map pane, tasks on the kanban (todo/doing/done); both panes grow
only through the controller and your answer, like the index. Dashed lavender = proposed by a model (with the
model name), mint = confirmed, rose = rejected (hidden behind "rejected: n (show)" in the pane bar), solid =
added by you. `c` confirms, `r` rejects: on a focused card (Tab, click, arrow keys), or from the chat input
while it is empty, on the outlined proposal (the newest; arrows move the outline). Buttons too. You can add
items by hand-editing `state.json` (`author: "user"`); a broken `state.json` is reported and never overwritten.
`decidedBy` is an extension of the schema, see `schemas/state.schema.json` (pilot/app copy).

The status bar shows the active model per role; `frontier→morrow` means the configured candidate
failed and the next one answered. Every model attempt is logged to `.pilot/metrics.jsonl`.

## Run against the fake endpoint (dev only, no key, no spend)

`dev/fake-model.js` is a fake OpenAI-compatible `/v1/chat/completions` (streaming and
non-streaming, canned replies tagged `[fake:<name>]`; `--delay=<ms>` and `--status=<code>`
simulate a slow or failing endpoint). `pilot.config.dev.json` points the
candidates `frontier` and `morrow` at two local ports. Use three terminals:

```sh
cd pilot/app
node dev/fake-model.js 5701 frontier
node dev/fake-model.js 5702 morrow
PILOT_CONFIG=pilot.config.dev.json node server.js
# open http://127.0.0.1:4747
```

`PILOT_CONFIG` is resolved relative to `pilot/app/`; without it the server uses `pilot.config.json`.
`PILOT_DIR` (relative to `pilot/app/`, must stay inside it) overrides the data folder, e.g. `PILOT_DIR=.pilot-demo`.
`--stall-after=<n>` makes a fake stop sending after n tokens while keeping the connection open.
`--extract=good|malformed|badquote|many|dupes` picks how a fake answers extraction requests (default good:
sentences starting `Decision:` / `Task:` / `TODO` and URLs in the turn become items); `--extract-delay=<ms>`
delays only extraction answers. See the header of `dev/fake-model.js`.

To see fallback, stop the `frontier` fake (Ctrl-C) and send another message.

To see the consent flow quickly, lower the index threshold after the first start (the server re-reads
the file every turn, no restart needed):

```sh
cd pilot/app
node -e 'const f=".pilot/rules.json",fs=require("fs"),r=JSON.parse(fs.readFileSync(f));r.rules.find(x=>x.module==="index").threshold=4;fs.writeFileSync(f,JSON.stringify(r,null,2))'
# send two messages in the page -> the question appears -> press y
```

## Demos and checks

`npm run demo -- <version>` (`scripts/demo.js`) wipes and seeds a throwaway `.pilot-demo/` from
`demo/fixtures/<version>/`, starts the fakes and the server on demo ports (v0.3: 4750, 5751, 5752; v0.4: 4754, 5754, 5755), prints the URL
and what to try. Ctrl+C stops everything. An unknown version lists the available ones. It never touches `.pilot/`.

`npm run verify` (`scripts/verify-all.sh`) runs every `dev/verify-*.sh` and the browser checks and prints a summary.
It refuses to start while `pilot/app/.pilot/` exists, because the P0–P2 checks wipe it.
`dev/verify-v0.3.sh` and `dev/verify-v0.4.sh` use their own ports and dirs and are safe next to a running demo.
`node dev/contrast-check.js` checks the palette (WCAG AA, both themes).

The older checks (each starts and stops everything itself and **wipes `.pilot/` first**;
stop your own server and fakes before running them, they use the same ports):

```sh
bash pilot/app/dev/verify-p0.sh
bash pilot/app/dev/verify-p1.sh
bash pilot/app/dev/verify-p2.sh
node pilot/app/dev/browser-check.js all     # p1 + p2, headless Chrome; needs Node 22+ and Google Chrome
bash pilot/app/dev/verify-v0.3.sh           # own ports/dirs; includes browser-check.js v03 and contrast-check.js
bash pilot/app/dev/verify-v0.4.sh           # own ports/dirs; proposals; includes browser-check.js v04
```

To start over by hand, stop the server and delete `pilot/app/.pilot/`.

## Endpoints

| Method | Path | Does |
|---|---|---|
| GET | `/` | the page (only files under `public/` are served) |
| GET | `/state` | `{transcript: last 500 lines, total, models, panes, pending, answers, items, stateRev, stateError, extracting}` |
| POST | `/chat` | `{text}`: appends the user line, streams the reply as `text/plain`, appends the assistant line |
| POST | `/command` | `{text: "/model chat morrow"}` → `{ok, lines}` (`/state.models.<role>` has `active`, `pinned`, `last`, `candidates`, `local`) |
| POST | `/answer` | `{module: "index", answer: "y"}` (y/n/a/x or yes/no/always/never), or `{itemId: "dec-3", decision: "c"}` (c/r or confirm/reject; proposed items only, records `decidedAt`, `decidedBy: "user"`) |
