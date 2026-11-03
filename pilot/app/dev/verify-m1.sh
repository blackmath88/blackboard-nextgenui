#!/bin/bash
# M1: isolated HTTP/privacy checks, plus the Settings/context browser mode when available.
set -eu
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"
trap 'fixture_remove "$T"' EXIT
fixture_ports 4840 5841
node dev/verify-m1.js "$T"
if node dev/browser-check.js m1; then :
else
  rc=$?; [ "$rc" -eq 77 ] || exit "$rc"
fi
echo 'ALL M1 CHECKS PASSED'
