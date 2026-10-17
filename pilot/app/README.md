# CLI Pilot v1 (steps P0 to P4 + P5 metrics, iteration pilot-v0.9)

**Quick look (no key, no model, 30 s):** `cd pilot/app && npm run demo -- v0.9` (experiment: pause on a finished line and
the input offers "send?", Tab sends, Enter always does; v0.8: panes fade to tabs and are removed only with your answer; v0.7: `/why`; v0.6: authorship and `/stats`; v0.5: live files, two tabs; v0.4: proposals; v0.3: pins
and fallback), open the printed URL, follow the "try this" lines. A tagged iteration without touching your checkout:
`bash pilot/app/scripts/try.sh pilot-v0.9`.
**Extraction (since pilot-v0.4) is untested with a real model:** it runs against the fake extractor in `dev/fake-model.js`.
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
| `/panes` | panes (faded ones marked), your consent answers and removal answers |
| `/stats` | the five P5 measures (04-build-plan.md) with thresholds, PASS / NOT YET and the numbers behind each, from `metrics.jsonl` and the files only (also `npm run stats -- <pilotDir>`) |
| `/why` | why the workbench looks like this: one line per pane (rule, question, your answer) and the items in brief, every statement with its source (`file:line`); from the files only, read-only (since pilot-v0.7) |
| `/why <pane>` | `index`, `map`, `kanban`, `chat`: the rule, every question, answer and add, the answer on file; since pilot-v0.8 also fading: last touch, turns since, threshold, what happens next, the removal question |
| `/why <item id>` | e.g. `/why dec-2`: origin, the message it came from (with a "show" link), the quote, who decided it and when, fields changed by hand |
| `/flag` | experiments (pilot-v0.9): each flag, its value and where it comes from |
| `/flag settled-input on\|off` | switch the settled-input experiment; kept in `.pilot/flags.json`, which wins over the config (default off) |
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
added by you. `c` confirms, `r` rejects, **only on a focused proposal card** (since pilot-v0.5): Tab, a click, or
↓/↑ in the empty chat input (lands on the newest proposal) moves focus into the pane; the focused card is outlined;
arrows move between cards; Escape returns to the chat input. In the chat input `c` and `r` are always text. Buttons
too. You can add items by hand-editing `state.json` (`author: "user"`); a broken `state.json` is reported and never
overwritten.
`decidedBy` is an extension of the schema, see `schemas/state.schema.json` (pilot/app copy).

**Live files (pilot-v0.5).** The server watches the data folder (`fs.watch`, also for `PILOT_DIR`; 150 ms debounce;
any event re-stats every file, because the file name in a watch event is only a hint) and pushes `{file, rev}` over
Server-Sent Events (`GET /events`) for every change: its own writes and your hand edits. The page reloads only the
part of `/state` that belongs to that file and re-renders only what changed, so a hand edit of `state.json` shows
within about 0.2 s and two tabs stay in sync. `rev`: JSON files carry a `rev` field the server bumps on every write
(`state.json`, `modules.json`, `roles.json`); for JSONL files (`transcript.jsonl`, `metrics.jsonl`) the rev in the
event is the number of non-empty lines. Writes from the page (`/answer`: consent and confirm/reject) send the rev the
page last saw; a stale one is rejected with 409 `{stale: true}`, the page reloads and shows a short notice (one person:
otherwise the last valid write wins). A hand edit that keeps `rev` is pushed and shown but is not a conflict. A hand
edit that is not valid JSON never crashes the server: `state.json`, `modules.json` and `roles.json` are read as their
last good version (pins included), the page says "file X is not valid JSON, showing last good version" until you fix
it, and the server refuses to write that file meanwhile. Without SSE (no EventSource, or the connection is down) the
page falls back to refreshing after each action and polling during an extraction; EventSource reconnects by itself
and the page then reloads everything.

**Authorship and metrics (pilot-v0.6).** Every line says who wrote it: `you` (peach), `model` + model name (sky),
`controller` (lavender), `system`. Every card says its author (`model · morrow` or `you`) and who decided it
(`confirmed by you 10-14 09:06`), and every pane bar says which rule grew it and which answer allowed it
(`controller · messages ≥ 12 · you: yes`). A hand edit of `state.json` reads **"you (file edit)"**:
- How it is detected: every item the server creates or decides is copied into `metrics.jsonl` as an `item_write`
  event (the write ledger). A field that differs from that copy was changed by hand, also while the server was down.
- What it looks like: `confirmed by you (file edit)` for a status, `edited by you (file edit): column` for other
  fields, and `you (file edit)` for an item added by hand.
