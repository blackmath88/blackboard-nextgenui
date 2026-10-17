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
- (v0.8) The stakes are higher for the removal question: it appears right after a reply, so a next message starting
  with "y" ("yes, and…", "you…") removes a pane, and one starting with "x" removes it for good. Not changed (the brief
  says "recorded like any consent"). One more option: require focus on the question for removal only.

## 2026-10-17 (v0.6) How strict should the P5 thresholds be read?
`/stats` reads the build plan's proposed thresholds literally and adds only what was needed to make each measurable
(definitions in CHECKS.md # pilot-v0.6):
- Quiet: asks ≤ ceil(hours of work), and only after 1 h of work.
- Usefulness: a work session ends at a gap of more than 30 min.
- Signal: no minimum sample, so 1 confirmed of 1 already passes.
- Blocks: nothing. It matters on day 7 of the dogfood week.
- Options: keep; add a minimum sample for Signal (e.g. 10 decided); make "no more than once per hour" mean "never two
  asks within one hour of work" (stricter than the rate); move the thresholds into `rules.json` so they can be tuned
  by hand.

## 2026-10-17 (v0.6) Hand edits of transcript lines
Authorship of hand edits covers `state.json` items and `modules.json` answers. A hand-edited `transcript.jsonl` line
still shows its `role` as author (no ledger for lines).
- Blocks: nothing. Options: keep; or log a hash per appended line and mark lines that differ as "you (file edit)".

## 2026-10-17 (v0.8) What do y/n/x mean for "remove the map pane?"
The brief says: "`n` keeps it as a tab; a removed pane can come back through its growth rule only if its answer was not
`x`". Read as:
- `y` removes, and the rule may offer the pane again later (as a new question, once the count has doubled);
- `x` removes for good;
- `a` is refused (400; in the empty input it stays text).
- Blocks: nothing.
- Options:
  - keep;
  - give `a` a meaning ("always remove faded panes without asking"). That would be the first rule that removes without
    a per-pane answer, so it is not built;
  - let `y` re-add without asking when the old growth answer was "always" (now it always asks).

## 2026-10-17 (v0.8) Fading is on for new pilot dirs only
`rules.example.json` now has `fadeAfterTurns: 8` and `askRemoveAfterTurns: 8`. It is copied only when `.pilot/` has no
`rules.json`, so an existing `.pilot/rules.json` has neither key and nothing fades there until you add them by hand.
- Blocks: nothing. It matters if the dogfood week runs on a `.pilot/` started before pilot-v0.8.
- Options:
  - keep (files are the truth; nothing changes behind your back);
  - use built-in defaults when the keys are missing;
  - have the server add the keys once with a system line.

## 2026-10-17 (v0.8) Are 8 and 8 the right defaults?
They are guesses: a pane fades after 8 untouched messages and is offered for removal after 8 more. The v0.6/v0.7
fixtures have about 7 messages from you per work session (22 over three sessions), so a pane fades after roughly one
session without use.
- Blocks: nothing. Tune after a few days of dogfooding (`pane_fade` vs `pane_touch` with `unfaded` in `metrics.jsonl`).

## 2026-10-17 (v0.8) "Once per pane" means once per pane entry
The removal question is asked at most once for a pane entry in `modules.json` (`removalAsked`). A pane that was removed
and grows again through its rule is a new entry and gets its own question. A question withdrawn by a touch does not
count as asked.
- Blocks: nothing. Options: keep; or once per module, ever (then a re-grown pane could never be offered for removal).

## 2026-10-17 (v0.9) Building the Enter experiment before P5 passes
`06-open-questions.md` lists "Diffusing the Enter key" with the condition "P5 passes (D9)", and D9 says it becomes v2's
first step only then. The v0.9 brief asks for it now, behind a flag that is never the default.
- Read as: build it, keep it off everywhere except the v0.9 demo config, and keep its events out of the five P5
  measures (they are counted apart and not judged). With the flag off nothing is rendered or logged, so a dogfood
  week on the default config measures exactly what D9 protects.
- Blocks: nothing. Options: keep; or remove the flag from `pilot.config.json` until P5 passes (config-only via
  `/flag`).

## 2026-10-17 (v0.9) Tab sends while the offer shows
Since pilot-v0.5 Tab moves focus from the input into the panes (and since v0.8 that is a `focus` touch). While a
"send?" offer is visible, Tab sends instead. Without an offer, with Shift, or with the flag off, Tab is unchanged.
- Blocks: nothing. It matters if you Tab to the proposals right after a finished sentence: you send it.
- Options: keep (it is what the brief asks); use another key for the accept (e.g. Ctrl+Enter, but that is just
  another Enter); or accept with Tab only after a second pause.

## 2026-10-17 (v0.9) No baseline from before the flag
With the flag off nothing new is logged (off = exactly today), so there is no "time from last keystroke to send" for
plain Enter use. Inside the experiment the baseline is `enter_send` with `offerShowing: false`.
- Blocks: nothing. Options: keep; or log `enter_send` also when the flag is off (one metric line per message, which
  changes what off means).

## 2026-10-17 (v0.9) The heuristic is English only, and T is a guess
`looksFinished` knows English question words and abbreviations only; a German "Ist das fertig" without `?` gets no
offer, "z.B." and "bzw." are treated as continuing. T = 1800 ms is a guess.
- Blocks: nothing. Tune with the `/stats` experiments block: many `settle_ignore typed` means T is too short or the
  heuristic too eager; many `enter_send` with an offer showing and a short `offerMs` means the offer comes too late.

## 2026-10-17 (v0.10) What may `group` say?
The brief writes `group?: ...`. Built as a closed enum: `status` (proposed / confirmed / rejected) or `author` (you /
model), shown as sub-headings inside each list; nothing is hidden.
- Blocks: nothing. Options: keep; add `kind` or `column` (the map and kanban already split by those); drop `group`
  until a real model shows a use for it.

## 2026-10-17 (v0.10) May a frame name a rejected card?
No: a frame whose focus or order names a rejected card is rejected whole. Rejected cards are hidden behind "rejected: n
(show)"; a frame that focuses one would bring back, by a model's choice, what you rejected.
- Blocks: nothing. Options: keep; allow them in `order` only (they are sorted but stay hidden unless you show them).

## 2026-10-17 (v0.10) An applied frame while the flag is off
With `/flag frame-proposals off` an applied frame is not shown and no proposal is made, but `frames.json` keeps it, and
it is back when the flag is on again. `/frame reset` works either way.
- Blocks: nothing. Options: keep (off = exactly the old screen); or reset every applied frame when the flag goes off.

## 2026-10-17 (v0.10) A frame call after every reply
While the flag is on, the frame role runs after every complete reply (after extraction), whenever a map or kanban is
shown and not a tab. With a local model that is a second background call per turn.
- Blocks: nothing. Options: keep; add `everyNTurns` like extract; call it only when the turn changed cards (an
  extraction proposed something, or you decided one).

## 2026-10-17 (v0.10) No /stats block for frames yet
`metrics.jsonl` has every frame event (`frame_propose`, `frame_reject` with its reason, `frame_none`, `frame_error`,
`frame_apply`, `frame_dismiss`, `frame_reset`), but `/stats` does not count them. The five P5 measures are unchanged.
- Blocks: nothing. Options: add an experiments line "frames: n proposed, n applied, n dismissed, n reset, n rejected"
  (measured, not judged, like settled input); or wait for a real model, since the fake's apply rate means nothing.
