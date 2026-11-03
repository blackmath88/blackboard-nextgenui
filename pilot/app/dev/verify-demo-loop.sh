#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
node dev/verify-demo-loop.js