- Limits: an item without a ledger entry (older data) shows its declared author. A `modules.json` answer without a
  matching consent event reads `you (file edit)` in the pane bar.

`metrics.jsonl` (append-only) logs these events for the P5 acceptance checks:
- `server_start` (with counts) and `turn`
- `consent` (with `id`) and `controller_add` (with `answerRef` = that id)
- `controller_ask`, `decide`, `index_jump` (sent by the page via `POST /metric`)
- pilot-v0.8: `pane_touch`, `pane_fade`, `pane_unfade`, `pane_remove`, `controller_withdraw`; `controller_ask` and
  `consent` with `question: "remove"` for the removal question
- `item_write` and `file_edit`
- pilot-v0.9, only while the experiment is on: `settle_offer`, `settle_accept`, `settle_ignore`, `enter_send`; `flag`
  on every `/flag` switch

`/stats` and `npm run stats -- <dir>` print the five measures from those events. `<dir>` is resolved against the
directory you ran npm from; the default is `pilot/app/.pilot`. Both are read-only. Definitions (work session, hour of
work): `CHECKS.md` # pilot-v0.6.

**Why (pilot-v0.7).** `/why`, or the "why?" button on a pane bar or a card (Tab reaches it, Enter presses it),
explains what is on screen from recorded facts only (`why.js`; no model, no writes). Each statement ends with its
sources: `metrics.jsonl:60 controller_ask`, `transcript.jsonl:5 m-f005` (physical line numbers), `modules.json:14 panes
index`, `state.json:18 items dec-2` (the entry's line in the file as it is now). What is not recorded is said: "no
recorded answer", "set by you (file edit), when is not recorded", "the server never wrote it". Narrow layouts: labels
never break mid-word; the kanban stacks its columns when its body is narrower than 420 px.

**Panes can go (pilot-v0.8).** A pane nobody touched for `fadeAfterTurns` turns (a turn = a message you sent) fades
to a tab: a slim labelled strip in its place, `▸ kanban  tab · untouched since turn 22`. The other panes take the
height. Click the tab, or Tab to it and press Enter, and the pane is back at once. Fading is not removal: the pane stays
in `modules.json` with `"state": "faded"`. After `askRemoveAfterTurns` more turns as a tab the controller asks once:
"Remove the kanban pane?". `y` removes it (its rule may offer it again once its count has doubled), `n` keeps the tab,
`x` removes it for good. The answer is recorded like any consent (`removals` in `modules.json`, a `consent` event with
`question: "remove"`); no rule ever removes a pane.
- **Touch:** a click, a wheel/touch scroll, or keyboard focus you move into the pane; confirming or rejecting one of its
  cards; the tab. Only the first touch of a pane per turn is recorded (`lastTouch` in its `modules.json` entry, a
  `pane_touch` event). Touching a pane whose removal question is open withdraws the question; it can come again after the
  pane has faded again (looking is not an answer). An answered question is not asked again for that pane.
- **Never faded:** the chat, and a pane holding an unanswered proposal (a tab would hide a decision). A proposal that
  arrives in a faded pane brings it back.
- **Settings** in `rules.json`: `"fadeAfterTurns": 8, "askRemoveAfterTurns": 8` at the top level (default), or on a
  rule to override it for that pane. A missing key switches that step off. A `.pilot/rules.json` seeded before
  pilot-v0.8 has neither; to turn fading on there:

```sh
cd pilot/app
node -e 'const f=".pilot/rules.json",fs=require("fs"),r=JSON.parse(fs.readFileSync(f));r.fadeAfterTurns=8;r.askRemoveAfterTurns=8;fs.writeFileSync(f,JSON.stringify(r,null,2))'
```

**Experiment: Enter, diffused (pilot-v0.9, off by default).** D9 keeps Enter in v1; this is the experiment behind a
flag. Switch it on with `"experiments": {"settledInput": true}` in `pilot.config.json` or `/flag settled-input on`
(kept in `.pilot/flags.json`, hand-editable, wins over the config). Then, after `settleMs` (default 1800) without a
change to the input, on a line that looks finished (ends in `.` `!` `?`, or is a question; not on `...`, `,`, `e.g.`,
an open bracket, a command; the cases are in `public/settle.js` and CHANGELOG.md # pilot-v0.9), a quiet
`send? (Tab to send, keep typing to ignore)` appears next to the input. Tab sends, typing or Escape drops it, Enter
always sends. Nothing is sent without a key. Tab while the offer shows sends instead of moving focus. The page logs
`settle_offer`, `settle_accept`, `settle_ignore`, `enter_send` (numbers only, never the text); `/stats` ends with an
"experiments" block that counts them and the time from the last keystroke to the send. Off: exactly the old prompt.

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
`demo/fixtures/<version>/`, starts the fakes and the server on demo ports (v0.3: 4750, 5751, 5752; v0.4: 4754, 5754, 5755; v0.5: 4758, 5758, 5759; v0.6: 4764, 5764, 5765; v0.7: 4768, 5768, 5769; v0.8: 4772, 5772, 5773; v0.9: 4776, 5778, 5779), prints the URL
and what to try. Ctrl+C stops everything. An unknown version lists the available ones. It never touches `.pilot/`.

`npm run verify` (`scripts/verify-all.sh`) runs every `dev/verify-*.sh` and the browser checks and prints a summary.
It refuses to start while `pilot/app/.pilot/` exists, because the P0–P2 checks wipe it.
`dev/verify-v0.3.sh` to `verify-v0.9.sh` use their own ports and dirs and are safe next to a running demo.
The v0.6 demo fixture is generated by `node dev/make-fixture-v06.js` (synthetic, every line `"fixture": true`), the v0.8
one by `node dev/make-fixture-v08.js` (from the v0.7 fixture), the v0.9 one by `node dev/make-fixture-v09.js` (from v0.8).
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
bash pilot/app/dev/verify-v0.5.sh           # own ports/dirs; live files, stale rev, c/r; browser-check.js v05, dev/sse-probe.js
bash pilot/app/dev/verify-v0.6.sh           # own ports/dirs; authorship, P5 events, /stats, npm run stats; browser-check.js v06
bash pilot/app/dev/verify-v0.7.sh           # own ports/dirs; /why, cited sources resolved (dev/why-cites.js); browser-check.js v07 (layout)
bash pilot/app/dev/verify-v0.8.sh           # own ports/dirs; fading, touches, removal consent, /why fading; browser-check.js v08
bash pilot/app/dev/verify-v0.9.sh           # own ports/dirs; settled-input flag, heuristic, settle metrics, /stats block; browser-check.js v09
```

To start over by hand, stop the server and delete `pilot/app/.pilot/`.

## Endpoints

| Method | Path | Does |
|---|---|---|
| GET | `/` | the page (only files under `public/` are served) |
| GET | `/state` | `{transcript: last 500 lines, total, turn, models, panes (faded ones included), faded, pending, pendingKind, answers, removals, modulesRev, paneInfo (with fade), items (with prov when hand-edited), stateRev, stateError, flags (pilot-v0.9: {settledInput, settleMs, source, rev}), extracting, fileErrors}`; `?only=state.json,modules.json,flags.json,…` returns only the parts of those files (plus `extracting`, `fileErrors`) |
| GET | `/events` | Server-Sent Events: `hello {revs, extracting}`, then `change {file, rev[, error]}` per changed file and `status {extracting}` |
| POST | `/chat` | `{text}`: appends the user line, streams the reply as `text/plain`, appends the assistant line |
| POST | `/command` | `{text: "/model chat morrow"}` → `{ok, lines}` (`/state.models.<role>` has `active`, `pinned`, `last`, `candidates`, `local`) |
| POST | `/answer` | `{module: "index", answer: "y"}` (y/n/a/x or yes/no/always/never; the removal question takes y/n/x), or `{itemId: "dec-3", decision: "c"}` (c/r or confirm/reject; proposed items only, records `decidedAt`, `decidedBy: "user"`). Optional `rev` (of `modules.json` / `state.json`): stale → 409 `{stale: true, file, rev}`; a broken file → 409 |
| POST | `/touch` | `{module, how}` (pilot-v0.8; how: click, focus, scroll, decide, tab): records a touch of a shown pane and brings a faded one back. The first touch of a pane per turn is written; later ones return `changed: false`. No rev. `chat` → 400, a pane not shown → 404 |
| POST | `/metric` | `{event: "index_jump", target: "<message id>"}` (pilot-v0.6; the page sends it on an index click). pilot-v0.9, only while the settled-input flag is on: `settle_offer {offer, cue, chars, words, sinceKeyMs}`, `settle_accept {offerRef, sinceKeyMs, offerMs, chars}`, `settle_ignore {offerRef, how, offerMs}`, `enter_send {offerShowing, offerRef?, sinceKeyMs, chars}` (other fields dropped; one outcome per offer). Any other event or an unknown id → 400 |
