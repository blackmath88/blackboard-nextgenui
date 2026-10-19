# CHANGELOG

P0 to P2 (skeleton, model roles, growth controller with consent and the index pane) are the pre-iteration
baseline, merged before the numbered iterations started; see `CHECKS.md` (# P0, # P1, # P2). Iterations are
tagged `pilot-v0.N` by the coordinator; each one is runnable with `npm run demo -- v0.N`.

## pilot-v0.13

Projects that group chats, as Miro decided: projects have chats, and the chats of a project share its board. v0.12 built
chats inside one project (one pilot dir). Now there can be several projects, and each one is its own pilot dir with its
own chats, board, rules, panes, pins, flags, frames and metrics. Still untested with a real model (fakes only).

**Adds**
- **A project is a pilot dir, unchanged.**
  - `project.js` (`createProject(dir)`) holds everything that works on one dir. That code was the body of `server.js`
    around one module-level `PILOT`. It moved as it was, except for `watch()`/`unwatch()`, `start()` (server_start),
    `chatTurn()` and the return value.
  - Every project therefore has its own caches, last good versions, write chain, extraction/frame/title queues, watcher
    and SSE clients. Two projects never share any of them.
  - `server.js` keeps the config, the HTTP router and the list of open projects.
- **Two modes.**
  - **Single-dir mode** (no `PILOT_HOME`; started as before with `PILOT_DIR` or the default `.pilot/`): the server has one
    project, that dir. It is opened and watched from the start, exactly as before. Nothing about projects is written:
    no `projects.json`, no home, the page and the URL look as in v0.12. `/projects` names the one project and says how to
    get several; `/project new` is refused and changes nothing.
  - **Home mode** (`PILOT_HOME=<dir>` relative to `pilot/app/`, or `pilotHome` in the config; documented default
    `projects/`, gitignored; `npm run projects` starts it): the home holds `projects.json` and one dir per project.
- **`projects.json`** `{rev, projects: [{id, name, dir, createdAt, archived?}]}` (`projects.js` reads it; hand-editable,
  `rev`, atomic, watched; a broken one is read as its last good version and never written).
  - It is created lazily. Until then the home has one project, the default dir (`PILOT_DIR`, else `.pilot/`), listed
    **by reference**. The first `/project new` (or rename, or archive) writes the file with that dir listed first, as
    `../.pilot` say. It is never copied or moved. This is how a real `.pilot/` becomes a project.
  - `dir` is relative to the home. A sub-dir is a project made here; any other path (e.g. `../.pilot`) is a reference.
  - Every dir must resolve inside `pilot/app/` (as `PILOT_DIR` must), so a hand edit cannot make the server read or
    write elsewhere. An entry outside, the home itself, a bad or repeated id, or a dir two entries share is ignored.
  - A listed dir that does not exist answers 404 and is never created.
- **`/project new <name>`** creates `<home>/<id>/` (id = the name as a slug: `tax-return`; `-2`, `-3` if the id or the
  dir is taken; an existing dir is never reused) and seeds `rules.json` from `rules.example.json`. Event `project_new`
  in the new project's `metrics.jsonl`.
- **More commands:** `/projects [all]`, `/project` (where you are), `/project <name or id>` (an exact id wins, then an
  exact name, then a unique prefix), `/project rename <name>`, `/project archive [project]`, `/project unarchive
  <project>`. Events: `project_rename {was, by: user}`, `project_archive`, and `project_switch {from, to, how}` (sent by
  the page, logged in the project it went to).
- **No delete, only archive.** `archived: true` hides a project from the list. Its dir stays, and it still opens by its
  URL. The last listed project cannot be archived. Archiving the project you are in takes the tab to the first one listed.
- **Every request names its project:** `?project=<id>` or `project` in the JSON body, on `/state`, `/events`, `/chat`,
  `/command`, `/answer`, `/move`, `/touch`, `/frame`, `/metric`. Missing = the default (the first listed project that
  is not archived; in single-dir mode the one). Unknown = 404 (`unknownProject: true`), as an unknown chat.
- **The URL holds project and chat** (`/?project=<id>&chat=<id>`, main omitted). `/` in home mode opens the default and
  writes it into the URL, so a reload and a copied link stay there. Two tabs can be in two projects; Back/Forward move
  between projects too. An unknown project in the URL falls back to the default, with a notice.
- **SSE per project.** `GET /events?project=<id>` registers the tab with that project only: it gets that project's file
  changes and extraction status, never another project's. One home watcher pushes `projects.json` changes to every tab.
- **Watchers only for open projects.** A project opens on first use (`server_start` is written then). Its watchers (the
  dir and `chats/`) start with its first tab and close 5 s after its last tab left (`UNWATCH_MS`). On the next tab they
  start again, and the tab reloads everything on hello. Resource limits (README, "Projects"): about two `fs.watch` handles
  per project a tab has open, plus one for the home; a project's in-memory caches stay until the server stops; a full
  `/state` reads the chat files of every listed project for the sidebar.
- **Per project, as the brief asks:** the board, the controller counts, `/stats`, `/why`, frames, fading, the open
  question; pins (`roles.json` lives in the project dir; the roles and candidates come from the one config) and flags
  (`flags.json`). Switching project switches the board.
- **The sidebar (home mode)** groups chats under projects, like ChatGPT's projects:
  - "+ new project" sits at the top. It puts `/project new ` into the input, so a project never starts without a name.
  - Each project has a header. It is a button that collapses or expands the project, with a caret, the name and the
    number of chats; collapsed headers are kept in this browser.
  - Below each header: "+ new chat" for that project, then its chats, most recent first, each with who named it.
  - The current project's header has the lavender edge, and the current chat inside it stays marked as in v0.12. The
    current project's chats are the live list (SSE). The other projects' chats come from `/state` and refresh with
    `projects.json` changes or on switch.
  - "+ new chat" under another project starts the chat there and opens it.
  - Archived projects sit behind "archived projects: n (show)".
  - The bar says "projects", and the title bar and the tab title say "project / chat".
  - The sidebar is open by default in home mode, and below 900 px it is a drawer as before. Alt+S and ↑/↓ also reach
    the project headers and each "+ new chat".
- **Switching project** resets the page's state for the new project: board, panes, proposals and touches, the event
  stream. A load answered for the old project is dropped.
- **Demo** `npm run demo -- v0.13` (ports 4790, 5800, 5801): a projects home with "health insurance claim" (the v0.12
  project byte for byte: three chats and an archived one, its kanban) and "move flat" (two chats, its own small board:
  four tasks and a confirmed decision, the kanban consented in its own metrics, every item in its own ledger).
  `demo.json` `"home": true` makes `demo.js` start the server with `PILOT_HOME`. Generated by `dev/make-fixture-v13.js`
  (deterministic).
- **Dev:**
  - `verify-v0.13.sh`.
  - `browser-check.js v13`; scenarios can now start a server with `PILOT_HOME` (`ENV.home`).
  - `sse-probe.js` takes `SSE_PROJECT=<id>`.

**Why**
- Miro's decision (projects with chats; chats share the project's board) and the v0.12 question "where do chats live once
  there are projects?": a project = a pilot dir keeps every file as it is. `chats.js`, `stats.js` and `why.js` already
  took the dir, and nothing inside a pilot dir changes.
- **Why a factory, not a "current project" variable:** the handlers `await` (streaming, extraction in the background), so
  a swapped global would let two projects interleave their writes.
- **Why the default dir by reference and a lazy `projects.json`:** a real `.pilot/` must never be moved or rewritten. The
  same pattern as main in `chats.json`: the first project command is the only moment anything is written, and it only
  adds a file.
- **Why single-dir mode stays exactly as it was:** every earlier verify script and demo starts the server that way. Home
  mode switches on only with `PILOT_HOME`, never because a `projects/` happens to exist.
- **Why watchers close:** the brief asks for one watcher per open project. With many projects, watching all of them would
  cost file handles for nothing; a tab that comes back reloads everything anyway.

