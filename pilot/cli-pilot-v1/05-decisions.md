# 05 Decisions

Each decision states what would reverse it.

**D1. Browser-based fake terminal, not a real TUI.**
Why: morphing panes and pixel sprites need a browser; a local server also keeps keys away from the page and solves CORS.
Reverse if: the pilot must run over SSH or inside an existing terminal workflow. Then: Textual with textual-serve, reading the same `.pilot/` files.

**D2. Node with no framework; plain HTML/CSS/JS for the page.**
Why: prototype-sized, readable, no build step, like the explainers.
Reverse if: the server passes about 600 lines or needs routing beyond a handful of endpoints.

**D3. Files are the truth: JSONL for history, JSON for state.**
Why: hand-editable, diffable, git-friendly; tests the blackboard idea directly.
Reverse if: a week of real use produces write conflicts that `rev` cannot handle. Then: SQLite with a JSON export.

**D4. Deterministic controller in v1.**
Why: we must see whether visible thresholds alone produce good growth before adding model judgment.
Reverse if: dogfooding shows thresholds misfire in ways a rule cannot express. Then: a small model may propose growth, still behind consent.

**D5. Model choice is per role and changeable at runtime.**
Why: the "Morrow or frontier" question has no single answer; privacy, cost and quality differ by topic and task.
Reverse if: never; at most the default changes.

**D6. Model output is always a proposal.**
Why: the authority line from br-ai-nstorm and Weavr; a button or an item from a model is not permission.
Reverse if: never in this pilot.

**D7. Server-Sent Events, not WebSockets.**
Why: one-way push is all the page needs; SSE is plain HTTP.
Reverse if: the page must stream large amounts back to the server.

**D8. CSS grid layouts for 1 to 4 panes, no docking library.**
Why: the diachronic idea is to avoid overwhelm; fixed templates are enough to test growth.
Reverse if: you find yourself wanting to rearrange panes by hand more than once a day. Then: dockview.

**D9. The chat keeps its Enter key in v1.**
Why: diffusing Enter is a separate experiment; mixing it in would muddy what P5 measures.
Reverse if: P5 passes. Then the Enter experiment becomes v2's first step.
