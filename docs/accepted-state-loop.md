# Accepted knowledge stays connected to the conversation

This increment builds on PR #9 (`feat/workspace-knowledge-slice`, `82314f0`), which
already contains the local Pilot foundation from PR #5 and the planning work from
PR #8. It keeps the dependency-free Node server, local files, consent-driven panes,
model roles, offline operation, host/origin checks, and local-to-cloud fallback
policy. It adds no framework, AG-UI adapter, Cloudflare integration or deployment.

## Walk through the loop

From the repository root:

```sh
cd pilot/app
npm run demo -- loop
```

Open `http://127.0.0.1:4870`. The demo starts two deterministic local fake providers
on ports 5871 and 5872. It needs no API key and makes no paid model call.

1. Send `Decision: keep evidence local. Task: review the release notes. Task: discard the archive.`
2. Confirm the release-notes task; reject the archive task. Leave the decision pending.
3. Edit the accepted task to `Publish reviewed release notes`.
4. Choose Kanban and move its Stage to `done`. Arrow keys also move a focused task.
5. Switch among Summary, Index and Kanban. The title, stage and provenance belong
   to the same record. “Show in conversation” finds its originating chat/message.
6. Enable Share project board and inspect the chat disclosure. Ask
   `What is the latest accepted task?` The fake response names the edited title
   and completed stage. Pending and rejected records are absent from the board payload.
7. Disable sharing and ask again. No board snapshot is attached. Conversation text
   that was previously sent remains in history; this setting does not erase it.
8. Stop with Ctrl+C and run `npm run demo -- loop --resume`. Accepted edits, pending
   proposals, history and sharing survive. Without `--resume`, the marked demo resets.

For a persistent project instead of a throwaway demo, use the existing
`node bin/pilot.js init <directory>` and `node bin/pilot.js start <directory>` flow
with your explicitly chosen provider configuration. No provider is provisioned by
this change. Application runtime: Node 20.3+. Browser checks: Node 22+ and Chromium.

## Canonical state and disclosure

`state.json` remains the canonical record store. Acceptance changes status;
editing changes title and, for a source, URL; moving changes a task's column.
Identity, model author, original quote, source message/chat, creation and acceptance
are retained. Edits and moves add their own user attribution and timestamp.
`/why <id>` cites the edit/move audit entries as well as the original evidence.

The browser sends a revision and SHA-256 token of the raw state file. A same-revision
manual file edit still invalidates the token. A stale editor keeps its unsaved draft,
shows the saved record, and requires an explicit “Load latest record” before saving.

The next chat context uses current accepted records, including tasks in `done`.
It is bounded to eight records per kind and 16,000 characters total. The most recent
edit/move/acceptance/creation timestamps determine inclusion; omitted and shortened
records are counted. The original quote is evidence, not a substitute for the edited
title. A broken state file supplies no board context even when a last-good display
is available. Broken sharing configuration defaults to off.

Each role disclosure names configured candidates, locality, models and blocked
local-to-cloud fallbacks. It shows a next-request template with placeholders, and
the latest attempted request body for that role and chat. Attempt bodies live only
in server memory: at most 30 role/chat entries, each displayed up to 100,000 characters
with explicit truncation. They contain no authorization headers and disappear on
restart. Metrics retain request hashes and board revision/token metadata. A failed
attempt means delivery was not confirmed; it does not prove the provider received nothing.

## Recovery contract

| Situation | Behavior |
| --- | --- |
| Acceptance response is lost | A retry with the same operation ID and request returns the stored outcome. A different request cannot reuse that ID. |
| Process stops during a canonical write | `state-transaction.json` completes state, provenance/audit and the conversation note exactly once on the next read/start. |
| State differs from both transaction images | Recovery refuses to overwrite the external edit and retains the journal for inspection. |
| Journal is empty, truncated or malformed | Writes stop; the journal and state are preserved. |
| Second server opens the same workspace | A live or unknown lock owner is refused. A dead local process can be recovered; a different host is not assumed dead. |
| Extraction is interrupted after a complete reply | The reply's durable extraction intent appears as interrupted after restart. Restart makes no model call. |
| Extraction returns invalid JSON or fails | No partial proposal batch is committed. The failed turn can be retried or dismissed in Knowledge. |
| Several retries arrive together | One extraction is queued. A committed extraction event prevents another batch or provider call. |
| Retry after changing sharing/provider settings | The original turn is extracted using current settings. Prior conversation text remains part of that turn. |
| Old/partial reply has no extraction intent | It is not automatically replayed. |

State, audit and note writes use a short-lived redo journal and atomic, synced file
replacement. The journal's destinations are fixed. This is a local single-writer
contract, not a distributed database or a lock that arbitrary text editors obey.
Keep a backup before repairing a conflicting journal or an unknown lock owner.
Do not remove a lock merely because a request is slow. Preserve the entire `.pilot`
directory, stop the owning server, and inspect the saved before/after state and audit
before deciding how to resolve a conflict.

This increment makes canonical item writes transactional. Existing pane/module,
frame and sharing actions retain their own file/audit paths; they are not covered
by the item transaction. Auxiliary pane-touch updates can follow an item commit.
Real-model extraction quality, remote filesystems and power-loss behavior on every
filesystem are not claimed by the deterministic process-crash tests.

## Verification

```sh
cd pilot/app
bash dev/verify-foundation.sh
bash dev/verify-loop.sh
bash dev/verify-demo-loop.sh
PILOT_REQUIRE_BROWSER=1 npm run verify
# Optional executable override and screenshot destination:
CHROME=/usr/bin/chromium SHOT_DIR=/absolute/output/path node dev/browser-check.js loop
```

The harness distinguishes PASS, FAIL, PARTIAL and SKIP using both exit status and
assertions. Missing optional browser support is not a pass; required-browser mode
fails instead. Fixtures are marked, isolated, and refuse occupied ports. Linux and
macOS use the same browser discovery. Fixture preservation checks compare the actual
before/after files and work in source archives without Git metadata.

The loop checks cover actual fake-provider requests, sharing boundaries, stale raw
tokens, provenance, concurrent chats, server restarts, interrupted extraction,
concurrent retries and acceptance killed between state and audit writes. Browser
checks exercise review/edit/move keys, all three views, stale drafts, restart,
cross-chat origin links, narrow layouts, extraction retry, and a delayed editor
response. Browser exceptions and off-origin page requests fail the scenario.

Review is self-review unless a separate reviewer is explicitly recorded. No
independent approval, real-model validation, merge or deployment is implied.
