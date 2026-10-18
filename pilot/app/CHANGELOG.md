# CHANGELOG

P0 to P2 (skeleton, model roles, growth controller with consent and the index pane) are the pre-iteration
baseline, merged before the numbered iterations started; see `CHECKS.md` (# P0, # P1, # P2). Iterations are
tagged `pilot-v0.N` by the coordinator; each one is runnable with `npm run demo -- v0.N`.

## pilot-ui (branch `pilot-ui`, untagged)

Closer to a real chat app: several chats, one shared board. Built on `pilot-mistral` (the chat model reads the board).
Tested against the fakes only.

**Adds**
- **Chats (left sidebar).** `+ new` starts a chat; click one to open it; double-click a title to rename it (Enter
  saves, Esc cancels, empty = back to the automatic title). The list is newest activity first; a title is the stored
  one, else the first sentence of the chat's first message. The open chat is kept in this browser (localStorage).
  - **One board for all chats.** Map, kanban and proposals are shared: a decision confirmed in one chat is a
    constraint in every chat (the board context goes into each chat call). The model sees only the open chat's history.
  - **Files.** Every transcript line now carries `chat`; lines without one belong to the first chat `c-1`, so old
    transcripts load unchanged. Controller and system lines land in the chat you were last in (the last message or
    chat switch). `.pilot/chats.json` `{rev, chats: [{id, title?, createdAt}]}` is hand-editable; a broken one is read
    as its last good version and never written. Metrics: `chat_new`, `chat_rename`.
  - **Log and index** show the open chat only; a pending controller question shows in every chat. Chat switching is
    blocked while a reply streams.
  - **API.** `POST /chat {text, chat?}` (default `c-1`; an unknown chat is 400). `POST /chats {action: "new", title?}
    | {action: "open", id} | {action: "rename", id, title}`. `/state` gains `chats`, `chatsRev`, `defaultChat`.
- **Theme switch** under the chat list: auto → light → dark, in sync with `/theme`.
- **Kanban drag and drop.** Drag a confirmed task to another column, or focus it and press ← / →. Proposed tasks are
  confirmed first (a proposal is not state); rejected ones do not move. `POST /move {itemId, column, rev?}` records
  `movedAt` and `movedBy: "user"` (the card says "moved by you"), writes the item to the ledger (so it is not shown as
  a file edit), logs `move`, and counts as a touch of the kanban pane. A stale `rev` gets 409 like `/answer`.

## pilot-v0.10

Frame proposals: an experiment behind a flag, never the default. 02-morph's rule, applied to the pilot: a model may only
*propose* a frame, a closed vocabulary decides what it can say, and you decide whether it applies. The frame is
allographic paratext (03-rolle-und-kodex): written about your workbench by someone other than you, so it says so. Still
untested with a real model (fakes only).

**Adds**
- **The flag.** `experiments.frameProposals` in `pilot.config.json` (default `false`; both shipped configs say so), or
  `/flag frame-proposals on|off` (kept in `.pilot/flags.json`, wins over the config, like settled-input). `/flag` now
  prints one line per flag; the settled-input line is unchanged and first. `/state.flags` gains `frameProposals` and
  `frameSource` (`source` still names the settled-input source).
- **Off = the old behaviour.** No frame role call, no `frames.json`, no event, no note, cards in their own order, `f`
  is an ordinary key, and the status bar does not list the frame role (it appears there only while the flag is on).
  `POST /frame` answers 409 "experiment is off". `/model` lists the role, since it is in the config.
- **A `frame` role** in the config (both shipped configs: one local candidate `morrow`, `structured: true`; the dev
  config points it at the morrow fake). It runs after a complete reply, in the background, queued after that turn's
  extraction (its proposals are cards a frame may name), and only while a map or kanban is shown and not a tab;
  otherwise there is no call at all. Through `callRole` it obeys pins (`/model frame <name>`), the local-only fallback
  rule and `stallMs` like every role; a failure or stall logs `frame_error` and writes nothing. `/state.framing` says
  when a run is queued or running.
- **The closed FrameIntent** (`schemas/frame-intent.schema.json`, checked by `frame.js`):
  `{pane: "map" | "kanban", focus?: item id, order?: [item ids], group?: "status" | "author"}`, `additionalProperties:
  false`. `{}` means "no suggestion" (`frame_none`). On top of the schema the pane must be shown with consent and not a
  tab, and every id must be a card of that pane that is not rejected; an id twice in `order`, or an intent with nothing
  to do, is refused. Anything else (an unknown key such as `hide`, `status`, `text`, `add`; an unknown or foreign id;
  pane `index`; not JSON) rejects the whole intent: `frame_reject {reason, errors}` in `metrics.jsonl`, nothing written.
  A suggestion equal to the applied or the open one is `frame_reject reason same`.
- **The hand validator moved to `schema-check.js`** (unchanged), so extraction and frames use the same code, and an
  unsupported schema keyword still fails at startup.
- **`.pilot/frames.json`** `{rev, pending: {pane}, applied: {pane}, resets: {pane}}`: one open proposal and one
  applied frame per pane. A proposal records `id` (`fr-N`), the intent, `author: "model"`, `model` (candidate) and
  `modelId`, `at`, `fromMessage`, `turn`; an applied frame adds `appliedBy: "user"` and `appliedAt`; a reset records
  `{at, by: "user", frame}`. Hand-editable like the other JSON files: `rev`, pushed over SSE, a broken file is read as
  its last good version, shown in `fileErrors` and never written (`POST /frame` 409, `/frame reset` 400, a turn logs
  `frame_error reason frames`). A frame never writes `modules.json` or `state.json`.
- **The page.** A proposal is a dashed lavender note at the top of its pane: `model suggests: focus dec-2 · order dec-2,
  dec-4, src-1, dec-1, …` and, muted, `suggested by morrow, not by you`, with `f apply`, `dismiss` and `why?`. Nothing
  changes until you apply it:
  - **`f`** applies it while focus is in that pane (a card, the note itself, or the pane body), never from the chat
    input, never on a focused button, with the same guards as `c`/`r` (no modifier, not composing, not a repeat). The
    note is focusable (Tab reaches it, Escape returns to the input). The buttons work too.
  - **Applied**, the frame only arranges: cards named in `order` come first in that order (the rest keep theirs; it
    applies to the decision chain, the sources and each kanban column alike), the `focus` card gets a lavender bar and
    the chip `frame focus, suggested by morrow` and is scrolled to, `group` adds sub-headings. Nothing is hidden, no
    card or text changes. A muted line at the top says `frame fr-1: … · suggested by morrow · applied by you 10-17 15:54
    · reset`.
  - With the flag off an applied frame is not shown (it stays in `frames.json` and comes back when the flag is on).
- **`POST /frame {pane, id, action: apply|dismiss, rev?}`**: only the page (you) applies or dismisses. Apply checks the
  intent again against what is on screen now; one that no longer fits (a card was rejected or removed, the pane became
  a tab) is dropped with 409 and `frame_reject reason stale`. A stale `rev` is 409 `{stale: true}` like the other files.
  Each step adds a system line and an event: `frame_apply {id, module, intent, by: "user", model, proposedAt}`,
  `frame_dismiss`.
- **`/frame`** lists, per pane, the applied frame and the open proposal; **`/frame reset [map|kanban]`** puts a pane
  (or both) back in its own order (`frame_reset`, a system line, `resets.<pane>`). Reset works with the flag off too: a
  frame must always be undoable.
- **`/why map` and `/why kanban`** explain a frame when one is on file: what the applied frame does, which model
  suggested it after which message (with a "show" link), that you applied it and when, an open proposal, the last
  reset, how many suggestions for that pane were rejected and why (by recorded reason). Every statement cites `frames.json:N applied.map`,
  `metrics.jsonl:N frame_propose fr-1`, `frame_apply`, `frame_reset` (resolved by `dev/why-cites.js`, which learned the
  `frames.json` labels). A frame in the file without a matching event reads "written by file edit, when is not
  recorded". `/why` (the whole workbench) gets one `frames:` line. Without frames the explanations are as before.
- **Fake:** `dev/fake-model.js --frame=good|group|none|bad|badid|badkey|wrongpane|malformed`. Frame requests are
  recognised by `PILOT-FRAME` before the extraction test (both carry `response_format`). `good` frames the first pane
  with cards: focus = the card sharing most words with your last message, then the rest by score, newest first.
- **Demo `v0.10`** (`dev/make-fixture-v10.js`, from the v0.9 fixture): the same workbench; `frameProposals: true` and
  `settledInput: false` in the demo config only (Tab must move focus into the map, not send).
- **Dev:** `dev/verify-v0.10.sh` (63 checks, one runs `browser-check.js v10` with 32 checks: 30 + 2 global);
  `contrast-check.js` covers the note, its byline and its keys.

**Why**
- 02-morph ends on the question of authority: who owns the frame? This build answers it for one small case: the model
  may say how a pane could be arranged, in a vocabulary that has no word for adding, hiding, changing or deciding, and
  only your key makes it so. 06-open-questions puts "frame provenance in the UI" at "when panes start re-ordering";
  they now do, so every frame says who suggested it and who applied it, and `/why` can tell.

**Deliberately does not**
- No hiding, collapsing, resizing or re-titling; no layout change of the workbench; no frame for the index or the chat.
- No frame for a pane that is a tab, and a frame never brings one back or keeps one from fading (`fade.js` counts card
  proposals only).
- No automatic apply, no "always apply", no learning from what you apply or dismiss.
- No `everyNTurns` for the frame role (it runs after every reply while the flag is on; see QUESTIONS.md).
- No `/stats` block for frames yet: the events are in `metrics.jsonl` (`frame_propose`, `frame_reject`, `frame_none`,
  `frame_error`, `frame_apply`, `frame_dismiss`, `frame_reset`), the five P5 measures are unchanged.
- Untested with a real model.

## pilot-v0.9

Enter, diffused: an experiment behind a flag, never the default. The blackboard explainer hands on "how does Enter
disappear?". This iteration tries one answer: the input notices that you have stopped and that the line looks finished,
and offers to send it. It never sends by itself. D9 stands: the chat keeps its Enter key, the flag is off unless you
switch it on. Still untested with a real model (fakes only; the experiment uses no model at all).

**Adds**
- **The flag.** `experiments.settledInput` in `pilot.config.json` (default `false`; both shipped configs say so), or
  `/flag settled-input on|off`:
  - `/flag` writes `.pilot/flags.json` `{rev, experiments: {settledInput}}`. That file wins over the config and
    survives restarts; `/flag` alone shows the value and where it comes from (flags.json, the config, or the default).
  - Each switch adds a system line ("experiment settled-input on (/flag) …") and a `flag` event. A system line is not
    a turn.
  - `flags.json` is hand-editable like the other JSON files: it carries a `rev`, a broken one is read as its last good
    version, shown in `fileErrors`, and never written (`/flag` answers 400). Its changes are pushed over SSE, so a
    second tab follows (`/state.flags`, `GET /state?only=flags.json`).
  - `experiments.settleMs` (config only): the pause T before the offer, default 1800 ms, clamped to 300–10000.
- **Off = exactly today's behaviour.** No offer element is rendered, the settle listeners return at once, Tab moves focus
  and Enter sends as before, the placeholder is unchanged. `POST /metric` refuses settle events (400). Nothing new is
  logged.
- **On: the settled-input signal, deterministic, no model** (`public/settle.js`, the same file the page loads and the
  node checks require):
  - "last keystroke" = the last change of the input's value (the `input` event, so pasting and IME text count too);
  - after T ms without a change, while the input has focus and is not disabled, the page asks `looksFinished(text)`;
  - if it says yes, a quiet inline proposal appears next to the input: `send? (Tab to send, keep typing to ignore)`.
    It is muted text with the dashed lavender edge that proposals use, its title says "proposed by the settled-input
    heuristic of this page (no model)", and the input points at it with `aria-describedby`;
  - **Tab** sends while it shows (the same submit path as Enter). Shift+Tab and Tab without an offer move focus as before;
  - **keep typing** (any change of the value) drops it at once; **Escape** drops it and keeps the text;
  - **Enter** sends at any time, offer or not: the override;
  - focus leaving the input drops it silently; the flag switched off removes the element.
  Nothing is ever sent without a key press.
- **The heuristic (`looksFinished`), documented case by case** (the verify table has 24 cases):
  - finished, cue `punct` or `question`: the trimmed line ends in `.` `!` `?`, also before closing `) ] " ' ” ’ »`
    (`Send it now.  `, `(see the map).`, `He said "done."`, `Is that it?)`);
  - finished, cue `question`: no final mark, but it starts with a question word (what, how, why, when, where, who,
    which, can, could, should, would, will, is, are, do, does, did, have, has, may, might, must, …), has at least 4
    words and does not end on a dangling word (and, or, the, to, of, with, …): `what is left for Monday`;
  - not finished: trailing off (`wait...`, `I was thinking…`); ending in `,` `:` `;` `-`; an abbreviation that usually
    continues (`e.g.`, `i.e.`, `vs.`, `cf.`, `approx.`, `incl.`); a list number (`Step 3.`); a URL with a full stop
    (`see https://x.org.`); an open bracket or code span (`use \`npm run`, `is it (really?`); a command (starts with
    `/`: commands never get an offer and are not counted); shorter than 2 words and 6 characters (`?`, `yes.`, `ok`);
  - English only.
- **Measure, don't judge** (`POST /metric`, only while the flag is on):
  - `settle_offer {offer, cue, chars, words, sinceKeyMs}`: the offer appeared. `offer` is an id `so-…`;
  - `settle_accept {offerRef, sinceKeyMs, offerMs, chars}`: sent with Tab;
  - `settle_ignore {offerRef, how: typed|escape, offerMs}`: kept typing, or Escape;
  - `enter_send {offerShowing, offerRef?, sinceKeyMs, chars}`: sent with Enter, with or without an offer showing;
  - the server keeps only these fields (numbers rounded, enums checked) and adds `settleMs` and `turn`. **Never any
    text:** an ignored offer was a draft nobody sent;
  - one offer has at most one outcome (accept, ignore, or Enter while showing); a second one is 400, also after a
    restart (checked against `metrics.jsonl`). An offer without an outcome (blur, reload, flag off) is "unresolved".
- **`/stats` (and `npm run stats`) get an "experiments" block** after the five measures: the flag in `flags.json` and how
  often `/flag` switched it; offers and their outcomes (Tab, kept typing, Escape, Enter while showing, unresolved);
  Enter sends with and without an offer; the median time from the last keystroke to the send for Tab, Enter with an
  offer and Enter without one (with n); the pause T used. No threshold, no PASS / NOT YET: the five verdict lines stay
  the only ones, and `/stats` still prints exactly what `npm run stats` prints (it reads the dir only).
- **Demo `v0.9`** (`dev/make-fixture-v09.js`, from the v0.8 fixture): the same workbench, fading thresholds raised to 20
  so nothing fades or asks during the demo, and `experiments.settledInput: true` in the demo's config only.
- **Dev:** `dev/verify-v0.9.sh` (35 checks, one runs `browser-check.js v09` with 28 checks: 26 + 2 global).

**Why**
- The explainer's question is how Enter can disappear without the machine deciding for you. A pause plus a finished
  sentence is the cheapest deterministic signal that you are done; turning it into a proposal (not an action) keeps
  "models only ever propose" true for the page itself, and Enter stays as the override.
- D9 keeps Enter in v1 because diffusing it would muddy what P5 measures. Behind a flag, default off, the five measures
  are unchanged; the experiment's own events are counted apart and not judged.

**Deliberately does not**
- Never sends by itself, never changes Enter, never runs a model on the draft, never stores the draft.
- No per-person learning of T or of the heuristic, no language other than English, no offer for commands.
- No `/flag` for `settleMs` (config only) and no "default" value for `/flag` (on|off only; delete `flags.json` to fall
  back to the config).
- Off logs nothing, so there is no baseline "time to send" from before the flag (see QUESTIONS.md). The baseline inside
  the experiment is `enter_send` without an offer.
- Tab while an offer shows sends instead of moving focus to the panes (see QUESTIONS.md).

## pilot-v0.8

Panes can go: an untouched pane fades to a tab, a touch brings it back, and only your answer removes it. This answers
the open question the growing-workbench explainer and `06-open-questions.md` hand on ("Remove, ask, or fade into a
tab?"): fade first, then ask. Still untested with a real model (fakes only).

**Adds**
- **Fading.** After every turn the controller checks each shown pane. A pane nobody touched for `fadeAfterTurns` turns
  fades to a tab:
  - a turn is one message you sent (the count of `user` lines in `transcript.jsonl`; commands are not turns);
  - `rules.json` sets `fadeAfterTurns` as a default at the top level, and a rule may set its own (the rule wins);
    without one, the pane never fades. `rules.example.json` now has `fadeAfterTurns: 8` and `askRemoveAfterTurns: 8`;
  - the controller says so in a controller line ("map pane faded to a tab: untouched for 8 turns …") and logs
    `pane_fade` (turn, idle turns, threshold, the last touch's turn).
- **Fading is not removal.** A faded pane stays in `modules.json` with `"state": "faded"`, `fadedAt` and `fadedTurn`. It
  keeps its place in the layout order as a slim labelled strip (`▸ kanban  tab · untouched since turn 22`). The grid
  gives it an auto row and the shown panes share the height; with only tabs, the side column shrinks to their width (at most 18rem).
  `/state.panes` still lists it; `/state.faded` and `paneInfo.<module>.fade` say it is a tab.
- **A touch brings it back at once.** Click, Enter or Space on the tab: the page shows the pane before the server answers,
  with a View Transition (instant with reduced motion), and reports `POST /touch {module, how: "tab"}`.
- **Touch, defined exactly.** A touch is your interaction with a shown pane:
  - `click`: a pointerdown anywhere inside it (a card, a button, an index entry, so also an index jump; the scrollbar);
  - `scroll`: a wheel or touchmove inside it;
  - `focus`: keyboard focus moved into it by you (Tab or arrows; a keydown less than 500 ms before the focus arrived).
    Focus the page restores after a re-render is not a touch;
  - `decide`: confirming or rejecting one of its cards (the server records it, also for `curl`);
  - `tab`: the tab of a faded pane.
  Typing `/why map` in the chat is not a touch of the map (it is the chat). Each touch moves the pane entry's
  `lastTouch {at, turn, how}`. Only the first touch of a pane in a turn is written and logged as `pane_touch` (a later
  one changes nothing, so there is no rev bump and no event); a touch on a tab is always recorded (`unfaded: true`). A
  new pane starts with `lastTouch.how: "added"`; an older entry without `lastTouch` counts from its `addedAt`.
- **Two panes never fade:**
  - the chat. It is not in `modules.json`, and `POST /touch {module: "chat"}` answers 400;
  - a pane holding an unanswered proposal (map: decisions and sources; kanban: tasks). A tab would hide a decision you
    have not made. If a proposal arrives in a faded pane (extraction, or a hand edit seen on the next turn), the
    controller brings the pane back at once, says why in a controller line, and logs `pane_unfade` (reason
    `proposal`). That is not a touch. A pane holding a proposal is also never offered for removal.
- **Removal only with consent.** After `askRemoveAfterTurns` more turns as a tab, the controller asks, once per pane: "The
  kanban pane has been a tab for 8 turns. Remove the kanban pane?" It goes through the same one-question-at-a-time
  controller as growth (`modules.json` `pending` plus `pendingKind: "remove"`; `controller_ask` with `question:
  "remove"`). Answers: buttons, or keys in the empty input:
  - `y` (yes): the pane entry leaves `modules.json`. Its rule may offer it again, but only as a new question (an old
    "always" no longer adds it by itself) and only once the rule's count has doubled since the removal, like after
    "no";
  - `n` (no): it stays a tab and is not asked again;
  - `x` (never): removed, and its rule never offers it again;
  - `a` has no meaning here: 400 from `/answer`, and in the input it stays text.
  The answer is recorded like any consent: `modules.json` `removals.<module> {answer, at, turn, count, consentId}`
  (kept apart from `answers.<module>`, which stays the growth consent), a `consent` event with `question: "remove"`, a
  system line, and `pane_remove` with `answerRef` for yes and never. No rule removes a pane; only this answer does.
  Touching the pane while its question is open withdraws the question (system line, `controller_withdraw`). A withdrawn
  question does not count as asked: looking is not an answer. It can come again once the pane has faded again and
  stayed a tab for `askRemoveAfterTurns` turns. An answered question is never asked again for that pane entry; a pane
  that is removed and grows again is a new entry with its own question.
- **`/why <pane>` explains fading** (sources as in v0.7):
  - shown or a tab since turn X;
  - the last touch: how, when, which turn (`metrics.jsonl:N pane_touch map`);
  - the turns since (`transcript.jsonl user lines ×N`);
  - the threshold and whether it comes from the rule or the default (`rules.json:N fadeAfterTurns`);
  - what happens next: "fades after turn 38 if nobody touches it", or "holds an unanswered proposal (dec-1), so it does
    not fade";
  - the removal question: when it is due, open, or asked with your answer.
  Its history adds `pane_fade`, `pane_unfade`, the removal question and answer, and `pane_remove`. `/why` marks tabs
  ("map (tab)") and removed panes. `/rules` and `/panes` show faded and removed panes.
- **`fade.js`** (beside `stats.js` and `why.js`): the pure rules (turn count, thresholds, last touch, proposals held,
  due or not), used by the controller and by `/why`, so both say the same thing.
- **Demo `v0.8`** (`dev/make-fixture-v08.js`, from the v0.7 fixture). The open proposals are decided, the kanban
  faded at turn 30, and the map was last clicked at turn 30. Your first message (turn 38) fades the map and makes the
  kanban removal question due.
- **Dev:**
  - `dev/verify-v0.8.sh`: 44 checks, one of which runs `browser-check.js v08` (24 checks);
  - `dev/why-cites.js` resolves the new citations (pane events by module, `removals.<m>`, `fadeAfterTurns`).

**Why**
- The growing-workbench explainer ends on "panes must also go: remove, ask, or fade?" (`06-open-questions.md`, first
  row). A workbench that only grows ends up as the overwhelm the diachronic idea was meant to avoid. Removing a pane
  silently would break "every pane earned and consented".

**Decision: fade first, then ask (in the style of `05-decisions.md`)**
- **Alternatives considered:**
  - (a) Remove after N idle turns. Rejected: a rule would delete something you consented to, and "no pane without a
    recorded answer" has a mirror image, "no pane gone without one".
  - (b) Ask "remove?" after N idle turns, nothing in between. Rejected: one more question, and every idle stretch
    (a weekend) would cost an answer. The quiet measure in `/stats` counts every question.
  - (c) Fade only, never remove. Rejected: a tab nobody ever opens is clutter too, and the person cannot get rid of it.
  - (d) Let a model judge relevance. Rejected: a model only proposes (D4, D6), and growth is deterministic in v1.
  - (e) Count idle time in minutes instead of turns. Rejected: overnight every pane would fade. Turns measure work.
- **Chosen:** (c) then (b), as a deterministic rule: fade first, and ask only about a pane that stayed a tab.
  - Idle for `fadeAfterTurns` turns → fade to a tab. Reversible with one click, no question.
  - A tab for `askRemoveAfterTurns` more turns → ask once.
  - Only a recorded yes or never removes.
  - The two exceptions: the chat never fades, and a pane holding an unanswered proposal never fades.
- **Reverse if:**
  - you bring panes back from a tab more often than you leave them as tabs (`pane_touch` with `unfaded` vs
    `pane_fade` in `metrics.jsonl`): the threshold is too low or turns are the wrong clock;
  - the removal question gets "n" almost every time: drop the question and keep (c);
  - tabs pile up and you want them gone without being asked: make "always remove faded panes" an answer (the unused
    `a`).
  Then: tune the defaults in `rules.json`, or replace turns with work time from `metrics.jsonl`.

**Deliberately does not**
- No rule ever deletes a pane, also not a pane added by hand. A hand-written pane entry fades like any other.
- No fading of the chat, no fading while a proposal is unanswered, no removal question while one is.
- No re-ordering of panes, no drag, no docking library (D8). A tab keeps its slot.
- No touch from typing `/why <pane>` or from the "show m-…" link; no touch from focus the page moves by itself.
- No unfading on a hand edit of `state.json` before the next turn: a proposal written into the file brings its pane
  back after your next message (or at once after an extraction, which runs the controller).
- No "always" for the removal question (see QUESTIONS.md).
- Fading needs `fadeAfterTurns` in `rules.json`. A `.pilot/rules.json` seeded before pilot-v0.8 has none, so nothing
  fades there until you add it (one line, see README). Old demo fixtures (v0.3–v0.7) behave as before.

## pilot-v0.7

`/why`: the current workbench explained from the files, each statement with its source. Also a layout fix for narrow
side panes. Still untested with a real model (fakes only).

**Adds**
- **`/why`** prints the whole workbench in compact form:
  - one line per shown pane: its rule, the count when it was asked, your answer, how it was added;
  - one line per pane that is not shown but has history (e.g. "answered no at 3");
  - two summary lines for the items.
- **`/why <pane>`** (`index`, `map`, `kanban`, `chat`) gives the full history:
  - the rule recorded with the pane, plus the current `rules.json` rule if it changed since;
  - every question (count, threshold, the question text and its transcript line), every answer and every add;
  - the answer on file and whether `metrics.jsonl` has its consent event.
- **`/why <item id>`** (e.g. `/why dec-2`) gives:
  - origin: model and extraction run, or a file edit;
  - the message it came from (author, time) and whether the quote is still in that message;
  - who decided it and when (through the page or by file edit);
  - every field changed by hand: what the server wrote and what the file says now.
- **Every statement cites its source:**
  - `metrics.jsonl:60 controller_ask` or `transcript.jsonl:5 m-f005` for JSONL files, with physical line numbers;
  - `modules.json:14 panes index` or `state.json:18 items dec-2` for JSON entries: the line of the entry as the file is now.
- **Missing facts are said plainly.** A fact is never filled in:
  - "no recorded answer";
  - "written by file edit, when is not recorded";
  - "added by you (file edit) at …" when a `file_edit` event exists, otherwise "when is not recorded";
  - "the server never wrote it";
  - "message m-… is not in transcript.jsonl";
  - "the pane entry has no controller_add event".
  A broken `state.json` or `modules.json` makes `/why` say so; it does not crash.
- **`why.js`** (like `stats.js`): pure and read-only. No model, no writes. `/command` returns `lines` (text) and `why`
  (statements with `cite` and `msg`).
- **Page:**
  - A "why?" button on every pane bar and every card runs the same `/why` command. It is a real button: Tab reaches it,
    Enter presses it.
  - `c`/`r` act only on the focused card itself, never on a button inside it.
  - `/why` lines show their sources in muted text. A statement that names a message has a "show m-…" button that
    scrolls to it. This is not logged as an `index_jump`, so Usefulness in `/stats` stays honest.
- **Layout fix:**
  - Labels never break mid-word. Who-labels, the controller label, chips, tags, times, pane titles and buttons do not
    wrap or shrink; the text next to them wraps instead. The cause was `overflow-wrap: anywhere` on chat lines, which
    let the controller label shrink to one letter per line.
  - The kanban stacks its three columns when its body is narrower than 420 px (a container query). Below that a column
    would be under about 134 px, about 17 characters of card text. Widths, measured with the demo data:
    | Window | Side panes | Kanban body | Kanban |
    |---|---|---|---|
    | 800 px | stacked full width (existing `max-width: 800px` rule) | 712 px | 3 columns |
    | 820 px | side by side | 259 px | stacked |
    | 1000 px | side by side | 328 px | stacked |
    | 1280 and 1600 px (the shell is at most 1280 wide) | side by side | 436 px | 3 columns of 140 px |
- **Demo `v0.7`:** the v0.6 fixture (index, map and kanban grown through consent), plus one `file_edit` event for task-7.
  dec-8 has none, so both the recorded and the unrecorded case show.
- **Dev:** `dev/why-cites.js` resolves every cited source back to its file. `browser-check.js v07` adds layout checks at
  800, 820, 1000, 1280 and 1600 px. `contrast-check.js` covers the new pairs.

**Why**
- 01-concept: "every frame says whose it is", and the person can always ask why the screen looks the way it does. This
  is the Observstory `explain_frame` idea, answered from recorded facts and never guessed. v0.6 recorded the facts;
  v0.7 makes them answerable.
- Layout: the coordinator's v0.6 run found "controll/er" and kanban columns about 6 characters wide (ITERATIONS.md,
  2026-10-17).

**Deliberately does not**
- No model involvement, no summarising. `/why` lists recorded facts and their sources.
- No explanation of transcript lines, the status bar or model choice (`/model` and `metrics.jsonl` already say that).
- No history of hand edits that happened while the server was down beyond "when is not recorded". Only the current
  file and the server's last write are compared, as in v0.6.
- Line numbers of JSON entries are found by searching the file as it is now (the entry's `"id"`/`"module"` line). A
  file reformatted by hand moves them; when the line is not found, the entry path alone is cited.
- Recorded times are printed verbatim (ISO, as in the files): they are citations. Cards and pane bars keep local time.
- The "show m-…" link only reaches messages among the last 500 lines the page shows. For older ones it says so.

## pilot-v0.6

Authorship and metrics, `/stats`. Still untested with a real model (fakes only).

**Adds**
- **Every line says who wrote it:** `you` (peach), `model` + the model name (sky), `controller` (lavender, next to its
  sprite), `system`. Each line also carries `data-author` and a tooltip "authored by …".
- **Every card says its author and who decided it.** Format: `dec-1 · model · morrow · confirmed · confirmed by you
  10-14 09:06`. Hand edits read "you (file edit)":
  - `confirmed by you (file edit)`: the status was changed in the file.
  - `edited by you (file edit): column`: other fields were changed in the file.
  - `task-7 · you (file edit)`: an item added in the file.
- The `proposed` tag on a card is now neutral (it used the controller's lavender pair). Times on cards and pane bars are
  local, with the ISO timestamp as tooltip.
- **Every pane bar says which rule and which answer:** `controller · messages ≥ 12 · you: yes 10-15 14:14`. An answer
  that was written into `modules.json` by hand (no matching consent event) reads `you (file edit): yes`.
- **How a hand edit is detected (write ledger):** whenever the server creates an item (extraction) or decides one
  (`POST /answer`), it appends an `item_write` event with a full copy of the item to `metrics.jsonl`.
  - An item in `state.json` that differs from its last copy was changed by hand. The differing fields are shown as
    "you (file edit)".
  - This works for edits made while the server was down. `state.json` itself gets no extra field.
  - A later server write keeps earlier hand edits attributed (`handFields`, `addedByFile`).
  - An item with no ledger entry (older data, the v0.4/v0.5 fixtures) shows its declared `author`. A `user` item can
    only come from the file, so it always reads "you (file edit)".
  - On every `state.json` change the watcher also logs `file_edit {itemId, fields}`.
- **P5 events in `metrics.jsonl`** (still append-only):
  - `server_start` with counts (lines, messages, items, panes, answers).
  - `turn` with lines and messages after each chat turn.
  - `consent` now has an `id`, which is stored as `answers.<module>.consentId`.
  - `controller_add {module, answer, answerRef}` on both paths. Before, only `always` logged an add; a `yes` that
    added a pane logged none.
  - `index_jump` from the page via `POST /metric`. Only this event is accepted, and only with an existing message id.
  - `item_write` and `file_edit` (described above).
  - Pane entries in `modules.json` now record their `rule {metric, threshold}`.
- **`/stats`** (and `npm run stats -- <pilotDir>`, same lines) prints the five P5 measures with their thresholds from
  `04-build-plan.md`, PASS or NOT YET, and the numbers behind each. They are computed in `stats.js` from
  `metrics.jsonl` and the files only: no model, no writes. Fixture data is labelled ("FIXTURE DATA: n of m …").
- **Demo `v0.6`:** three synthetic days (made by `dev/make-fixture-v06.js`, every line `"fixture": true`).
  - All three panes are present.
  - Items come from the model, from you via the page, and from file edits.
  - `/stats` shows 3 PASS and 2 NOT YET. Three index clicks turn Usefulness into PASS.
- **Dev:**
  - `browser-check.js v06`.
  - `contrast-check.js` checks the author chips on the pane bar.
  - `demo.js` fills `{app}` and `{rel}` in try lines.

**Why**
- 01-concept "every frame says whose it is" and authority rule 4. The v0.5 coordinator run found that a status
  changed by hand still rendered as the model's.
- P5 of the build plan is read from `metrics.jsonl`. Before v0.6 the file could not answer continuity, consent (for
  `yes` answers), usefulness or quiet.

**Deliberately does not**
- No authorship for hand edits of `transcript.jsonl` lines. Items and pane answers only.
- No signature field in `state.json`. Deleting or editing `metrics.jsonl` removes the evidence, and items then show
  their declared author.
- A hand-made item that claims `author: model` is not flagged when nothing in the ledger contradicts it.
- "You never re-explained the project" and the kill criterion are not measured; `/stats` says so.
- No minimum sample for Signal (1 decided proposal can PASS). Thresholds are not configurable: they are the build
  plan's, hard-coded with their wording in `stats.js`.
- No charts; `/stats` is text.

## pilot-v0.5

Live files (P4), and `c`/`r` only on a focused proposal. Still untested with a real model (fakes only).

**Adds**
- **Watcher:** `fs.watch` on the data folder (works for `PILOT_DIR`), 150 ms debounce. Any watch event re-stats every
  file in the folder (mtime, size, inode) and pushes one event per changed file, because macOS coalesces events and
  editors save by rename. The server's own temp files and other dotfiles are ignored. Watch errors are logged and the
  watch restarts; nothing in the watch path can crash the server.
- **`GET /events` (SSE, D7):** `hello {revs, extracting}`, then `change {file, rev[, error]}` for every change (own
  writes and hand edits) and `status {extracting}` when background extraction starts or ends (an extraction that
  writes nothing changes only `metrics.jsonl`). `retry: 1000`, a comment every 15 s.
- **rev:** JSON files carry `rev`, bumped on every server write (`state.json`, `modules.json`, `roles.json`;
  `rules.json` is only seeded). JSONL files: rev = number of non-empty lines.
- **Stale writes:** `/answer` takes an optional `rev` (consent: `modules.json`, confirm/reject: `state.json`). If it is
  stale the server answers 409 `{stale: true, file, rev}` and writes nothing. The page then reloads state and shows a
  short notice. A request without `rev` is accepted (curl, older checks).
- **Last good version:** a hand edit of `state.json`, `modules.json` or `roles.json` that is not valid JSON never
  crashes the server. `/state` serves the last good version with `fileErrors`, and the page says "file X is not valid
  JSON, showing last good version" until the file is fixed. The server writes none of these files while they are
  broken: the controller skips (`controller_error`), answers and decisions get 409. A broken `roles.json` keeps its
  last good pins.
- **Page:**
  - EventSource on `/events`. Reloads only the changed part (`GET /state?only=<files>`) and re-renders only areas whose
    content changed.
  - Per-part request generations, so an older response never overwrites a newer one.
  - File events are held back while this tab streams a reply.
  - Full reload after a reconnect.
  - Fallback without SSE: refresh after each action and polling during an extraction, as in v0.4.
  - Meta shows `ready · live` when connected.
- **`c`/`r` only on a focused proposal card:**
  - They never act from the chat input, empty or not.
  - ↓/↑ in the empty input moves focus to the newest proposal; Tab and click work too.
  - Only the focused card is outlined. After a decision, focus stays in the pane; Escape returns to the input.
  - y/n/a/x keep the v0.3 rule (empty input). Buttons unchanged.
- **Demo `v0.5`:** two tabs, a printed hand-edit one-liner and a break/repair one-liner. `demo.js` fills `{url}` and
  `{dir}` in try lines. The v0.4 demo's try lines now describe the new keys.
- **Dev:** `dev/sse-probe.js` (SSE client for verify), `browser-check.js v05` (second tab via CDP).

**Why**
- P4 of the build plan: hand edits appear by themselves, two tabs stay honest, and a write based on an old view is
  refused instead of silently winning.
- `c`/`r`: in v0.4 a message starting with c or r decided a proposal on the first keystroke. Models only propose; the
  person decides on purpose.

**Deliberately does not**
- No conflict detection for hand edits that keep `rev` (they are pushed and shown, but a page write based on the
  older view still goes through). No merge: one person, last valid write wins.
- No View Transition on live re-renders (pane add/remove still uses one; a content refresh is instant).
- No push for `/chat` streaming to other tabs: they see the user line, then the finished reply.
- No undo for decisions. y/n/a/x still answer from the empty input, also for a question that arrived by push (see
  QUESTIONS.md).

## pilot-v0.4

Proposals (P3). **Untested with a real model:** Morrow was not reachable, so extraction ran only against the fake
extractor in `dev/fake-model.js`.

**Adds**
- **Role `extract`** after each complete reply, in the background (queued, one run at a time, never awaited by
  `/chat`), every `everyNTurns` replies. Input: last user + assistant message + existing item titles. The closed
  `schemas/extraction.schema.json` goes along as `response_format` when the candidate has `structured: true`.
  Same rules as chat: pins, local→cloud block, stall timeout.
- **Validation, fail closed:** small hand validator (no Ajv). Malformed or schema-invalid output (including more
  than 3 items) writes nothing and logs `extract_error`. Per item: `quote` must occur in the turn (whitespace and
  case ignored), near-duplicates of non-rejected items and of the same batch are dropped (word-set Jaccard ≥ 0.75
  after stopwords, or the same url), at most `maxItems` kept; each drop is logged as `extract_drop`.
- **`.pilot/state.json`** (atomic, `rev` bumped): `status: proposed`, `author: model`, `model`, `quote`,
  `fromMessage`, ids `dec-N`/`task-N`/`src-N` (max + 1, so hand-added ids never collide). Hand edits keep every
  unknown field; a broken file is reported (`/state.stateError`) and never overwritten.
- **Panes:** reasoning map (decisions as a chain, then sources) and kanban (tasks in todo/doing/done), grown only through the
  controller and consent (`map`/`kanban` rules now count proposed + confirmed items, not rejected ones). Proposed =
  dashed lavender with "model · <name>"; confirmed = mint; rejected = rose, hidden behind a pane-bar toggle;
  hand-added (`author: user`) = solid with "you".
- **Confirm/reject:** `c` / `r` on a focused card, or in the empty chat input on the outlined proposal (the newest;
  arrows move it), plus buttons. `POST /answer {itemId, decision}` records `decidedAt` and `decidedBy: "user"`
  (schema extension in `pilot/app/schemas/state.schema.json`), a system line and a `decide` metric.
- **Fake extractor:** `--extract=good|malformed|badquote|many|dupes`, `--extract-delay=<ms>`.
- The page polls `/state` while an extraction runs, so proposals and a resulting question appear without reload.
- Fix: a consent answer now stores the count of the rule's own metric (decisions/tasks), so "no" waits for that
  count to double (it stored the message count, which was only right for the index).

**Why**
- P3 of the build plan: models only ever propose; the user decides, and every item says who authored it.

**Deliberately does not**
- No real model test (Morrow unreachable), no live file watching or SSE (v0.5; hand edits show on the next state
  load), no moving tasks between columns in the page (edit `column` by hand), no undo of a decision.
- No cap-and-keep for a response with more than 3 items: the closed schema says at most 3, so it is rejected whole
  (see QUESTIONS.md).
- No extraction after a failed or stalled reply.

## pilot-v0.3

Hardening, pastel palette, iteration infrastructure.

**Adds**
- **Explicit `/model` pins the role.** `/model chat morrow` means no fallback until `/model chat auto`, which
  returns the role to its policy starting at the first candidate. Pins persist in `.pilot/roles.json`; the status
  bar shows `chat: morrow (pinned)`. A pinned failure becomes a system line.
- **`local: true|false` per candidate** (example and dev config: frontier false, morrow true). After a local
  candidate failed, fallback never goes to a non-local one unless the role sets `allowCloudFallback: true`;
  missing `local` counts as non-local. Each block is logged (`fallback_blocked`) and shown as a system line
  "fallback to frontier blocked: morrow is local".
- **Stall timeout** `stallMs` (default 20000): once a reply has started, no new token for that long aborts it,
  keeps the partial text as an assistant line, adds a system line, logs a `stall` metric. Never falls back.
  `dev/fake-model.js --stall-after=<n>`.
- **Consent keys only on an empty input** (P2 already did this; now regression-tested in the browser, plus guards
  for IME composition and key repeat). Buttons always work, also with text in the input.
- **Pastel palette** in the pixel-terminal style, defined once as CSS custom properties; sprites use them too.
  Light variant via `prefers-color-scheme: light` and `/theme light|dark|auto` (page-only, kept in localStorage).
  `dev/contrast-check.js` checks every text/background pair (WCAG AA) in both modes.
- **Infrastructure:** `package.json` (scripts only), `npm run demo -- <version>` (`scripts/demo.js`, seeds a
  throwaway `.pilot-demo/` from `demo/fixtures/<version>/`), `npm run verify` (`scripts/verify-all.sh`),
  `scripts/try.sh <tag>`, `PILOT_DIR` env override, `ITERATIONS.md`, `QUESTIONS.md`, this file.

**Why**
- Pins: the concept's day-5 case. Switching to morrow because the topic got private must not silently send the
  text to frontier when morrow is down (open question after P2).
- Stall: an endpoint that hung mid-stream kept the request open forever.
- Palette: the amber/brown look is replaced by a calmer pastel one that also works in light mode and passes AA.
- Infrastructure: every later iteration must be runnable and checkable in 30 s by the coordinator.

**Deliberately does not**
- No per-candidate "never fall back to" lists; one `local` flag and one role-level `allowCloudFallback` only.
- No fallback after a stall, and no retry: a reply never mixes two models.
- No proposals, extraction or live file updates (v0.4, v0.5). The `.proposal` style exists but is unused.
- No change to the explainers or to anything outside `pilot/app/` except the "Pilot iterations" list in the
  root `index.html`.
