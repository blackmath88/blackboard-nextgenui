# 04 Build plan

Six steps. Each is small, reversible, and ends with checks you can run in under five minutes. Estimates assume one focused person with a coding agent.

## P0 Skeleton (½ day)

**Delivers:** `server.js`, `public/index.html`, chat round trip to one OpenAI-compatible endpoint, `transcript.jsonl`.

- Server serves the page, proxies `/chat` with streaming, appends both lines.
- Page shows the terminal pane, input line, streamed reply.
- `pilot.config.json` with one `chat` role.

**Done when**
- [ ] A message and its reply appear in `transcript.jsonl`.
- [ ] Restart the server and reload: the full conversation is back.
- [ ] The browser network tab shows no call to any model endpoint.

## P1 Roles and commands (½ day)

**Delivers:** model roles with candidates and policy, `/model`, `/help`, status bar.

**Done when**
- [ ] `/model chat morrow` switches the chat model; the next assistant line records it.
- [ ] With policy `fallback`, stopping the first endpoint makes the second answer; `metrics.jsonl` logs it.
- [ ] The status bar always shows the active model per role.

## P2 Growth (½ day)

**Delivers:** controller, `rules.json`, `modules.json`, consent flow, index pane, pane layouts for 1 to 4 panes, View Transitions.

**Done when**
- [ ] At the message threshold, the controller asks exactly once.
- [ ] `y` adds the index; `x` (never) survives a server restart and is never asked again.
- [ ] Editing a threshold in `rules.json` takes effect on the next turn without restart.
- [ ] Clicking an index entry scrolls the chat to that message.

## P3 Proposals (1 day)

**Delivers:** extractor on role `extract`, `state.json`, reasoning map and kanban panes, confirm and reject.

**Done when**
- [ ] After a turn with a clear decision, a proposed item appears, dashed, with author `model` and the model name.
- [ ] Malformed extractor output writes nothing and is logged.
- [ ] A proposal whose `quote` is not in the turn is dropped.
- [ ] `c` confirms, `r` rejects; both are recorded with time and author.
- [ ] Never more than 3 proposals per turn; near-duplicates are dropped.

## P4 Live files (½ day)

**Delivers:** `fs.watch` + SSE, atomic writes, `rev` checks.

**Done when**
- [ ] A hand edit of `state.json` appears in the page within a second.
- [ ] Two open tabs stay in sync.
- [ ] A write with a stale `rev` is rejected and the page reloads state.

## P5 Dogfood week (7 days)

**Delivers:** one real project run in the pilot. Suggested: the next build after the pilot, so the pilot plans its own successor.

**Acceptance (proposed thresholds, to be read from `metrics.jsonl`)**
- [ ] **Continuity:** state survived every restart; you never re-explained the project.
- [ ] **Consent:** no pane appeared without a recorded answer.
- [ ] **Usefulness:** the index was used to jump back at least three times in one session.
- [ ] **Signal:** at least half of confirmed-or-rejected proposals were confirmed.
- [ ] **Quiet:** the controller asked no more than once per hour of work.

**Kill criterion:** if after a week you open a plain chat instead of the pilot for this project, stop and write down why. That is a result.

## Explicitly out of scope for v1

Real shell · removing or fading panes · model-driven growth · several users · MCP, ACP, AG-UI adapters · voice · auth · a database · a docking library.

Each has a trigger in `06-open-questions.md` that would bring it in.

## Risks and the first response to each

| Risk | First response |
|---|---|
| Extraction noise makes confirming a chore | Max 3 per turn, quote check, dedupe; watch the confirm rate |
| Thresholds wrong for real work | They live in `rules.json`; tune by editing, not coding |
| Qwen too slow for extraction after every turn | Run extraction only every N turns or on idle; it is background work |
| Scope creep toward an IDE | The out-of-scope list; any addition needs a written trigger |
| File conflicts between editor and server | Atomic writes plus `rev`; last write wins for one person |
