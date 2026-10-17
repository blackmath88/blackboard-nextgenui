#!/bin/bash
# Runs every dev/verify-*.sh (old P0/P1/P2 ones included) and the P1/P2 browser checks, then prints a summary.
# Usage: npm run verify   (or bash pilot/app/scripts/verify-all.sh)
# The P0-P2 scripts use ports 4747/5701/5702 and WIPE pilot/app/.pilot/. To protect a real .pilot/, this
# script refuses to start while one exists (move it aside first), and removes the one the old checks leave behind.
# Verdicts are read from the output (^FAIL lines, the "ALL ... PASSED" marker), not from exit codes:
# verify-p1/p2 always exit 0 and verify-p0 prints no verdicts (its success marker is its final transcript dump).
set -u
cd "$(dirname "$0")/.."
if [ -e .pilot ]; then
  echo "pilot/app/.pilot/ exists. The P0-P2 checks wipe it. Move it aside (e.g. mv .pilot .pilot.keep) and run again."
  exit 2
fi
T=$(mktemp -d); trap 'rm -rf "$T"; rm -rf .pilot' EXIT
BAD=0; SUMMARY=()
run() {
  local name=$1; shift
  echo "######## $name"
  "$@" > "$T/out.log" 2>&1; local rc=$?
  cat "$T/out.log"
  local fails; fails=$(grep -c '^FAIL' "$T/out.log")
  local ok=0
  case "$name" in
    verify-p0.sh) grep -q '"role":"assistant"' "$T/out.log" && [ $rc -eq 0 ] && ok=1 ;;
    *) grep -q '^ALL .*PASSED' "$T/out.log" && [ "$fails" -eq 0 ] && ok=1 ;;
  esac
  if [ $ok -eq 1 ]; then SUMMARY+=("PASS $name"); else SUMMARY+=("FAIL $name (exit $rc, $fails FAIL lines)"); BAD=$((BAD+1)); fi
}
for s in dev/verify-*.sh; do run "$(basename "$s")" bash "$s"; done
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  run "browser-check.js p1 p2" node dev/browser-check.js all
else
  SUMMARY+=("SKIP browser-check.js p1 p2 (needs Node 22+ and Google Chrome)")
fi
echo; echo "######## summary"; printf '%s\n' "${SUMMARY[@]}"
[ $BAD -eq 0 ] && echo "ALL VERIFY SCRIPTS PASSED" || echo "$BAD VERIFY SCRIPT(S) FAILED"
exit $(( BAD > 0 ))
