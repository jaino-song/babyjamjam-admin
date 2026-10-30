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
# `/usr/bin/mv` becomes `vr_mv` in the copy (a seam for the F4 injection; by default exactly /usr/bin/mv).
sed -e '$d' -e 's#/usr/bin/mv -f#vr_mv -f#' "$OPERATOR" >"$COPY"
# shellcheck disable=SC1090
source "$COPY"

fail() { echo "REALRUN FAIL: $*" >&2; exit 1; }
ok() { echo "ok - $*"; }

MV_TERM=0
vr_mv() { # F4: TERM right after the marker's atomic rename, while the snapshot is still pending
    /usr/bin/mv "$@"
    if [[ "$MV_TERM" == 1 && -n "$VR_PENDING_SNAPSHOT" && "${*: -1}" == "$VR_MARKER" ]]; then MV_TERM=0; kill -TERM "$BASHPID"; fi
}

# Seams: only identities and the production readiness/state checks are replaced.
VR_PROJECT=$PROJECT
VR_VOLUME=$VOLUME
VR_MARKER="$WORK/state/valkey-restore-fence"
VR_REPLACED_ROOT="$WORK/replaced"
VR_SNAPSHOT_ROOT="$WORK/snapshots"
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
# a value-only variant: same keys, same types, same stream ids, different value of plan:b
cli SET plan:b TAMPERED >/dev/null; cli SAVE >/dev/null
docker cp "$VC:/data/dump.rdb" "$WORK/backups/value-swapped.rdb"
cli SET plan:b 2 >/dev/null
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
( vr_resolve_target; vr_source_check "$WORK/backups/backup.rdb"; VR_STAMP=naive-$$; vr_snapshot_take; vr_backup_fingerprint; printf '%s\n' "$VR_EXPECTED_FP" >"$WORK/rdb.fp" )
vr_snapshot_purge
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

