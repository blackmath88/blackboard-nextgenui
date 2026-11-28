# Blackboard Foldkit workbench spike

Runtime-generated workbench for issue #13, using synthetic Microsoft 365 rollout records. The deterministic fixture provider is the default. An opt-in local preview can request view proposals through the configured UniBas sciCORE launcher.

```sh
cd pilot/foldkit-workbench
npm install
npm run check
npm run dev
```

Open <http://127.0.0.1:4320>. State is stored in browser `localStorage`. Use **Reset fixture** to return to the initial synthetic project.

For the optional live trial on a machine with the configured `pi-scicore` launcher, run `BLACKBOARD_UNIBAS=1 npm run dev` and open <http://127.0.0.1:4320/?unibas=1>. Use the original synthetic fixture revision. Only view proposals are sent to UniBas. Follow-up turns remain simulated locally.

The two question buttons use the same Effect Schema decoding and record-level validation path. The probe controls exercise malformed, unknown-ID, cross-project, unsupported-action, and stale-proposal refusals while retaining the last usable view and accepted records.

## Blackboard studio (generative workspace)

`studio.html` is the generative, persistent, bidirectional workspace from session 01 (`docs/build/GENERATIVE-EXPERIENCE-SESSION-01.md`). It runs in fully synthetic mode: no model route, no network calls.

```sh
cd pilot/foldkit-workbench
npm ci
npm run check                        # typecheck, unit/behaviour tests, build
npm run dev -- --port 4330           # then open http://127.0.0.1:4330/studio.html
node scripts/studio-acceptance.mjs   # browser acceptance (needs the dev server and Google Chrome; writes docs/build/evidence/run)
```

Start from one of the four starters (Architektur, Budget, Forschung, Lernplan), or ask about PostgreSQL vs SQLite to see a replayed model-format reply. Select objects on the Blackboard; the tray above the composer offers the matching action. State is kept in `localStorage` under `blackboard.studio.v1`; **Labor zurücksetzen** in the rail clears it.
