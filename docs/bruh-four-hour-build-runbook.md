# bruh: bounded four-hour Claude Code build session

Status: runbook for review · 28 November 2026

Product target: [Blackboard product vision](product-vision.md)

## Outcome and authority

One session delivers one reviewable improvement to Blackboard's persistent generative workspace, with a commit, evidence, remaining gaps and a resumable handoff. **Four hours is a maximum wall-clock budget, not a completion estimate or a target to fill.** Finish early when the selected slice is complete.

The requested build host is **bruh (Mac mini)** and the requested implementer is **Claude Code**. This document does not start, schedule or authorize a worker by itself. A later execution instruction must identify the session and its permitted scope. Routine implementation choices within that scope do not require repeated user check-ins.

Keep implementation in an isolated branch/worktree. Preserve the existing prototype, data, explainers, open branches and other workers' files. Do not merge, deploy, migrate stored data, change accounts, install system-wide tooling, expand a Mission or start a new paid service under this runbook. Publishing a build branch/draft PR must be included in that session's authority; otherwise return the commit and diff for the coordinator to publish.

## Route and permission check — observed 28 November 2026

This section records the preparation check; it is not a launch certificate.

| Check | Observed result | Consequence |
| --- | --- | --- |
| GitHub repository | Default branch main at `8be222715d8db677c1d56ccd1120ffe3460b53ad`; connected account reported push access. | Sufficient for the requested documentation review branch. Does not establish worker credentials or runtime authority. |
| Existing work | Open PRs #8, #10, #12, #14 and #16 retain separate research/implementation histories. Local main also has an uncommitted change to `pilot/app/.gitignore`. | Leave it untouched. Local worktree discovery is not proof that an agent has stopped. |
| Orca discovery | `orca skills get orchestration` succeeded. `orca host list --json` identifies the local machine as blackbird and contains no host named bruh. | No bruh route was established through this inventory. Do not guess that another host is bruh. |
| Weavr overview | At 2026-11-28 07:52:56 UTC, the returned overview contained no Blackboard project and no bruh runner. | No Blackboard Mission or bruh execution permission was established through that source. Absence here does not prove the machine is unavailable elsewhere. |
| bruh runtime | Checkout, Claude login/model, active workers, credential isolation, browser access and deadline enforcement were not inspected. | All remain launch prerequisites. No worker or schedule was created. |

Recheck at launch. Do not reuse an old online flag, a historical test count or a model name from a conversation as live evidence.

## Before launch: complete one bounded session contract

Record this outside public artifacts if it contains private host paths or account identifiers. No credentials or full environment dumps belong in logs.

| Field | Required value |
| --- | --- |
| Session | Unique ID, accountable supervisor, execution authorization reference |
| Objective | One user-visible outcome and explicit exclusions |
| Source | Repository URL, exact base SHA, chosen prototype path, PLAN.md slice if present |
| Ownership | Isolated branch and absolute worktree; exact writable files, including tests and evidence |
| Route | Verified bruh host selector, execution harness, provider, requested and observed effective model |
| Authentication | Existing permitted auth class; data destination; scoped credential boundary |
| Budget | Maximum 240 minutes; one implementation worker; no recursive delegation; one focused repair attempt |
| Spend | No new paid API spend by default; record any already authorized numerical API limit separately from subscription usage |
| Deadline | T0, absolute stop time in UTC and Europe/Zurich, external supervisor/watchdog and stop procedure |
| Checks | Actual commands from the selected checkout; behavioural and visual acceptance scenarios |
| Delivery | Evidence location, allowed branch/PR publication, checkpoint path and next owner |

Do not assign the entire repository as writable scope. First inspect the actual bruh prototype and select the files needed for one slice. If the relevant existing work cannot be found, checkpoint that fact; do not rebuild it from main on an assumption.

## Readiness gate

1. **Identify bruh and its route.** Use the runtime's current documented host discovery and help. Verify host identity separately from Claude Code availability. Record the discovered selector; do not invent SSH targets, daemon endpoints, flags or launch commands. If Orca is the route, load its current orchestration guide before coordination. If a different established route is used, document its actual contract.
2. **Read repository and ownership state.** Read PLAN.md first if present, then applicable instructions, the product vision and the prior session's handoff. Inspect status, worktrees, current workers and open PRs. Any possibly live worker retains ownership until settlement is proved. A dirty checkout is not permission to stash, reset or overwrite it.
3. **Locate the working prototype.** Compare its exact commit and local changes with main and the relevant open branches. Record what will be reused. Read package manifests, lockfiles, test scripts and launch instructions. Do not merge all open branches as setup.
4. **Verify route permissions and costs.** Establish Claude Code's permitted auth mode and actual model readback without printing tokens. Confirm the worker can access only the intended checkout/data and necessary scoped provider authentication, not unrelated accounts or publishing/control-plane credentials. Subscription access does not authorize API billing. If the requested Claude route cannot meet these boundaries, stop that launch; do not silently switch provider or host.
5. **Verify supervision.** A supervisor external to the model must enforce the deadline, survive loss of the coordinating chat, observe process/dispatch settlement and preserve logs/checkpoints. A prompt saying “stop after four hours,” a token limit or a scheduled next job is not a wall-clock limit. Record the supported stop and escalation mechanism, including child processes. Verify the installed mechanism before allowing unattended work.
6. **Confirm scope and validation.** Set exact paths and commands in the contract. Reserve non-conflicting localhost ports and synthetic test storage. Verify screenshot/browser capability and package-version compatibility. Resolve a real scope or authority conflict before starting dependent work.