**Deliberately does not**
- No delete, no moving or copying of a project dir, no import of a dir from outside `pilot/app/`.
- No rename or archive from the sidebar (commands or a hand edit), no drag to reorder projects, no search.
- No moving a chat or an item between projects; no board across projects.
- No live push of another project's chat list (SSE isolation): it refreshes on `projects.json` changes and on switch.
- No per-project config (the roles and candidates are shared; only the pins are per project).
- No project UI in single-dir mode, so every earlier layout check is unchanged.
- No `file_edit` events for a project no tab has open. Hand edits made then are still shown as "you (file edit)",
  because authorship comes from the ledger.

## pilot-v0.12

Several chats in one project, with a sidebar like ChatGPT's, asked for by Miro. His decision: projects have chats, and the
chats of a project share its board. This iteration builds chats within one project (the pilot dir). Projects come in
v0.13. Still untested with a real model (fakes only; the new `title` role runs against the morrow fake in the demo).

**Adds**
- **Files** (hand-editable, atomic, `rev`, watched; `chats.js` reads them, and every function takes the dir, so nothing
  assumes a single pilot dir):
  - `transcript.jsonl` stays the first chat, `main`. It is never moved, rewritten or migrated.
  - Further chats live in `chats/<id>.jsonl`.
  - `chats.json` `{rev, chats: [{id, file, createdAt, title?, titleBy?, titleModel?, titledAt?, archived?}]}` lists
    them, `main` first. It is created on the first new chat, together with `chats/`.
  - A dir without `chats.json` is one chat and behaves exactly as before. The earlier verify scripts and demos run
    unchanged.
  - Path safety: an id is `main` or `[a-z0-9][a-z0-9-]*`. The file always follows from the id. An entry whose `file`
    says anything else is ignored.
  - A broken `chats.json` is read as its last good version (`fileErrors`) and never written; `/chat new`, rename and
    archive refuse until it is fixed.
- **The sidebar** (`public/index.html`, `app.js`, `style.css`):
  - Lists the chats, most recent activity first: the title, who named it, the number of messages and the last activity.
    "+ new chat" sits at the top.
  - The chat you are in is marked (`aria-current`, a lavender edge on the bar colour).
  - Archived chats sit behind "archived: n (show)".
  - Each chat is a real link (`/?chat=<id>`), so a middle click opens it in a new tab.
  - It is closed while the project has one chat, so the page looks as before; the ☰ button in the title bar opens it.
    It opens by itself once `chats.json` exists. Your toggle is kept in this browser.
  - With the sidebar open, the shell grows by its width. The chat column narrows a little (1.2 : 1 instead of
    1.6 : 1), so the kanban keeps three columns at 1280 px.
  - Below 900 px it is a drawer over the page, opened with ☰ and closed by Escape or by picking a chat.
  - The title bar and the browser tab title name the current chat.
- **Keyboard:** `Alt+S` (Option+S) focuses the sidebar (opening it or the drawer if needed). It is matched on the key
  code and never acts while the chat input has text. In the list, ↑/↓ move, Enter opens, Escape returns to the input.
- **Commands:**
  - `/chats [all]` lists the chats.
  - `/chat new [title]` starts one. An empty, untitled chat you have not used yet is reused instead of piling up empty
    chats.
  - `/chat <title or id>` switches. An exact id wins, then an exact title, then a unique title prefix.
  - `/chat rename <title>` names the chat you are in.
  - `/chat archive [chat]` and `/chat unarchive <chat>` hide a chat from the list and bring it back.
- **The URL holds the chat** (`/?chat=<id>`, main = `/`). A reload stays in it, Back/Forward move between chats, and each
  tab can be in a different chat. The chat is never kept in localStorage, so two tabs never fight over it. An unknown
  chat in the URL falls back to main, with a notice.
- **Every write names its chat:** `chat` in `POST /chat`, `/command`, `/answer`, `/move`, `/touch` and `/frame`, and
  `GET /state?chat=`. Missing means main, for curl and the older checks; an unknown chat gets 404. System and controller
  lines go to the chat where the action happened. Nothing done in another chat touches `transcript.jsonl`.
- **The model sees only the current chat's history** (the last 40 messages of that chat).
- **The shared board.**
  - Decisions, tasks and sources from every chat land in the same `state.json`.
  - Once the project has more than one chat, a proposed item records `fromChat` next to `fromMessage`. The field is in
    the schema copy, `pilot/app/schemas/state.schema.json`. A missing `fromChat` means main, as in every older item.
  - `/state` gives each item its `chat`: `fromChat`, else the chat that holds `fromMessage`.
  - With more than one chat, every card shows a chat tag, e.g. `chat · invoices`. It is a button: it opens that chat and
    scrolls to the message the card came from.
  - `/why <item>` cites the message in its own file and line (`chats/c-invoices.jsonl:1 m-f203`) and says which chat
    (`chats.json:N chats c-invoices`). A `/why` "show m-…" link into another chat opens that chat first.
    `dev/why-cites.js` resolves both.
- **Titles and who named them.**
  - The `title` role names a chat after its first reply, if the role has a candidate. Pins, local-only fallback and
    `stallMs` apply, as for every role. The reply must be one line of 1 to 60 characters; anything else is logged as
    `title_error` and changes nothing.
  - Without a candidate (the default config), the title is the first sentence of the first message, the index pane's
    rule. A model never renames a chat that has a title.
  - Who named a chat is shown everywhere:
    - "you": `/chat rename` or `/chat new <title>`;
    - "model · morrow": the title role;
    - "first message": no title yet;
    - "you (file edit)": the title in `chats.json` differs from the last one the server wrote. `chat_new` and
      `chat_rename` events are the ledger, as `item_write` is for items (v0.6).
- **No delete.** `archived: true` only hides a chat from the list. Its file stays, and its messages still count for the
  controller. `/chat unarchive` brings it back. Main cannot be archived.
- **The open question is the project's.** `modules.json` `pending` is project-wide, but its line lives in the chat where
  it was asked. `/state` sends it as `pendingLine {chat, line}`, and every other chat shows it at the end of the log,
  with its buttons and "asked in chat …". So y/n/a/x from the empty input never answers a question that is not on
  screen. The answer's system line goes to the chat where you answered.
- **Metrics:** `chat_new {chat, file, from, title?, by?, created?}`, `chat_switch {from, to, how: sidebar | command |
  tag | link | new | archive | back, turn}` (sent by the page via `POST /metric`; both chats must exist), `chat_rename
  {chat, title, was, by: user | model, model?}`, `chat_archive {chat, archived}`, `title_error`. `turn` and `index_jump`
  carry `chat` when it is not main.
- **`/stats`:** the five P5 measures stay project-wide. Usefulness and quiet count the messages of every chat.
  Continuity compares `server_start` with `turn`, and both now count the lines of all chats, so `/stats` reports no
  lost lines. A "chats" block (measured, not judged) follows the experiments block, only when the project has
  `chats.json` (or chat events): chats per file, and the chat events by kind.
- **Live files:** the watcher also watches `chats/` (`fs.watch` is not recursive) and pushes `change {file:
  "chats/<id>.jsonl", rev}`. The page reloads its transcript only for its own chat's file; any chat file, and
  `chats.json`, refreshes the list (recency, titles, the project-wide turn).
- **Demo** `npm run demo -- v0.12` (ports 4786, 5794, 5795): the v0.11 project with three chats ("letter" = main named
  by you, "invoices" named by morrow, the hospital chat with no name yet) and an archived "scratch". The shared kanban
  holds tasks from all three. The title role runs on the morrow fake. `dev/make-fixture-v12.js` (deterministic) copies
  the main transcript byte for byte from v0.11. `scripts/demo.js` now copies folders too (`chats/`).
- **Dev:**
  - `dev/fake-model.js` answers title requests (`PILOT-TITLE`) with the first four words of the first message.
  - `browser-check.js v12`.
  - `contrast-check.js` has six more pairs (the sidebar and the chat tag; all existing tokens).
  - `verify-v0.12.sh`.

**Why**
- Miro's request ("more than one chat, chat navigation like ChatGPT") and his decision: chats of one project share its
  board.
- **Why main stays `transcript.jsonl`:** a real `.pilot/` must never be moved or migrated, and a dir without chats must
  keep working with every earlier script. A lazily created `chats.json` makes the first new chat the only moment
  anything changes, and it only adds files.
