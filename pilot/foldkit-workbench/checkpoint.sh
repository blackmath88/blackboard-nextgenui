#!/bin/sh
set -eu
cd "$(dirname "$0")"
lock="$(git rev-parse --path-format=absolute --git-path blackboard-offline-check.lock)"
if ! mkdir "$lock" 2>/dev/null; then
  echo "An offline check already holds $lock" >&2
  exit 1
fi
cleanup() {
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
build_dir="$(mktemp -d /tmp/blackboard-checkpoint.XXXXXX)"
git status --short --branch
git log -1 --oneline
npm run typecheck
npm test
npm run build -- --outDir "$build_dir"
echo "Verified build: $build_dir"