If readiness cannot be established during the first 20 minutes, end with a blocked-preflight checkpoint. Independent documentation may continue within its own authorized scope; no build launch is implied.

Route selection is deliberate: the user requested Claude Code on bruh for this experience work. Use deterministic tools for inventory and tests. Record why the chosen route is suitable; local inference or Mistral is not a fallback to start automatically. Any alternative requires verified capability, permitted data handling and applicable authority.

## The four-hour cycle

T0 begins when the session is opened for preflight. The deadline includes preparation, build, checks, one repair and handoff. Every later phase uses the remaining original budget.

| Elapsed time | Activity | Required checkpoint |
| --- | --- | --- |
| 00:00–00:20 | Complete readiness and contract; establish current baseline. | Base SHA, ownership, route, permissions, deadline and baseline evidence; or stop before launch. |
| 00:20–00:40 | Reproduce one target journey with synthetic data; select the smallest visible improvement. | Before screenshots, known failures and concrete acceptance criteria. |
| 00:40–02:15 | Implement one end-to-end slice, reusing current services/components. | Working chat → workspace → interaction loop; brief durable checkpoint at least every 30 minutes. |
| 02:15–02:45 | Inspect the actual UI and make at most one focused repair. | Before/after comparison; unresolved issues recorded honestly. |
| 02:45–03:25 | Run focused and required regression checks; verify continuity, boundary and accessibility cases. | Commands, outputs, screenshots, interaction trace and exact tested commit. |
| 03:25–03:45 | Freeze feature scope; inspect diff and produce the evidence packet. | Scope check, rubric, commit and draft PR if authorized; label coordinator-only review as self-review. |
| 03:45–04:00 | Finish handoff and stop the owned worker/session. | Terminal settlement/exit evidence, retained checkpoint and next action. |

At 03:25, do not begin another feature. At the hard deadline, the supervisor stops the owned attempt using the verified runtime mechanism and records the result. Disconnect, fencing or an absent status is not proof of termination. If settlement is uncertain, retain ownership, report it and forbid overlapping edits or fallback launches until resolved.

## Candidate sessions — choose one at a time

These are proposed slices, not three queued jobs or a promise that each fits four hours. Carry forward evidence and narrow a slice when necessary.

| Session | Visible outcome | Minimum demonstration |
| --- | --- | --- |
| 01 — Generative experience | Refine the existing IDE-style shell and demonstrate native composition beyond a fixed card arrangement. | Three materially different synthetic conversations produce useful, readable representations; at least one interaction returns meaningful context to chat. |
| 02 — Bidirectional interaction | Deepen selection, comparison, edits and direct manipulation through shared state. | An explicit workspace action affects the next chat turn; edits, source references and pins survive regrouping and reopening; no inference on ordinary selection unless explicitly designed. |
| 03 — HTML and continuity | Add one isolated bespoke artifact and continue working through it. | One allowed artifact event reaches the host; unauthorized/malformed events are rejected; a pinned artifact and accepted human edit survive later turns/reload. |

The first session should extend the actual working prototype. If it already meets a candidate outcome, select the next evidenced gap instead of rebuilding the same feature. Across sessions exercise research, planning, architecture, budgeting, learning and comparison. Keep all new user-facing labels German.

## Acceptance checks and evidence

Use real browser evidence as well as tests. Keep deterministic fixtures, real-provider observations and unverified claims separate.

- **Conversation → workspace:** a request produces or updates a useful representation in the persistent right-hand pane, with a visible relation to the current task.
- **Workspace → conversation:** selection plus an explicit action sends the right scoped record/context; a meaningful edit is reflected in the next authorized model turn. Record the actual input or a safe trace, not only the displayed answer.
- **Continuity:** change a human-owned value, pin a pane, change representation, reload/reopen, then ask a follow-up. Verify the edit, identity, evidence and pins remain; test draft/selection retention across view changes.
- **Authority and recovery:** malformed proposals, unknown/cross-project IDs, stale revisions, duplicate actions, denied sharing and provider interruption leave accepted data and a usable view intact. Test the cases touched by the slice and retain existing regression gates.
- **Visual and accessible use:** capture the same fixture before/after at desktop and narrow sizes; check hierarchy, legibility, overflow, keyboard paths, focus after updates, contrast and reduced motion. Include loading, empty and failure states where changed.
- **HTML, when introduced:** prove isolation from host credentials/storage/DOM, restricted external requests, validated sender and event payloads, and rejection of unknown actions. Test the bridge rather than relying on an iframe attribute as proof.
- **Scope:** compare the final diff with the contract's exact allowed files. Preserve other work and demonstrate that test data never used the user's real project storage.