- **Why no delete:** the files are the truth, and the board, `/why` and `/stats` cite chat lines by file and line. A
  deleted chat would leave items whose `fromMessage` points nowhere, and `/why` answers that say "not recorded" for
  something that was recorded. Archiving hides without losing anything, and you can still remove a file by hand if you
  really want to.
- **Why the controller counts all chats (project-wide):**
  - Growth is a property of the project. The panes and the board are shared, so the rules that grow them count what the
    project holds: messages in all chats, decisions and tasks as before.
  - Turns, and with them fading (v0.8), are project-wide too: a pane you have not touched for 8 messages in any chat
    fades.
  - The index pane lists the current chat's messages, because jumping back only makes sense within the log you see.
  - Alternative considered: count per chat (each chat grows its own index; fading counts turns in the chat you are in).
    That would make panes appear and fade as you switch chats, although the panes belong to the project, and a new
    chat would start with no index although the project already has one. If dogfooding shows the index rule should be
    per chat, only `counts()` and `fade.turnOf` change (see QUESTIONS.md).

**Deliberately does not**
- No projects (v0.13): one pilot dir is one project. `chats.js`, `stats.js` and `why.js` take the dir as a parameter;
  the server still has one `PILOT`.
- No delete, no rename from the sidebar (`/chat rename` or a hand edit), no drag to reorder chats, no search, no pinning.
- No sidebar in the old single-chat layout unless you open it (☰), so every earlier layout check is unchanged.
- No per-chat panes, rules or pending questions: one `modules.json` for the project.
- No `fromChat` on items while the project has one chat (missing = main), so `state.json` stays exactly as before in
  every earlier check.
- No streaming of a reply to other tabs (as before): another tab in the same chat sees the user line, then the finished
  reply.

## pilot-v0.11

A kanban that is drag and drop, asked for by Miro. Moving a card is you arranging your own board, so it is authored by
you, goes through the server with the page's last `rev`, and never confirms or rejects anything. Still untested with a
real model (fakes only; moving cards uses no model at all).

**Adds**
- **Drag and drop on the kanban** (`public/app.js`, pointer events, no library):
  - drag a task card to another column, or to another place in its column;
  - the card stays in place, dimmed, while a copy follows the pointer;
  - the column under the pointer is outlined and a bar shows where the card lands. Empty columns are drop zones too;
  - the drag starts after 5 px of movement, so a click still focuses the card. Buttons and links on a card never
    start a drag;
  - Escape, or a drop outside the columns, cancels. Nothing is sent then;
  - mouse, pen and touch all produce pointer events, so all three work. Task cards have `touch-action: none`, so a
    touch drag on a card moves it instead of scrolling the pane.
- **The keyboard way** (required for accessibility). On a focused task card:
  - `Alt+←` / `Alt+→` moves it to the previous / next column, keeping its row, or to the end if that column is shorter;
  - `Alt+↑` / `Alt+↓` moves it up / down in its column;
  - at an edge nothing is sent, and the page says why ("already at the top of todo");
  - the keys never act from the chat input or from a button. They don't clash with plain arrows (focus between cards),
    `c`/`r` (decide) or `f` (frame), none of which use Alt;
  - every move, refusal and cancel is announced in a new visually hidden `aria-live="polite"` region (`#announce`),
    e.g. "task-4 moved to todo, position 2 of 3.";
  - task cards point at a hidden help text through `aria-describedby`. No new Tab stop: the v0.10 Tab path is
    unchanged.
- **Optimistic, then the file decides.**
  - The card moves at once. `POST /move {itemId, column, index, rev}` follows; `index` is the place among the other cards
    of the target column, 0 = top.
  - Moves are queued, so quick Alt presses (and key repeat) go out in order; each carries the rev of the previous move's answer.
  - File events wait while a drag or a move is in flight, then the page reloads.
  - A refused move (stale rev → 409 `{stale}`, a rejected task, anything else) shows the notice and snaps the card back.
    The page re-renders even when the file did not change.
  - The moved card keeps focus and gets a short highlight, none with `prefers-reduced-motion`.
- **What a move writes** (`server.js` `move()`, inside the write chain):
  - on that task only: `column`, `order` (a number), `movedBy: "user"`, `movedAt`. Never `status`, `decidedAt` or
    `decidedBy`, and no other card;
  - `rev` + 1;
  - an `item_write` with `via: "move"` (the v0.6 write ledger), so the card reads "you" and not "you (file edit)", and
    a hand edit of `column`/`order` made before a page move stops counting as one;
  - `item_move {id, from, to, order, fromIndex, index, between, status, by: "user", turn, rev}` in `metrics.jsonl`.
- **What a move refuses:**
  - 409: a rejected task (rejected tasks are not on the board; with "rejected: n (show)" on, they are shown but can't
    be dragged or moved by key), a stale rev, a broken `state.json`, a kanban that is not shown;
  - 400: a decision or source, a bad column, a bad index;
  - 404: an unknown id;
  - the same place again: 200 `changed: false`, nothing written;
  - without `rev` (curl) a move is accepted, like `/answer`.
- **A proposed task can be moved and stays proposed**: dashed, with its c/r keys, still holding its pane open (v0.8).
- **The order rule** (`public/board.js`, one file loaded by the page and required by the server, so both sort alike):
  - a task's place is its `order` when it has one, else its position in `state.json` `items`. Without any `order` the
    board is in file order, exactly as before;
  - a move sets the moved task's `order` to the midpoint between its new neighbours (top: the next one − 1; bottom: the
    previous one + 1; alone in the column: its own file position). No card is renumbered.
- **Interplay:**
  - a move is a touch of the kanban (v0.8, `applyTouch(…, "move")`). A kanban that is a tab comes back. Only the
    first touch per turn is written; in the page the pointerdown or focus before a drag or a key is usually that first
    touch;
  - an applied kanban frame (v0.10) is reset by a manual move: `frames.json` gets `resets.kanban {at, by: "user",
    frame, reason: "manual move"}`, `frame_reset` has the same reason, a system line says why, and the page shows a
    notice: "kanban: frame fr-1 … reset by your manual move; the pane shows your order". This also happens while the
    experiment is off (see QUESTIONS.md). A broken `frames.json` never blocks a move: the move happens, the file
    stays as it is, and a `frame_error` is logged.
- **Files stay the truth.** A hand edit of `column` or `order` shows within about 0.2 s (v0.5) and reads "edited by you
  (file edit): column, order" (v0.6). Two tabs stay in sync through SSE. A tab whose rev is old gets 409 and reloads.
- **`/why task-N`** adds where the task is now ("on the kanban now: doing, position 1 of 2 (order 7)") and every move,
  e.g. "moved by you from todo to doing (position 2) at … (through the page; still proposed: a move decides nothing)
  [metrics.jsonl:N item_move task-4]". A move that reset a frame says so, and cites the `frame_reset`. A rejected task:
  "not on the kanban". `/why kanban` says when a frame was reset by your manual move.
- **The schema copy** `schemas/state.schema.json` (pilot/app only; the original under `pilot/cli-pilot-v1` is
  untouched) gains `order` (number), `movedBy` (enum `user`) and `movedAt` (date-time). Its title says so.
- **Demo `v0.11`** (`dev/make-fixture-v11.js`, from the v0.10 fixture, seven more synthetic turns):
  - the kanban has the whole side column, because the map and the index faded to tabs under the v0.8 rules;
  - seven tasks are on the board: todo task-4, task-5, task-7 (yours), task-8 (proposed, dashed); doing task-3 (moved
    there through a recorded move); done task-1, task-2. task-6 is rejected and off the board;
  - experiments are off.
- **Dev:**
  - `dev/verify-v0.11.sh` (41 checks, one of them runs the 40 checks of `browser-check.js v11`: 38 + 2 global);
  - `browser-check.js`: `page.key(k, modifiers)` and ArrowLeft/ArrowRight.

**Why**
- Moving a card is the clearest case of the person arranging their own workbench: it is theirs (authored by "you"), it
  lives in the hand-editable file, and it carries no judgement. That is why it may never confirm or reject. A model's
  frame (v0.10) is someone else's arrangement, so when you arrange the pane yourself, yours wins and the frame goes.
- Native pointer events instead of HTML5 drag and drop: HTML5 drag events do not fire for touch, and they cannot be
  driven by real input in headless Chrome. D8 rules out a docking library; a drag and drop library is out for the same
  reason.

