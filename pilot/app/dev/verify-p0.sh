#!/bin/bash
# Assert the original skeleton contract using isolated local fake providers.
set -eu
cd "$(dirname "$0")/.."
source dev/lib/safe-dir.sh
T=$(fixture_temp); fixture_root "$T"; FIXTURE_ROOT="$T"
trap 'fixture_remove "$T"' EXIT
fixture_ports 4750 5701 5702
node dev/verify-p0.js "$T"
