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
