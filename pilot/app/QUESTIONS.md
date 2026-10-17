# QUESTIONS

Open questions for the coordinator/user. Each: date, question, what it blocks, options.

## 2026-10-17 Where is Morrow?
Morrow (nebuchadnezzar) was not reachable over Tailscale on 2026-10-17; v0.4 extraction will be built against a
fake extractor and marked untested with a real model. Which host/port is Morrow on?
- Blocks: testing v0.4 extraction (and any `local: true` candidate) against a real model.
- Options: give host:port once it is up; or keep building against `dev/fake-model.js` and test later.

## 2026-10-17 Old P0–P2 checks wipe `pilot/app/.pilot/`
`dev/verify-p0.sh`, `verify-p1.sh`, `verify-p2.sh` and `dev/browser-check.js p1|p2` start with `rm -rf .pilot`
(they predate the rule "never delete or rewrite a real `.pilot/`"). They were not rewritten in v0.3 (only
assertions changed by the v0.3 decisions were adapted). As a guard, `npm run verify` refuses to start while
`pilot/app/.pilot/` exists. The new v0.3 checks use their own dirs (`.pilot-verify-v03*/`, `.pilot-demo-verify/`).
- Blocks: nothing now; it is a risk once someone dogfoods with a real `.pilot/` in this folder.
- Options: (a) move the old scripts to `PILOT_DIR=.pilot-verify-p*` in a later iteration (small change, but
  rewrites baseline checks); (b) keep the guard in `verify-all.sh` only; (c) both.

## 2026-10-17 Where does `allowCloudFallback` live?
Chosen: per role (`roles.chat.allowCloudFallback: true`), not top level, so e.g. a `title` role could allow cloud
while `chat` does not. A top-level default is not read.
- Blocks: nothing. Options: keep per role; or add a top-level default that roles override.

## 2026-10-17 More than 3 extracted items: reject all, or keep the first 3?
Chosen (v0.4): an extractor response with more than 3 items violates the closed schema (`maxItems: 3`) and is
rejected whole (nothing written, `extract_error`), per "nothing half-valid is written". A config `maxItems` below 3
is a cap: valid survivors beyond it are dropped one by one (`extract_drop maxItems`).
- Blocks: nothing. Matters once a real model without structured output returns 4 items.
- Options: keep fail-closed; or treat > 3 as "keep the first 3 that pass the checks".

## 2026-10-17 `c`/`r` in the empty input can decide a proposal by accident
Per the brief, `c`/`r` act from the empty chat input on the outlined proposal (same rule as y/n/a/x). Unlike a
consent question, a proposal is outlined most of the time, so a message starting with "c" or "r" typed into an empty
input decides a proposal on its first keystroke (there is no undo; the decision is shown as a system line).
- Blocks: nothing; it is a usability risk during dogfooding.
- Options: keep; act from the input only right after a new proposal arrived; require focus in a pane (Tab) for
  keys; or add an undo for decisions.
- **Closed (pilot-v0.5): require focus in a pane.** `c`/`r` act only on a focused proposal card (Tab, click, or ↓/↑
  from the empty input; Escape back). In the chat input they are always text. Buttons unchanged; no undo added.

## 2026-10-17 Which name goes into `item.model`?
Chosen: the candidate name (e.g. `morrow`), the same value the transcript stores in `model`; `metrics.jsonl`
`extract` events carry both candidate and model id.
- Blocks: nothing. Options: keep; or store the model id (`qwen3:14b`) instead or in addition.

## 2026-10-17 y/n/a/x and a question that arrives by push
Since pilot-v0.5 a consent question can appear by push (another tab, a background extraction crossing a threshold),
while someone is about to type a message starting with y, n, a or x into the empty input. That is the same accident
class as the old `c`/`r` (one keystroke answers). The brief keeps the v0.3 rule (empty input), so nothing changed.
- Blocks: nothing; it is a usability risk during dogfooding.
- Options: keep; ignore y/n/a/x for ~1 s after a question appeared; require focus on the question (Tab), like c/r.

