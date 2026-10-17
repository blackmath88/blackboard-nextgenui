# 02 Architecture

## Overview

```
┌──────────────── browser (localhost) ────────────────┐
│  terminal pane  │  index │ map │ kanban  (grow later) │
│  status bar: models per role · counts · panes       │
└───────▲──────────────────────────────┬──────────────┘
        │ SSE /events (file changes)   │ POST /chat, /answer, /command
┌───────┴──────────────────────────────▼──────────────┐
│ server.js (Node, no framework)                      │
│  router ─ model roles ─► OpenAI-compatible endpoints │
│  controller (deterministic, rules.json)             │
│  extractor (narrow model call, closed schema)       │
│  watcher (fs.watch on .pilot/) ─► SSE               │
└───────▲──────────────────────────────┬──────────────┘
        │ read                          │ write (atomic)
┌───────┴──────────────────────────────▼──────────────┐
│ .pilot/  the blackboard                             │
│  transcript.jsonl  state.json  modules.json         │
│  rules.json        metrics.jsonl                    │
└─────────────────────────────────────────────────────┘
```

The browser never calls a model and never holds a key. The server is the only writer of `.pilot/` besides you and your editor.

## The blackboard: `.pilot/`

| File | Shape | Written by | Notes |
|---|---|---|---|
| `transcript.jsonl` | one message per line | server | append-only; `{id, ts, role, text, model}`; roles: user, assistant, controller, system |
| `state.json` | items with status and author | server, you | decisions, tasks, sources; see `schemas/state.schema.json` |
| `modules.json` | panes and answers | server | which panes exist, when added, your y/n/a/x answers |
| `rules.json` | growth thresholds | you | see `schemas/rules.example.json` |
| `metrics.jsonl` | one event per line | server | consent answers, jumps, confirmations, model calls with latency |

Writes are atomic (write to a temp file, then rename) and every write bumps `rev`. A write carrying a stale `rev` is rejected; the page then reloads state. Last write wins otherwise. That is enough for one person with one editor and one browser tab, and it stays honest with two tabs.

## Flows

### Chat turn

1. You type and press Enter. In v1 the chat keeps Enter; diffusing it is a later experiment.
2. `POST /chat` → server appends the user line to `transcript.jsonl`.
3. Router picks the model for role `chat`, streams the reply back, appends the assistant line.
4. Server runs the **controller** (cheap, deterministic) and, in the background, the **extractor**.

### Extraction (proposals)

1. Role `extract` gets the last user and assistant message plus the titles of existing items.
2. It must return JSON matching `schemas/extraction.schema.json`: at most 3 items, each `{kind, text, quote}`.
3. Server validates: schema, max 3, `quote` must occur in the turn, near-duplicates dropped.
4. Survivors are written to `state.json` with `status: "proposed"`, `author: "model"`, `model`, `fromMessage`.
5. Invalid output is dropped and logged to `metrics.jsonl`. Nothing half-valid is written: fail closed.

Where available, the request uses structured outputs (Ollama's `format` with a JSON Schema, or `response_format` on OpenAI-compatible endpoints). Validation still runs on every response, because grammar-constrained decoding guarantees shape, not sense.

### Growth (controller)

1. After each turn, the controller computes four counts: messages, decisions (confirmed + proposed), tasks, sources.
2. For each rule not yet asked: if `count >= threshold`, it appends a controller line to the transcript and sets `modules.json.pending`.
3. The page shows the question with keys `[y] yes  [n] no  [a] always  [x] never`.
4. `POST /answer` records the answer. `yes`/`always` adds the pane; `never` silences that rule permanently; `no` silences it until the count doubles.

No model is involved in growth decisions in v1. That keeps the controller's rule distinguishable from model judgment, which is the thing we want to measure first.

### Live files

`fs.watch` on `.pilot/` (debounced 150 ms) re-reads the changed file and pushes `{file, rev}` over Server-Sent Events. The page re-renders the affected pane with a View Transition. A hand edit in your editor therefore appears in the page within a second.

## Model roles: the dynamic decision

The question "Morrow or frontier?" is not answered once. It is configuration per role, changeable at runtime.

| Role | Job | Sensible default |
|---|---|---|
| `chat` | the conversation | frontier model, or Morrow for private topics |
| `extract` | decisions, tasks, sources as proposals | Morrow (Qwen): narrow, closed schema |
| `title` | optional one-line titles for the index | none in v1: first sentence is used |

Each role has an ordered list of candidates and a policy:

- `manual`: use the first candidate; switch with `/model <role> <candidate>`.
- `fallback`: try candidates in order on error or timeout; log which one answered.

The status bar always shows the active model per role. Every assistant line and every proposed item records which model produced it.

If you later want load balancing, cost tracking or many providers, point a role's `baseUrl` at a LiteLLM proxy. The pilot does not need to know.

See `schemas/pilot.config.example.json`.

## The page

- Plain HTML, CSS, JS. No bundler. Amber-phosphor look from the explainer, pixel sprites for the controller.
- Layout by CSS grid with fixed templates for 1 to 4 panes. No docking library in v1.
- Panes change with `document.startViewTransition`; instant swap if unsupported or reduced motion is set.
- Keyboard first: chat input, `y/n/a/x` for consent, `c/r` on a focused proposal, `/` commands.

### Commands in v1

| Command | Effect |
|---|---|
| `/model <role> <candidate>` | switch the model for a role |
| `/rules` | print the current rules and counts |
| `/panes` | list panes and your answers |
| `/help` | list commands |

## Authority rules (non-negotiable in v1)

1. The model never writes state directly; it proposes.
2. Only `POST /answer` and your editor change an item from `proposed` to `confirmed`.
3. No pane appears without a recorded answer.
4. Every item shows its author and, for model items, the model.
5. The pilot never touches files outside `.pilot/` and its own folder.