**Deliberately does not**
- No transcript line per move: moves are in `metrics.jsonl`, `state.json` and `/why`, so the chat stays readable. A frame
  reset by a move does write a system line, like `/frame reset`.
- No renumbering: a move writes only the moved card, so no other card changes author. Repeated midpoints between the same
  two neighbours lose precision after about 50 moves (QUESTIONS.md).
- No drag between panes, no moving decisions or sources, no new columns, no multi-select.
- No auto-scroll at the pane edge while dragging.
- No undo beyond moving the card back (by drag, key or hand edit).
- No change to what `c`/`r`/`f` or plain arrows do.

## pilot-v0.10

Frame proposals: an experiment behind a flag, never the default. 02-morph's rule, applied to the pilot: a model may only
*propose* a frame, a closed vocabulary decides what it can say, and you decide whether it applies. The frame is
allographic paratext (03-rolle-und-kodex): written about your workbench by someone other than you, so it says so. Still
untested with a real model (fakes only).

**Adds**
- **The flag.** `experiments.frameProposals` in `pilot.config.json` (default `false`; both shipped configs say so), or
  `/flag frame-proposals on|off` (kept in `.pilot/flags.json`, wins over the config, like settled-input). `/flag` now
  prints one line per flag; the settled-input line is unchanged and first. `/state.flags` gains `frameProposals` and
  `frameSource` (`source` still names the settled-input source).
- **Off = the old behaviour.** No frame role call, no `frames.json`, no event, no note, cards in their own order, `f`
  is an ordinary key, and the status bar does not list the frame role (it appears there only while the flag is on).
  `POST /frame` answers 409 "experiment is off". `/model` lists the role, since it is in the config.
- **A `frame` role** in the config (both shipped configs: one local candidate `morrow`, `structured: true`; the dev
  config points it at the morrow fake). It runs after a complete reply, in the background, queued after that turn's
  extraction (its proposals are cards a frame may name), and only while a map or kanban is shown and not a tab;
  otherwise there is no call at all. Through `callRole` it obeys pins (`/model frame <name>`), the local-only fallback
  rule and `stallMs` like every role; a failure or stall logs `frame_error` and writes nothing. `/state.framing` says
  when a run is queued or running.
- **The closed FrameIntent** (`schemas/frame-intent.schema.json`, checked by `frame.js`):
  `{pane: "map" | "kanban", focus?: item id, order?: [item ids], group?: "status" | "author"}`, `additionalProperties:
  false`. `{}` means "no suggestion" (`frame_none`). On top of the schema the pane must be shown with consent and not a
  tab, and every id must be a card of that pane that is not rejected; an id twice in `order`, or an intent with nothing
  to do, is refused. Anything else (an unknown key such as `hide`, `status`, `text`, `add`; an unknown or foreign id;
  pane `index`; not JSON) rejects the whole intent: `frame_reject {reason, errors}` in `metrics.jsonl`, nothing written.
  A suggestion equal to the applied or the open one is `frame_reject reason same`.
- **The hand validator moved to `schema-check.js`** (unchanged), so extraction and frames use the same code, and an
  unsupported schema keyword still fails at startup.
- **`.pilot/frames.json`** `{rev, pending: {pane}, applied: {pane}, resets: {pane}}`: one open proposal and one
  applied frame per pane. A proposal records `id` (`fr-N`), the intent, `author: "model"`, `model` (candidate) and
  `modelId`, `at`, `fromMessage`, `turn`; an applied frame adds `appliedBy: "user"` and `appliedAt`; a reset records
  `{at, by: "user", frame}`. Hand-editable like the other JSON files: `rev`, pushed over SSE, a broken file is read as
  its last good version, shown in `fileErrors` and never written (`POST /frame` 409, `/frame reset` 400, a turn logs
  `frame_error reason frames`). A frame never writes `modules.json` or `state.json`.
- **The page.** A proposal is a dashed lavender note at the top of its pane: `model suggests: focus dec-2 · order dec-2,
  dec-4, src-1, dec-1, …` and, muted, `suggested by morrow, not by you`, with `f apply`, `dismiss` and `why?`. Nothing
  changes until you apply it:
  - **`f`** applies it while focus is in that pane (a card, the note itself, or the pane body), never from the chat
    input, never on a focused button, with the same guards as `c`/`r` (no modifier, not composing, not a repeat). The
    note is focusable (Tab reaches it, Escape returns to the input). The buttons work too.
  - **Applied**, the frame only arranges: cards named in `order` come first in that order (the rest keep theirs; it
    applies to the decision chain, the sources and each kanban column alike), the `focus` card gets a lavender bar and
    the chip `frame focus, suggested by morrow` and is scrolled to, `group` adds sub-headings. Nothing is hidden, no
    card or text changes. A muted line at the top says `frame fr-1: … · suggested by morrow · applied by you 10-17 15:54
    · reset`.
  - With the flag off an applied frame is not shown (it stays in `frames.json` and comes back when the flag is on).
- **`POST /frame {pane, id, action: apply|dismiss, rev?}`**: only the page (you) applies or dismisses. Apply checks the
  intent again against what is on screen now; one that no longer fits (a card was rejected or removed, the pane became
  a tab) is dropped with 409 and `frame_reject reason stale`. A stale `rev` is 409 `{stale: true}` like the other files.
  Each step adds a system line and an event: `frame_apply {id, module, intent, by: "user", model, proposedAt}`,
  `frame_dismiss`.
- **`/frame`** lists, per pane, the applied frame and the open proposal; **`/frame reset [map|kanban]`** puts a pane
  (or both) back in its own order (`frame_reset`, a system line, `resets.<pane>`). Reset works with the flag off too: a
  frame must always be undoable.
- **`/why map` and `/why kanban`** explain a frame when one is on file: what the applied frame does, which model
  suggested it after which message (with a "show" link), that you applied it and when, an open proposal, the last
  reset, how many suggestions for that pane were rejected and why (by recorded reason). Every statement cites `frames.json:N applied.map`,
  `metrics.jsonl:N frame_propose fr-1`, `frame_apply`, `frame_reset` (resolved by `dev/why-cites.js`, which learned the
  `frames.json` labels). A frame in the file without a matching event reads "written by file edit, when is not
  recorded". `/why` (the whole workbench) gets one `frames:` line. Without frames the explanations are as before.
- **Fake:** `dev/fake-model.js --frame=good|group|none|bad|badid|badkey|wrongpane|malformed`. Frame requests are
  recognised by `PILOT-FRAME` before the extraction test (both carry `response_format`). `good` frames the first pane
  with cards: focus = the card sharing most words with your last message, then the rest by score, newest first.
- **Demo `v0.10`** (`dev/make-fixture-v10.js`, from the v0.9 fixture): the same workbench; `frameProposals: true` and
  `settledInput: false` in the demo config only (Tab must move focus into the map, not send).
- **Dev:** `dev/verify-v0.10.sh` (63 checks, one runs `browser-check.js v10` with 32 checks: 30 + 2 global);
  `contrast-check.js` covers the note, its byline and its keys.

**Why**
- 02-morph ends on the question of authority: who owns the frame? This build answers it for one small case: the model
  may say how a pane could be arranged, in a vocabulary that has no word for adding, hiding, changing or deciding, and
  only your key makes it so. 06-open-questions puts "frame provenance in the UI" at "when panes start re-ordering";
  they now do, so every frame says who suggested it and who applied it, and `/why` can tell.

**Deliberately does not**
- No hiding, collapsing, resizing or re-titling; no layout change of the workbench; no frame for the index or the chat.
- No frame for a pane that is a tab, and a frame never brings one back or keeps one from fading (`fade.js` counts card
  proposals only).
- No automatic apply, no "always apply", no learning from what you apply or dismiss.
- No `everyNTurns` for the frame role (it runs after every reply while the flag is on; see QUESTIONS.md).
- No `/stats` block for frames yet: the events are in `metrics.jsonl` (`frame_propose`, `frame_reject`, `frame_none`,
  `frame_error`, `frame_apply`, `frame_dismiss`, `frame_reset`), the five P5 measures are unchanged.
- Untested with a real model.

## pilot-v0.9

