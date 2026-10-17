# CLI Pilot v1 (steps P0 to P2, iteration pilot-v0.3)

**Quick look (no key, no model, 30 s):** `cd pilot/app && npm run demo -- v0.3`, open the printed URL, follow the
"try this" lines. A tagged iteration without touching your checkout: `bash pilot/app/scripts/try.sh pilot-v0.3`.
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
`demo/fixtures/<version>/`, starts the fakes and the server on demo ports (v0.3: 4750, 5751, 5752), prints the URL
and what to try. Ctrl+C stops everything. An unknown version lists the available ones. It never touches `.pilot/`.

`npm run verify` (`scripts/verify-all.sh`) runs every `dev/verify-*.sh` and the browser checks and prints a summary.
It refuses to start while `pilot/app/.pilot/` exists, because the P0–P2 checks wipe it.
`dev/verify-v0.3.sh` uses its own ports and dirs and is safe next to a running demo.
`node dev/contrast-check.js` checks the palette (WCAG AA, both themes).

The older checks (each starts and stops everything itself and **wipes `.pilot/` first**;
stop your own server and fakes before running them, they use the same ports):

```sh
bash pilot/app/dev/verify-p0.sh
bash pilot/app/dev/verify-p1.sh
bash pilot/app/dev/verify-p2.sh
node pilot/app/dev/browser-check.js all     # p1 + p2, headless Chrome; needs Node 22+ and Google Chrome
bash pilot/app/dev/verify-v0.3.sh           # own ports/dirs; includes browser-check.js v03 and contrast-check.js
```

To start over by hand, stop the server and delete `pilot/app/.pilot/`.

## Endpoints

| Method | Path | Does |
|---|---|---|
| GET | `/` | the page (only files under `public/` are served) |
| GET | `/state` | `{transcript: last 500 lines, total, models, panes, pending, answers}` |
| POST | `/chat` | `{text}`: appends the user line, streams the reply as `text/plain`, appends the assistant line |
| POST | `/command` | `{text: "/model chat morrow"}` → `{ok, lines}` (`/state.models.<role>` has `active`, `pinned`, `last`, `candidates`, `local`) |
| POST | `/answer` | `{module: "index", answer: "y"}` (y/n/a/x or yes/no/always/never) |