# ---- 2b. F4: a real SIGTERM right after the marker adopted the snapshot must not delete it
MV_TERM=1; RC2B=0
( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out2b.txt" 2>"$WORK/err2b.txt" || RC2B=$?
MV_TERM=0
[[ "$RC2B" == 143 ]] || { cat "$WORK/err2b.txt"; fail "F4: expected exit 143, got $RC2B"; }
[[ -e "$VR_MARKER" ]] || fail "F4: the marker is missing"
SNAP2B="$(vr_marker_get snapshot_dir)"
[[ -d "$SNAP2B" && -f "$SNAP2B/dump.rdb" ]] || fail "F4: the snapshot the marker references was deleted ($SNAP2B)"
! running "$AC" || fail "F4: the API is running while fenced"
grep -Fq 'INTERRUPTED at stage' "$WORK/err2b.txt" || fail "F4: no recovery text"
( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out2c.txt" 2>"$WORK/err2c.txt" || { cat "$WORK/err2c.txt"; fail "F4: the printed resume command failed"; }
[[ "$(vr_marker_get stage)" == verified ]] || fail "F4: the resumed restore is not verified"
ok "F4: SIGTERM after the marker adopted the snapshot: snapshot kept, same command resumed to verified"
( valkey_restore --abort --confirm-fence ) >/dev/null 2>&1 || fail "F4: abort failed"
[[ ! -e "$VR_MARKER" ]] || fail "F4: marker left"
docker start "$AC" >/dev/null
OLD_RUN="$(run_id)"

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

# ---- 7b. F1: the operator input is swapped (same keys/types/stream ids, different VALUE of plan:b)
#          after the preflight and after the last hash, i.e. while the replaced data is being kept.
#          The fingerprint cannot see a value-only change; the byte binding must.
cli SET plan:z 9 >/dev/null
cp "$WORK/backups/backup.rdb" "$WORK/operator-input.rdb"; chmod a+r "$WORK/operator-input.rdb"
APPROVED_SHA="$(sha256sum "$WORK/backups/backup.rdb" | cut -d' ' -f1)"
[[ "$(sha256sum "$WORK/backups/value-swapped.rdb" | cut -d' ' -f1)" != "$APPROVED_SHA" ]] || fail "fixture: the value-swapped RDB must differ"
vr_copy_replaced_real=$(declare -f vr_copy_replaced)
eval "${vr_copy_replaced_real/vr_copy_replaced/vr_copy_replaced_orig}"
vr_copy_replaced() { cp "$WORK/backups/value-swapped.rdb" "$WORK/operator-input.rdb"; vr_copy_replaced_orig "$@"; }
RUN3="$(run_id)"
( valkey_restore "$WORK/operator-input.rdb" --confirm-fence ) >"$WORK/out7b.txt" 2>"$WORK/err7b.txt" || { cat "$WORK/err7b.txt"; fail "value-swap restore failed"; }
eval "$vr_copy_replaced_real"
[[ "$(sha256sum "$WORK/operator-input.rdb" | cut -d' ' -f1)" != "$APPROVED_SHA" ]] || fail "the input was not swapped (the hook did not run)"
[[ "$(get plan:b)" == 2 ]] || fail "the swapped value was restored (plan:b=$(get plan:b)): the restore did not use the verified bytes"
[[ "$(get plan:b)" != TAMPERED && -z "$(get plan:z)" && "$(get plan:a)" == 1 ]] || fail "dataset is not the approved backup"
[[ "$(run_id)" != "$RUN3" && "$(vr_marker_get stage)" == verified && "$(vr_marker_get backup_digest)" == "$APPROVED_SHA" ]] || fail "marker / run_id after the value-swap restore"
ok "value-only swap after the last hash: the approved value (plan:b=2) was restored from the snapshot, not TAMPERED"
( valkey_restore --reopen --confirm-reopen ) >/dev/null 2>"$WORK/err7c.txt" || { cat "$WORK/err7c.txt"; fail "reopen after the value-swap restore failed"; }
running "$AC" || fail "API not started"

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

# ---- 9. F3: fenced rollback to the data the AOF restore replaced (plan:d=4, stream 3000-1),
#          with the fence held for the whole run and every start path refused meanwhile.
# (production runs as root and can read the kept copies; this harness is a plain user)
readable() { docker run --rm --network none -v "$1:/c" alpine:latest sh -c 'chmod -R a+rX /c' >/dev/null; }
KEPT_NEWEST="$VR_REPLACED_ROOT/$(ls -1 "$VR_REPLACED_ROOT" | tail -n 1)"
KEPT_OLDEST="$VR_REPLACED_ROOT/$(ls -1 "$VR_REPLACED_ROOT" | head -n 1)"
readable "$KEPT_NEWEST"; readable "$KEPT_OLDEST"
[[ -d "$KEPT_NEWEST/appendonlydir" && -d "$KEPT_OLDEST/appendonlydir" ]] || fail "kept copies missing"
RUN4="$(run_id)"
# 9a. outside the replaced-data root: refused, nothing touched
cp "$VR_MARKER" "$WORK/marker.before"
for bad in "$WORK/backups/backup.rdb" "$WORK/backups/aof-backup" "$KEPT_NEWEST" "$VR_REPLACED_ROOT/../backups/backup.rdb"; do
    if ( valkey_restore --rollback "$bad" --confirm-fence ) >/dev/null 2>"$WORK/err9a.txt"; then fail "rollback accepted '$bad'"; fi
    grep -q 'accepts only' "$WORK/err9a.txt" || fail "no explanation for '$bad'"
done
cmp -s "$VR_MARKER" "$WORK/marker.before" && [[ "$(run_id)" == "$RUN4" ]] && running "$VC" && ! running "$AC" || fail "a refused rollback touched something"
ok "rollback outside valkey-replaced: refused, marker/Valkey/API untouched"
# 9b. rollback to the newest kept copy, with a poller proving the marker never disappears and start paths stay refused
rm -f "$WORK/poll.missing" "$WORK/poll.allowed"
( valkey_restore --rollback "$KEPT_NEWEST/appendonlydir" --confirm-fence ) >"$WORK/out9.txt" 2>"$WORK/err9.txt" &
RPID=$!
while kill -0 "$RPID" 2>/dev/null; do
    [[ -e "$VR_MARKER" ]] || echo missing >>"$WORK/poll.missing"
    if ( refuse_if_valkey_restore_fenced ) >/dev/null 2>&1; then echo allowed >>"$WORK/poll.allowed"; fi
    sleep 0.1
done
wait "$RPID" || { cat "$WORK/err9.txt"; fail "rollback failed"; }
[[ ! -e "$WORK/poll.missing" && ! -e "$WORK/poll.allowed" ]] || fail "the fence was missing or a start path was allowed during the rollback"
sed 's/^/   /' "$WORK/out9.txt"
[[ "$(run_id)" != "$RUN4" ]] || fail "run_id unchanged after the rollback"
[[ "$(get plan:d)" == 4 && "$(get plan:b)" == 2 ]] || fail "rollback did not bring back the replaced data"
[[ "$(cli XINFO STREAM realtime:entity-changes | grep -A1 '^last-generated-id$' | tail -1)" == 3000-1 ]] || fail "rollback stream wrong"
[[ "$(vr_marker_get stage)" == verified && "$(vr_marker_get mode)" == rollback && -e "$VR_MARKER" ]] && ! running "$AC" || fail "rollback must end verified, fenced, API stopped"
[[ "$(ls "$VR_SNAPSHOT_ROOT" | wc -l)" -eq 1 ]] || fail "superseded snapshot not dropped"
ok "rollback to the replaced data: new run_id, plan:d=4 and stream 3000-1 are back, fence held throughout, start paths refused meanwhile"
# 9c. an injected staging failure in a second rollback leaves the same fenced state; the same command then completes
vr_stage_data_real2=$(declare -f vr_stage_data)
eval "${vr_stage_data_real2/vr_stage_data/vr_stage_data_orig2}"
vr_stage_data() { [[ "$1" != "$VR_VOLUME" ]] || return 1; vr_stage_data_orig2 "$@"; }
if ( valkey_restore --rollback "$KEPT_OLDEST/appendonlydir" --confirm-fence ) >"$WORK/out9c.txt" 2>"$WORK/err9c.txt"; then fail "rollback succeeded with a failing stage"; fi
eval "$vr_stage_data_real2"
[[ -e "$VR_MARKER" && "$(vr_marker_get mode)" == rollback && "$(vr_marker_get stage)" != verified ]] && ! running "$AC" || fail "failed rollback left an unfenced/verified state"
grep -Fq -- "Resume (idempotent): valkey-restore --rollback '$KEPT_OLDEST/appendonlydir' --confirm-fence" "$WORK/err9c.txt" || fail "no rollback resume instruction"
( valkey_restore --rollback "$KEPT_OLDEST/appendonlydir" --confirm-fence ) >"$WORK/out9d.txt" 2>"$WORK/err9d.txt" || { cat "$WORK/err9d.txt"; fail "rollback resume failed"; }
[[ "$(get plan:c)" == 3 && -z "$(get plan:a)" ]] || fail "second rollback did not bring back the oldest kept data"
[[ "$(vr_marker_get stage)" == verified ]] && ! running "$AC" || fail "second rollback not verified/fenced"
ok "failed rollback: stays fenced, resumes with the same command, oldest kept copy restored"

# ---- 9d. F2: a real SIGTERM after the API was started and before it is ready (the reviewer's
#          reproduction). The exit path must stop the real container and confirm it; the old code
#          left it running and printed "backend stays stopped".
vr_reopen_wait_ready_real=$(declare -f vr_reopen_wait_ready)
vr_reopen_wait_ready() { running "$AC" && : >"$WORK/f2.started"; kill -TERM "$BASHPID"; }
rm -f "$WORK/f2.started"; RC9D=0
( valkey_restore --reopen --confirm-reopen ) >"$WORK/out9d2.txt" 2>"$WORK/err9d2.txt" || RC9D=$?
eval "$vr_reopen_wait_ready_real"
[[ -e "$WORK/f2.started" ]] || fail "F2 fixture: the API container was never started before the signal"
[[ "$RC9D" == 143 ]] || fail "F2: SIGTERM during reopen should exit 143, got $RC9D"
! running "$AC" || fail "F2: the API container is still running after the interrupted reopen"
[[ -e "$VR_MARKER" && "$(vr_marker_get stage)" == reopening ]] || fail "F2: the marker must stay at stage reopening"
grep -Fq 'The backend stays stopped (confirmed' "$WORK/err9d2.txt" && ! grep -Fq 'MAY BE RUNNING' "$WORK/err9d2.txt" || { cat "$WORK/err9d2.txt"; fail "F2: the recovery text must report a confirmed stop"; }
if ( deploy_release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ) >/dev/null 2>&1; then fail "F2: deploy ran while fenced"; fi
ok "SIGTERM after the API start: exit 143, the real container was stopped and confirmed, marker kept at stage reopening"
sed 's/^/   /' "$WORK/err9d2.txt" | head -3

# ---- 9e. F2: abort while the API is (still) running must stop it before the marker goes
docker start "$AC" >/dev/null
running "$AC" || fail "F2 fixture: the API container should be running"
( valkey_restore --abort --confirm-fence ) >"$WORK/out9e.txt" 2>"$WORK/err9e.txt" || { cat "$WORK/err9e.txt"; fail "abort with a running API failed"; }
! running "$AC" && [[ ! -e "$VR_MARKER" && ! -e "$VR_SNAPSHOT_ROOT" ]] || fail "F2: abort left the API running or the fence behind"
grep -Fqx 'api_stopped_confirmed=true' "$WORK/out9e.txt" || fail "F2: abort did not report a confirmed stop"
ok "abort with the API running: the real container was stopped and confirmed, then the marker and snapshot were removed"
# rebuild a fenced, verified state for the final abort below
( valkey_restore "$WORK/backups/backup.rdb" --confirm-fence ) >"$WORK/out9f.txt" 2>"$WORK/err9f.txt" || { cat "$WORK/err9f.txt"; fail "restore before the final abort failed"; }
[[ -e "$VR_MARKER" ]] || fail "F2 fixture: no fence before the final abort"

# ---- 10. abort path
( valkey_restore --abort --confirm-fence ) >"$WORK/out5.txt" 2>&1 || fail "abort failed"
[[ ! -e "$VR_MARKER" ]] && ! running "$AC" && [[ ! -e "$VR_SNAPSHOT_ROOT" ]] || fail "abort state wrong"
ok "abort: marker and snapshot cleared, API stays stopped"

echo "REALRUN PASSED"
