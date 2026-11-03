# Local knowledge slice (packet bb)

## Delivered

The existing Project overview becomes Workspace knowledge, with direct user-selected
Summary, Index and Kanban representations. All read the same `/state` items from
`.pilot/state.json`; no second store, schema migration, inferred tasks, model-driven
pane growth or new dependencies. Summary counts accepted records and shows decisions
and open tasks. Index groups all accepted records by kind. Kanban groups accepted
tasks by their existing todo/doing/done column, retaining decisions and sources below.
Every view has a separate, explicitly labelled proposal review section. Rejected
records remain excluded. Missing status retains the legacy hand-confirmed meaning.

Cards retain IDs, authorship, acceptance metadata and the existing `why?` inspector;
source quotes are visible. Confirm/reject uses the existing serialized `/answer`
operation with the revision rendered on the overview card. Stage controls use
`/move` with the rendered revision. A 409 reloads truth without applying the stale
change. Stage selection and view links are keyboard reachable; existing focused-card
c/r and chat input behaviour remain. View selection does not change consented panes.

The baseline already provides atomic state writes, revision rejection, opt-in accepted
board context, SSE refresh/reconnect and persisted proposal review. This slice reuses
those paths. Reopening restores records and stages; hash URLs restore presentation.
Uncommitted extraction is not resumed after server death; persisted proposals remain
reviewable independently of a model run. Duplicate acceptance is refused rather than
returning an idempotent success receipt. Existing optional revisions for legacy HTTP
clients, hand edits that retain rev, and non-transactional multi-file audit writes
remain limitations; this is not complete Phase 3 of the protocol plan.

## Demo and stable URLs

From `pilot/app`, use `npm run demo -- v0.10` for the existing deterministic saved
fixture (no model calls). At the loopback URL printed by the demo, open:

- `/#knowledge-summary`
- `/#knowledge-index`
- `/#knowledge-kanban`

Use the same paths on an existing local Pilot project. Select Index, review a task's
quote/why, explicitly confirm it, select Kanban and change its Stage. Switch to Index
and back, reload, then restart using the same data directory: ID, decision and stage
must remain. Pending cards stay under Review throughout. The demo is a disposable
fixture; restarting its seed command may reset demo data, so use a CLI project for
restart persistence demonstration. Screenshots are left to the coordinator.

For a fresh extraction/recovery exercise with only the loopback fake provider:
`cd pilot/app && bash dev/verify-knowledge.sh`. It allocates a marked isolated fixture,
ports 4862/5862 and a fixture-only secret path, and removes only its owned root.
It checks extracted provenance, pending-task move refusal, explicit acceptance,
stale acceptance, moves, restart with a pending proposal, duplicate refusal, opt-in
accepted context, and interruption before extraction's durable write. The verify-all
runner discovers it automatically. It does not make real-provider calls.

## Checks and limits of evidence

- `node --check` for public/app.js, public/workspace.js, dev/verify-knowledge.js: passed.
- `bash -n dev/verify-knowledge.sh` and `git diff --check`: passed.
- `bash dev/verify-knowledge.sh`: blocked before startup by fixture port probe.
  A direct `net.Server.listen(4862, '127.0.0.1')` reports `listen EPERM` in this
  sandbox (the guard's generic diagnostic says port unavailable).
- `bash scripts/verify-all.sh`: exit 1, all 15 scripts fail at fixture port
  preflight; browser checks skipped. Log: `/tmp/bb-verify-all.log`. Loopback-dependent
  checks cannot execute here. No runtime, browser, visual, reconnect or real-provider pass is claimed.
  The coordinator must run the supplied acceptance command outside the sandbox.

## Focused repair attempt — 2026-11-03

The coordinator's previous acceptance log contains only `bb acceptance not
finalized`; it supplies no failed assertion or commit rejection to repair.
The existing implementation was retained; no safety gate or test was weakened.

Re-ran `bash dev/verify-knowledge.sh`: exit 1 at port preflight. A direct Node
`net.Server.listen(4862, '127.0.0.1')` confirmed `EPERM`, rather than evidence
of an occupied port. Re-ran `bash scripts/verify-all.sh`: its log reports all
15 scripts failed at port preflight and browser checks skipped. Fresh log:
`/tmp/bb-repair-verify-all.log`. This sandbox cannot finalize runtime acceptance.

Fresh static checks passed: `node --check` on `public/app.js`,
`public/workspace.js` and `dev/verify-knowledge.js`; `bash -n
dev/verify-knowledge.sh`; and `git diff --check`. All changed paths remain
within `pilot/**`. The next required step is the coordinator's acceptance
command outside the sandbox, followed by browser/visual verification of the
stable URLs above. No runtime pass or successful repair of an unknown
acceptance failure is claimed.

## Protocol decision (unchanged)

No AG-UI adapter. [The plan](../../../docs/workspace-ui-protocol-plan.md), Ownership
and protocol choices and Phase 4, puts a removable adapter after a useful application
loop and requires a concrete reuse/consumer benefit. No such consumer is present;
AG-UI demonstrably improves nothing in this implementation because it is not used.
Current official AG-UI documentation/version compatibility is unverified (no network).
Existing HTTP/SSE remains the runtime, and local files remain authoritative.
