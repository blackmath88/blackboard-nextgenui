# Beyond the scroll

This repository collects the outputs of one long design conversation about AI interfaces, held between Miro ([blackmath88](https://github.com/blackmath88)) and Claude in October 2026. It asks who decides the form of an interface, where its state lives, and who holds authority over it. Four interactive explainers answer one question each and hand the next one on. A build plan, CLI Pilot v1, turns the result into something to build for real.

## Layout

```
index.html                     the overview page that tells the story
assets/                        styles and script for index.html only
explainers/
  01-blackboard/               Hearsay-II and the blackboard: how does an LLM "listen"? (German UI)
  02-morph/                    semantic morphing, NLS to Morphic to authority (German UI)
  03-rolle-und-kodex/          scroll vs codex, three architectures compared (German UI)
  04-growing-workbench/        the chat that grows into a workbench (English UI)
pilot/cli-pilot-v1/            concept, architecture and build plan; Markdown and JSON schemas, no code
notes/summaries/               the conversation's own JSON summary
```

Each explainer keeps its own `README.md` with details on its acts and file structure.

## Open it locally

Open `index.html` in a browser. There is no build step, server or dependency. The explainers load Google Fonts when online and fall back to system fonts offline.

## GitHub Pages

All links are relative, so the site works from a project page such as `https://blackmath88.github.io/blackboard-nextgenui/`. Enable Pages under *Settings → Pages* with the root of the default branch as the source. The `.nojekyll` file makes Pages serve files as they are, so the pilot's Markdown appears as plain text there; the overview also links to the rendered version on GitHub.
