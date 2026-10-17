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
  app/                           the build (local Node server, tagged iterations v0.3–v0.10)
notes/
  summaries/
    generative-ui-shared-state-summary.json   the conversation's session summary
```

Each explainer keeps its own `README.md` with its acts, structure and sources. The explainers and the plan are kept as they were delivered. The only change to the explainers is a small "← Overview" link at the top of each page.

The pilot build lives in `pilot/app/` and grows in tagged iterations (`pilot-v0.3` to `pilot-v0.10`; see `pilot/app/CHANGELOG.md` and `pilot/app/REPORT.md`). Run any of them with `cd pilot/app && npm run demo -- v0.N`, or a tag with `bash pilot/app/scripts/try.sh pilot-v0.N`.

## How to open

- Double-click `index.html`. Everything works from `file://`: no build, no server, no dependencies. The pages load Google Fonts if they are online and fall back to system fonts if not.
- Or serve the folder, for example `python3 -m http.server` in the repo root, then open <http://localhost:8000/>.

## GitHub Pages

Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`. The overview is served at the site root and the explainers at `explainers/<name>/`.

## Authorship

Written with AI (Claude, Anthropic) in conversation with Miro, and reviewed by a human. The explainers simulate model behaviour deterministically and say so.
