# Brief: build CLI Pilot v1, steps P0 to P4

You are building a small local prototype. Read `../01-concept.md`, `../02-architecture.md` and `../04-build-plan.md` first. This brief is the short form.

## What to build

A local web page that looks like a terminal (amber on dark, monospace), served by a Node server. One chat pane at start. Project state in `.pilot/` files. A deterministic controller proposes new panes (index, reasoning map, kanban) when thresholds in `rules.json` are reached, and asks before adding them. A narrow model call extracts decisions, tasks and sources as *proposals* that the user confirms or rejects.

## Constraints

- Node 20+, no web framework, no database, no bundler. Page in plain HTML/CSS/JS under `public/`.
- Dependencies: at most one JSON Schema validator (Ajv). Nothing else without asking.
- Prototype-sized. No extra abstraction layers, error boundaries or config systems beyond `pilot.config.json`.
- UI text in English.
- The browser never calls a model endpoint and never sees a key. Keys come from environment variables named in config.
- The server writes only inside `.pilot/`. Atomic writes (temp file, rename). Every write bumps `rev`.
- Models only ever *propose*. Only `POST /answer` or a hand edit changes `proposed` to `confirmed`.
- No pane appears without a recorded answer in `modules.json`.

## File tree

```
cli-pilot/
  server.js
  pilot.config.json        (copy of schemas/pilot.config.example.json)
  public/index.html  app.js  style.css  pixel.js
  .pilot/                  (created on first run, with rules.json from schemas/rules.example.json)
  README.md
```

## Endpoints

| Method | Path | Does |
|---|---|---|
| GET | `/` | page |
| GET | `/state` | transcript tail, state, modules, rules, active models |
| POST | `/chat` | `{text}` → append, call role `chat`, stream reply, append, run controller, schedule extraction |
| POST | `/answer` | `{module, answer}` or `{itemId, decision: "confirm"\|"reject"}` |
| POST | `/command` | `/model`, `/rules`, `/panes`, `/help` |
| GET | `/events` | SSE: `{file, rev}` on every change in `.pilot/` |

## Steps

Do them in order. Stop after each step and show the "done when" checks passing.

1. **P0 Skeleton**: chat round trip, transcript, restart-safe.
2. **P1 Roles**: candidates, `manual` and `fallback` policies, `/model`, status bar.
3. **P2 Growth**: controller, consent keys `y/n/a/x`, index pane, CSS grid templates for 1 to 4 panes, View Transitions with reduced-motion fallback.
4. **P3 Proposals**: extractor with `schemas/extraction.schema.json` (pass it as structured output when the candidate has `structured: true`), validation, quote check, max 3, dedupe; map and kanban panes; `c`/`r` on focused proposals.
5. **P4 Live files**: `fs.watch` with 150 ms debounce, SSE, `rev` checks, two tabs in sync.

The "done when" lists are in `../04-build-plan.md`. Treat them as acceptance tests; write a short `CHECKS.md` that records how each was verified.

## Do not

Run shell commands for the user · add agents or tool execution · add auth · add a database · add a docking library · let a model decide growth · remove panes automatically.
