# Blackboard NextGenUI: Critical Assessment and Futures

*Design-research review, 2026-10-17. Analysis only: no application code was changed. Written by Claude (Claude Code) at Miro's request. Every major conclusion carries a confidence level and an evidence source (see the legend).*

**Evidence legend**

- **[code]**: read in the repository, cited as `file:line`.
- **[ran]**: executed in this session (Node 22, Linux, headless Chromium).
- **[doc]**: stated in the project's own explainers or plans.
- **[lit]**: external literature, linked in Part 6.
- **[judgement]**: my reasoning, with no direct evidence behind it.

Confidence is **high**, **medium** or **low**.

---

## 0. The decision in one page

**Strongest insight.** The state belongs to the project, not to the answer. A model may *propose* structure over that state, but only a person commits it, and every element can say where it came from. That is a sound and defensible stance. It is better articulated here than in most current generative-UI work. *(medium; [doc] [lit])*

**Strongest criticism.** The pilot quietly reversed the project's own best argument. *Rolle und Kodex* argued that the workspace, not the transcript, should be the center: the model sees the state, a follow-up question reframes the existing state, and silence is a signal. The pilot does the opposite. It is a chat with side panels that the chat model never reads. The chat model receives the last 40 transcript lines and nothing else (`pilot/app/server.js:52`, `:1098`). Confirmed decisions never reach the conversation. The workbench is a write-only mirror of the chat, maintained by the user through consent prompts. Then eight iterations, built in one day, polished the mirror's lifecycle (fade, removal, frames, Enter) before anyone had used it on real work. That broke the project's own evidence gates (D9, `04-build-plan.md` out-of-scope list, `06-open-questions.md` triggers). *(high for the facts; medium for the interpretation; [code] [doc] [ran])*

**Keep:**
- files as the shared state;
- the proposal/authority split, enforced fail-closed;
- the quote check;
- authorship on every element;
- provenance answered from records, never from the model;
- the closed frame vocabulary as an idea;
- role routing with the local-never-falls-back-to-cloud rule;
- the explicit kill criterion.

**Pause:**
- automatic fade and removal (v0.8);
- Enter diffusion (v0.9);
- model frame proposals (v0.10);
- turn-count thresholds as the growth clock;
- per-object confirmation as the only path to state.

None of these has earned more investment. They answer questions that real use has not yet raised.

**Forward.** Close the loop: the confirmed state goes into every model call. A follow-up acts on the state, not on the scroll. Run one week of real-model use.

**Backward.** A minimum interface: chat plus one durable, model-readable project document. The model writes into it with attribution, every change is undoable, and provenance is shown inline. No panes, no thresholds, no consent queue.

**Sideways.** Explore the decision log / case file as the primary object, with chat as a margin tool. It is the metaphor closest to Weavr, Observstory and the M7 "Fall, Beleg, Entscheidung, Herkunft" line in the Morph data.

**Underneath.** The durable contribution is likely a small interaction grammar: work object, proposal, authority, provenance, frame, reversal. It can drive very different surfaces. The pane workbench is one renderer of it, and not obviously the best one.

**Recommendation.** Go *Backward first, then Underneath*. Build the minimum interface on the existing file contracts, compare it against plain chat and the current workbench on a week of real work, and only then decide whether panes earn their keep. The argument against this is in §8.9.

**Next three moves:**
1. Run the Morrow connectivity check (§7.5).
2. Feed the confirmed state into the chat call (≈15 lines). This is the only implementation change I'd make before evaluation, and it should be authorized as such.
3. Run a 5-day, three-condition, within-subject dogfood (§7) with fade, Enter and frames off.

---

## Part 1. The argument before the implementation

### 1.1 Each explainer

| | Problem actually addressed | What it establishes | What it hands on | Inherited without test |
|---|---|---|---|---|
| **01 Blackboard** (Hearsay-II) | How a system with independent contributors decides *who acts next* and *when input is finished*. | A blackboard plus agenda is a clear model for coordinating partial contributions with provenance (each hypothesis says what supports it). "Complete" is not "finished": none of silence, grammaticality or an explicit signal suffices alone. | "How does the Enter key disappear?" | That an LLM interface *should* listen continuously. That one model is usefully described as many knowledge sources. |
| **02 Morph** | Whether a view can reshape itself *without taking authority*. | A clean separation: signal → deterministic controller (ignore / note / wake) → model proposes a closed `FrameIntent` → a compiler validates and builds the scene. Act 3 shows the real danger: a frame that *hides* a blocked item, or offers a button the state does not allow. | "Where does view end and authority begin?" | That a model-proposed frame is *worth* its cost, compared with a person choosing among a few deterministic layouts. Act 1's adaptive-hypermedia failure (hiding a blocked item) is shown but not generalized. |
| **03 Rolle und Kodex** | Answer-shaped vs workspace-shaped architectures, side by side on one scenario. | The strongest piece. It specifies what a workspace architecture must deliver: the model sees user edits, state survives reload, several writers share one state, silence triggers notice, a follow-up reframes instead of rebuilding, a button is not permission, every frame says whose it is. It is honest that the answer shape wins on novelty ("pave the cowpaths"). It ends with a falsifiable north star: two weeks of real work, thresholds, and a kill criterion. | "What would prove it?" | That the workspace *domain model* already exists. The scenario runs on a build-plan tracker with typed milestones and dependencies. The score table itself says Kodex needs a domain model up front (`js/scenario.js`, SCORE row 1). |
| **04 Growing Workbench** | How to get from chat to workspace *without a domain model*: start as chat and let structure grow. | Growth by visible, deterministic thresholds with consent is easy to explain and replay. The history act (training wheels, Alexander, Brand) gives a good reason to introduce complexity gradually. | "How do panes go away again?" | That *chat is the right starting point* and that panes are the right unit of growth. That message, decision and task counts measure need. |

### 1.2 Where the next piece genuinely follows, and where it changes the subject

- **01 → 02 follows.** The agenda becomes the deterministic controller, and "what may write to the board" becomes "what may change the frame".
- **02 → 03 follows.** Authority over the frame becomes authority over the architecture.
- **03 → 04 is a change of subject presented as a continuation.** *Rolle und Kodex* argued for a state-first codex over an existing domain (milestones with dependencies). *Growing Workbench* starts from the chat scroll that *Rolle und Kodex* had just argued against, and tries to grow a domain out of it by extraction. That is a different and harder bet. It moves from *compiling a known ontology* to *inferring an ontology from conversation*, which is exactly the "guessed shapes" risk the session summary named (`notes/summaries/…json`, `deterministic_vs_generative`). The relay framing ("each piece hands the next one on") hides this switch. *(high; [doc])*

### 1.3 Where a metaphor became an implementation constraint

1. **"The Enter key" became a feature.** In 01, Enter stands for *turn boundary, authority, trigger and addressee* bundled together. That is a rich analytical point. In the pilot it became v0.9: a "send?" offer after a pause, with Tab to send. The analysis was about *who decides when the model acts*. The implementation is about *keystroke timing in a text box*. The deeper question, whether the system should act without a turn at all, was never built. *(high; [doc] [code])*
2. **"Panes" from the terminal and IDE lineage (Norton Commander, Turbo Vision, Eclipse)** became the unit of structure. Pane-ness then drove a lifecycle: grow, fade, ask, remove, plus a consent vocabulary of y/n/a/x for growth and y/n/x for removal. None of this would exist if the unit were "a section of one document". *(high; [code])*
3. **"Blackboard = files"** is a good engineering decision. But the metaphor implies that every knowledge source *reads* the board, and the chat model doesn't (§2.2). The metaphor was honored in storage and ignored in data flow. *(high; [code])*
4. **"Brand's storage rooms"** became "fade to a tab after 8 untouched turns". In buildings, storage is decided by people over seasons. In the pilot it is decided by a pointer-event counter (`public/app.js` touch handlers; `fade.js:18`). *(high; [code])*

