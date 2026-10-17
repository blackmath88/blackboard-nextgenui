# CLI Pilot iterations: report (2026-10-17)

Stop condition reached: **pilot-v0.10 is tagged.** All eight tags (`pilot-v0.3` … `pilot-v0.10`) exist locally, each passes the full `npm run verify` (every earlier script included), and local `main` was fast-forwarded to each tag in turn. Nothing was pushed.

Everything ran against `dev/fake-model.js`. **No iteration has been tested with a real model.** Morrow (`nebuchadnezzar`) was not on the tailnet, and nothing answered on `:11434` on the other Linux hosts.

## The tags

Run any of them with `cd pilot/app && npm run demo -- v0.N`. To run an exact tag without touching your checkout, use `bash pilot/app/scripts/try.sh pilot-v0.N`.

For every tag, the coordinator ran `npm run verify` (exit 0), started every demo up to that tag and checked that `/state` answered within about 1 s with no orphan processes, and ran `try.sh <tag>` and confirmed its temp worktree was removed. Each CHECKS.md section ends with a "coordinator re-run" block listing what was verified by hand.

| Tag | What it shows | Verified by the coordinator, beyond the gate |
|---|---|---|
| `pilot-v0.3` | Hardening: an explicit `/model` pins the role (`/model chat auto` unpins); local candidates never fall back to the cloud without `allowCloudFallback`; a 20 s stall cuts a reply off. Consent keys work only in an empty input. Pastel palette in dark and light, AA contrast. Demo, `try.sh`, `verify-all`. | Morrow down + pinned → no fallback. Unpinned → `fallback_blocked: morrow is local`. Stall at 1.69 s with `stallMs` 1500, partial reply kept. Letters typed in a non-empty input stay text. Contrast check, plus dark and light screenshots: in light mode pastels are fills only. |
| `pilot-v0.4` | Proposals (P3): the extractor proposes decisions, tasks and sources, shown dashed with author and model; `c`/`r` decide; map and kanban grow through consent. | One message produced a dashed dec-4 "model · morrow" and the kanban question. `c` confirmed it with `decidedBy` and `decidedAt`. Own fake runs: a bad quote is dropped, malformed output writes nothing, 5 items are rejected whole, each logged. |
| `pilot-v0.5` | Live files (P4): watcher + SSE, `rev`, stale writes refused, broken files tolerated. `c`/`r` act only on a focused proposal (re-plan). | A hand edit reached a second tab in 221 ms. A confirm in tab A appeared in tab B. "can you check" stays text. A stale `rev` gets 409 and changes nothing. |
| `pilot-v0.6` | Authorship everywhere (you / model + name / controller / system / "you (file edit)"). `metrics.jsonl` covers the five P5 measures. `/stats` and `npm run stats`. | `/stats` labels fixture data as such and gives the numbers behind 3 PASS / 2 NOT YET. A hand edit of dec-2's text reads "edited by you (file edit): text". |
| `pilot-v0.7` | `/why`, `/why <pane>`, `/why <item>`: the current workbench explained from recorded facts, each statement with its source (file:line), plus "why?" buttons. Layout fix for narrow panes (re-plan). | Two citations resolved by hand to the right lines. The "why?" button gives the same text. At 820 px: labels whole, kanban stacked, no horizontal scroll. |
| `pilot-v0.8` | Panes can go: an untouched pane fades to a tab, a touch brings it back, and removal happens only after a recorded answer (fade first, then ask once). | One message faded the map and asked "Remove the kanban pane?". `n` was recorded as consent and the kanban stays `faded`. Clicking the map tab brought it back (`pane_touch unfaded`). |
| `pilot-v0.9` | Enter, diffused (flag, off by default): after a pause on a finished-looking line, "send?" is offered; Tab sends, Enter always sends. Measured in `/stats`. | Nothing was sent before a key press (100 → 102 lines only after Tab). An unfinished line got no offer. `/stats` counted exactly the session (3 offers, 1 Tab, 1 Enter while showing, 1 unresolved). |
| `pilot-v0.10` | Frame proposals (flag, off by default): a model may suggest focus, order or group inside the map or kanban, in a closed vocabulary, marked "suggested by morrow, not by you". `f` or "apply" applies, `/frame reset` undoes, `/why map` explains. | The note appeared while the order and the items stayed unchanged. Apply reordered the cards with the items byte-identical. `/why map` cited the model, the message and who applied it. Reset restored the order. |

## Re-plans (also in ITERATIONS.md)

1. **v0.5 also fixed accidental `c`/`r`.** Testing v0.4 showed that a message starting with "c" or "r" decided a proposal on its first keystroke. That breaks "the person decides on purpose", so `c`/`r` now act only on a focused proposal.
2. **v0.7 also fixed the cramped 4-pane layout.** At 800 px the v0.6 demo broke "controller" mid-word and squeezed the kanban columns to about 6 characters.

No step was skipped, merged or reordered. The builders logged their own smaller choices in ITERATIONS.md.

