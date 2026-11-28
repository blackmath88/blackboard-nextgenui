# Blackboard development ledger

Host `mac-mini-bruh`, branch `feat/foldkit-unibas-evaluation`. The 27 November 2026 window starts at approximately 12:13 CET and ends at 17:13 CET. Resume from the latest accepted commit. Consumption in this window is zero UniCorn requests. A provider budget is still unverified.

## UI-01 — Responsive workspace, KEEP

Codex implemented and verified `50b1370`. The criteria were a visible inspector at 1095 px, no document overflow at 1095, 820 or 390 px, and keyboard evidence opening that survives reload. Browser measurements matched the viewport widths. The first phone check found a 660 px document from the payload footer. A block footer resolved it. TypeScript, 13 tests and the build passed.

- Visual quality 3/5. Three surfaces fit at desktop width. Phone still puts the inspector below the work surface.
- Interaction, usefulness and continuity 4/5 each. Keyboard apply and source activation worked, and the source remained open after reload.
- Architecture and maintainability 4/5 each. Existing Foldkit views and messages support the change with a small CSS diff.
- Reliability 4/5. Three breakpoints and deterministic gates passed.
- Accessibility 3/5. Enter activation works. Full tab order, contrast, and screen reader verification remain open.
- Security 5/5. Fixture preview stayed on loopback and the change is CSS only.
- Model efficiency unmeasured for this offline package.

## Queue and local resume

1. UI-02 — Add a restrained dark palette and inspect record, focus, and warning contrast at both widths.
2. CHAT-01 — Add a fixture conversation composer with typed messages. Accept only if an inline result can promote to a saved arrangement without changing accepted records.
3. REG-01 — Extract the first useful native component contract and gallery. Start with evidence and structured lists.
4. EVAL-01 — Compare fixture and captured live results against the fixed blockers view. Hold new UniCorn traffic until the permitted budget is verified.

Take one package at a time. Record owner and acceptance checks before editing. Review the diff, run the checkpoint command, inspect the browser when the UI changes, and commit the evidence and verdict. Stop at the window deadline. Keep hourly status in STATUS.md.
