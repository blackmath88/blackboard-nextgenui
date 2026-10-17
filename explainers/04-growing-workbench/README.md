# The Growing Workbench

An explainer in three acts.

1. **History**: eight pixel-art eras of interfaces that grew: teletype and shell, Alexander's piecemeal growth, Carroll and Carrithers' training wheels, Norton Commander, Turbo Vision, Brand's *How Buildings Learn*, Eclipse perspectives, and the return of the terminal with coding agents.
2. **Replay**: a real conversation, condensed to 26 messages, replays in a fake terminal. A controller watches four visible, deterministic thresholds (index at 10 messages, reasoning map at 4 decisions, kanban at 4 tasks, sources at 5 sources) and asks `[y/n]` before adding a pane. Accepted panes split the screen with View Transitions; declined ones are remembered. The index jumps back into the chat.
3. **What's next**: the open problem (panes must also go: remove, ask, or fade?) and the draft spec for **CLI Pilot v1**.

## Run

Open `index.html`. No build, no dependencies besides Google Fonts (with fallbacks). Keys in the replay: `→` next, `y` / `n` answer the controller.

## Structure

```
js/replay.js   the conversation, task names, growth rules (data only)
js/pixel.js    original 12×12 pixel sprites rendered as SVG
js/ui.js       everything derived from: messages shown + your answers
css/style.css
```
