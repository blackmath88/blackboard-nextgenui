#!/bin/bash
# Try a tagged pilot iteration without touching your checkout:
#   bash pilot/app/scripts/try.sh pilot-v0.3
# Adds the tag as a detached git worktree in a temp dir, runs `npm run demo -- v0.3` there, and removes the
# worktree when the demo exits (Ctrl+C). Works for pilot-v0.3 onward. An unknown tag lists the pilot-v* tags.
# TRY_REF=<commit> checks out that commit instead of the tag (to test this script before a tag exists).
set -u
TAG=${1:-}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 1
REF=${TRY_REF:-refs/tags/$TAG}
if [ -z "$TAG" ] || ! git -C "$REPO" rev-parse -q --verify "$REF^{commit}" > /dev/null; then
  [ -n "$TAG" ] && echo "unknown tag \"$TAG\"."
  echo "usage: scripts/try.sh <tag>   available pilot tags:"
  git -C "$REPO" tag -l 'pilot-v*' | sed 's/^/  /' | grep . || echo "  (none yet)"
  exit 2
fi
VERSION=${TAG#pilot-}
source "$(dirname "$0")/../dev/lib/safe-dir.sh"
SAFE_HELPER="$(cd "$(dirname "$0")/.." && pwd)/dev/lib/safe-dir.js"
TRY_ROOT=$(fixture_temp); FIXTURE_ROOT=$TRY_ROOT
WT="$TRY_ROOT/pilot-$VERSION"
cleanup() { git -C "$REPO" worktree remove --force "$WT" 2>/dev/null; fixture_remove "$TRY_ROOT"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
git -C "$REPO" worktree add --detach "$WT" "$REF" > /dev/null || exit 1
echo "[try] $TAG ($(git -C "$WT" rev-parse --short HEAD)) checked out in $WT (removed again on exit)"
if [ ! -f "$WT/pilot/app/demo/fixtures/$VERSION/demo.json" ]; then
  echo "[try] $TAG has no demo/fixtures/$VERSION/ (demos exist from pilot-v0.3 on)"; exit 2
fi
cd "$WT/pilot/app" && npm run --silent demo -- "$VERSION"
