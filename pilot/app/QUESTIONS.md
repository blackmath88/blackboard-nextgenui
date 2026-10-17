# QUESTIONS

Open questions for the coordinator/user. Each: date, question, what it blocks, options.

## 2026-10-17 Where is Morrow?
Morrow (nebuchadnezzar) was not reachable over Tailscale on 2026-10-17; v0.4 extraction will be built against a
fake extractor and marked untested with a real model. Which host/port is Morrow on?
- Blocks: testing v0.4 extraction (and any `local: true` candidate) against a real model.
- Options: give host:port once it is up; or keep building against `dev/fake-model.js` and test later.

## 2026-10-17 Old P0–P2 checks wipe `pilot/app/.pilot/`
`dev/verify-p0.sh`, `verify-p1.sh`, `verify-p2.sh` and `dev/browser-check.js p1|p2` start with `rm -rf .pilot`
(they predate the rule "never delete or rewrite a real `.pilot/`"). They were not rewritten in v0.3 (only
assertions changed by the v0.3 decisions were adapted). As a guard, `npm run verify` refuses to start while
`pilot/app/.pilot/` exists. The new v0.3 checks use their own dirs (`.pilot-verify-v03*/`, `.pilot-demo-verify/`).
- Blocks: nothing now; it is a risk once someone dogfoods with a real `.pilot/` in this folder.
- Options: (a) move the old scripts to `PILOT_DIR=.pilot-verify-p*` in a later iteration (small change, but
  rewrites baseline checks); (b) keep the guard in `verify-all.sh` only; (c) both.

## 2026-10-17 Where does `allowCloudFallback` live?
Chosen: per role (`roles.chat.allowCloudFallback: true`), not top level, so e.g. a `title` role could allow cloud
while `chat` does not. A top-level default is not read.
- Blocks: nothing. Options: keep per role; or add a top-level default that roles override.
