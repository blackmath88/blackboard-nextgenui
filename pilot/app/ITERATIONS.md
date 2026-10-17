# ITERATIONS

Planned progression (from the coordinator's plan, 2026-10-17). Changes to the plan are appended below with
date, old plan, new plan and why.

| Tag | Iteration | Notes |
|---|---|---|
| pilot-v0.3 | hardening: pins, local-only fallback, stall timeout, empty-input consent keys, pastel palette, demo/verify/try infrastructure | |
| pilot-v0.4 | proposals (P3) | extraction against a fake extractor until Morrow is reachable |
| pilot-v0.5 | live files (P4) | |
| pilot-v0.6 | authorship & metrics, `/stats` | |
| pilot-v0.7 | `/why` | |
| pilot-v0.8 | panes can go | |
| pilot-v0.9 | Enter diffused (behind a flag) | |
| pilot-v0.10 | frame proposals (behind a flag) | |

## Changes to the plan

- 2026-10-17 (v0.4). Old plan: live files are v0.5 (P4). New plan: unchanged, but v0.4 needs proposals to appear
  without reload after a background extraction, so the page polls `/state` every 300 ms while `extracting` is true
  (and only re-renders when something changed). Why: the alternative was SSE now, which is v0.5's job; the poll is
  removed or replaced when v0.5 pushes file changes.

## 2026-10-17 (coordinator) v0.5 also fixes accidental c/r
- Old plan: v0.5 = live files only.
- New plan: v0.5 = live files + `c`/`r` act only when keyboard focus is on a proposal (Tab/arrow into a pane), never from the chat input.
- Why: coordinator testing of v0.4 confirmed that a message starting with "c" or "r" typed into the empty input decides a proposal at once. That breaks "models only propose, the person decides on purpose". It is small, so it rides along with v0.5 rather than taking its own tag.

## 2026-10-17 (v0.5) The v0.4 poll is fallback-only
- Old plan: v0.4 polled `/state` every 300 ms while `extracting` was true, "removed or replaced when v0.5 pushes file
  changes".
- New plan: with SSE connected the page does not poll. The server pushes `status {extracting}` and the file events.
  The poll runs only when SSE is unavailable (no EventSource, never connected, or dropped), next to the
  refresh-after-action.
- Why: the brief asks for a fallback to the refresh-after-action when SSE is unavailable. Without the poll, proposals
  from a background extraction would not appear in such a tab until the next action.


## 2026-10-17 (coordinator) v0.7 also fixes the cramped 4-pane layout
- Old plan: v0.7 = /why only.
- New plan: v0.7 = /why + a layout fix: labels never break mid-word, and below a usable width the kanban stacks its columns instead of squeezing them.
- Why: coordinator testing of the v0.6 demo at 800 px showed "controll/er" and kanban columns about 6 characters wide. /why adds affordances to the same pane bars, so the fix belongs there.

## 2026-10-17 (v0.7) The cramped layout is just above 800 px, not at 800
- Old plan: check the layout at 800, 1280 and 1600 px; at 800 px the v0.6 demo shows "controll/er" and kanban columns
  about 6 characters wide.
- New plan: unchanged checks at 800, 1280 and 1600 px, plus 820 and 1000 px. The fix does not depend on the window:
  labels do not wrap or shrink, and a container query stacks the kanban when its body is under 420 px.
- Why: at exactly 800 px the existing `@media (max-width: 800px)` already stacks every pane full width. Headless Chrome
  reproduces the bug at 820 px: "contr/oller", kanban columns of 81 px, chips sticking out of their column. The
  coordinator's 800 px window was probably slightly wider than 800 px of viewport. Checking only 800 would not have
  caught it.

## 2026-10-17 (v0.8) Panes can go: fade first, then ask
- Old plan: "pilot-v0.8 panes can go". The brief left open how a pane goes ("remove, ask, or fade?",
  `06-open-questions.md`).
- New plan, built:
  - a pane untouched for `fadeAfterTurns` turns fades to a tab; it stays in `modules.json` (`state: "faded"`);
  - a touch brings it back;
  - after `askRemoveAfterTurns` more turns as a tab the controller asks once whether to remove it;
  - only a recorded yes/never removes it;
  - the chat never fades, and a pane holding an unanswered proposal never fades.
  Alternatives considered, the rule chosen and what would reverse it: CHANGELOG.md # pilot-v0.8, "Decision".
- Smaller choices made while building:
  - **Turns are messages you sent.** Not minutes, so a pane does not fade overnight. Not `turn` events in
    `metrics.jsonl`: the transcript is the file a person reads.
  - **A touch is written only once per pane per turn.** Writing `modules.json` on every scroll would bump its rev
    constantly and make consent answers stale (409).
  - **`scroll` means wheel/touchmove, not the `scroll` event. `focus` means focus you moved with a key.** A re-render
    resets scroll positions and restores focus by script, so the page would otherwise touch its own panes.
  - **A proposal arriving in a faded pane brings it back** (`pane_unfade`, not a touch). Alternatives were a badge on
    the tab, or "only before fading". A badge still hides the decision; "only before" misses extractions that land
    after the controller has run.
  - **After a removal (yes), the rule asks again only once its count has doubled, and an old "always" no longer adds
    the pane by itself.** Without this, a kanban answered "always" would come straight back on the next turn.
  - **A touch withdraws an open removal question, and a withdrawn question does not count as asked.** Opening the tab to
    look at the pane before answering must not forfeit the question for good, and must not answer it.
- Why: fading is reversible and silent; removal is not, so it needs consent like growth. That keeps "every pane earned
  and consented" true in both directions.