Enter, diffused: an experiment behind a flag, never the default. The blackboard explainer hands on "how does Enter
disappear?". This iteration tries one answer: the input notices that you have stopped and that the line looks finished,
and offers to send it. It never sends by itself. D9 stands: the chat keeps its Enter key, the flag is off unless you
switch it on. Still untested with a real model (fakes only; the experiment uses no model at all).

**Adds**
- **The flag.** `experiments.settledInput` in `pilot.config.json` (default `false`; both shipped configs say so), or
  `/flag settled-input on|off`:
  - `/flag` writes `.pilot/flags.json` `{rev, experiments: {settledInput}}`. That file wins over the config and
    survives restarts; `/flag` alone shows the value and where it comes from (flags.json, the config, or the default).
  - Each switch adds a system line ("experiment settled-input on (/flag) …") and a `flag` event. A system line is not
    a turn.
  - `flags.json` is hand-editable like the other JSON files: it carries a `rev`, a broken one is read as its last good
    version, shown in `fileErrors`, and never written (`/flag` answers 400). Its changes are pushed over SSE, so a
    second tab follows (`/state.flags`, `GET /state?only=flags.json`).
  - `experiments.settleMs` (config only): the pause T before the offer, default 1800 ms, clamped to 300–10000.
- **Off = exactly today's behaviour.** No offer element is rendered, the settle listeners return at once, Tab moves focus
  and Enter sends as before, the placeholder is unchanged. `POST /metric` refuses settle events (400). Nothing new is
  logged.
- **On: the settled-input signal, deterministic, no model** (`public/settle.js`, the same file the page loads and the
  node checks require):
  - "last keystroke" = the last change of the input's value (the `input` event, so pasting and IME text count too);
  - after T ms without a change, while the input has focus and is not disabled, the page asks `looksFinished(text)`;
  - if it says yes, a quiet inline proposal appears next to the input: `send? (Tab to send, keep typing to ignore)`.
    It is muted text with the dashed lavender edge that proposals use, its title says "proposed by the settled-input
    heuristic of this page (no model)", and the input points at it with `aria-describedby`;
  - **Tab** sends while it shows (the same submit path as Enter). Shift+Tab and Tab without an offer move focus as before;
  - **keep typing** (any change of the value) drops it at once; **Escape** drops it and keeps the text;
  - **Enter** sends at any time, offer or not: the override;
  - focus leaving the input drops it silently; the flag switched off removes the element.
  Nothing is ever sent without a key press.
- **The heuristic (`looksFinished`), documented case by case** (the verify table has 24 cases):
  - finished, cue `punct` or `question`: the trimmed line ends in `.` `!` `?`, also before closing `) ] " ' ” ’ »`
    (`Send it now.  `, `(see the map).`, `He said "done."`, `Is that it?)`);
  - finished, cue `question`: no final mark, but it starts with a question word (what, how, why, when, where, who,
    which, can, could, should, would, will, is, are, do, does, did, have, has, may, might, must, …), has at least 4
    words and does not end on a dangling word (and, or, the, to, of, with, …): `what is left for Monday`;
  - not finished: trailing off (`wait...`, `I was thinking…`); ending in `,` `:` `;` `-`; an abbreviation that usually
    continues (`e.g.`, `i.e.`, `vs.`, `cf.`, `approx.`, `incl.`); a list number (`Step 3.`); a URL with a full stop
    (`see https://x.org.`); an open bracket or code span (`use \`npm run`, `is it (really?`); a command (starts with
    `/`: commands never get an offer and are not counted); shorter than 2 words and 6 characters (`?`, `yes.`, `ok`);
  - English only.
- **Measure, don't judge** (`POST /metric`, only while the flag is on):
  - `settle_offer {offer, cue, chars, words, sinceKeyMs}`: the offer appeared. `offer` is an id `so-…`;
  - `settle_accept {offerRef, sinceKeyMs, offerMs, chars}`: sent with Tab;
  - `settle_ignore {offerRef, how: typed|escape, offerMs}`: kept typing, or Escape;
  - `enter_send {offerShowing, offerRef?, sinceKeyMs, chars}`: sent with Enter, with or without an offer showing;
  - the server keeps only these fields (numbers rounded, enums checked) and adds `settleMs` and `turn`. **Never any
    text:** an ignored offer was a draft nobody sent;
  - one offer has at most one outcome (accept, ignore, or Enter while showing); a second one is 400, also after a
    restart (checked against `metrics.jsonl`). An offer without an outcome (blur, reload, flag off) is "unresolved".
- **`/stats` (and `npm run stats`) get an "experiments" block** after the five measures: the flag in `flags.json` and how
  often `/flag` switched it; offers and their outcomes (Tab, kept typing, Escape, Enter while showing, unresolved);
  Enter sends with and without an offer; the median time from the last keystroke to the send for Tab, Enter with an
  offer and Enter without one (with n); the pause T used. No threshold, no PASS / NOT YET: the five verdict lines stay
  the only ones, and `/stats` still prints exactly what `npm run stats` prints (it reads the dir only).
- **Demo `v0.9`** (`dev/make-fixture-v09.js`, from the v0.8 fixture): the same workbench, fading thresholds raised to 20
  so nothing fades or asks during the demo, and `experiments.settledInput: true` in the demo's config only.
- **Dev:** `dev/verify-v0.9.sh` (35 checks, one runs `browser-check.js v09` with 28 checks: 26 + 2 global).

**Why**
- The explainer's question is how Enter can disappear without the machine deciding for you. A pause plus a finished
  sentence is the cheapest deterministic signal that you are done; turning it into a proposal (not an action) keeps
  "models only ever propose" true for the page itself, and Enter stays as the override.
- D9 keeps Enter in v1 because diffusing it would muddy what P5 measures. Behind a flag, default off, the five measures
  are unchanged; the experiment's own events are counted apart and not judged.

**Deliberately does not**
- Never sends by itself, never changes Enter, never runs a model on the draft, never stores the draft.
- No per-person learning of T or of the heuristic, no language other than English, no offer for commands.
- No `/flag` for `settleMs` (config only) and no "default" value for `/flag` (on|off only; delete `flags.json` to fall
  back to the config).
- Off logs nothing, so there is no baseline "time to send" from before the flag (see QUESTIONS.md). The baseline inside
  the experiment is `enter_send` without an offer.
- Tab while an offer shows sends instead of moving focus to the panes (see QUESTIONS.md).

## pilot-v0.8

