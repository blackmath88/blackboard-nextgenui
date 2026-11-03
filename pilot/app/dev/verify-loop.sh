#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
source dev/lib/safe-dir.sh
T=$(fixture_temp); fixture_root "$T"; FIXTURE_ROOT="$T"
trap 'fixture_remove "$T"' EXIT
fixture_ports 4864 5864
node dev/verify-loop.js "$T"

rc=0
node dev/browser-check.js loop || rc=$?
if [ "$rc" -ne 0 ] && [ "$rc" -ne 77 ]; then exit "$rc"; fi
