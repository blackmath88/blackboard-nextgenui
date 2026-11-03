#!/bin/bash
# Runs every dev/verify-*.sh (old P0/P1/P2 ones included) and the P1/P2 browser checks, then prints a summary.
# Usage: npm run verify   (or bash pilot/app/scripts/verify-all.sh)
# Every check owns a fresh marked fixture; real .pilot/ may remain in place.
# Exit status AND assertions must agree. Legacy scripts can print a success
# marker for an early section and fail later, or exit 0 after a FAIL assertion.
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT=$T; trap 'fixture_remove "$T"' EXIT
BAD=0; SKIPPED=0; PARTIAL=0; PASSED=0; SUMMARY=()
run() {
  local name=$1; shift
  echo "######## $name"
  "$@" > "$T/out.log" 2>&1; local rc=$?
  cat "$T/out.log"
  local status fails skips
  IFS='|' read -r status fails skips < <(node dev/lib/check-verdict.js "$name" "$rc" "$T/out.log")
  SKIPPED=$((SKIPPED+skips))
  case "$status" in
    PASS) SUMMARY+=("PASS $name"); PASSED=$((PASSED+1)) ;;
    PARTIAL) SUMMARY+=("PARTIAL $name ($skips skipped checks)"); PARTIAL=$((PARTIAL+1)) ;;
    SKIP) SUMMARY+=("SKIP $name") ;;
    *) SUMMARY+=("FAIL $name (exit $rc, $fails FAIL lines)"); BAD=$((BAD+1)) ;;
  esac
}
for s in dev/verify-*.sh; do run "$(basename "$s")" bash "$s"; done
run "browser-check.js p1 p2" node dev/browser-check.js all
echo; echo "######## summary"; printf '%s\n' "${SUMMARY[@]}"
echo "VERIFY COMPLETE: $PASSED passed, $PARTIAL partial, $BAD failed, $SKIPPED skipped checks"
if [ $BAD -gt 0 ]; then echo "$BAD VERIFY SCRIPT(S) FAILED"
elif [ $SKIPPED -gt 0 ]; then echo "AVAILABLE CHECKS PASSED; SKIPPED CHECKS WERE NOT RUN"
else echo "ALL VERIFY SCRIPTS PASSED"; fi
exit $(( BAD > 0 ))