Panes can go: an untouched pane fades to a tab, a touch brings it back, and only your answer removes it. This answers
the open question the growing-workbench explainer and `06-open-questions.md` hand on ("Remove, ask, or fade into a
tab?"): fade first, then ask. Still untested with a real model (fakes only).

**Adds**
- **Fading.** After every turn the controller checks each shown pane. A pane nobody touched for `fadeAfterTurns` turns
  fades to a tab:
  - a turn is one message you sent (the count of `user` lines in `transcript.jsonl`; commands are not turns);
  - `rules.json` sets `fadeAfterTurns` as a default at the top level, and a rule may set its own (the rule wins);
    without one, the pane never fades. `rules.example.json` now has `fadeAfterTurns: 8` and `askRemoveAfterTurns: 8`;
  - the controller says so in a controller line ("map pane faded to a tab: untouched for 8 turns …") and logs
    `pane_fade` (turn, idle turns, threshold, the last touch's turn).
- **Fading is not removal.** A faded pane stays in `modules.json` with `"state": "faded"`, `fadedAt` and `fadedTurn`. It
  keeps its place in the layout order as a slim labelled strip (`▸ kanban  tab · untouched since turn 22`). The grid
  gives it an auto row and the shown panes share the height; with only tabs, the side column shrinks to their width (at most 18rem).
  `/state.panes` still lists it; `/state.faded` and `paneInfo.<module>.fade` say it is a tab.
- **A touch brings it back at once.** Click, Enter or Space on the tab: the page shows the pane before the server answers,
  with a View Transition (instant with reduced motion), and reports `POST /touch {module, how: "tab"}`.
- **Touch, defined exactly.** A touch is your interaction with a shown pane:
  - `click`: a pointerdown anywhere inside it (a card, a button, an index entry, so also an index jump; the scrollbar);
  - `scroll`: a wheel or touchmove inside it;
  - `focus`: keyboard focus moved into it by you (Tab or arrows; a keydown less than 500 ms before the focus arrived).
    Focus the page restores after a re-render is not a touch;
  - `decide`: confirming or rejecting one of its cards (the server records it, also for `curl`);
  - `tab`: the tab of a faded pane.
  Typing `/why map` in the chat is not a touch of the map (it is the chat). Each touch moves the pane entry's
  `lastTouch {at, turn, how}`. Only the first touch of a pane in a turn is written and logged as `pane_touch` (a later
  one changes nothing, so there is no rev bump and no event); a touch on a tab is always recorded (`unfaded: true`). A
  new pane starts with `lastTouch.how: "added"`; an older entry without `lastTouch` counts from its `addedAt`.
- **Two panes never fade:**
  - the chat. It is not in `modules.json`, and `POST /touch {module: "chat"}` answers 400;
  - a pane holding an unanswered proposal (map: decisions and sources; kanban: tasks). A tab would hide a decision you
    have not made. If a proposal arrives in a faded pane (extraction, or a hand edit seen on the next turn), the
    controller brings the pane back at once, says why in a controller line, and logs `pane_unfade` (reason
    `proposal`). That is not a touch. A pane holding a proposal is also never offered for removal.
- **Removal only with consent.** After `askRemoveAfterTurns` more turns as a tab, the controller asks, once per pane: "The
  kanban pane has been a tab for 8 turns. Remove the kanban pane?" It goes through the same one-question-at-a-time
  controller as growth (`modules.json` `pending` plus `pendingKind: "remove"`; `controller_ask` with `question:
  "remove"`). Answers: buttons, or keys in the empty input:
  - `y` (yes): the pane entry leaves `modules.json`. Its rule may offer it again, but only as a new question (an old
    "always" no longer adds it by itself) and only once the rule's count has doubled since the removal, like after
    "no";
  - `n` (no): it stays a tab and is not asked again;
  - `x` (never): removed, and its rule never offers it again;
  - `a` has no meaning here: 400 from `/answer`, and in the input it stays text.
  The answer is recorded like any consent: `modules.json` `removals.<module> {answer, at, turn, count, consentId}`
  (kept apart from `answers.<module>`, which stays the growth consent), a `consent` event with `question: "remove"`, a
  system line, and `pane_remove` with `answerRef` for yes and never. No rule removes a pane; only this answer does.
  Touching the pane while its question is open withdraws the question (system line, `controller_withdraw`). A withdrawn
  question does not count as asked: looking is not an answer. It can come again once the pane has faded again and
  stayed a tab for `askRemoveAfterTurns` turns. An answered question is never asked again for that pane entry; a pane
  that is removed and grows again is a new entry with its own question.
- **`/why <pane>` explains fading** (sources as in v0.7):
  - shown or a tab since turn X;
  - the last touch: how, when, which turn (`metrics.jsonl:N pane_touch map`);
  - the turns since (`transcript.jsonl user lines ×N`);
  - the threshold and whether it comes from the rule or the default (`rules.json:N fadeAfterTurns`);
  - what happens next: "fades after turn 38 if nobody touches it", or "holds an unanswered proposal (dec-1), so it does
    not fade";
  - the removal question: when it is due, open, or asked with your answer.
  Its history adds `pane_fade`, `pane_unfade`, the removal question and answer, and `pane_remove`. `/why` marks tabs
  ("map (tab)") and removed panes. `/rules` and `/panes` show faded and removed panes.
- **`fade.js`** (beside `stats.js` and `why.js`): the pure rules (turn count, thresholds, last touch, proposals held,
  due or not), used by the controller and by `/why`, so both say the same thing.
- **Demo `v0.8`** (`dev/make-fixture-v08.js`, from the v0.7 fixture). The open proposals are decided, the kanban
  faded at turn 30, and the map was last clicked at turn 30. Your first message (turn 38) fades the map and makes the
  kanban removal question due.
- **Dev:**
  - `dev/verify-v0.8.sh`: 44 checks, one of which runs `browser-check.js v08` (24 checks);
  - `dev/why-cites.js` resolves the new citations (pane events by module, `removals.<m>`, `fadeAfterTurns`).

**Why**
- The growing-workbench explainer ends on "panes must also go: remove, ask, or fade?" (`06-open-questions.md`, first
  row). A workbench that only grows ends up as the overwhelm the diachronic idea was meant to avoid. Removing a pane
  silently would break "every pane earned and consented".

**Decision: fade first, then ask (in the style of `05-decisions.md`)**
- **Alternatives considered:**
  - (a) Remove after N idle turns. Rejected: a rule would delete something you consented to, and "no pane without a
    recorded answer" has a mirror image, "no pane gone without one".
  - (b) Ask "remove?" after N idle turns, nothing in between. Rejected: one more question, and every idle stretch
    (a weekend) would cost an answer. The quiet measure in `/stats` counts every question.
  - (c) Fade only, never remove. Rejected: a tab nobody ever opens is clutter too, and the person cannot get rid of it.
  - (d) Let a model judge relevance. Rejected: a model only proposes (D4, D6), and growth is deterministic in v1.
  - (e) Count idle time in minutes instead of turns. Rejected: overnight every pane would fade. Turns measure work.
- **Chosen:** (c) then (b), as a deterministic rule: fade first, and ask only about a pane that stayed a tab.
  - Idle for `fadeAfterTurns` turns → fade to a tab. Reversible with one click, no question.
  - A tab for `askRemoveAfterTurns` more turns → ask once.
  - Only a recorded yes or never removes.
  - The two exceptions: the chat never fades, and a pane holding an unanswered proposal never fades.
- **Reverse if:**
  - you bring panes back from a tab more often than you leave them as tabs (`pane_touch` with `unfaded` vs
    `pane_fade` in `metrics.jsonl`): the threshold is too low or turns are the wrong clock;
  - the removal question gets "n" almost every time: drop the question and keep (c);
  - tabs pile up and you want them gone without being asked: make "always remove faded panes" an answer (the unused
    `a`).
  Then: tune the defaults in `rules.json`, or replace turns with work time from `metrics.jsonl`.

**Deliberately does not**
- No rule ever deletes a pane, also not a pane added by hand. A hand-written pane entry fades like any other.
- No fading of the chat, no fading while a proposal is unanswered, no removal question while one is.
- No re-ordering of panes, no drag, no docking library (D8). A tab keeps its slot.
- No touch from typing `/why <pane>` or from the "show m-…" link; no touch from focus the page moves by itself.
- No unfading on a hand edit of `state.json` before the next turn: a proposal written into the file brings its pane
  back after your next message (or at once after an extraction, which runs the controller).
- No "always" for the removal question (see QUESTIONS.md).
- Fading needs `fadeAfterTurns` in `rules.json`. A `.pilot/rules.json` seeded before pilot-v0.8 has none, so nothing
  fades there until you add it (one line, see README). Old demo fixtures (v0.3–v0.7) behave as before.

## pilot-v0.7

`/why`: the current workbench explained from the files, each statement with its source. Also a layout fix for narrow
side panes. Still untested with a real model (fakes only).

**Adds**
- **`/why`** prints the whole workbench in compact form:
  - one line per shown pane: its rule, the count when it was asked, your answer, how it was added;
  - one line per pane that is not shown but has history (e.g. "answered no at 3");
  - two summary lines for the items.
- **`/why <pane>`** (`index`, `map`, `kanban`, `chat`) gives the full history:
  - the rule recorded with the pane, plus the current `rules.json` rule if it changed since;
  - every question (count, threshold, the question text and its transcript line), every answer and every add;
  - the answer on file and whether `metrics.jsonl` has its consent event.
- **`/why <item id>`** (e.g. `/why dec-2`) gives:
  - origin: model and extraction run, or a file edit;
  - the message it came from (author, time) and whether the quote is still in that message;
  - who decided it and when (through the page or by file edit);
  - every field changed by hand: what the server wrote and what the file says now.
- **Every statement cites its source:**
  - `metrics.jsonl:60 controller_ask` or `transcript.jsonl:5 m-f005` for JSONL files, with physical line numbers;
  - `modules.json:14 panes index` or `state.json:18 items dec-2` for JSON entries: the line of the entry as the file is now.
- **Missing facts are said plainly.** A fact is never filled in:
  - "no recorded answer";
  - "written by file edit, when is not recorded";
  - "added by you (file edit) at …" when a `file_edit` event exists, otherwise "when is not recorded";
  - "the server never wrote it";
  - "message m-… is not in transcript.jsonl";
  - "the pane entry has no controller_add event".
  A broken `state.json` or `modules.json` makes `/why` say so; it does not crash.
- **`why.js`** (like `stats.js`): pure and read-only. No model, no writes. `/command` returns `lines` (text) and `why`
  (statements with `cite` and `msg`).
- **Page:**
  - A "why?" button on every pane bar and every card runs the same `/why` command. It is a real button: Tab reaches it,
    Enter presses it.
  - `c`/`r` act only on the focused card itself, never on a button inside it.
  - `/why` lines show their sources in muted text. A statement that names a message has a "show m-…" button that
    scrolls to it. This is not logged as an `index_jump`, so Usefulness in `/stats` stays honest.
- **Layout fix:**
  - Labels never break mid-word. Who-labels, the controller label, chips, tags, times, pane titles and buttons do not
    wrap or shrink; the text next to them wraps instead. The cause was `overflow-wrap: anywhere` on chat lines, which
    let the controller label shrink to one letter per line.
  - The kanban stacks its three columns when its body is narrower than 420 px (a container query). Below that a column
    would be under about 134 px, about 17 characters of card text. Widths, measured with the demo data:
    | Window | Side panes | Kanban body | Kanban |
    |---|---|---|---|
    | 800 px | stacked full width (existing `max-width: 800px` rule) | 712 px | 3 columns |
    | 820 px | side by side | 259 px | stacked |
    | 1000 px | side by side | 328 px | stacked |
    | 1280 and 1600 px (the shell is at most 1280 wide) | side by side | 436 px | 3 columns of 140 px |
- **Demo `v0.7`:** the v0.6 fixture (index, map and kanban grown through consent), plus one `file_edit` event for task-7.
  dec-8 has none, so both the recorded and the unrecorded case show.
- **Dev:** `dev/why-cites.js` resolves every cited source back to its file. `browser-check.js v07` adds layout checks at
  800, 820, 1000, 1280 and 1600 px. `contrast-check.js` covers the new pairs.

**Why**
- 01-concept: "every frame says whose it is", and the person can always ask why the screen looks the way it does. This
  is the Observstory `explain_frame` idea, answered from recorded facts and never guessed. v0.6 recorded the facts;
  v0.7 makes them answerable.
- Layout: the coordinator's v0.6 run found "controll/er" and kanban columns about 6 characters wide (ITERATIONS.md,
  2026-10-17).

**Deliberately does not**
- No model involvement, no summarising. `/why` lists recorded facts and their sources.
- No explanation of transcript lines, the status bar or model choice (`/model` and `metrics.jsonl` already say that).
- No history of hand edits that happened while the server was down beyond "when is not recorded". Only the current
  file and the server's last write are compared, as in v0.6.
- Line numbers of JSON entries are found by searching the file as it is now (the entry's `"id"`/`"module"` line). A
  file reformatted by hand moves them; when the line is not found, the entry path alone is cited.
- Recorded times are printed verbatim (ISO, as in the files): they are citations. Cards and pane bars keep local time.
- The "show m-…" link only reaches messages among the last 500 lines the page shows. For older ones it says so.

## pilot-v0.6

Authorship and metrics, `/stats`. Still untested with a real model (fakes only).

**Adds**
- **Every line says who wrote it:** `you` (peach), `model` + the model name (sky), `controller` (lavender, next to its
  sprite), `system`. Each line also carries `data-author` and a tooltip "authored by …".
- **Every card says its author and who decided it.** Format: `dec-1 · model · morrow · confirmed · confirmed by you
  10-14 09:06`. Hand edits read "you (file edit)":
  - `confirmed by you (file edit)`: the status was changed in the file.
  - `edited by you (file edit): column`: other fields were changed in the file.
  - `task-7 · you (file edit)`: an item added in the file.
- The `proposed` tag on a card is now neutral (it used the controller's lavender pair). Times on cards and pane bars are
  local, with the ISO timestamp as tooltip.
- **Every pane bar says which rule and which answer:** `controller · messages ≥ 12 · you: yes 10-15 14:14`. An answer
  that was written into `modules.json` by hand (no matching consent event) reads `you (file edit): yes`.
- **How a hand edit is detected (write ledger):** whenever the server creates an item (extraction) or decides one
  (`POST /answer`), it appends an `item_write` event with a full copy of the item to `metrics.jsonl`.
  - An item in `state.json` that differs from its last copy was changed by hand. The differing fields are shown as
    "you (file edit)".
  - This works for edits made while the server was down. `state.json` itself gets no extra field.
  - A later server write keeps earlier hand edits attributed (`handFields`, `addedByFile`).
  - An item with no ledger entry (older data, the v0.4/v0.5 fixtures) shows its declared `author`. A `user` item can
    only come from the file, so it always reads "you (file edit)".
  - On every `state.json` change the watcher also logs `file_edit {itemId, fields}`.
- **P5 events in `metrics.jsonl`** (still append-only):
  - `server_start` with counts (lines, messages, items, panes, answers).
  - `turn` with lines and messages after each chat turn.
  - `consent` now has an `id`, which is stored as `answers.<module>.consentId`.
  - `controller_add {module, answer, answerRef}` on both paths. Before, only `always` logged an add; a `yes` that
    added a pane logged none.
  - `index_jump` from the page via `POST /metric`. Only this event is accepted, and only with an existing message id.
  - `item_write` and `file_edit` (described above).
  - Pane entries in `modules.json` now record their `rule {metric, threshold}`.
- **`/stats`** (and `npm run stats -- <pilotDir>`, same lines) prints the five P5 measures with their thresholds from
  `04-build-plan.md`, PASS or NOT YET, and the numbers behind each. They are computed in `stats.js` from
  `metrics.jsonl` and the files only: no model, no writes. Fixture data is labelled ("FIXTURE DATA: n of m …").
- **Demo `v0.6`:** three synthetic days (made by `dev/make-fixture-v06.js`, every line `"fixture": true`).
  - All three panes are present.
  - Items come from the model, from you via the page, and from file edits.
  - `/stats` shows 3 PASS and 2 NOT YET. Three index clicks turn Usefulness into PASS.
- **Dev:**
  - `browser-check.js v06`.
  - `contrast-check.js` checks the author chips on the pane bar.
  - `demo.js` fills `{app}` and `{rel}` in try lines.

**Why**
- 01-concept "every frame says whose it is" and authority rule 4. The v0.5 coordinator run found that a status
  changed by hand still rendered as the model's.
- P5 of the build plan is read from `metrics.jsonl`. Before v0.6 the file could not answer continuity, consent (for
  `yes` answers), usefulness or quiet.

**Deliberately does not**
- No authorship for hand edits of `transcript.jsonl` lines. Items and pane answers only.
- No signature field in `state.json`. Deleting or editing `metrics.jsonl` removes the evidence, and items then show
  their declared author.
- A hand-made item that claims `author: model` is not flagged when nothing in the ledger contradicts it.
- "You never re-explained the project" and the kill criterion are not measured; `/stats` says so.
- No minimum sample for Signal (1 decided proposal can PASS). Thresholds are not configurable: they are the build
  plan's, hard-coded with their wording in `stats.js`.
- No charts; `/stats` is text.

## pilot-v0.5

Live files (P4), and `c`/`r` only on a focused proposal. Still untested with a real model (fakes only).

**Adds**
- **Watcher:** `fs.watch` on the data folder (works for `PILOT_DIR`), 150 ms debounce. Any watch event re-stats every
  file in the folder (mtime, size, inode) and pushes one event per changed file, because macOS coalesces events and
  editors save by rename. The server's own temp files and other dotfiles are ignored. Watch errors are logged and the
  watch restarts; nothing in the watch path can crash the server.
- **`GET /events` (SSE, D7):** `hello {revs, extracting}`, then `change {file, rev[, error]}` for every change (own
  writes and hand edits) and `status {extracting}` when background extraction starts or ends (an extraction that
  writes nothing changes only `metrics.jsonl`). `retry: 1000`, a comment every 15 s.
- **rev:** JSON files carry `rev`, bumped on every server write (`state.json`, `modules.json`, `roles.json`;
  `rules.json` is only seeded). JSONL files: rev = number of non-empty lines.
- **Stale writes:** `/answer` takes an optional `rev` (consent: `modules.json`, confirm/reject: `state.json`). If it is
  stale the server answers 409 `{stale: true, file, rev}` and writes nothing. The page then reloads state and shows a
  short notice. A request without `rev` is accepted (curl, older checks).
- **Last good version:** a hand edit of `state.json`, `modules.json` or `roles.json` that is not valid JSON never
  crashes the server. `/state` serves the last good version with `fileErrors`, and the page says "file X is not valid
  JSON, showing last good version" until the file is fixed. The server writes none of these files while they are
  broken: the controller skips (`controller_error`), answers and decisions get 409. A broken `roles.json` keeps its
  last good pins.
- **Page:**
  - EventSource on `/events`. Reloads only the changed part (`GET /state?only=<files>`) and re-renders only areas whose
    content changed.
  - Per-part request generations, so an older response never overwrites a newer one.
  - File events are held back while this tab streams a reply.
  - Full reload after a reconnect.
  - Fallback without SSE: refresh after each action and polling during an extraction, as in v0.4.
  - Meta shows `ready · live` when connected.
- **`c`/`r` only on a focused proposal card:**
  - They never act from the chat input, empty or not.
  - ↓/↑ in the empty input moves focus to the newest proposal; Tab and click work too.
  - Only the focused card is outlined. After a decision, focus stays in the pane; Escape returns to the input.
  - y/n/a/x keep the v0.3 rule (empty input). Buttons unchanged.
- **Demo `v0.5`:** two tabs, a printed hand-edit one-liner and a break/repair one-liner. `demo.js` fills `{url}` and
  `{dir}` in try lines. The v0.4 demo's try lines now describe the new keys.
- **Dev:** `dev/sse-probe.js` (SSE client for verify), `browser-check.js v05` (second tab via CDP).

**Why**
- P4 of the build plan: hand edits appear by themselves, two tabs stay honest, and a write based on an old view is
  refused instead of silently winning.
- `c`/`r`: in v0.4 a message starting with c or r decided a proposal on the first keystroke. Models only propose; the
  person decides on purpose.

**Deliberately does not**
- No conflict detection for hand edits that keep `rev` (they are pushed and shown, but a page write based on the
  older view still goes through). No merge: one person, last valid write wins.
- No View Transition on live re-renders (pane add/remove still uses one; a content refresh is instant).
- No push for `/chat` streaming to other tabs: they see the user line, then the finished reply.
- No undo for decisions. y/n/a/x still answer from the empty input, also for a question that arrived by push (see
  QUESTIONS.md).

## pilot-v0.4

Proposals (P3). **Untested with a real model:** Morrow was not reachable, so extraction ran only against the fake
extractor in `dev/fake-model.js`.

**Adds**
- **Role `extract`** after each complete reply, in the background (queued, one run at a time, never awaited by
  `/chat`), every `everyNTurns` replies. Input: last user + assistant message + existing item titles. The closed
  `schemas/extraction.schema.json` goes along as `response_format` when the candidate has `structured: true`.
  Same rules as chat: pins, local→cloud block, stall timeout.
- **Validation, fail closed:** small hand validator (no Ajv). Malformed or schema-invalid output (including more
  than 3 items) writes nothing and logs `extract_error`. Per item: `quote` must occur in the turn (whitespace and
  case ignored), near-duplicates of non-rejected items and of the same batch are dropped (word-set Jaccard ≥ 0.75
  after stopwords, or the same url), at most `maxItems` kept; each drop is logged as `extract_drop`.
- **`.pilot/state.json`** (atomic, `rev` bumped): `status: proposed`, `author: model`, `model`, `quote`,
  `fromMessage`, ids `dec-N`/`task-N`/`src-N` (max + 1, so hand-added ids never collide). Hand edits keep every
  unknown field; a broken file is reported (`/state.stateError`) and never overwritten.
- **Panes:** reasoning map (decisions as a chain, then sources) and kanban (tasks in todo/doing/done), grown only through the
  controller and consent (`map`/`kanban` rules now count proposed + confirmed items, not rejected ones). Proposed =
  dashed lavender with "model · <name>"; confirmed = mint; rejected = rose, hidden behind a pane-bar toggle;
  hand-added (`author: user`) = solid with "you".
- **Confirm/reject:** `c` / `r` on a focused card, or in the empty chat input on the outlined proposal (the newest;
  arrows move it), plus buttons. `POST /answer {itemId, decision}` records `decidedAt` and `decidedBy: "user"`
  (schema extension in `pilot/app/schemas/state.schema.json`), a system line and a `decide` metric.
- **Fake extractor:** `--extract=good|malformed|badquote|many|dupes`, `--extract-delay=<ms>`.
- The page polls `/state` while an extraction runs, so proposals and a resulting question appear without reload.
- Fix: a consent answer now stores the count of the rule's own metric (decisions/tasks), so "no" waits for that
  count to double (it stored the message count, which was only right for the index).

**Why**
- P3 of the build plan: models only ever propose; the user decides, and every item says who authored it.

**Deliberately does not**
- No real model test (Morrow unreachable), no live file watching or SSE (v0.5; hand edits show on the next state
  load), no moving tasks between columns in the page (edit `column` by hand), no undo of a decision.
- No cap-and-keep for a response with more than 3 items: the closed schema says at most 3, so it is rejected whole
  (see QUESTIONS.md).
- No extraction after a failed or stalled reply.

## pilot-v0.3

Hardening, pastel palette, iteration infrastructure.

**Adds**
- **Explicit `/model` pins the role.** `/model chat morrow` means no fallback until `/model chat auto`, which
  returns the role to its policy starting at the first candidate. Pins persist in `.pilot/roles.json`; the status
  bar shows `chat: morrow (pinned)`. A pinned failure becomes a system line.
- **`local: true|false` per candidate** (example and dev config: frontier false, morrow true). After a local
  candidate failed, fallback never goes to a non-local one unless the role sets `allowCloudFallback: true`;
  missing `local` counts as non-local. Each block is logged (`fallback_blocked`) and shown as a system line
  "fallback to frontier blocked: morrow is local".
- **Stall timeout** `stallMs` (default 20000): once a reply has started, no new token for that long aborts it,
  keeps the partial text as an assistant line, adds a system line, logs a `stall` metric. Never falls back.
  `dev/fake-model.js --stall-after=<n>`.
- **Consent keys only on an empty input** (P2 already did this; now regression-tested in the browser, plus guards
  for IME composition and key repeat). Buttons always work, also with text in the input.
- **Pastel palette** in the pixel-terminal style, defined once as CSS custom properties; sprites use them too.
  Light variant via `prefers-color-scheme: light` and `/theme light|dark|auto` (page-only, kept in localStorage).
  `dev/contrast-check.js` checks every text/background pair (WCAG AA) in both modes.
- **Infrastructure:** `package.json` (scripts only), `npm run demo -- <version>` (`scripts/demo.js`, seeds a
  throwaway `.pilot-demo/` from `demo/fixtures/<version>/`), `npm run verify` (`scripts/verify-all.sh`),
  `scripts/try.sh <tag>`, `PILOT_DIR` env override, `ITERATIONS.md`, `QUESTIONS.md`, this file.

**Why**
- Pins: the concept's day-5 case. Switching to morrow because the topic got private must not silently send the
  text to frontier when morrow is down (open question after P2).
- Stall: an endpoint that hung mid-stream kept the request open forever.
- Palette: the amber/brown look is replaced by a calmer pastel one that also works in light mode and passes AA.
- Infrastructure: every later iteration must be runnable and checkable in 30 s by the coordinator.

**Deliberately does not**
- No per-candidate "never fall back to" lists; one `local` flag and one role-level `allowCloudFallback` only.
- No fallback after a stall, and no retry: a reply never mixes two models.
- No proposals, extraction or live file updates (v0.4, v0.5). The `.proposal` style exists but is unused.
- No change to the explainers or to anything outside `pilot/app/` except the "Pilot iterations" list in the
  root `index.html`.
