# 01 Concept

## The claim to test

Chat is a good place to start work and a bad place to keep it. The pilot tests whether a chat can **grow into a workbench** when the project earns it, without ever surprising the person using it.

Three ideas carry it, each tested in an earlier explainer:

1. **Files are the blackboard.** Project state lives in plain files. The chat, the panes, the controller and the models are modules that read and write them. (Blackboard explainer, VS Code picture.)
2. **Growth is proposed, never imposed.** A deterministic controller watches visible thresholds and asks before adding a pane. Model output enters as a proposal and becomes state only after confirmation. (Growing workbench, br-ai-nstorm's rule.)
3. **Every frame says whose it is.** Every item carries its author: you, or the model with your confirmation. (Genette's authorial and allographic paratext, Rolle und Kodex.)

## What it is

- A local web page that looks and behaves like a terminal.
- One chat pane at the start. Nothing else.
- A small local server that talks to models and owns the files.
- A controller with four editable rules that proposes new panes.
- Three possible panes in v1: **index**, **reasoning map**, **kanban**.

## What it is not

- Not a shell. No commands are executed on your machine.
- Not an agent. It does not act on anything outside its own `.pilot/` folder.
- Not multi-user. One person, one project.
- Not an IDE. The goal is the fewest panes that help, not the most.

## Principles

| Principle | Consequence in v1 |
|---|---|
| Start as a chat | First launch shows one pane and a prompt |
| Earn every pane | A pane appears only after a threshold and your `y` |
| State outside the session | Restarting the server or the browser loses nothing |
| Proposals, not changes | Model-extracted decisions and tasks start as dashed, unconfirmed items |
| Visible rules | `rules.json` is shown in the UI and editable by hand |
| Models are swappable per role | Which model does chat, extraction or titles is configuration, changeable at runtime |
| Prototype-sized | No framework, no database, no auth, no build step for the page |

## A week with the pilot

**Day 1, minute 1.** `npm start`, the page opens. A cursor blinks. You start talking about a topic, exactly like any chat.

**Day 1, message 12.** The controller's pixel sprite appears in the chat: *12 messages. Scrolling back gets slow. Add an index pane?* You press `y`. The screen splits; the index lists every message by its first sentence. Clicking jumps back.

**Day 2.** After each assistant reply, a small local model reads the turn and proposes up to three items: a decision, a task, a source. They collect quietly in `state.json` as *proposed*. When four decisions have accumulated, the controller asks: *Add a reasoning map?* The map shows decisions as a chain; dashed ones are still proposals. `c` confirms, `r` rejects.

**Day 3.** You restart your laptop. Everything is back: transcript, panes, your answers, the map.

**Day 4.** You open `.pilot/state.json` in your editor and fix a task's wording by hand. The page updates within a second. The files really are the truth.

**Day 5.** You switch the chat model from the frontier model to Morrow with `/model chat morrow`, because the topic got private. Extraction keeps running on Morrow as before. The status bar shows which model does what.

**Day 7.** You read `.pilot/metrics.jsonl` against the acceptance checks in `04-build-plan.md`.

## Success, in one sentence

After a week you would rather open the pilot than a plain chat for this project, and nothing in it ever appeared or changed without your yes.