### 1.4 Unresolved after the fourth explainer

- Whether a workbench helps on *real* work at all. The overview page says so itself: "Still open: Does it work on real work, not just in a simulation?" `index.html`. *[doc]*
- What the domain of a chat-grown workbench is. Decisions, tasks and sources are generic, and a generic ontology produces generic panes.
- Who notices, and when. *Rolle und Kodex*'s "three days of silence" and "a colleague marks M5 done" have no counterpart in the pilot. The controller runs only after a user turn (`server.js:1118`, `:681`). *[code]*
- Whether the model should *see* the workspace. It was claimed (✓ in the Kodex score) but never built.

### 1.5 Is the pilot testing the strongest claims?

**No.** *(high; [doc] [code] [ran])* The strongest claims are:

| Claim | Where made | Tested? |
|---|---|---|
| State outside the conversation improves continuity: "you never re-explain the project" | 03 north star; `01-concept.md` | Persistence is tested. *Continuity of meaning* is not, and cannot pass as built: the model forgets everything older than 40 lines regardless of what the workbench holds. |
| The model sees what you changed | 03 SCORE row 2 | Not implemented in the pilot. |
| The workspace notices things unprompted | 03 "Bemerkt" threshold | Not implemented. |
| A follow-up reframes instead of rebuilding | 03 step 6 | Not implemented. Answers still append to the transcript. Frames (v0.10) reorder cards, not answers. |
| Growth by consent doesn't surprise | 04 | Tested mechanically (no pane without a recorded answer), against fake models and scripted fixtures. |
| Extraction is useful | `04-build-plan.md` P5 "Signal" | Never run against a real model ([doc] `REPORT.md`). Fixture confirm rates are synthetic. |

What *was* tested, thoroughly, is implementation correctness: 395 scripted checks pass on Linux, plus the browser suites for v0.8 and v0.10 (§2.10). That is real engineering quality. It is not evidence of usefulness, and the report says so honestly.

---

## Part 2. The pilot as built

Scope read: `server.js` (1,319 lines), `why.js`, `fade.js`, `frame.js`, `stats.js`, `public/app.js` (838), schemas, configs, `CHANGELOG`, `ITERATIONS`, `QUESTIONS`, `REPORT`, `CHECKS`, and the v0.8 and v0.10 fixtures. Runtime code is about 3,450 lines and dev/test scripts about 3,850, which is more test code than product. All 41 commits fall on 2026-10-16 and 2026-10-17. *[code] [ran]*

### 2.1 Mechanism by mechanism

