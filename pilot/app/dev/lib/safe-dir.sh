# Shared test-only fixture operations; source after changing to pilot/app.
SAFE_HELPER="$(pwd)/dev/lib/safe-dir.js"
fixture_temp() { node "$SAFE_HELPER" temp; }
fixture_remove() { node "$SAFE_HELPER" remove "$FIXTURE_ROOT" "$@"; }
fixture_owned() { node "$SAFE_HELPER" validate "$FIXTURE_ROOT" "$@"; }
fixture_reset() { node "$SAFE_HELPER" reset "$FIXTURE_ROOT" "$1" || exit 1; }
fixture_ports() { node "$SAFE_HELPER" ports "$@" || exit 1; }
