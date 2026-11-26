# Blackboard Foldkit workbench spike

Fixture-only runtime-generated workbench for issue #13. It uses synthetic Microsoft 365 rollout records and does not contain or call production credentials. The UniBas worker built this checkpoint; the in-app generation boundary is exercised with a deterministic fixture provider only.

```sh
cd pilot/foldkit-workbench
npm install
npm run check
npm run dev
```

Open <http://127.0.0.1:4320>. State is stored in browser `localStorage`. Use **Reset fixture** to return to the initial synthetic project.

The two question buttons use the same Effect Schema decoding and record-level validation path. The probe controls exercise malformed, unknown-ID, cross-project, unsupported-action, and stale-proposal refusals while retaining the last usable view and accepted records.