| Mechanism | What it does | User problem or demonstration? | Verdict |
|---|---|---|---|
| **Role routing** (`server.js:404–546`) | Per-role candidate lists, manual/fallback policy, pins, `local` flag; after a local failure it never falls back to the cloud unless `allowCloudFallback` is set. | Real problem: privacy and cost. The local→cloud block is a genuinely good, rarely seen guarantee. | **Keep.** Over-general for three roles, but cheap. |
| **Transcript as JSONL** | Append-only log of user, assistant, controller and system lines. | Real (persistence). But controller and system lines are mixed into the conversation. In the v0.8/0.10 fixtures, 26 of 100 lines are controller/system lines *(synthetic fixture; [ran])*. | **Keep the file; separate administrative events from the conversation.** |
| **Extraction → proposals** (`:608–682`) | After each reply, a second model call proposes ≤3 decisions, tasks or sources. Each needs a verbatim quote from the turn; near-duplicates are dropped; any invalid output writes nothing. | The quote check and fail-closed rule are excellent. The *problem* (turning talk into durable objects) is real. Whether extraction is *precise enough* is unknown. | **Keep, but measure first.** The prompt sends *every* existing item, rejected ones included (`:609`), so cost grows linearly over a project. |
| **Confirm/reject** (`decide`, `:900`) | `c`/`r` on a focused card, recorded with time and author. | Real (authority). But it is the *only* path from proposal to state, so the user becomes the extractor's reviewer for every turn. In the synthetic fixture: 15 decisions + 5 pane answers across 37 user turns. | **Re-examine** (Part 3B). |
| **Consent-driven panes** (`runController`, `:216`) | Counts compared to thresholds; asks y/n/a/x; `no` re-asks when the count doubles; `always`/`never` persist. | Partly real. The fixed panes (index, map, kanban) are cheap to show. The *question* costs more attention than the pane does. | **Simplify.** Show empty-state affordances; let people open panes. |
| **Fade and removal** (v0.8, `fade.js`, `:256–343`) | An untouched pane fades to a tab after 8 turns. 8 turns later, it asks once whether to remove it. Touch = pointerdown, wheel, keyboard focus. | Demonstration. Built without its trigger: "a pane unused for a week during P5" (`06-open-questions.md`); listed out of scope (`04-build-plan.md`). Reading a pane isn't a touch, so a glanced-at pane fades. Repeats the abandoned Office adaptive-menu pattern [lit]. | **Pause; off by default.** |
| **Live files + `rev`** (P4) | `fs.watch` → SSE; stale writes 409; broken files tolerated, never overwritten. | Real for the "files are truth" promise. Proves hand edits work. | **Keep.** |
| **Authorship** (v0.6) | Every line, item and pane says who: you, model+name, controller, system, "you (file edit)". | Real and important. **But** authorship is derived from `metrics.jsonl` as a ledger (`:858–883`, `:1019`). The analytics log is load-bearing for provenance: delete or rotate it and the authorship of hand edits disappears. | **Keep the idea; move the ledger into the state file** (one `history` per item). |
| **/why** (v0.7, `why.js` 499 lines) | Explains panes and items from the files, with `file:line` citations. No model involved. | Mixed. Answering from records, not the model, is right [lit: Crystal, Whyline, Turpin]. `file:line` serves the *builder* who audits the pilot more than the *user*, who needs "from which message, with which quote, decided by whom", and that fits on the card. | **Keep the engine; move the user-facing part inline; keep `/why` as the audit view.** |
| **Enter diffused** (v0.9, flag off) | After a pause on a finished-looking line, offers "send?"; Tab sends. | Demonstration. Built before P5 against D9. Takes over **Tab**, which the rest of the UI uses for focus navigation (`app.js:119`, `:18`): an accessibility conflict. English-only heuristic. | **Pause.** The real question (should anything act without a turn?) is different. |
| **Frame proposals** (v0.10, flag off) | A third model call per turn proposes focus/order/group in a closed vocabulary; `f` applies; reset undoes; `/why map` explains. | Demonstration. The *vocabulary* is the most defensible novelty in the project [lit]. *Reordering six cards* is not a problem anyone has reported. Costs one model call per turn (QUESTIONS #6). | **Pause; keep the closed-vocabulary contract on paper.** |
| **/stats** and P5 measures | Five PASS / NOT YET measures computed from metrics. | Real evaluation infrastructure, but it measures *mechanism* (asked ≤ once/hour, ≥3 index jumps), not *outcome*. | **Keep; add outcome measures (§7).** |

### 2.2 The decisive gap: the model does not read the board

`handleChat` builds the model prompt as `readTranscript().filter(user|assistant).slice(-HISTORY)` with `HISTORY = 40` (`server.js:52`, `:1098`). There is no system prompt, no `state.json` and no confirmed decisions. *(high; [code])*

Consequences:

- Continuity of *meaning* is no better than a 40-line chat window. The workbench remembers; the model does not.
- A confirmed decision cannot constrain later answers. The user may confirm "keep the claim local" and the model may contradict it 30 turns later.
- Confirming a proposal changes nothing about what the model does. The user's administrative work buys nothing from the model, only a display.
- This is the blackboard metaphor broken in its essential property: knowledge sources that do not read the board are not on a blackboard.

The fix is small (§5.1). It is the only change I'd make before evaluation.

### 2.3 Persistent state and duplication

One item can exist in four places:
1. `state.json` (truth);
2. `metrics.jsonl` `item_write` (full copy per write, used as the provenance ledger);
3. a `system` line in `transcript.jsonl` ("dec-4 confirmed: …");
4. `frames.json` when framed.

Pane state lives in `modules.json`, split into `answers`, `removals`, `pending`, `pendingKind`, `state: faded`, `lastTouch` and `removalAsked`. That is a seven-field lifecycle for three panes. The metrics file is twice the size of the transcript in the fixture (34.8 KB vs 16.4 KB) and is re-parsed whenever it changes. Every metric append changes it, and authorship and `/state` both read it (`server.js:99–105`). *(high; [code] [ran])*

### 2.4 How proposals become work objects

Model turn → extract call → validate (schema, quote, duplicate, max 3) → `state.json` `proposed` → card shows dashed with model name → user focuses the card and presses `c` or `r` → `confirmed`/`rejected` with `decidedBy: user`.

This is sound and auditable. Its weakness is not correctness but *economics*: it puts a review queue between conversation and state and assumes the user wants to run it. Shipman & Marshall's "Formality Considered Harmful" predicts this exact friction [lit]. A stronger LLM formalizer makes it *worse*, because it proposes more structure than people want to adjudicate.

### 2.5 Consent and revocation

- **Granting consent** is well engineered: recorded answers, `rev` checks, no accidental `c`/`r` from the chat input since v0.5.
- **Revocation** is uneven. A confirmed item cannot be un-confirmed from the UI; that needs a hand edit of the file. A pane answered `always` returns automatically after a hand removal (`verify` P2 check "always: pane removed by hand is re-added"). An applied frame can be reset (good). There is no general undo. *(medium; [code] [ran])*

The design leans on *asking before* rather than *undoing after*. The literature strongly favors the latter for low-stakes actions [lit: Raskin; Abowd & Dix].

### 2.6 The user administers the interface

In one (synthetic) 37-turn fixture session, the user:
- answered 5 controller questions;
- confirmed or rejected 15 proposals;
- watched 1 pane fade;
- produced 6 pane touches.

That is roughly one administrative act every two turns, *before* any real-model noise. With v0.8–v0.10 on, the user may also get removal questions and frame notes, plus the "send?" offer. Each is individually polite. Together they make the interface a second conversation partner that wants decisions about itself. *(medium; [ran] synthetic data; [judgement] on the per-turn rate in real use)*

### 2.7 Transcript and workbench

- The index pane is a table of contents of the transcript.
- The map and kanban are projections of extracted items. Each links back to its source message, which is good.
- Nothing flows the other way. Workbench changes do not alter the conversation or the model's context, except as system lines appended to the transcript.

The transcript stays the center. The workbench is its annotation. This is the notebook's "two states that drift" problem from the opposite side [lit: Rule et al.; Head et al.].

### 2.8 Rendering, keyboard, accessibility, mobile

- **Rendering.** `renderLog` rebuilds the whole transcript DOM on change (`app.js:100`), capped at the last 500 lines (`server.js:51`). Dirty-checking avoids most re-renders. Fine at pilot scale. View Transitions respect reduced motion (verified in the v0.8 browser check). *(high; [code] [ran])*
- **Keyboard.** Single-letter commands (`y n a x c r f`) are scoped to an empty input or a focused card. That is careful, but it is a modal grammar the user must learn, with a different letter set per question type. v0.9's Tab-to-send conflicts with Tab-to-focus.
- **Accessibility.**
  - Good: `role="log" aria-live="polite"` on the chat, focusable cards and notes, a contrast check in CI, no horizontal scroll at 390 px for the frame note.
  - Missing: no screen-reader verification of proposals or consent questions; no announcement when a pane fades; dashed borders carry meaning visually, with only the text chip backing them up.
  - *(medium; [code] [ran])*
- **Mobile.** Below 800 px every pane stacks full width. Keys have button equivalents. I found no touch-device test, and a phone would mean scrolling past three panes to reach the chat. Not a target yet, which is reasonable, but nothing in the design anticipates it.

### 2.9 Failure states and model independence

- **Excellent:**
  - fail-closed extraction;
  - a stall cut-off that keeps the partial reply;
  - broken hand-edited files read as their last good version and never overwritten;
  - pinned roles never fall back;
  - local never falls back to the cloud without explicit opt-in.
- **Without any model**, the pilot keeps the transcript, panes, items, `/why` and `/stats`, and hand edits still work. But it cannot *produce* anything new except by hand-editing JSON: there is no UI to add a decision or task yourself. *That is a significant gap for "model independence": the human cannot author work objects in the UI.* *(high; [code])*

### 2.10 What I ran

| Run | Result |
|---|---|
| `npm run verify` on Linux, Node 22 | 395 PASS. All 8 script-level "failures" were environmental: browser suites count a SKIP as a failure when Google Chrome isn't at the macOS path, and `dev/verify-v0.6.sh:125` uses BSD-only `sed -i ''`. |
| `browser-check.js v08` and `v10` against Playwright Chromium (`--no-sandbox` wrapper) | All PASS. |

**Portability defect:** the suite only fully passes on macOS. That matters if anyone else is to replicate the evaluation. *(high; [ran])*

### 2.11 The cost of multiple independent model calls

Per user turn:
- 1 chat call (streams);
- 1 extract call (background, structured, every turn by default: `everyNTurns: 1`);
- with frames on, 1 frame call.

So 2–3 calls per turn. Both background prompts include *all* items, so input tokens grow with the project. On a local Qwen3-14B the latency is unknown, because nothing has been measured against a real model. `04-build-plan.md` already lists "Qwen too slow for extraction after every turn" as a risk, and the proposed response (every N turns or on idle) is configurable but untested. *(high for counts; low for latency; [code])*

Accidental coupling found:
1. Provenance depends on the metrics log.
2. Frame IDs are allocated by scanning metrics (`server.js:710`).
3. Controller and system lines enter the conversation log.
4. The pane lifecycle reads item state (a pane holding a proposal can't fade). That is reasonable, but it couples three state machines.
5. D2's own reversal trigger ("server passes about 600 lines") was crossed long ago without the decision being revisited.

---

## Part 3. The central assumptions

### A. Growth

- **Why should a workspace accumulate panes?** Because the IDE and terminal lineage did, and because growth is easy to make visible. The underlying user need is different: *at this moment, show me the material that bears on what I'm doing.* That is a relevance problem, not an accumulation problem. *[judgement]*
- **Alternatives that fit the need better:**
  - *foreground* (bring the relevant decision next to the answer that touches it);
  - *replace* (a follow-up question replaces the answer it refines, as *Rolle und Kodex* step 6 proposed);
  - *contextualize temporarily* (show the dependency chain while you discuss it, then let it go);
  - *simplify* (collapse resolved material into one line).
  - These manipulate *salience in place*, which the adaptive-UI literature found safer than moving or adding things [lit: Findlater et al. 2009 ephemeral adaptation; Gajos et al. 2008].
- **Are turn counts meaningful?** They are convenient proxies. "12 messages" says nothing about whether scrolling back has become a problem. "4 decisions" says nothing about whether they depend on each other. The better signal is a *failed retrieval*: the user scrolls up for more than N seconds, searches, or asks "what did we decide about X". That is the moment an index or decision list earns its place. *(medium; [judgement])*
- **Is fade-first-then-ask enough?** It is a careful mitigation of a questionable concept. Automatic lifecycle management of *containers* adds a second thing to track (where did my board go?) on top of the work. Office personalized menus, which the user could also restore, were dropped because people found the movement "random" and turned it off [lit: Harris 2006]. If the workbench needs pruning, the user can close a pane in one click. Make that the default and let the system *offer* tidying only when the screen is actually crowded. *(medium; [lit])*

### B. Consent

- **Consent fatigue is likely.** Low-stakes, frequent, uniform confirmations become reflexive within days [lit: Böhme & Köpsell 2010; Anderson et al. 2015; Vance et al. 2018]. Then "confirmed" stops meaning "endorsed", which is the very guarantee the project was built to protect. *(medium; [lit]; not yet observed here)*
- **Where the boundary should lie.** Classify by *consequence and reversibility*, not by *who initiated*:

| Class | Example | Policy |
|---|---|---|
| Presentation, reversible, no state | Show the index; highlight a related decision; reorder cards | **Automatic**, visibly attributed, one-key undo. No question. |
| Draft state, reversible | An extracted decision or task enters the project as a *draft* | **Automatic as draft**, attributed and undoable; drafts are second-class in model context ("unconfirmed: …"). Batch review when the user wants it. |
| Commitment | Marking a decision *settled*; anything sent outside `.pilot/`; deleting | **Explicit consent**, with a preview of the effect. |
| Irreversible / external | (Not in the pilot.) Sending, publishing, executing | **Explicit consent plus a summary of consequences.** Weavr's gate territory. |

- **Reducing consent interactions without giving up authority:**
  - *reversibility* (undo instead of ask);
  - *preview* (show the effect before asking, so the question is about something concrete);
  - *inspectability* (every automatic change is visible in place and in one activity list);
  - *bounded delegation* ("for this session, auto-accept tasks; ask about decisions"), recorded as a rule the user can see and revoke. That is the `a`/`x` idea generalized from panes to policies, in the spirit of Weavr's Missions: *constrain breadth, not depth*.

### C. Chat

- **Is chat still the organizing center?** Yes, structurally. The chat pane can never fade (`fade.js`). The transcript is the only thing the model reads. Every administrative event becomes a chat line. The workbench is subordinate. *(high; [code])*
- **When the primary object is a document, decision, map or case,** the conversation becomes a *tool applied to the object* (DirectGPT's insight: select the object, then speak [lit]). The transcript becomes a *trace*, valuable for provenance and recovery, not a reading surface.
- **Would the user still need a permanent transcript?** As a *record*, yes: it is the provenance substrate, and the quote check depends on it. As a *permanently visible pane*, probably not. A margin thread per object, plus a searchable log, would do. *(medium; [judgement])*

### D. Intelligence

Which UI decisions actually need an LLM?

| Decision | Needs an LLM? |
|---|---|
| When to show an index, map or board | **No.** Rules, or simply the user. Already deterministic in the pilot. |
| When to fade a pane | **No**, and arguably nobody should decide it automatically. |
| Extract decisions and tasks from free text | **Yes.** This is the one place semantic intelligence is essential. |
| Link a new message to existing items ("this touches dec-3") | **Yes, narrowly.** Embedding similarity could do much of it deterministically. |
| Reorder cards (frames) | **Mostly no.** Deterministic orders (recency, dependency, status, mentioned in the last turn) cover most of the value; an LLM adds a small, unmeasured increment. |
| Notice a stale blocker ("blocked 72 h") | **No.** A level trigger (*Rolle und Kodex* step 5). |
| Answer the user | **Yes.** |

**Does one model need the whole workspace?** No. The chat model needs the *confirmed* state, compactly. The extractor needs the turn plus item *titles* (not rejected ones). A linker needs the turn plus item embeddings. Narrow operations suffice, and the pilot's role split is the right shape for them.

**Without a model** the architecture keeps its record but loses its ability to *create* objects, because there is no human authoring UI (§2.9). The deterministic layer is strong. The human-as-author layer is missing. *(high; [code])*

### E. Provenance

- **Is `/why` helpful to users or attractive to engineers?** In its current form, mostly to engineers and auditors. Users need three things, at the moment of doubt, without a command:
  1. *where this came from* (the message, the quote);
  2. *who made it so* (model / you / rule);
  3. *how to change it* (edit, revert, reject).

  The card already shows (2). Putting (1) one hover or tap away, and (3) as one key, covers most user needs. `file:line` belongs in the audit view. *(medium; [judgement] [lit: Crystal, Amershi G11])*
- **The over-reliance risk.** Provenance tells you *where* a proposal came from, not *whether the extraction is right*. Explanations raise acceptance regardless of correctness [lit: Bansal et al. 2021]. A visible verbatim *quote* is a stronger check than a citation, because the user can judge the extraction against the source in one glance. The pilot already stores the quote; show it.
- **Provenance integrated into interaction** means a diff-like presentation of every model-authored change, as in track changes: attribution in the margin, undo in place, and an activity list as the single history. That replaces `/why` for users and keeps it for audit.

---

## Part 4. Competing futures

### Direction A (Forward): Adaptive Workbench

**What it adds beyond the pilot.**
- The model reads the board.
- Follow-up questions act on objects ("what depends on dec-3?" highlights the chain in the map instead of appending an answer).
- Salience-in-place adaptation (foreground/dim) instead of pane lifecycle.
- Spatial continuity: things never move unless the user moves them.
- Contextual tools on objects (select a task → "split", "block on…").
- Level triggers for silence and staleness.
- Progressive disclosure of pane *types* via empty-state affordances rather than threshold questions.

**What must change architecturally.**
- A context builder that serializes confirmed state into every chat call.
- An answer-to-object binding so a model reply can carry `refs: [dec-3, task-2]` and the renderer can foreground them.
- A real undo log (reuse `item_write` history, moved into state).
- A scheduler for level triggers (the controller already exists; it needs a clock, not only turns).
- Fade, removal and threshold questions are deleted.

**Evidence that would justify the complexity.**
In a week of real use, with the model reading state:
- users rely on the map or board for at least 30% of status questions, instead of asking chat;
- interruption-recovery time is measurably lower than with the minimal interface (§7);
- review effort stays under about 1 administrative act per 5 turns.

**Cost.** Highest of the four. Generic decision/task/source panes may never beat a good document.

### Direction B (Backward): Minimum Intelligent Interface

**Shape.**
- **Chat.**
- **One** durable artifact, `project.md` or `state.json` rendered as a document, with sections Decisions, Open questions, Tasks and Sources.
- The model writes into it *directly as drafts*, attributed and visibly marked.
- Every change is a line in one activity list with one-key undo.
- The model reads the whole document on every call.
- The user edits the document like any document.
- No panes, thresholds, consent questions, fading or frames.

**What is lost.**
- The growth story.
- Spatial views (map, kanban).
- Explicit per-item endorsement (replaced by "settled" marks the user sets when it matters).
- Some demo value.

**What improves.**
- Continuity of meaning (the model reads the document).
- Near-zero administration.
- Model-independence (a person can write the document by hand, in the UI).
- Portability (a Markdown document is the most interoperable artifact there is).
- Cost (one extraction pass can be batched every N turns, because drafts can lag).

**Does it deliver most of the benefit?** That is the central empirical question of this whole project, and it is cheap to test. My prior: yes for single-person, single-project work, which is exactly the pilot's declared scope ("one person, one project"). It sits close to Claude Projects plus artifacts, and to Potluck's gradual enrichment [lit]. The difference is attribution and undo as first-class, and that difference is the project's real contribution. *(medium; [judgement] [lit])*

**Implementation estimate.** Under 600 lines on the existing server: reuse files, `rev`, SSE, roles, the extractor with its quote check, and authorship. Delete the controller, fade, frames and settle.

### Direction C (Sideways): three different interaction metaphors

#### C1. The Decision Log (a case file)

*The primary object is a list of decisions, each with its question, options, evidence, status and provenance. Conversation happens in a thread attached to one decision.*

**Journey.**
1. **Monday.** You open "Pilot evaluation design". The log is empty except an "open question" field. You type the question. A thread opens beside it, and you discuss with the model.
2. As the model answers, *candidate options* appear under the question, each with its supporting quote, attributed to the model. You mark one "leaning", and the evidence you pasted (a paper link) attaches as a source.
3. **Wednesday.** You come back. The log shows 3 open, 2 leaning and 1 settled. Each open item has a one-line "where we left off", generated from its thread and attributed. Recovery is reading six lines, not scrolling.
4. **Thursday.** You ask in the global box "what blocks the Morrow test?". The answer is *a filter over the log* (two items highlighted, their dependency shown), not a chat bubble.
5. **Over time.** Settled decisions collapse to one line. Reopening one keeps its history. The log becomes the project's memory and exports as a Markdown ADR set.

**Why it's different.** The unit is a *question with a lifecycle*, not a pane. That maps directly to Weavr's Needs and Decisions, to br-ai-nstorm's proposals vs accepted events, and to M7's "Fall, Beleg, Entscheidung, Herkunft". This is the most natural meeting point with "Case Systems" as I understand it. I could not locate a canonical Case Systems repository in this session's scope, so treat this as a hypothesis, not an integration plan.

#### C2. The Annotated Document (margin AI)

*The primary object is a document you are writing (a plan, a spec, an essay). The model works in the margin, as Genette's allographic paratext, which the project already invokes.*

**Journey.**
1. You write a draft. You select a paragraph and ask "is this consistent with what we decided about local models?"
2. A margin note appears, anchored to the paragraph, attributed, with a quote from the earlier decision it relies on.
3. Model *suggestions* to the text appear as tracked changes: accept, reject or edit.
4. Conversation is per-anchor. There is no global transcript in view, but every thread is searchable.
5. Over a week, the document *is* the state. Decisions are paragraphs marked "decided". The workbench's map becomes an outline view of the same document.

**Why it's different.** The user's own authorship is primary and the model is explicitly secondary. Consent is the familiar track-changes grammar, not a new key vocabulary. It tests whether "workspace-shaped" can mean "document-shaped" with no new UI concepts at all.

#### C3. The Investigation Board (spatial evidence desk)

*The primary object is a 2D canvas of evidence, claims and questions. Placement is the user's. The model proposes links and clusters.*

**Journey.**
1. Researching a topic (e.g., "is consent fatigue real for AI proposals?"), you drop sources on the board. The model extracts *claims* from each as small cards attached to their source.
2. You drag claims into rough clusters. The model proposes "these two contradict" as a dashed edge with both quotes. You keep or dismiss it.
3. Later you ask "what's the strongest evidence against?" The board dims everything except the relevant cluster. It is a temporary frame that vanishes when you move on, and it never relocates anything.
4. **Over time.** Positions are stable. Nothing moves unless you move it. The board's spatial memory *is* the orientation aid (Marshall & Shipman's spatial hypertext; VIKI's suggested structure [lit]).

**Why it's different.** It tests the frame-proposal idea where it might actually matter (large, messy material), and it keeps spatial continuity absolute. It is also the riskiest. Sensecape and Graphologue occupy nearby ground [lit], and canvases are known to become unmaintained.

### Direction D (Underneath): an interaction grammar

**Thesis.** The project's lasting contribution may be a set of *contracts* any surface can implement. A chat-with-panes, a decision log, a margin document and an evidence board could all run on them.

| Contract | Definition | Already in the pilot as |
|---|---|---|
| **Work object** | Typed, identified, stable-ID item with a lifecycle (`draft → proposed → settled → superseded/withdrawn`) | `state.json` items (`proposed/confirmed/rejected`) |
| **Proposal vs authority** | Any writer may *propose*; only principals with authority may *settle*; settlement is recorded with who, when and from what | `decide()`, `decidedBy` |
| **Provenance** | Every object and change carries origin (message, quote, model, rule) and a history of changes, inside the state, not in analytics | `quote`, `fromMessage`, `item_write` ledger |
| **Frame** | A closed-vocabulary, reversible view transform (focus, order, group, filter) with an author; never changes state | `FrameIntent`, `frames.json` |
| **Reversal** | Every change has an inverse that is one action away; irreversible actions are a separate class | partial: frame reset only |
| **Bounded delegation** | A visible, revocable rule granting automatic acceptance within a scope ("auto-accept tasks this session") | `always`/`never` for panes only |
| **Attention** | Triggers (edge and level) decide when intelligence is woken; separate from presentation | controller (edge, turn-based only) |
| **Persistence** | State outlives the conversation; the conversation is a trace referenced by provenance | files, `rev`, SSE |

**Does it power radically different interfaces?** Yes, if three things are removed from the pilot's contracts:
1. pane-specific lifecycle;
2. turn as the only clock;
3. the transcript as the only input.

The Weavr blackboard principle ("each runtime receives only the projection relevant to its intervention", Weavr `CONCEPT.md`; D-041) is the same idea at orchestration scale. A shared vocabulary between Weavr and this grammar (Proposal, Decision, Evidence, Need, Frame) is plausible and would be valuable. **Do not force integration:** Weavr governs *runtimes*, and this grammar governs *a person's working surface*. The overlap is the authority model, not the data. *(medium; [doc] [judgement])*

**Risk.** Grammars extracted before two real surfaces exist tend to be wrong. Specify the grammar *after* B or C1 runs on real work, by diffing what the two implementations actually needed.

---

## Part 5. Optimizing what exists

### 5.1 Immediate (hours, low risk)

| Change | Costs | Preserves | Replaces |
|---|---|---|---|
| **Put confirmed state into the chat call** (system message: settled decisions, open tasks; proposals marked as unconfirmed) | ~15 lines; more input tokens | Everything | The "model only sees 40 lines" behavior |
| **Turn fade/removal off by default** (`fadeAfterTurns` absent from `rules.example.json`) | Nothing | The code, for later | Unasked-for lifecycle during evaluation |
| **Extraction prompt: titles of non-rejected items only, capped** | ~5 lines | Dedup quality | Linear prompt growth |
| **Show the quote on hover/focus of every proposal card** | ~20 lines | `/why` | The need to run `/why` to judge an extraction |
| **Add "+ decision / + task" in the UI** | ~40 lines | Authority model (author: you) | JSON hand-editing as the only human authoring path |
| **Portable verify**: detect Chromium via `CHROME` and Playwright's path; replace `sed -i ''` with a Node one-liner | ~10 lines | All checks | macOS-only replication |
| **Outcome metrics**: time-to-answer for status questions, scroll-back seconds, undo/reject counts, sessions where chat was used outside the pilot | ~60 lines | `/stats` | Mechanism-only measurement |

Only the first is a behavior change I'd call necessary before evaluation. All are **proposals, not authorized implementation**.

### 5.2 Architectural (days)

| Change | Costs | Preserves | Replaces |
|---|---|---|---|
| **Move provenance into state**: each item gets `history: [{at, by, via, fields}]`; metrics becomes pure analytics | Migration of fixtures; `why.js`/`stats.js` rewrite of the ledger path | Every provenance guarantee | The `metrics.jsonl`-as-ledger coupling; frame ID scanning |
| **Separate the event log from the conversation**: controller and system events go to `events.jsonl`; the transcript holds only user/assistant | Renderer merges two streams | Visibility of system events | 26% of transcript lines being administration |
| **Collapse the pane lifecycle** to `shown | closed` by the user; drop `answers/removals/pending/pendingKind/removalAsked/fadedTurn` | Loses fade experiments (kept on a branch) | Consent for *showing* panes, if desired, as a one-time preference | A seven-field state machine |
| **Batch extraction** every N turns or on idle with a turn range | Proposals appear later | Quote check (over a range) | One extra model call per turn |
| **Drop the frame role**; implement 3 deterministic orders (recency, mentioned-in-last-turn, dependency) the user picks | Loses model-suggested frames | Closed vocabulary, `frames.json`, reset, provenance | A model call per turn |
| **Revisit D2**: split `server.js` (1,319 lines) into store / roles / controller / http | Refactor time | Behavior | The decision's own reversal trigger, crossed silently |

### 5.3 Conceptual

1. **Wrong problem: "how do panes appear and disappear".** The real problem is *how the state stays authoritative and in view while the conversation moves on*. Containers are a means.
2. **Wrong abstraction: turns as the clock.** Work has days, interruptions and returns. The pilot's clock can't see "three days of silence", and that was one of *Rolle und Kodex*'s best scenarios. Add wall-clock and session-boundary signals.
3. **Inherited assumption: chat as the start state.** *Growing Workbench* chose it, but *Rolle und Kodex* showed a workspace is strongest over an existing domain. Many real projects *have* a domain artifact on day 1: a plan, a repo, a document. Start from the artifact when one exists, and from chat only when nothing exists.
4. **Inherited assumption: confirmation = authority.** Authority can also be exercised by *reverting*. A person who can see and undo every change in one place holds authority without approving each one in advance.
5. **Iteration discipline.** v0.8–v0.10 should not have been built before P5, per the project's own D9, scope list and triggers. Not because they're bad, but because they answer questions no user has asked yet. Every one of them would be designed differently after a week of real use. *This is the most important process finding.* *(high; [doc])*

---

## Part 6. External intellectual challenge

The full annotated scan (~55 DOI-verified references) is in [`assessment-2026-10-prior-art.md`](assessment-2026-10-prior-art.md); summarized here. Items marked [unverified] could not be checked.

### Established prior art the project should cite explicitly

| Project idea | Prior art | What it means here |
|---|---|---|
| Extract structure and let the user accept it | **Shipman & Marshall, "Formality Considered Harmful"**, CSCW Journal 1999, https://doi.org/10.1023/A:1008716330212; VIKI spatial parser, https://doi.org/10.1145/192757.192759; **Potluck** (Ink & Switch 2022), https://www.inkandswitch.com/potluck/ | Incremental formalization is the project's true lineage. The literature's warning: premature formalization is resisted, and an LLM formalizer proposes *more* structure. |
| Proposals and mixed initiative | Horvitz, "Principles of mixed-initiative user interfaces", CHI 1999, https://doi.org/10.1145/302979.303030; Amershi et al., "Guidelines for Human-AI Interaction", CHI 2019, https://doi.org/10.1145/3290605.3300233 | The pilot sits at Horvitz's most conservative end. Horvitz would use *confidence and expected utility* to decide whether to propose, ask or act. The pilot uses none. |
| Answer vs workspace, authority | Shneiderman & Maes, Interactions 1997, https://doi.org/10.1145/267505.267514; Shneiderman 1983, https://doi.org/10.1109/MC.1983.1654471 | A reframing of the old debate, and a useful vocabulary, not a new distinction. |
| Panes fading after inactivity | Jensen Harris on Office 2000 personalized menus (abandoned): https://learn.microsoft.com/en-us/archive/blogs/jensenh/combating-the-perception-of-bloat-why-the-ui-part-3; Findlater & McGrenere CHI 2004, https://doi.org/10.1145/985692.985704; Gajos et al. CHI 2008, https://doi.org/10.1145/1357054.1357252; Findlater et al. CHI 2009 (ephemeral adaptation), https://doi.org/10.1145/1518701.1518956 | "Auto-customization, unless it does a perfect job, is usually worse than no customization at all." Adapt salience, not location. |
| Consent at every step | Böhme & Köpsell CHI 2010, https://doi.org/10.1145/1753326.1753689; Anderson et al. CHI 2015, https://doi.org/10.1145/2702123.2702322; Akhawe & Felt USENIX Sec 2013, https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/akhawe | Frequent uniform confirmations habituate within days. Design and frequency matter. |
| Undo instead of confirm | Raskin, *The Humane Interface* (2000); Abowd & Dix 1992, https://doi.org/10.1016/0953-5438(92)90021-7; Berlage TOCHI 1994 (selective undo), https://doi.org/10.1145/196699.196721 | The pilot's provenance records are the substrate selective undo needs. |
| `/why` | Myers et al. "Crystal", CHI 2006, https://doi.org/10.1145/1124772.1124832; Ko & Myers "Whyline", CHI 2004, https://doi.org/10.1145/985692.985712; Bansal et al. CHI 2021, https://doi.org/10.1145/3411764.3445717; Turpin et al. 2023, https://arxiv.org/abs/2305.04388 | Answering from records is right (it avoids unfaithful self-explanation). Explanations can still raise unwarranted trust. |
| Chat transcript vs work product | Rule et al. CHI 2018, https://doi.org/10.1145/3173574.3173606; Head et al. CHI 2019, https://doi.org/10.1145/3290605.3300500 | The notebook's two drifting states: a workbench next to a transcript can recreate them. |
| Generative and LLM-native UI | Sensecape, https://doi.org/10.1145/3586183.3606756; Graphologue, https://doi.org/10.1145/3586183.3606737; DirectGPT, https://doi.org/10.1145/3613904.3642462; DynaVis, https://doi.org/10.1145/3613904.3642639; Luminate, https://doi.org/10.1145/3613904.3642400; Google "Generative UI", https://arxiv.org/abs/2604.09577 | Morphing and structured side panels are crowded territory. Conservative, closed-vocabulary generation is the defensible niche. |
| Resumption and orientation | Altmann & Trafton 2002, https://doi.org/10.1207/s15516709cog2601_2; Iqbal & Horvitz CHI 2007, https://doi.org/10.1145/1240624.1240730 | The *strongest under-used justification*: persistent visible state is a resumption cue. Evaluate on that. |
| Task-centric workspaces | Henderson & Card "Rooms" 1986, https://doi.org/10.1145/24054.24056; Bardram activity-based computing, https://doi.org/10.1145/1534903.1534907; TaskTracer, https://doi.org/10.1145/1040830.1040855 | Activity desktops mostly did not take hold. A plausible reason (my synthesis, not consensus) is the declaration and maintenance tax, which per-item confirmation partly re-imposes. |
| Blackboard | Erman et al. 1980, https://doi.org/10.1145/356810.356816; Hayes-Roth BB1 1985, https://doi.org/10.1016/0004-3702(85)90063-3; Nii 1986, https://ojs.aaai.org/index.php/aimagazine/article/view/537 | Hearsay-II's hard part was the *control* problem. Harpy, a compiled approach, met the DARPA targets (Klatt 1977, https://doi.org/10.1121/1.381666; figures [unverified]). Fittingly, the deterministic, compiled path has history on its side. |
| Evaluation | Olsen UIST 2007, https://doi.org/10.1145/1294211.1294256; Greenberg & Buxton CHI 2008, https://doi.org/10.1145/1357054.1357074 | Judge systems by situation, task and user. Don't let early usability tests kill or flatter a novel idea. |

### What is genuinely new, carefully stated

- **Plausibly novel:** a closed, model-proposed, user-applied view-transform vocabulary (focus/order/group) over an LLM workspace, recorded with provenance and reset. I found no direct precedent; BB1's control blackboard is the nearest ancestor. *(low–medium: absence of evidence)*
- **A new and useful combination, not a new mechanism:** LLM extraction + verbatim-quote grounding + fail-closed validation + attributed proposals + provenance from records (not model self-report) + local-never-falls-back-to-cloud routing. As a *stance* ("conservative, provenance-backed generative UI"), it is well defined and under-represented in current products. *(medium)*
- **Not novel:** blackboard as a metaphor, morphing UIs, answer-vs-workspace, consent-gated growth, `/why` as such, role routing (FrugalGPT, RouteLLM), Enter-timing (spoken dialogue end-of-turn detection).

### Failed approaches with direct bearing

- Office adaptive menus: unpredictable movement, users disabled them.
- Clippy: interruption, opacity, anthropomorphism. Contrary to common lore, whether Lumière's inference shipped is [unverified].
- Typed-link hypertext and semantic wikis: premature formalization.
- Activity-based desktops: declaration tax; synthesis, not consensus.

---

## Part 7. A meaningful evaluation

### 7.1 Question

For one person doing multi-day work with an LLM, does a persistent, model-readable workspace improve **recovery after interruption** and **orientation** enough to justify its **management cost**? Is the growing pane workbench better than a single durable document?

### 7.2 Conditions (within-subject, counterbalanced)

| Condition | What it is | Build cost |
|---|---|---|
| **A. Chat** | Pilot with no panes and no extraction (`rules.json` empty, extract role empty). Same model, same server. | none |
| **B. Minimal workspace** | Chat + one document view of `state.json` (Direction B): drafts auto-added, attributed, undoable; model reads the document | ~1–2 days |
| **C. Growing workbench** | Current pilot, v0.7 behavior **plus** state-in-context (§5.1). Fade, Enter and frames off. | ~1 hour |
| **D. (optional) Decision log** | C1 as a lo-fi prototype, or a Wizard-of-Oz paper version for one session | ~2–3 days, or skip |

Holding the model and the state-in-context constant isolates the *interface*. Without state-in-context in A, B and C alike, any win for B or C is confounded by memory.

### 7.3 Tasks (real, not scripted)

Three bounded, real tasks from Miro's own backlog, each spanning **≥ 3 sessions over ≥ 2 days** with forced interruptions:
1. **A design decision.** Example: choose the P5 thresholds, or Weavr's next ADR. Output: a decision with rationale.
2. **A small research synthesis.** Example: consent fatigue for AI proposals. Output: a 1-page brief with sources.
3. **A planning task.** Example: plan the next pilot step. Output: tasks with order and owners.

Rotate task × condition (Latin square). With one participant this is an **n-of-1 study**. It is still informative if the effects are large. Add 3–5 colleagues for one condition pair (A vs B or C) if available.

### 7.4 Measures: behavior separated from preference

**Measured behavior (logged):**

| Construct | Measure |
|---|---|
| Interruption recovery | Time from session start to first *substantive* message (not "where were we"). Count of "remind me / what did we decide" messages. Scroll-back seconds in the first 3 minutes. |
| Orientation | At session start, before touching anything, the participant writes the 3 open items from memory and from the screen. Score against the ground truth (state at last session end). Time to answer 3 probe questions ("what blocks X?") using the interface. |
| Task completion | Output exists, judged by a blind second reader on a 3-point rubric (complete, correct, traceable). |
| Management time | Seconds spent on consent answers, confirm/reject, pane manipulation, `/why`, undo. Count of administrative acts per turn. |
| Explain or reverse changes | End-of-session probe: pick 3 random items and ask who created it, from what, and how to undo it. Score correctness and time. |
| Model quality (for B/C) | Extraction precision: % of proposals kept unchanged. Recall: items the participant added by hand that the model missed. Wrong-quote rate. |
| Cost | Model calls and tokens per turn; latency p50/p90 per role. |

**Subjective (asked separately, after behavior is recorded):**
- NASA-TLX raw (unweighted) per session;
- a single-item trust rating per condition;
- end-of-week ranking with a free-text "why";
- a diary line per session.

**Pre-registered decision rules.** Write these down before running.
- **B ≥ C on recovery and orientation, and C costs > 2× B's management time** → pursue Direction B; pause panes.
- **C > B by a clear margin on orientation probes (≥ 1 item better on average, or ≥ 30% faster)** → continue A, keeping only panes that were used.
- **Neither beats A on recovery** → the workspace premise fails for this kind of work. Write it up; that is a result (the project's own kill criterion).

### 7.5 Practical real-model dogfooding, with the Morrow check

**Step 0: connectivity check (blocking; no test results invented).** Run from the machine that will host the pilot:

```bash
tailscale status | grep -i nebuchadnezzar              # is Morrow on the tailnet?
curl -sS -m 5 http://nebuchadnezzar:11434/api/tags      # Ollama up; is qwen3:14b listed?
curl -sS -m 60 http://nebuchadnezzar:11434/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3:14b","messages":[{"role":"user","content":"Reply with {\"ok\":true}"}],
       "response_format":{"type":"json_schema","json_schema":{"name":"t","schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}}},
       "stream":false}'
```

Record:
- first-token latency;
- total latency for a 2-turn extraction prompt;
- whether `response_format` is honored;
- tokens/second.

If Morrow is unreachable, the fallback is an explicitly *cloud* extract candidate. Because the role is `local: false`, this is a conscious privacy decision for non-private topics only, recorded in the condition log.

**Step 1: one-hour smoke session** on a throwaway topic, condition C. Measure extraction precision on ~20 turns, wrong-quote drops and latency. **Go/no-go:** if precision < 50% or extraction p90 > 30 s, fix extraction (prompt, batching, model) before the week. Otherwise the week measures noise.

**Step 2: the week** (§7.2–7.4), with `.pilot/` per condition and task. Resolve QUESTIONS #2 first (the old verify scripts wipe `.pilot/`) by running dogfood in a separate `PILOT_DIR`.

**Step 3: write-up** with raw logs committed, including failures and the sessions where Miro reached for plain chat instead.

---

## Part 8. Decision

### 8.1 Strongest insight

*State belongs to the project; the model proposes; a person settles; everything can say where it came from.* Plus the engineering discipline that makes it real:
- extraction grounded in verbatim quotes;
- fail-closed validation;
- provenance from records, never from model self-report;
- local data never silently escalating to the cloud.

**Confidence: medium.** Supported by [code] and [lit]; usefulness is untested.

### 8.2 Strongest criticism

The project argued for a workspace the model *reads*, and built a chat whose model *doesn't*. It then spent its iterations on the lifecycle of containers around that chat instead of testing the premise on real work. The user is made the administrator of an interface whose administration buys them nothing from the model.

**Confidence: high** on the facts ([code] `server.js:52/1098`; [doc] D9, scope list, triggers; [ran]). **Medium** on the claim that this is fundamental rather than easily fixed. It is *easily fixed in code*; the deeper issue is the iteration discipline that let it happen.

### 8.3 Keep (protect these)

| Element | Why | Confidence / source |
|---|---|---|
| Files as truth, `rev`, atomic writes, live SSE, broken-file tolerance | Makes hand edits and tool-independence real | high · [code][ran] |
| Proposal vs authority, fail-closed extraction, verbatim quote check | The core guarantee; rare in current products | high · [code]; medium · [lit] |
| Authorship on every element | Prerequisite for trust and undo | high · [code] |
| Provenance from records, not model explanation | Avoids unfaithful explanations | medium · [lit] |
| Role routing with the local→cloud block and pins | Real privacy guarantee | high · [code] |
| Closed `FrameIntent` vocabulary *as a contract* | The most defensible novelty | low–medium · [lit] |
| The kill criterion ("if you reach for chat, Kodex lost") | Honest, falsifiable | high · [doc] |
| Deterministic controller for *when* to wake intelligence | Cheap, predictable, testable | medium · [doc][judgement] |

### 8.4 Kill or pause

| Item | Action | Why | Confidence |
|---|---|---|---|
| Fade and removal after N turns (v0.8) | **Pause; off by default** | No trigger occurred; repeats a documented failure pattern; adds a lifecycle the user must track | medium · [doc][lit] |
| Enter diffusion (v0.9) | **Pause** | Built against D9; Tab conflict; answers a keystroke question, not the authority question | high · [doc][code] |
| Model frame proposals (v0.10) | **Pause the model call; keep the contract** | One call per turn for a reorder of a few cards; no user problem observed | medium · [code][judgement] |
| Turn-count thresholds as growth signal | **Replace** with retrieval-failure signals or user choice | Proxy without validity evidence | medium · [judgement] |
| Per-object confirmation as the *only* path to state | **Reconsider** (drafts + undo + settle) | Consent fatigue risk; Shipman & Marshall | medium · [lit] |
| `metrics.jsonl` as provenance ledger | **Kill the coupling** | Analytics should not be load-bearing | high · [code] |

### 8.5 Forward

- **Model-readable state** (now).
- **Answers bound to objects** (`refs`), so a reply can foreground what it touches instead of growing the scroll.
- **Level triggers** (staleness, silence) as *notes*, not interruptions. This tests *Rolle und Kodex*'s "notices unprompted" claim, which the pilot never touched.

### 8.6 Backward

- **One document, drafts, undo, settle.** Delete or flag-off the pane lifecycle, frames and settle-input for the evaluation.
- **Separate administrative events from the conversation.**
- **Give the human an authoring path in the UI.**

### 8.7 Sideways

The **Decision Log / case file** (C1) is the alternative most worth a lo-fi prototype:
- it aligns with Weavr's vocabulary and M7's product line;
- it makes the work object, not the chat, primary;
- it can run on the same files.

The **Annotated Document** (C2) is the cheapest to imitate with existing tools (a Markdown file plus track changes) and makes a good control condition.

### 8.8 Smallest deciding experiments

1. **Morrow check** (30 min). Decides whether any real-model evaluation can be local.
2. **One-hour extraction smoke test** (§7.5 step 1). Decides whether extraction is good enough for anything built on it. If precision is poor, every pane-based future is moot until fixed.
3. **A vs B vs C week**, n-of-1 with pre-registered rules (§7.4). Decides Forward vs Backward.
4. **Wizard-of-Oz decision log**: one session, Miro plays the model's margin notes for a colleague, or vice versa. Decides whether C1 deserves a build. Cost: half a day, no code.

### 8.9 Recommendation, and the case against it

**Recommendation: Backward first, then Underneath.**
- Make the model read the state.
- Run the three-way comparison with the minimum interface (B) as a first-class condition.
- Let the results decide whether panes, frames and lifecycle come back.
- Then write the interaction grammar from what B and C *actually needed*, and only then consider Weavr or Case alignment.

**The case against it.**
- (1) B may look like a reinvention of Claude Projects plus artifacts, or of Potluck, which lowers its research novelty. If B wins, the project's distinctive contribution shrinks to attribution, undo and grounding discipline. That may be the honest outcome, but it is less exciting.
- (2) An n-of-1 week with the designer as participant is biased toward whatever the designer finds interesting. The blind second reader and logged behavior help but don't remove the bias.
- (3) The growing workbench's real advantage might only appear on longer horizons (weeks, several projects) than a week tests. A loss for C in one week is weak evidence against A.
- (4) Spatial views (map, board) may matter more for the *investigation* kind of work than for planning, and B has none.

I still prefer this path. It is the cheapest route to evidence, and it protects the project's best idea (authority and provenance) from being judged by its least-tested decoration (pane lifecycle).

### 8.10 Next three moves (bounded)

1. **Connectivity and smoke (≤ ½ day).** Run the Morrow check (§7.5 step 0) and record the numbers in `pilot/app/REPORT.md`. If reachable, run the one-hour extraction smoke test. *Needs Miro's network; no code.*
2. **One authorized code change (≤ ½ day, needs explicit go-ahead).**
   - Feed confirmed state (and unconfirmed proposals, marked) into the chat call.
   - Default fade off.
   - Make verify portable.
   - Tag `pilot-v0.11`. Nothing else.
3. **Run the comparison (5 working days).**
   - Build condition B as a minimal branch.
   - Write the decision rules into `docs/` *before* starting.
   - Run A/B/C on three real tasks and commit raw logs.
   - Make the Forward/Backward/Sideways call from the results.

---

## Confidence summary of major conclusions

| Conclusion | Confidence | Evidence |
|---|---|---|
| Chat model does not read workbench state | high | [code] |
| v0.8–v0.10 were built against the project's own gates | high | [doc] |
| No real-model evidence exists | high | [doc] `REPORT.md` |
| Test suite: 395 PASS on Linux; failures environmental (macOS-only paths, BSD sed) | high | [ran] |
| Browser suites v0.8, v0.10 pass with Chromium | high | [ran] |
| Provenance coupled to the metrics log | high | [code] |
| Consent fatigue is a likely failure mode | medium | [lit], not observed |
| Fade-after-N-turns repeats a known failure pattern | medium | [lit] |
| Minimal workspace (B) delivers most of the benefit for single-person work | low–medium | [judgement] [lit] |
| Closed frame vocabulary is the most novel element | low–medium | [lit] (absence of a found precedent) |
| Decision log is the strongest sideways bet | low | [judgement] |

## Scope and governance notes

- **Weavr.** Read `blackmath88/weavr/docs/CHATGPT-OPERATING-CONTRACT.md`, `CONCEPT.md`, `DECISIONS.md` and `.weavr/missions/` read-only at `49a9a5b`. No Weavr Mission or Observatory setup covers `blackboard-nextgenui`, so this work is an exploratory Session in the contract's terms. Nothing was dispatched, submitted, merged, deployed or waived.
- **Case Systems.** I found no repository by that name in the accessible scope. Its relation is described conceptually (C1, D) from the M7 line in `explainers/02-morph/js/data.js` and Weavr's vocabulary.
- **What changed in this repository.** Only this file was added. No application code was touched. The prior-art scan behind Part 6 was produced by a research subagent with DOI checks against Crossref. Items it could not verify are marked [unverified].
