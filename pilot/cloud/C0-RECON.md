# Pilot Cloud: C0 reconnaissance and C1 decisions

Date: 2026-10-26. Implements C0 and C1 of `pilot/cloud/BUILD-PLAN.md` (PR #6, `09834ba`).

## State found
| Item | State |
|---|---|
| `main` | `7234e62` |
| PR #5 `pilot/v012-integration` (local Pilot v0.12) | draft, head `27598b3`, APPROVE at that SHA in its own review |
| PR #4 W0 data safety, PR #3 workspace plan | draft, unmerged. #4 is contained in #5 |
| PR #6 `plan/pilot-cloudflare-personal` | draft, docs only (`BUILD-PLAN.md`) |
| Orca worktrees | `pilot-v012-m1-mistral` (PR #5), `pilot-w0-data-safety`, `pilot-w0-verify` (detached). None touched |
| Orca primary checkout | lives in an older Claude scratch folder (`scratch-2026-10-24-…/blackboard-nextgenui`). It goes away if that session is deleted, so re-point the Orca repo before then |
| Observatory / Weavr | no Observatory files and no `.weavr/` in this repo, so it is not Weavr-governed. The operating contract (weavr `docs/CHATGPT-OPERATING-CONTRACT.md`) was followed: repo inspected directly, no missions dispatched |
| Cloudflare | no Wrangler login and no `CLOUDFLARE_API_TOKEN` on the NUC (`wrangler whoami`: not authenticated). No account, zone or Access app was inspected |
| Provider keys | none were read or used. All provider calls were made to a local fake |

## Integration strategy
- New branch `blackmath88/pilot-cloud-c1`, stacked on PR #5 head `27598b3`. The draft PR targets `pilot/v012-integration`, so its diff is only the cloud slice. Rebase it onto `main` once #5 merges.
- Everything new is in `pilot/cloud/`. `pilot/app/` is unchanged, and local Pilot still runs and verifies as before.
- `BUILD-PLAN.md` stays in PR #6. Adding it here too would make the two PRs conflict.

## Compatibility matrix (local v0.12 → Worker)
| Local piece | C1 Worker | How |
|---|---|---|
| `server.js` HTTP + 127.0.0.1 Host/Origin guard | `src/index.js` | Replaced by Access JWT verification on every request (assets too) and a same-origin + JSON check on writes |
| `callCandidate` SSE parsing, key scrubbing (incl. split prefix), first-token/stall timeouts | `src/providers.js` | Ported. Adds a native Anthropic Messages adapter next to the OpenAI-compatible (Mistral) one |
| `secrets.js` key store + `/settings/key` | Worker secrets only | No key endpoint, as the plan requires. `looksLikeKey` ported (`src/guard.js`, parity test) |
| `transcript.jsonl` + `chats.json` | SQLite in one Durable Object per user | `conversations`, `messages`, `meta(schema_version)` |
| Conversation-only history (40 lines), board share off by default | same | Board/project context does not exist in C1, so nothing else can be sent |
| `public/style.css` | `public/style.css` | Byte-identical copy (parity test), plus `cloud.css` for layout |
| `public/app.js` (1030 lines, bound to `/state`, `/events`, board, kanban) | new `public/app.js` (~120 lines) | Not reused: it depends on fs-backed endpoints that C2 has to redesign anyway |
| Board, extraction, frames, modules, fades, files, `/why`, metrics.jsonl | — | Out of scope (C2/C3) |

## ADR-1: storage boundary
- **Decision:** one SQLite-backed Durable Object per authenticated email (`idFromName('user:' + email)`). It owns conversations and messages and serializes writes. The provider call runs inside the DO, so a reply is stored even if the browser disconnects.
- **Schema:** versioned in `meta.schema_version` (currently 1). The DO refuses to start on a newer schema than its build. Migrations are additive.
- **Not now:** D1, R2, KV, Queues. Add them only when there is a concrete need (cross-workspace queries, attachments).
- **Domain logic later (C2):** blackboard semantics (proposed/confirmed, origin, /why) go behind a narrow storage interface used by both local and cloud. No Node `fs` ports.
- **Export:** before any data migration (C3), add a versioned JSON export of the DO, so local→cloud import is dry-runnable.

## C1 limitations (known, accepted)
- One user workspace and conversation list. No board, decisions/tasks, files or project context.
- No export/import yet (C3). DO data exists only in Cloudflare once deployed.
- A conversation accepts one streaming reply at a time (409 otherwise). A reply abandoned by the browser keeps running in the DO until the provider finishes or times out (60 s to first token, 30 s stall).
- Telemetry is `console.log` JSON, metadata only (provider, model, latency, first token, chars, error category), visible in Workers Logs. No OTel exporter.
- Real Anthropic/Mistral calls are untested: no keys were used. The adapters follow the public APIs and are tested against a fake that speaks both stream formats.
- The JWKS fetch from the Access team domain is covered only by unit tests (real RSA keys, a mocked JWKS). The live Access flow needs the deployment.

## C1 evidence
| Step | SHA | Result |
|---|---|---|
| Base (PR #5 head) | `27598b3` | |
| C1 slice | `b87fff3` | Independent review (Codex, Orca worktree `pilot-cloud-c1-review`): **REQUEST CHANGES**, 1 P1 + 3 P2 |
| Review fixes | `c425726` | Re-review: **APPROVE at `c425726`**, 43 passed / 0 failed across required suites and reviewer probes |

Builder runs at `c425726` (Node 26.8.1, wrangler 4.152.0, local workerd):
- `npm test`: 21 passed, 0 failed.
- `npm run test:e2e`: 8 passed, 0 failed. Covers streaming via fake Claude/Mistral (more than one chunk each), the server-side key on each provider call, conversation-only context, a provider echoing the key (redacted from stream, storage and logs), key-like input and titles refused, CSRF, DO state identical after a Worker restart, a second user seeing nothing, and 401/403/500 without a valid identity on HTML/JS/CSS/API.
- Local Pilot at the same tree (`CHROME=/usr/bin/chromium npm run verify` in `pilot/app`): 14 of 15 scripts pass, including the browser checks. The one failure, `verify-v0.6`, is the known GNU sed baseline from PR #5. `git diff 27598b3 -- pilot/app` is empty.
- Browser check of the hosted UI at desktop and 375 px widths: chat streams, the conversation survives reload, no horizontal scroll.

Review findings fixed in `c425726`: upstream error text could carry a key prefix out (P1, now only allowlisted error types are passed on); titles skipped the key-input check (P2); a stream cut off before its end marker was saved as complete (P2); Mistral in-stream error envelopes were ignored (P2).

Open after review: `npm audit` reports 2 moderate and 1 high advisory in the Wrangler dev toolchain (not shipped to the Worker; not triaged). The provider call in the DO is not registered with `ctx.waitUntil`, and eviction during an in-flight reply is untested.