## Parked questions, by how much they block

All are in `QUESTIONS.md` with options. None blocked a tag.

**Blocks real use:**
1. **Where is Morrow?** Every model-facing behaviour (extraction quality, frame suggestions, stall and timeouts on a real local model) is untested. Give a host and port, and a short real session against it becomes the next test.
2. **The old P0–P2 checks wipe `pilot/app/.pilot/`.** `npm run verify` refuses to start while a real `.pilot/` exists, but dogfooding in this folder and running the checks don't mix yet. Options: move the old scripts to their own dirs (a), the guard only (b), or both (c).
3. **v0.9 was built before P5 passed** (D9 says Enter diffusion comes after P5). It is off everywhere except its demo. Decide whether the flag may even be in `pilot.config.json` during a dogfood week.

**Shapes the next design step:**
4. Is "8 and 8" right for `fadeAfterTurns` / `askRemoveAfterTurns`, and are turns the right clock?
5. What do y/n/x mean for a removal question? (`a` is refused; "always remove faded panes" would be its use.)
6. A frame call after every reply costs a model call each time. Should it run every N turns or on idle?
7. How strictly should the P5 thresholds be read (per session, per day)?
8. The Enter heuristic is English only, and its pause T is a guess. There is also no baseline from before the flag.

**Small, defaults chosen:**
- `allowCloudFallback` is per role.
- More than 3 extracted items rejects the whole response.
- `item.model` holds the candidate name.
- Consent keys ignore a question that arrives by push while you type.
- Hand edits of transcript lines aren't tracked.
- "once per pane" means once per pane entry.
- `group` may only be `status` or `author`.
- A frame may not name a rejected card.
- An applied frame is not shown while the flag is off.
- There is no `/stats` block for frames yet.

**Needs your OK (outside what the coordinator may change):**
- The CLI Pilot card in the overview's story section still says "P0 to P2 done". The iterations list below it is current.

## Who built what

The coordinator (this Claude Code session, `claude-opus-5-5`) wrote the briefs, gated and tested every tag itself, wrote each CHECKS.md "coordinator re-run" block, tagged, fast-forwarded `main`, updated the root README line, and wrote this report.

| Tag | Builder | Route | Effective model (from session logs) |
|---|---|---|---|
| v0.3 | in-session subagent | Agent tool, Orca worktree `pilot-next` | `claude-opus-5-5` |
| v0.4 | in-session subagent | Agent tool, Orca worktree `pilot-next` | `claude-opus-5-5` |
| v0.5 | Orca Claude worker | `orca terminal create --command claude` in `pilot-next` | `claude-opus-5-5` |
| v0.6 | Orca Claude worker | same | `claude-opus-5-5` |
| v0.7 | Orca Claude worker | same | `claude-opus-5-5` |
| v0.8 | Orca Claude worker | same | `claude-opus-5-5` |
| v0.9 | Orca Claude worker | same | `claude-opus-5-5` |
| v0.10 | Orca Claude worker | same | `claude-opus-5-5` |

Why v0.3 and v0.4 were not built in Orca:
- The first v0.3 Orca worker was stopped before it wrote anything: Orca had branched it from `origin/main` instead of local `main`. The branch was reset to local `main`.
- The next one stopped at "Login expired": the Claude CLI's OAuth session had expired.
- A Codex worker running without approvals was refused by the auto-mode safety classifier. The coordinator did not work around that.
- v0.3 and v0.4 were therefore built by in-session subagents in the same Orca worktree.
- From v0.5, after Miro renewed the CLI login, every build went back to Orca Claude workers.

## Honest assessment

**Closest to the vision: pilot-v0.7 (`/why`)**, with v0.6 underneath it. "A workbench that thinks along without deciding" needs two things:
- Models only propose. v0.4 and v0.5 deliver that: dashed proposals, a decision only on a focused key.
- You can always see why the screen looks the way it does. v0.7 answers "why is this pane here, where did this item come from, who decided" from recorded facts, each with a file:line source, never a guess.

That is the part chat cannot do, and it is what makes consent auditable rather than just asked once.

**Most consequential new idea: v0.8.** "Fade first, then ask once" is a real answer to the growing workbench's open problem, but it is a hypothesis. The defaults (8/8 turns) and the clock (turns, not time) are guesses only real use can test.

**Least ready: v0.9 and v0.10.** They are built correctly behind flags and measured, but they are experiments on a base that has never had a real model or a real week. Before their numbers mean anything, the base has to pass P5.

**What the next session should decide:**
1. **Get Morrow reachable, then run one real dogfood session** on the default config, flags off. This is the gate for everything else: P5 (`/stats`) can only pass or fail with real use.
2. Answer parked questions 2 (old checks vs a real `.pilot/`) and 3 (whether the v0.9 flag stays out of the dogfood config) before that week starts.
3. Approve the one-line fix for the overview's stale CLI Pilot card.
4. Only after P5: decide whether v0.9 or v0.10 becomes v2's first real step, using their `/stats` numbers rather than impressions.
