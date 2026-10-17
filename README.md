# blackboard-nextgenui

Four explainers and one build plan from a single human–AI design conversation about interfaces for language models: Miro ([blackmath88](https://github.com/blackmath88)) with Claude.

Chat became the default interface for working with language models. It is good for curiosity and bad for ongoing work. This collection asks who decides an interface's form, where its state lives, and who holds authority over it. Each piece answers one question and hands the next one on.

Start with **`index.html`**, the overview.

## Folder map

```
index.html                       overview page (English)
assets/                          overview stylesheet and icon
explainers/
  01-blackboard/                 Hearsay-II rebuilt: how does an LLM listen? (German)
  02-morph/                      can the UI reshape itself? (German)
  03-rolle-und-kodex/            answer-shaped vs workspace-shaped UI (German)
  04-growing-workbench/          grow panes by consent (English)
pilot/
  cli-pilot-v1/                  concept and build plan for the first real build
notes/
  summaries/
    generative-ui-shared-state-summary.json   the conversation's session summary
```

Each explainer keeps its own `README.md` with its acts, structure and sources. The explainers and the plan are kept as they were delivered. The only change to the explainers is a small "← Overview" link at the top of each page.

The pilot build itself lives in `pilot/app/` on its own branch and is in progress.

## How to open

- Double-click `index.html`. Everything works from `file://`: no build, no server, no dependencies. The pages load Google Fonts if they are online and fall back to system fonts if not.
- Or serve the folder, for example `python3 -m http.server` in the repo root, then open <http://localhost:8000/>.

## GitHub Pages

Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`. The overview is served at the site root and the explainers at `explainers/<name>/`.

## Authorship

Written with AI (Claude, Anthropic) in conversation with Miro, and reviewed by a human. The explainers simulate model behaviour deterministically and say so.
