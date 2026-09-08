#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [[ "$(id -u)" -ne 0 ]]; then echo 'Fallback installer behavioral test skipped: root required'; exit 0; fi
run(){ FALLBACK_INSTALL_ARTIFACT_ROOT="$TMP/artifacts" FALLBACK_INSTALL_OPERATOR_PATH="$TMP/bin/babyjamjam-fallback-server" FALLBACK_INSTALL_STATE_ROOT="$TMP/state" FALLBACK_INSTALL_SYSTEMD_DIR="$TMP/systemd" FALLBACK_INSTALL_SKIP_DAEMON_RELOAD=true bash "$ROOT/install.sh" >/dev/null; }
mkdir -p "$TMP/bin"
run
test "$(wc -l <"$TMP/artifacts/bundle.manifest")" = 6
test "$(stat -c %a "$TMP/artifacts/bundle.manifest")" = 640
rm "$TMP/artifacts/bundle.manifest"
run
test -f "$TMP/artifacts/bundle.manifest"
grep -Fq 'compose.temporary-active.yml=' "$TMP/artifacts/bundle.manifest"
grep -Fq 'guard.timer' "$TMP/artifacts/bundle.manifest"
# Upgrading a persistent host must preserve /dev/null masks, including rollback
# backup handling (cp without -P would turn the masks into empty regular files).
printf 'disabled\n' >"$TMP/state/automatic-shutdown-policy"
chmod 400 "$TMP/state/automatic-shutdown-policy"
for unit in babyjamjam-fallback-temporary-active-{guard,stop}.{service,timer}; do
    rm -f "$TMP/systemd/$unit"
    ln -s /dev/null "$TMP/systemd/$unit"
done
run
for unit in babyjamjam-fallback-temporary-active-{guard,stop}.{service,timer}; do
    test "$(readlink "$TMP/systemd/$unit")" = /dev/null
done
chmod 600 "$TMP/state/automatic-shutdown-policy"
if ( run ) >/dev/null 2>&1; then echo 'unsafe shutdown policy accepted' >&2; exit 1; fi
echo 'Fallback installer behavioral tests passed'