For the inspected main baseline, `pilot/app/package.json` offers `npm run demo -- v0.13` and `npm run verify`. **Do not run the legacy verification suite against a real checkout's data:** its [verify-all.sh](https://github.com/blackmath88/blackboard-nextgenui/blob/8be222715d8db677c1d56ccd1120ffe3460b53ad/pilot/app/scripts/verify-all.sh) says old checks wipe `pilot/app/.pilot/`, use fixed ports and may skip browser checks without Node 22+/Chrome. Use a disposable checkout and synthetic storage after reading the scripts; do not move real data aside to make the command run. The Foldkit prototype's commands must be discovered from its own manifest. A skipped browser check is a recorded gap, not a visual pass.

Real-model validation needs its own authorized provider and spend allowance. Claude Code implementation access does not automatically authorize the application's model calls. If unavailable, deliver the deterministic evidence and label the real-provider gate unverified.

## Proposed quality rubric

Rate each dimension 0–4: 0 absent/broken, 1 partial, 2 functional with material gaps, 3 convincing with minor gaps, 4 compelling and evidenced across the chosen scenarios. Score = sum(weight × rating / 4), out of 100. Attach an artifact or a concrete limitation to each rating; record unavailable dimensions as unverified rather than inventing a score. Compare with the same baseline, not a remembered impression.

| Dimension | Weight |
| --- | ---: |
| Visual quality against the ChatGPT reference | 25% |
| Bidirectional chat/workspace interaction | 25% |
| Richness and usefulness of generated representations | 20% |
| Persistence and continuity | 15% |
| Usability and accessibility | 10% |
| Technical reliability | 5% |

These weights came from the follow-up discussion and are proposed evaluation policy. A high score cannot compensate for lost edits, failed required checks, permission violations or a broken security boundary. Those are mandatory gates. Report implemented, tested, live-observed and human-accepted status separately; human acceptance is never inferred from a score.

## Stop, escalation and restart

Stop the affected work for a permission boundary, incompatible architectural requirement, overlapping ownership, sensitive-data exposure, unauthorized cost, failing isolation or a consequential product choice outside the slice. Record the exact blocker and safe next step. Do not ask the user about routine naming, component placement or other reversible choices within the contract.

Allow one focused repair attempt within the same time/spend budget. Repeated failure or an unavailable route ends in a checkpoint. Preserve the worktree and evidence; never force-reset shared state or launch a fallback while the previous attempt may still be alive.

A subsequent session starts only under applicable execution authorization, after the previous worker has demonstrably settled. Read the previous handoff, recheck route/permissions/ownership and set a fresh bounded contract. Reuse the tested commit and address its highest-value gap. Do not auto-chain sessions, create cron jobs or schedule recurring work from this runbook.

## Required handoff packet

Keep a durable session record with:

- Objective, exclusions, authorization reference, exact base/final SHAs, branch/worktree and PR URL.
- Route evidence: host/harness/provider/model, auth class, observed start/stop times, deadline enforcement and settlement outcome; no secrets.
- Changed files and acceptance matrix: pass/fail/unverified with commands, exit results and useful failure output.
- Before/after screenshots, interaction recording where practical, state/context trace and rubric with evidence.
- Known regressions, deferred work, remaining permission/architecture decisions and one recommended next slice.
- Usage with provenance: observed API spend, subscription usage and local resource use separately; mark missing values unavailable, never zero by assumption.
- Exact resume instructions, retained artifacts, owned attempts and whether any process may still be live.

Report to the user in at most five lines: outcome; exact commit/PR links; strongest validation evidence; remaining blocker; next action. The durable packet carries the detail.

## Source references

- [Product vision and preserved source answer](product-vision.md)
- [Foldkit dynamic-workbench concept, pinned revision](https://github.com/blackmath88/blackboard-nextgenui/blob/8c3dac163e4e069783e63464cae712cafb2da532/docs/foldkit-dynamic-workbench-concept.md)
- [Workspace/protocol plan, pinned revision](https://github.com/blackmath88/blackboard-nextgenui/blob/a955c541f9e38e5b0cfc7bd0a7d91049b2670733/docs/workspace-ui-protocol-plan.md)
- [Accepted-state continuity work, PR #10](https://github.com/blackmath88/blackboard-nextgenui/pull/10)
- [Context-aware execution proposal, pinned revision](https://github.com/blackmath88/blackboard-nextgenui/blob/fd7f9eacd405431294115c111217f1c6dce2ab15/docs/concepts/CONTEXT-AWARE-EXECUTION-WORKSPACE.md)
- [Weavr operating contract](https://github.com/blackmath88/weavr/blob/main/docs/CHATGPT-OPERATING-CONTRACT.md) — applies when execution is actually governed through Weavr; a plan is evidence, not launch authority.
