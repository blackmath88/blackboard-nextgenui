#!/bin/bash
set -eu
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"
trap 'fixture_remove "$T"' EXIT
fixture_ports 4850 5851
node dev/verify-i1.js "$T"
if [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js i1
else
  echo 'SKIP I1 browser (set CHROME=/usr/bin/chromium)'
fi
echo 'ALL I1 CHECKS PASSED'
