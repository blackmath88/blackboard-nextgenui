# 03 Prior art: bits and pieces on GitHub

Searched on 16 October 2026. The point is not to find a finished product, but parts worth reusing, ideas worth borrowing, and traps worth avoiding. Licences and maturity must be re-checked before adoption.

## Reuse (candidate dependencies)

| Piece | What it gives the pilot | Use in v1? |
|---|---|---|
| **WebTUI** · github.com/webtui/webtui | A modular, pure-CSS library that gives browser pages a terminal-UI look; themes such as Catppuccin, Nord, Gruvbox | Optional. Our own amber CSS is small; WebTUI is the fallback if styling grows |
| **Ollama structured outputs** · docs.ollama.com/capabilities/structured-outputs | A JSON Schema in the `format` field constrains decoding; also available through the OpenAI-compatible `response_format` | Yes, for the `extract` role on Morrow |
| **Zod** (or Ajv) | One schema used both to request structured output and to validate the answer | Yes, Ajv if we stay schema-first in JSON; Zod if TypeScript |
| **dockview** · github.com/mathuo/dockview | Zero-dependency docking layout (tabs, groups, splits, serialisation), vanilla TypeScript core | Not v1. Candidate for v2 when panes need drag, tabs, popouts |
| **LiteLLM proxy** · docs.litellm.ai | One OpenAI-compatible endpoint in front of Ollama, OpenAI, Anthropic and others, with fallbacks | Not required. Point a role's `baseUrl` at it if routing needs grow |
| **Mermaid** | Text-to-diagram rendering in the browser | Maybe for the reasoning map in v2; v1 draws its own chain |
| **Node `fs.watch` + Server-Sent Events** | Live file updates without dependencies | Yes |

## Borrow (ideas, not code)

| Project | Idea worth borrowing | Where it differs |
|---|---|---|
| **Toad** · github.com/batrachianai/toad (Will McGugan) | A unified terminal UI for coding agents over the Agent Client Protocol (ACP), Markdown-first, and `toad serve` runs the same TUI in a browser | Toad fronts agents; it does not grow panes from project state. ACP is a candidate integration for v2+ |
| **Textual + textual-serve** | One codebase for a real TUI and a browser view | The alternative path if the pilot must live in a real terminal (see decision D1) |
| **Cradle** · github.com/wibus-wee/cradle-app | Its release notes say plainly that chat is for exploration, and its workspace became a real workbench with panels that follow the workspace lifecycle and release resources when closed | Panels are opened by the user; no consent-based growth from state |
| **Flowstate** · github.com/lazarbukejlovic/flowstate | Turns a meeting transcript into a workspace: decisions, tasks, risks with confidence scores and source quotes | One-shot extraction into a finished board; ours is incremental and proposal-first |
| **veritas-kanban** · github.com/BradGroux/veritas-kanban | Extracted candidates stay pending with attribution, confidence and rationale; idempotency prevents duplicates after retries | Same proposal discipline, different domain |
| **Syntrace** · github.com/leksval/syntrace | Project memory as one Markdown file any LLM can read | Confirms "state in files"; no live UI |
| **AG-UI shared state** · docs.ag-ui.com | Snapshot and JSON-Patch delta events between agent and UI | Our transport is file-change events; AG-UI is a v2+ adapter if other frontends need the state |
| **MCP Apps `ui/update-model-context`** | A UI telling the model its state without forcing a turn | Our equivalent: the extractor and `state.json` in the next prompt |
| **br-ai-nstorm** (own) | Proposals vs accepted events, qualified attribution, conflicts as first-class | The provenance model to copy |
| **Observstory** (own) | Deterministic compile from typed state to a scene; `explain_frame` | The pattern for "why does the workbench look like this?" in v2 |

## Avoid

| Trap | Why |
|---|---|
| A full agent framework as the base | The pilot is not an agent; frameworks pull in tool execution and autonomy we explicitly exclude |
| A database in v1 | Files must stay readable and hand-editable; that is the experiment |
| A docking library before the panes prove useful | Drag-and-drop layout is the IDE-overwhelm path the diachronic idea exists to avoid |
| Model-driven growth in v1 | We could not tell the controller's rule from the model's judgment |
| `format: "json"` without a schema on small models | Reported as unreliable; pass a schema and validate anyway |

## What none of these do, as far as found

Combine all four: chat that **grows** panes on visible thresholds, **asks** before each, keeps state as **hand-editable files**, and marks every item's **author**. That combination is the pilot.
