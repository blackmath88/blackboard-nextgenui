#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
node dev/verify-harness.js
node dev/verify-context.js
node dev/verify-store.js
node dev/verify-lock.js
node dev/verify-disclosure.js
echo 'ALL FOUNDATION CHECKS PASSED'
