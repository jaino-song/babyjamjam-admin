#!/usr/bin/env bash
# Manual end-to-end run of the fenced Valkey restore against REAL but disposable
# containers: a throwaway compose project (valkey + a stand-in API container, no
# published ports) and a throwaway volume. It drives the restore core in
# operator.sh with only the project/volume/marker identities and the production
# readiness checks replaced (root, bundle and approval-state checks are covered by
# operator.valkey-restore.behavior.test.sh). Not part of CI: it needs a Docker
# daemon and ~1 minute. It never touches a running project or an existing volume;
# everything it creates is named "$PROJECT-..." and is removed on exit.
#   bash operator.valkey-restore.realrun.sh            # project vrrun-<pid>
#   PROJECT=rt3r-fence bash operator.valkey-restore.realrun.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OPERATOR="$HERE/operator.sh"
PROJECT="${PROJECT:-vrrun-$$}"
VOLUME="$PROJECT-valkey-data"
WORK="$(mktemp -d)"
RR_COMPOSE="$WORK/compose.yml"
cleanup() {
    docker compose -p "$PROJECT" -f "$RR_COMPOSE" down -v >/dev/null 2>&1 || true
    # the containers wrote root-owned files into $WORK
    docker run --rm --network none -v "$WORK:/w" alpine:latest sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/state" "$WORK/backups"
cat >"$RR_COMPOSE" <<COMPOSE
name: $PROJECT
services:
  valkey:
    image: valkey/valkey:8.1-alpine
    command: ["valkey-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 10
    volumes:
      - valkey_data:/data
  api:
    image: alpine:latest
    command: ["sh", "-c", "while true; do sleep 1; done"]
    environment:
      SCHEDULERS_ENABLED: "false"
      SERVICE_RECORD_AUTO_FINALIZE_ENABLED: "false"
      CONTRACT_AUTO_FINALIZE_ENABLED: "false"
      EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED: "false"
      EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: "false"
      EFORMSIGN_RECONCILE_ALLOW_UNLOCKED: "false"
      MESSAGE_TRIGGER_JOBS_WORKER_ENABLED: "false"
    healthcheck:
      test: ["CMD", "true"]
      interval: 2s
      timeout: 2s
      retries: 3
    restart: unless-stopped
volumes:
  valkey_data:
    name: $VOLUME
COMPOSE
docker compose -p "$PROJECT" -f "$RR_COMPOSE" up -d >/dev/null
for _ in $(seq 1 30); do
    [[ "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter health=healthy | wc -l)" == 2 ]] && break
    sleep 1
done
COPY="$WORK/operator-copy.sh"
sed '$d' "$OPERATOR" >"$COPY"
# shellcheck disable=SC1090
source "$COPY"

fail() { echo "REALRUN FAIL: $*" >&2; exit 1; }
ok() { echo "ok - $*"; }

# Seams: only identities and the production readiness/state checks are replaced.
VR_PROJECT=$PROJECT
VR_VOLUME=$VOLUME
VR_MARKER="$WORK/state/valkey-restore-fence"
VR_REPLACED_ROOT="$WORK/replaced"
VR_ATTEMPTS=60
vr_reopen_decision() { VR_REOPEN_MODE=passive; VR_REOPEN_REASON=""; }
vr_reopen_wait_ready() { # health of the stand-in API container
    local cid attempt
    for attempt in $(seq 1 30); do
        cid="$(vr_service_containers api running || true)"
        [[ -n "$cid" && "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" == healthy ]] && return 0
        sleep 1
    done
    return 1
}
vr_reopen_status() { echo "stand_in_api=healthy"; }
lease_status_fields() { printf 'lease_mode=unknown\nlease_held=unknown\n'; }
read_state() { [[ "$1" == current-image-tag ]] && { printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; return 0; }; return 1; }

VC="$(docker ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=valkey)"
AC="$(docker ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=api)"
cli() { docker exec "$VC" valkey-cli --raw "$@" | tr -d '\r'; }
run_id() { docker exec "$VC" valkey-cli --raw INFO server | tr -d '\r' | awk -F: '$1=="run_id"{print $2}'; }
running() { [[ "$(docker inspect --format '{{.State.Running}}' "$1")" == true ]]; }
get() { cli GET "$1"; }

# ---- seed the dataset that the backups will capture
cli SET plan:a 1 >/dev/null; cli SET plan:b 2 >/dev/null; cli HSET h:1 f v >/dev/null
cli SET volatile:x y EX 3600 >/dev/null
cli XADD realtime:entity-changes 1000-1 e one >/dev/null
cli XADD realtime:entity-changes 1000-2 e two >/dev/null
cli SAVE >/dev/null
docker cp "$VC:/data/dump.rdb" "$WORK/backups/backup.rdb"
cli BGREWRITEAOF >/dev/null
for _ in $(seq 1 30); do [[ "$(cli INFO persistence | awk -F: '$1=="aof_rewrite_in_progress"{print $2}')" == 0 ]] && break; sleep 1; done
sleep 1
docker cp "$VC:/data/appendonlydir" "$WORK/backups/aof-backup"
chmod -R a+rX "$WORK/backups"
# ---- diverge after the backups
cli SET plan:c 3 >/dev/null; cli DEL plan:a >/dev/null
cli XADD realtime:entity-changes 2000-1 e three >/dev/null
OLD_RUN="$(run_id)"
[[ "$(cli XINFO STREAM realtime:entity-changes | grep -A1 '^last-generated-id$' | tail -1)" == 2000-1 ]] || fail "seed stream"
ok "seeded; live dataset diverged from the backups (old run_id $OLD_RUN)"

# ---- 1. missing --confirm-fence is refused and nothing is touched
if ( valkey_restore "$WORK/backups/backup.rdb" ) >/dev/null 2>"$WORK/out.err"; then fail "restore ran without --confirm-fence"; fi
grep -q -- '--confirm-fence' "$WORK/out.err" || fail "missing-flag message"
running "$AC" && running "$VC" && [[ "$(run_id)" == "$OLD_RUN" ]] || fail "missing flag touched containers"
[[ ! -e "$VR_MARKER" ]] || fail "marker written without the flag"
ok "missing flag: refused, API and Valkey untouched, no marker"

# ---- 2. the naive copy: RDB beside a live appendonlydir is shadowed (fingerprint mismatch)
( vr_resolve_target; vr_inspect_backup "$WORK/backups/backup.rdb"; VR_STAMP=naive-$$; vr_backup_fingerprint; printf '%s\n' "$VR_EXPECTED_FP" >"$WORK/rdb.fp" )
cat "$WORK/rdb.fp" | sed 's/^/   expected: /'
grep -q '^stream_last_id=1000-2$' "$WORK/rdb.fp" || fail "backup fingerprint should end at 1000-2"
docker stop "$AC" >/dev/null; docker stop -t 60 "$VC" >/dev/null
docker run --rm --network none --user 0 --entrypoint sh -v $VOLUME:/data -v "$WORK/backups/backup.rdb:/b/dump.rdb:ro" valkey/valkey:8.1-alpine -c 'cp /b/dump.rdb /data/dump.rdb && chown valkey:valkey /data/dump.rdb'
docker start "$VC" >/dev/null; sleep 3
NAIVE_FP="$(vr_fingerprint "$VC")"
if vr_fingerprint_matches "$(cat "$WORK/rdb.fp")" "$NAIVE_FP" 2>"$WORK/naive.err"; then fail "naive copy matched the fingerprint"; fi
cat "$WORK/naive.err" | sed 's/^/   /'
ok "AOF shadows RDB: the naive copy loads the OLD dataset and the fingerprint rejects it"
docker start "$AC" >/dev/null

# ---- 3. an injected failure mid-restore leaves the API stopped and the fence in place
vr_stage_data_real=$(declare -f vr_stage_data)
eval "${vr_stage_data_real/vr_stage_data/vr_stage_data_orig}"
vr_stage_data() { [[ "$1" != "$VR_VOLUME" ]] || return 1; vr_stage_data_orig "$@"; }
if ( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out.txt" 2>"$WORK/err.txt"; then fail "restore succeeded with a failing stage"; fi
eval "$vr_stage_data_real"
[[ -e "$VR_MARKER" ]] || fail "marker missing after a failed restore"
! running "$AC" || fail "API running while fenced"
grep -q 'INTERRUPTED at stage' "$WORK/err.txt" || fail "no recovery text"
ok "failed staging: marker kept (stage $(vr_marker_get stage)), API stopped, recovery instructions printed"
sed 's/^/   /' "$WORK/err.txt" | head -6

# ---- 4. start paths refuse while fenced (positive: allowed after clear checked in stub tests)
if ( deploy_release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ) >/dev/null 2>&1; then fail "deploy ran while fenced"; fi
ok "deploy refused while fenced"

# ---- 4b. a real SIGTERM in the middle of the restore leaves the same fenced state
vr_stage_data() { if [[ "$1" == "$VR_VOLUME" ]]; then sleep 60 & wait $!; fi; vr_stage_data_orig "$@"; }
( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out6.txt" 2>"$WORK/err6.txt" &
SPID=$!
for _ in $(seq 1 120); do grep -q "kept the replaced data" "$WORK/err6.txt" 2>/dev/null && break; sleep 0.5; done
kill -TERM "$SPID"; RC6=0; wait "$SPID" || RC6=$?
[[ "$RC6" == 143 ]] || fail "SIGTERM should exit 143, got $RC6"
[[ -e "$VR_MARKER" ]] && ! running "$AC" || fail "SIGTERM left an unfenced state"
grep -q 'INTERRUPTED at stage' "$WORK/err6.txt" || fail "no recovery text after SIGTERM"
ok "SIGTERM mid-restore: exit 143, marker kept (stage $(vr_marker_get stage)), API stopped, recovery text printed"
eval "$vr_stage_data_real"

# ---- 5. re-run from the fenced state with the real stage: RDB restore completes
( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out.txt" 2>"$WORK/err.txt" || { cat "$WORK/err.txt"; fail "RDB restore re-run failed"; }
sed 's/^/   /' "$WORK/out.txt"
NEW_RUN="$(run_id)"
[[ "$NEW_RUN" != "$OLD_RUN" ]] || fail "run_id unchanged"
[[ "$(get plan:a)" == 1 && "$(get plan:b)" == 2 && -z "$(get plan:c)" ]] || fail "dataset not rolled back"
[[ "$(cli XINFO STREAM realtime:entity-changes | grep -A1 '^last-generated-id$' | tail -1)" == 1000-2 ]] || fail "stream not rolled back"
[[ "$(cli INFO persistence | awk -F: '$1=="aof_enabled"{print $2}')" == 1 ]] || fail "aof not enabled"
docker run --rm --network none -v $VOLUME:/data:ro --entrypoint sh valkey/valkey:8.1-alpine -c 'ls -ln /data /data/appendonlydir' | sed 's/^/   /'
! running "$AC" || fail "API running before reopen"
[[ "$(vr_marker_get stage)" == verified ]] || fail "stage not verified"
ls "$VR_REPLACED_ROOT"/*/ >/dev/null || fail "no replaced-data copy"
ok "RDB restore: new run_id $NEW_RUN, data rolled back to the backup, AOF enabled, API still stopped, replaced data kept"

# ---- 6. idempotent re-run when already verified
( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out2.txt" 2>"$WORK/err2.txt" || fail "verified re-run failed"
grep -q 'already restored and verified' "$WORK/err2.txt" || fail "verified re-run did not short-circuit"
[[ "$(run_id)" == "$NEW_RUN" ]] || fail "verified re-run restarted Valkey"
ok "re-run from verified state is a no-op"

# ---- 7. reopen
( valkey_restore --reopen --confirm-reopen ) >"$WORK/out3.txt" 2>"$WORK/err3.txt" || { cat "$WORK/err3.txt"; fail "reopen failed"; }
sed 's/^/   /' "$WORK/out3.txt"
running "$AC" || fail "API not started"
[[ ! -e "$VR_MARKER" ]] || fail "marker not cleared"
ok "reopen: API started (same container), marker cleared"

# ---- 8. AOF backup restore after more divergence
cli SET plan:d 4 >/dev/null; cli XADD realtime:entity-changes 3000-1 e four >/dev/null
RUN2="$(run_id)"
( valkey_restore "$WORK/backups/aof-backup" --confirm-fence ) >"$WORK/out4.txt" 2>"$WORK/err4.txt" || { cat "$WORK/err4.txt"; fail "AOF restore failed"; }
sed 's/^/   /' "$WORK/out4.txt"
[[ "$(run_id)" != "$RUN2" ]] || fail "run_id unchanged after AOF restore"
[[ -z "$(get plan:d)" && "$(get plan:b)" == 2 ]] || fail "AOF dataset wrong"
[[ "$(cli XINFO STREAM realtime:entity-changes | grep -A1 '^last-generated-id$' | tail -1)" == 1000-2 ]] || fail "AOF stream wrong"
! running "$AC" || fail "API running before reopen (AOF)"
ok "AOF restore: new run_id, data rolled back, API stopped"

# ---- 9. abort path
( valkey_restore --abort --confirm-fence ) >"$WORK/out5.txt" 2>&1 || fail "abort failed"
[[ ! -e "$VR_MARKER" ]] && ! running "$AC" || fail "abort state wrong"
ok "abort: marker cleared, API stays stopped"

echo "REALRUN PASSED"
