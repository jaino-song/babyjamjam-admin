#!/usr/bin/env bash
# Behavioural contract for the fenced Valkey restore (operator `valkey-restore`).
# Like operator.behavior.test.sh it sources a copy of operator.sh with its
# entrypoint removed and never reaches real Docker, systemd or Valkey: `vr_docker`
# is replaced by a small stateful fake (api/valkey containers, a run_id that
# changes on every Valkey start, scripted fingerprints). The real-process run
# against disposable containers is operator.valkey-restore.realrun.sh (manual).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
COPY="$TMP/operator.sh"
sed '$d' "$ROOT/operator.sh" >"$COPY"
# shellcheck disable=SC1090
source "$COPY"
fail(){ echo "FAIL: $*" >&2; exit 1; }

API=aaaaaaaaaaaa
VALKEY=bbbbbbbbbbbb
TAG="$(printf '1%.0s' {1..40})"
NOW=1800000000
FP_BACKUP=$'persistent_keys=4\ndbsize=5\nother_dbs=0\nstream_last_id=1000-2\nsample_count=4\nsample_sha256='"$(printf 'a%.0s' {1..64})"
FP_OLD=$'persistent_keys=7\ndbsize=8\nother_dbs=0\nstream_last_id=2000-1\nsample_count=7\nsample_sha256='"$(printf 'b%.0s' {1..64})"

# ---- fixtures: an RDB, a multi-part AOF directory and unsupported things
printf 'REDIS0011\xfa\x09redis-ver\x058.1.11' >"$TMP/backup.rdb"
mkdir -p "$TMP/aof"
printf 'file appendonly.aof.1.base.rdb seq 1 type b\n' >"$TMP/aof/appendonly.aof.manifest"
printf 'REDIS0011' >"$TMP/aof/appendonly.aof.1.base.rdb"
printf 'REDIS0011\xfa\x09redis-ver\x058.1.11-DIFFERENT-VALUE' >"$TMP/evil.rdb"   # same shape, different bytes
printf 'not a dump\n' >"$TMP/garbage.rdb"
mkdir -p "$TMP/noman"; printf x >"$TMP/noman/appendonly.aof.1.base.rdb"
ln -s "$TMP/backup.rdb" "$TMP/link.rdb"
: >"$TMP/empty.rdb"

# ---- the fake world
WORLD_N=0
world_reset() {
    WORLD_N=$((WORLD_N + 1))
    W="$TMP/world-$WORLD_N"; mkdir -p "$W/state" "$W/replaced"
    VR_PROJECT=tproj; VR_VOLUME=tvolume; VR_ATTEMPTS=3
    VR_MARKER="$W/state/valkey-restore-fence"; VR_REPLACED_ROOT="$W/replaced"; VR_SNAPSHOT_ROOT="$W/snapshots"
    printf 1 >"$W/api_running"; printf 1 >"$W/valkey_running"
    printf 0 >"$W/runs"; printf 'run-0' >"$W/run_id"; printf master >"$W/role"
    printf '%s' "$FP_BACKUP" >"$W/fp_backup"        # what the backup is
    printf '%s' "$FP_OLD" >"$W/fp_live"             # what the live Valkey holds now
    printf '%s' "$FP_BACKUP" >"$W/fp_after_start"   # what a correct restore yields
    : >"$W/docker.log"; : >"$W/hooks.log"
    : >"$W/marker_trace"; : >"$W/probe"; rm -rf "$W/vol" "$W/hook_done"
    HOOK_ON=""; HOOK_CMD=""; STAGE_CORRUPT=0
    FAIL=""; printf 0 >"$W/fail_skip"; NO_BUMP=0
    READY_FAIL=0; STATUS_FAIL=0
    RT_MODE=""; RT_EXPIRY=""; RT_TAG="$TAG"; RT_PERSISTENT=0; RT_MASKS=1; RT_TIMER=1; RT_CLASS=active
}
state_of() { case "$1" in "$API") cat "$W/api_running";; "$VALKEY") cat "$W/valkey_running";; *) echo 0;; esac; }
vr_docker() {
    local arg svc="" all=0 id fmt c skip prev="" vol="" src="" dst="" form
    printf '%s\n' "$*" >>"$W/docker.log"
    if [[ -e "$VR_MARKER" ]]; then echo 1 >>"$W/marker_trace"; else echo 0 >>"$W/marker_trace"; fi
    # One-shot hook: lets a test change the world at an exact docker call.
    if [[ -n "${HOOK_ON:-}" && "$*" == *"$HOOK_ON"* && ! -e "$W/hook_done" ]]; then
        : >"$W/hook_done"; eval "$HOOK_CMD"
    fi
    if [[ -n "$FAIL" && "$*" == *"$FAIL"* ]]; then
        skip="$(cat "$W/fail_skip")"
        if (( skip > 0 )); then printf '%s' "$((skip - 1))" >"$W/fail_skip"; else return 1; fi
    fi
    case "$1" in
        ps)
            [[ "$2" == -aq ]] && all=1
            for arg in "$@"; do [[ "$arg" == label=com.docker.compose.service=* ]] && svc="${arg##*=}"; done
            case "$svc" in
                api) if (( all )) || [[ "$(cat "$W/api_running")" == 1 ]]; then echo "$API"; fi ;;
                valkey) if (( all )) || [[ "$(cat "$W/valkey_running")" == 1 ]]; then echo "$VALKEY"; fi ;;
            esac ;;
        inspect)
            fmt="$3"; id="${*: -1}"
            case "$fmt" in
                *State.Running*) [[ "$(state_of "$id")" == 1 ]] && echo true || echo false ;;
                *Mounts*) echo "$VR_VOLUME" ;;
                *'{{.Image}}'*) echo "sha256:$(printf 'c%.0s' {1..64})" ;;
            esac ;;
        stop) id="${*: -1}"; case "$id" in "$API") printf 0 >"$W/api_running";; "$VALKEY") printf 0 >"$W/valkey_running";; esac ;;
        start)
            case "$2" in
                "$API") printf 1 >"$W/api_running" ;;
                "$VALKEY")
                    printf 1 >"$W/valkey_running"
                    if [[ "$NO_BUMP" != 1 ]]; then
                        printf '%s' "$(( $(cat "$W/runs") + 1 ))" >"$W/runs"; printf 'run-%s' "$(cat "$W/runs")" >"$W/run_id"
                    fi
                    cp "$W/fp_after_start" "$W/fp_live" ;;
            esac ;;
        exec)
            c="$2"; shift 2
            if [[ "$c" != *-vr-* && "$(state_of "$c")" != 1 ]]; then return 1; fi
            if [[ "$1" == sh ]]; then
                if [[ "$c" == *-vr-fp-* ]]; then cat "$W/fp_backup"; else cat "$W/fp_live"; fi
                return 0
            fi
            shift 2
            case "$*" in
                PING) printf 'PONG\r\n' ;;
                "INFO server") printf 'redis_version:8.1.11\r\nrun_id:%s\r\n' "$(cat "$W/run_id")" ;;
                "INFO replication") printf 'role:%s\r\nmaster_replid:replid-%s\r\n' "$(cat "$W/role")" "$(cat "$W/runs")" ;;
                "INFO persistence") printf 'loading:0\r\naof_enabled:1\r\naof_rewrite_in_progress:0\r\naof_rewrite_scheduled:0\r\naof_last_bgrewrite_status:ok\r\n' ;;
                "CONFIG SET appendonly yes") printf 'OK\r\n' ;;
            esac ;;
        volume) [[ "$2" == ls ]] || true ;;
        run)
            case "$*" in
                *:/backup/dump.rdb:ro*|*:/backup/appendonlydir:ro*)
                    # staging: the data volume ends up holding exactly what was mounted
                    for arg in "$@"; do
                        if [[ "$prev" == -v ]]; then
                            case "$arg" in
                                *:/data) vol="${arg%:/data}" ;;
                                *:/backup/*:ro) src="${arg%%:/backup/*}"; dst="${arg##*:/backup/}"; dst="${dst%:ro}" ;;
                            esac
                        fi
                        prev="$arg"
                    done
                    if [[ "$vol" == "$VR_VOLUME" ]]; then
                        rm -rf "$W/vol"; mkdir -p "$W/vol"; cp -R "$src" "$W/vol/$dst"
                        if [[ "$STAGE_CORRUPT" == 1 ]]; then
                            if [[ -f "$W/vol/dump.rdb" ]]; then printf x >>"$W/vol/dump.rdb"; else printf x >>"$W/vol/appendonlydir/appendonly.aof.1.base.rdb"; fi
                        fi
                    fi ;;
                *sha256sum*)
                    # read-back of the staged volume
                    form="${*: -1}"
                    if [[ "$form" == rdb ]]; then sha256sum "$W/vol/dump.rdb" | cut -d' ' -f1; else vr_tree_digest "$W/vol/appendonlydir"; fi ;;
            esac ;;
        rm) : ;;
    esac
    return 0
}
vr_sleep() { :; }
current_unix_time() { echo "$NOW"; }
runtime_env_for() {
    local key
    if [[ "$RT_CLASS" == active ]]; then
        for key in "${ACTIVE_TRUE_ENV_KEYS[@]}"; do echo "$key=true"; done
        echo EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=false; echo MESSAGE_TRIGGER_JOBS_WORKER_ENABLED=false
    else
        for key in "${PASSIVE_ENV_KEYS[@]}"; do echo "$key=false"; done
    fi
}
read_state() {
    local v=""
    case "$1" in runtime-mode) v="$RT_MODE";; temporary-active-expiry) v="$RT_EXPIRY";; current-image-tag) v="$RT_TAG";; esac
    [[ -n "$v" ]] || return 1
    printf '%s\n' "$v"
}
automatic_shutdown_disabled() { [[ "$RT_PERSISTENT" == 1 ]]; }
verify_shutdown_masks() { [[ "$RT_MASKS" == 1 ]]; }
vr_expiry_timer_active() { [[ "$RT_TIMER" == 1 ]]; }
vr_reopen_wait_ready() { echo "ready:$1" >>"$W/hooks.log"; [[ "$READY_FAIL" != 1 ]]; }
vr_reopen_status() { echo "hook:status" >>"$W/hooks.log"; [[ "$STATUS_FAIL" != 1 ]] && echo status_block=ok; }
lease_status_fields() { printf 'lease_mode=required\nlease_held=true\n'; }

# set -e must stay ON inside the unit under test, as in production.
run() { set +e; ( set -e; "$@" ) >"$W/out" 2>"$W/err"; RC=$?; set -e; }
log_has() { grep -Fq -- "$1" "$W/docker.log"; }
log_count() { grep -Fc -- "$1" "$W/docker.log" || true; }
log_line() { grep -Fn -m1 -- "$1" "$W/docker.log" | cut -d: -f1; }
assert_order() {
    local a b first second
    first="$(log_line "$1")"; second="$(log_line "$2")"
    [[ -n "$first" && -n "$second" && "$first" -lt "$second" ]] || fail "expected '$1' before '$2' in the docker calls"
}
marker_stage() { VR_MARKER="$VR_MARKER" vr_marker_get stage; }
api_up() { [[ "$(cat "$W/api_running")" == 1 ]]; }
assert_fenced_and_down() {
    [[ -e "$VR_MARKER" ]] || fail "$1: the fence marker is missing"
    api_up && fail "$1: the API is running while fenced"
    log_has "start $API" && fail "$1: the API was started"
    [[ "$(marker_stage)" != verified ]] || fail "$1: the stage claims verified"
    grep -q 'INTERRUPTED at stage' "$W/err" || fail "$1: no resume/rollback text was printed"
    return 0
}


# ---- shared helpers
want() { [[ -z "${VR_TEST_SECTION:-}" || "$VR_TEST_SECTION" == "$1" ]]; }
verified_world() { world_reset; run valkey_restore "$TMP/backup.rdb" --confirm-fence; [[ "$RC" == 0 ]] || fail "setup: restore"; : >"$W/docker.log"; }
expect_started() {
    [[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "$1: reopen failed (rc $RC)"; }
    [[ "$(log_count "start $API")" == 1 ]] || fail "$1: the API container should be started exactly once"
    log_has " up " && fail "$1: reopen must not use compose up"
    log_has "compose" && fail "$1: reopen must not go through compose"
    [[ ! -e "$VR_MARKER" ]] || fail "$1: the marker should be cleared"
    grep -Fq "reopen_mode=$2" "$W/out" && grep -Fqx 'api_started=true' "$W/out" || fail "$1: summary missing"
    grep -Fqx 'lease_mode=required' "$W/out" || fail "$1: the lease observation should be printed"
    grep -Fq "ready:$TAG" "$W/hooks.log" && grep -Fq 'hook:status' "$W/hooks.log" || fail "$1: readiness and status verification did not run"
}
expect_not_started() {
    [[ "$RC" -ne 0 ]] || fail "$1: reopen should not succeed"
    log_has "start $API" && fail "$1: the API must not be started"
    [[ ! -e "$VR_MARKER" ]] || fail "$1: the verified restore should release the fence"
    grep -q 'NOT started' "$W/err" && grep -q "$2" "$W/err" || { cat "$W/err" >&2; fail "$1: the message should name the normal flow ($2)"; }
}
first_call() { # function that is the first thing each start path calls after the guard
    case "$1" in
        adopt_persistent_active_release) automatic_shutdown_disabled() { echo reached >>"$W/reached"; exit 99; } ;;
        rollback_release) refuse_active_or_unknown_runtime() { echo reached >>"$W/reached"; exit 99; } ;;
        *) validate_release() { echo reached >>"$W/reached"; exit 99; } ;;
    esac
}
try_start_path() { first_call "$1"; "$1" "$TAG" "sha256:$(printf 'd%.0s' {1..64})"; }
START_PATHS=(deploy_release temporary_activate_release replace_temporary_active_release \
             extend_temporary_active_release adopt_persistent_active_release rollback_release)
# every start path, run (in its own subshell) against the CURRENT world; one "fn:rc" line each
probe_start_paths() {
    local fn rc
    for fn in "${START_PATHS[@]}"; do
        if ( try_start_path "$fn" ) >/dev/null 2>&1; then rc=0; else rc=$?; fi
        echo "$fn:$rc" >>"$W/probe"
    done
}
sha_of() { sha256sum "$1" | cut -d' ' -f1; }
snapshot_dir_of_marker() { vr_marker_get snapshot_dir; }

if want legacy; then
# ===== 1. happy path, RDB backup: fence -> stop Valkey -> keep copy -> stage -> bootstrap -> convert to AOF -> normal start
world_reset
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "RDB restore failed (rc $RC)"; }
assert_order "stop $API" "stop -t 60 $VALKEY"
assert_order "stop -t 60 $VALKEY" "cp -a /data/. /copy/"
assert_order "cp -a /data/. /copy/" "-v tvolume:/data -v $W/snapshots/"
assert_order "-v tvolume:/data -v $W/snapshots/" "run -d --name tproj-vr-bootstrap"
assert_order "run -d --name tproj-vr-bootstrap" "CONFIG SET appendonly yes"
assert_order "CONFIG SET appendonly yes" "stop -t 60 tproj-vr-bootstrap"
assert_order "stop -t 60 tproj-vr-bootstrap" "start $VALKEY"
log_has "valkey-server --appendonly no --save" || fail "the RDB bootstrap must start with appendonly off"
log_has "chown valkey:valkey /data /data/dump.rdb" || fail "the staged RDB must be chowned to the valkey user"
log_has "start $API" && fail "restore must leave the API stopped"
log_has " up " && fail "restore must not use compose up"
[[ "$(marker_stage)" == verified && -e "$VR_MARKER" ]] || fail "restore must end verified and still fenced"
[[ "$(vr_marker_get old_run_id)" == run-0 && "$(vr_marker_get new_run_id)" == run-1 ]] || fail "run ids not recorded"
grep -Fqx 'valkey_restore=verified' "$W/out" && grep -Fqx 'fenced=true' "$W/out" || fail "restore summary missing"
[[ "$(ls "$W/replaced" | wc -l)" -eq 1 ]] || fail "the replaced data was not kept in a timestamped directory"
# the throwaway load happened BEFORE anything was stopped (preflight)
assert_order "run -d --name tproj-vr-fp-" "stop $API"
log_has "--network none" || fail "preflight must use a network-less container"
echo "ok - RDB happy path"

# ===== 2. happy path, AOF directory: replaced as a whole, no bootstrap, normal start
world_reset
run valkey_restore "$TMP/aof" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "AOF restore failed (rc $RC)"; }
log_has "/appendonlydir:/backup/appendonlydir:ro" && log_has "-v $W/snapshots/" || fail "AOF must be staged as a whole directory from the snapshot"
log_has "tproj-vr-bootstrap" && fail "an AOF restore needs no bootstrap"
log_has "valkey-check-aof" || fail "the AOF backup must pass the integrity check"
assert_order "-v tvolume:/data -v $W/snapshots/" "start $VALKEY"
[[ "$(marker_stage)" == verified ]] || fail "AOF restore not verified"
echo "ok - AOF happy path"

# ===== 3. confirmation flags: refused with nothing touched, and the positive direction
for args in "$TMP/backup.rdb" "--reopen" "--abort"; do
    world_reset
    # shellcheck disable=SC2086
    run valkey_restore $args
    [[ "$RC" -ne 0 ]] || fail "'$args' without its confirmation flag was accepted"
    [[ ! -s "$W/docker.log" && ! -e "$VR_MARKER" ]] || fail "'$args' without confirmation touched docker or wrote a marker"
    api_up || fail "'$args' without confirmation stopped the API"
done
world_reset; run valkey_restore --reopen --confirm-fence; [[ "$RC" -ne 0 && ! -s "$W/docker.log" ]] || fail "--reopen accepted the fence flag"
world_reset; run valkey_restore "$TMP/backup.rdb" --confirm-reopen; [[ "$RC" -ne 0 && ! -s "$W/docker.log" ]] || fail "restore accepted the reopen flag"
world_reset; run valkey_restore "$TMP/backup.rdb" --confirm-fence; [[ "$RC" == 0 ]] || fail "restore with its flag was refused"
echo "ok - confirmation flags"

# ===== 4. unsupported backups are refused in the preflight, before anything is stopped
for bad in "$TMP/garbage.rdb" "$TMP/empty.rdb" "$TMP/link.rdb" "$TMP/noman" "$TMP/missing" "relative.rdb"; do
    world_reset
    run valkey_restore "$bad" --confirm-fence
    [[ "$RC" -ne 0 ]] || fail "unsupported backup accepted: $bad"
    log_has "stop " && fail "unsupported backup stopped something: $bad"
    [[ ! -e "$VR_MARKER" ]] && api_up || fail "unsupported backup left a fence or stopped the API: $bad"
done
echo "ok - unsupported backups"

# ===== 5. preflight failures change nothing (no marker, API keeps running)
for pattern in "volume create" "valkey-check-rdb" "run -d --name tproj-vr-fp-"; do
    world_reset; FAIL="$pattern"
    run valkey_restore "$TMP/backup.rdb" --confirm-fence
    [[ "$RC" -ne 0 ]] || fail "preflight failure '$pattern' was ignored"
    [[ ! -e "$VR_MARKER" ]] && api_up || fail "preflight failure '$pattern' fenced or stopped the API"
done
echo "ok - preflight failures"

# ===== 6. every failure after the fence leaves the backend stopped and the fence in place
for rdb_point in \
    "stop -t 60 $VALKEY" "cp -a /data/. /copy/" "-v tvolume:/data -v $TMP/world-" \
    "run -d --name tproj-vr-bootstrap" "CONFIG SET appendonly yes" "start $VALKEY" \
    "exec $VALKEY valkey-cli --raw PING"; do
    world_reset; FAIL="$rdb_point"
    run valkey_restore "$TMP/backup.rdb" --confirm-fence
    [[ "$RC" -ne 0 ]] || fail "failure at '$rdb_point' was ignored"
    assert_fenced_and_down "failure at '$rdb_point'"
done
# the fence-stage failure itself: the marker is written BEFORE the API is stopped
world_reset; FAIL="stop $API"
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] || fail "a failing API stop must still leave the marker"
[[ "$(marker_stage)" == fencing ]] || fail "the fence stage should be 'fencing' after a failed stop"
# an integrity-check failure on the AOF path
world_reset; FAIL="valkey-check-aof"
run valkey_restore "$TMP/aof" --confirm-fence
[[ "$RC" -ne 0 && ! -e "$VR_MARKER" ]] && api_up || fail "a failed AOF integrity check must stop at the preflight"
echo "ok - failure points leave the backend stopped and fenced"

# ===== 7. run_id unchanged -> abort before reopen
world_reset; NO_BUMP=1
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] || fail "an unchanged run_id was accepted"
grep -q 'run_id did not change' "$W/err" || fail "the run_id failure should say why"
assert_fenced_and_down "run_id unchanged"
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 ]] && ! log_has "start $API" && [[ -e "$VR_MARKER" ]] || fail "reopen must refuse an unverified restore"
echo "ok - run_id unchanged aborts before reopen"

# ===== 8. fingerprint mismatch ("AOF shadows RDB": the old dataset is still served) -> abort before reopen
world_reset; printf '%s' "$FP_OLD" >"$W/fp_after_start"
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] || fail "a dataset that does not match the backup was accepted"
grep -q 'does not match the backup' "$W/err" || fail "the mismatch should say why"
assert_fenced_and_down "fingerprint mismatch"
for field in stream_last_id persistent_keys sample_sha256; do
    world_reset
    printf '%s' "${FP_BACKUP/$field=/$field=zzz}" >"$W/fp_after_start"
    run valkey_restore "$TMP/backup.rdb" --confirm-fence
    [[ "$RC" -ne 0 ]] || fail "a tampered $field was accepted"
done
# dbsize may only shrink (expiry), never grow and never undercut the persistent keys
world_reset; printf '%s' "${FP_BACKUP/dbsize=5/dbsize=4}" >"$W/fp_after_start"
run valkey_restore "$TMP/backup.rdb" --confirm-fence; [[ "$RC" == 0 ]] || fail "expired volatile keys must not fail the fingerprint"
world_reset; printf '%s' "${FP_BACKUP/dbsize=5/dbsize=6}" >"$W/fp_after_start"
run valkey_restore "$TMP/backup.rdb" --confirm-fence; [[ "$RC" -ne 0 ]] || fail "extra keys must fail the fingerprint"
world_reset; printf '%s' "${FP_BACKUP/dbsize=5/dbsize=3}" >"$W/fp_after_start"
run valkey_restore "$TMP/backup.rdb" --confirm-fence; [[ "$RC" -ne 0 ]] || fail "fewer keys than the persistent set must fail"
echo "ok - fingerprint mismatch aborts"

# ===== 9. not a master / signal interruption
world_reset; printf replica >"$W/role"
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'not a master' "$W/err" || fail "a non-master was accepted"
assert_fenced_and_down "role"
world_reset
vr_stage_data_orig_def="$(declare -f vr_stage_data)"
eval "${vr_stage_data_orig_def/vr_stage_data/vr_stage_data_orig}"
vr_stage_data() { if [[ "$1" == "$VR_VOLUME" ]]; then kill -TERM "$BASHPID"; fi; vr_stage_data_orig "$@"; }
run valkey_restore "$TMP/backup.rdb" --confirm-fence
eval "$vr_stage_data_orig_def"
[[ "$RC" == 143 ]] || fail "a TERM during staging should exit 143, got $RC"
assert_fenced_and_down "SIGTERM during staging"
echo "ok - role check and interruption"

# ===== 10. re-run from a fenced state resumes and completes; the old run_id is kept
world_reset; FAIL="start $VALKEY"
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] || fail "setup: the first run should fail"
printf 0 >"$W/valkey_running"
FAIL=""
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "re-run from the fenced state failed"; }
[[ "$(marker_stage)" == verified && "$(vr_marker_get old_run_id)" == run-0 ]] || fail "re-run lost the original run_id or did not verify"
[[ "$(ls "$W/replaced" | wc -l)" -eq 2 ]] || fail "each attempt should keep its own copy of the data it replaced"
# a different backup while fenced is refused
run valkey_restore "$TMP/aof" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'different backup' "$W/err" || fail "a fence for another backup must not be reused"
[[ "$(marker_stage)" == verified ]] || fail "the refused re-run must not disturb the marker"
# re-run when already verified: no stop/start at all
: >"$W/docker.log"
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" == 0 ]] && grep -q 'already restored and verified' "$W/err" || fail "re-run of a verified restore should be a no-op"
log_has "stop " && fail "the verified re-run stopped something"
log_has "start " && fail "the verified re-run started something"
echo "ok - re-run from fenced state"

# ===== 11. abort clears the marker and starts nothing; without a fence it refuses
run valkey_restore --abort --confirm-fence
[[ "$RC" == 0 && ! -e "$VR_MARKER" ]] && ! api_up || fail "abort must clear the marker and leave the API stopped"
log_has "start $API" && fail "abort started the API"
run valkey_restore --abort --confirm-fence
[[ "$RC" -ne 0 ]] || fail "abort without a fence was accepted"
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 ]] || fail "reopen without a fence was accepted"
echo "ok - abort"

# ===== 12. reopen: the gate is re-checked from live state for BOTH active modes
# temporary-active, valid window and timer
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active
run valkey_restore --reopen --confirm-reopen; expect_started temporary-active temporary-active
# temporary-active: expiry inside the readiness wait, expired, missing, timer gone
for exp in $((NOW + 100)) $((NOW - 1)) "" ; do
    verified_world; RT_MODE=temporary-active; RT_EXPIRY="$exp"; RT_CLASS=active
    run valkey_restore --reopen --confirm-reopen; expect_not_started "expired window '$exp'" "temporary-active"
done
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_TIMER=0
run valkey_restore --reopen --confirm-reopen; expect_not_started "timer gone" "temporary-active"
# persistent-active: policy + masks hold
verified_world; RT_MODE=temporary-active; RT_PERSISTENT=1; RT_MASKS=1; RT_EXPIRY=$((NOW - 99999))
run valkey_restore --reopen --confirm-reopen; expect_started persistent-active persistent-active
verified_world; RT_MODE=temporary-active; RT_PERSISTENT=1; RT_MASKS=0
run valkey_restore --reopen --confirm-reopen; expect_not_started "persistent masks broken" "adopt-persistent-active"
# passive container with passive state
verified_world; RT_MODE=""; RT_CLASS=passive
run valkey_restore --reopen --confirm-reopen; expect_started passive passive
# the expiry guard fired during the fence (state cleared) but the container is still an ACTIVE one
verified_world; RT_MODE=""; RT_CLASS=active
run valkey_restore --reopen --confirm-reopen; expect_not_started "guard cleared state, active container" "matching normal flow"
# invalid mode
verified_world; RT_MODE=corrupt
run valkey_restore --reopen --confirm-reopen; expect_not_started "corrupt mode" "normal deploy flow"
echo "ok - reopen decision per mode"

# ===== 13. reopen refusals that must keep the fence, and failure after the start
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active
printf 'run-99' >"$W/run_id"
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] && ! log_has "start $API" || fail "a Valkey that restarted since verification must keep the fence"
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active
printf '%s' "$FP_OLD" >"$W/fp_live"
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] && ! log_has "start $API" || fail "a dataset that drifted since verification must keep the fence"
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active; FAIL="start $API"
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] && ! api_up || fail "a failing API start must keep the fence with the API stopped"
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active; READY_FAIL=1
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] && ! api_up && log_has "start $API" || fail "an API that never becomes ready must be stopped again, fenced"
[[ "$(marker_stage)" == reopening ]] || fail "the interrupted reopen should be visible in the marker"
READY_FAIL=0; : >"$W/docker.log"; : >"$W/hooks.log"
run valkey_restore --reopen --confirm-reopen
expect_started "retry after a failed reopen" temporary-active
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active; STATUS_FAIL=1
run valkey_restore --reopen --confirm-reopen
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] && ! api_up || fail "a failing status verification must stop the API again, fenced"
# the API was not running when the fence began: nothing to start
world_reset; printf 0 >"$W/api_running"
run valkey_restore "$TMP/backup.rdb" --confirm-fence; [[ "$RC" == 0 ]] || fail "setup"
run valkey_restore --reopen --confirm-reopen
[[ "$RC" == 0 && ! -e "$VR_MARKER" ]] && ! log_has "start $API" && grep -Fqx 'api_started=false' "$W/out" || fail "a stopped API must stay stopped"
echo "ok - reopen keeps the fence on failure"

# ===== 14. every START path refuses while fenced, and runs again once the marker is gone;
#          stop and guard-expiry stay available while fenced
for fn in "${START_PATHS[@]}"; do
    world_reset; : >"$W/reached"
    : >"$VR_MARKER"
    run try_start_path "$fn"
    [[ "$RC" == 1 ]] && ! [[ -s "$W/reached" ]] && grep -q 'restore fence is active' "$W/err" \
        || fail "$fn ran or did not explain the fence while a marker existed (rc $RC)"
    rm -f "$VR_MARKER"
    run try_start_path "$fn"
    [[ "$RC" == 99 && -s "$W/reached" ]] || fail "$fn was still refused after the marker was cleared (rc $RC)"
done
# stop and guard-expiry are not start paths
world_reset; : >"$VR_MARKER"
( set -e
  RT_MODE=temporary-active; RT_EXPIRY=1700000000
  compose() { echo "compose:$*" >>"$W/hooks.log"; }
  container_id_for() { return 1; }
  clear_temporary_expiry_timer() { echo timer >>"$W/hooks.log"; }
  clear_temporary_active_state() { echo state >>"$W/hooks.log"; }
  stop_release ) >"$W/out" 2>"$W/err" || { cat "$W/err" >&2; fail "stop must stay allowed while fenced"; }
grep -Fq "compose:$TAG stop api" "$W/hooks.log" && grep -Fqx state "$W/hooks.log" || fail "stop did not stop the API while fenced"
: >"$W/hooks.log"
( set -e
  RT_MODE=temporary-active; RT_EXPIRY=1700000000; RT_PERSISTENT=0
  compose() { echo "compose:$*" >>"$W/hooks.log"; }
  container_id_for() { return 1; }
  clear_temporary_expiry_timer() { :; }
  clear_temporary_active_state() { echo state >>"$W/hooks.log"; }
  guard_expiry ) >"$W/out" 2>"$W/err" || { cat "$W/err" >&2; fail "guard-expiry must stay allowed while fenced"; }
grep -Fq "compose:$TAG stop api" "$W/hooks.log" && grep -Fqx state "$W/hooks.log" || fail "guard-expiry did not stop an expired runtime while fenced"
# an unexpired runtime is left alone by the guard
: >"$W/hooks.log"
( set -e; RT_MODE=temporary-active; RT_EXPIRY=4000000000; compose() { echo "compose:$*" >>"$W/hooks.log"; }; guard_expiry ) \
    >/dev/null 2>&1 || fail "guard-expiry failed on a live window"
[[ ! -s "$W/hooks.log" ]] || fail "guard-expiry stopped a live window"
echo "ok - start paths refuse while fenced; stop and guard-expiry stay available"

# ===== 15. the CI deployer refuses before it touches the approval, then proceeds without a marker
CI_COPY="$TMP/ci-deployer.sh"
sed -e '$d' -e "s|^readonly VALKEY_RESTORE_MARKER=.*|readonly VALKEY_RESTORE_MARKER=\"$TMP/ci-fence\"|" "$ROOT/ci/ci-deployer.sh" >"$CI_COPY"
: >"$TMP/ci-fence"
if bash -c 'source "$1"; require_no_valkey_restore_fence' _ "$CI_COPY" 2>"$TMP/ci.err"; then fail "ci-deployer ignored the fence"; fi
grep -q 'restore fence is active' "$TMP/ci.err" || fail "ci-deployer fence message missing"
if bash -c 'source "$1"; require_automation_authority(){ echo reached >&2; exit 99; }; replace_release "$2" "$3"' _ "$CI_COPY" "$TAG" "sha256:$(printf 'e%.0s' {1..64})" 2>"$TMP/ci.err"; then fail "replace ran while fenced"; fi
grep -q 'reached' "$TMP/ci.err" && fail "replace got past the fence check"
rm -f "$TMP/ci-fence"
bash -c 'source "$1"; require_no_valkey_restore_fence' _ "$CI_COPY" || fail "ci-deployer refused without a fence"
set +e; bash -c 'source "$1"; require_automation_authority(){ echo reached >&2; exit 99; }; replace_release "$2" "$3"' _ "$CI_COPY" "$TAG" "sha256:$(printf 'e%.0s' {1..64})" 2>"$TMP/ci.err"; ci_rc=$?; set -e
[[ "$ci_rc" == 99 ]] || fail "replace did not proceed past the fence check without a marker"
echo "ok - ci deployer"

# ===== 16. leftovers of an interrupted run are removed by the next one, only under this project's prefix
world_reset
fake_vr_docker_def="$(declare -f vr_docker)"
vr_docker() { printf '%s\n' "$*" >>"$W/docker.log"; case "$1 $2" in "ps -aq") echo leftover1;; "volume ls") printf '%s\n' tproj-vr-fp-old other-volume;; esac; return 0; }
vr_remove_leftovers
log_has "rm -f leftover1" && log_has "volume rm -f tproj-vr-fp-old" || fail "leftovers were not removed"
log_has "volume rm -f other-volume" && fail "a foreign volume was removed"
log_has "--filter name=^/tproj-vr-" || fail "the container filter must be anchored to the project prefix"
eval "$fake_vr_docker_def"   # the stateful fake again for the sections that follow
echo "ok - leftovers"

fi

# =============================================================================
# F1 - restore exactly the bytes that were verified (VR_TEST_SECTION=f1)
# =============================================================================
if want f1; then
ORIG_RDB_SHA="$(sha_of "$TMP/backup.rdb")"
ORIG_AOF_SHA="$(vr_tree_digest "$TMP/aof")"
EVIL_RDB_SHA="$(sha_of "$TMP/evil.rdb")"
[[ "$ORIG_RDB_SHA" != "$EVIL_RDB_SHA" ]] || fail "fixture: the evil RDB must differ"

# ===== F1.1 the operator path is read once: every later step uses the protected snapshot
world_reset; FAIL="start $VALKEY"          # stop after staging so the fence (and its snapshot) stay for inspection
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] || fail "setup: the first run should fail and stay fenced"
snap="$(snapshot_dir_of_marker || true)"
[[ "$snap" == "$W/snapshots/"* && "$(vr_marker_get backup_digest)" == "$ORIG_RDB_SHA" ]] || fail "the marker must record the snapshot and its digest"
[[ "$(stat -c %a "$W/snapshots")" == 700 && "$(stat -c %a "$snap")" == 700 && "$(stat -c %a "$snap/dump.rdb")" == 600 ]] \
    || fail "the snapshot area must be 0700 with a 0600 file"
[[ "$(sha_of "$snap/dump.rdb")" == "$ORIG_RDB_SHA" ]] || fail "the snapshot is not a byte copy of the backup"
grep -F -- "$TMP/backup.rdb" "$W/docker.log" && fail "the operator path reached docker: it must be read once, by the snapshot copy"
grep -Fq -- "-v $snap/dump.rdb:/backup/dump.rdb:ro" "$W/docker.log" || fail "staging must mount the snapshot"
[[ "$(sha_of "$W/vol/dump.rdb")" == "$ORIG_RDB_SHA" ]] || fail "the staged volume does not hold the snapshot bytes"
echo "ok - F1.1 snapshot: protected, byte-exact, the only thing docker sees"

# ===== F1.2 operator input replaced AFTER the preflight and after the last hash (the reviewer's repro)
for point in "stop $API" "cp -a /data/. /copy/"; do
    world_reset; cp "$TMP/backup.rdb" "$W/operator.rdb"
    HOOK_ON="$point"; HOOK_CMD='cp "$TMP/evil.rdb" "$W/operator.rdb"'
    run valkey_restore "$W/operator.rdb" --confirm-fence
    [[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "F1.2 ($point): the restore from the approved bytes should still succeed"; }
    [[ "$(sha_of "$W/operator.rdb")" == "$EVIL_RDB_SHA" ]] || fail "F1.2 ($point): the hook did not replace the operator file"
    [[ "$(sha_of "$W/vol/dump.rdb")" == "$ORIG_RDB_SHA" ]] || fail "F1.2 ($point): a different dataset was restored than the one that was verified"
    [[ "$(vr_marker_get backup_digest)" == "$ORIG_RDB_SHA" && "$(marker_stage)" == verified ]] || fail "F1.2 ($point): marker does not describe the verified bytes"
done
# the same for an AOF directory (one file's bytes swapped after the preflight)
world_reset; cp -R "$TMP/aof" "$W/operator-aof"
HOOK_ON="cp -a /data/. /copy/"; HOOK_CMD='printf "REDIS0011-CHANGED" >"$W/operator-aof/appendonly.aof.1.base.rdb"'
run valkey_restore "$W/operator-aof" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "F1.2 aof: restore failed"; }
[[ "$(vr_tree_digest "$W/vol/appendonlydir")" == "$ORIG_AOF_SHA" ]] || fail "F1.2 aof: a different AOF was restored than the one that was verified"
echo "ok - F1.2 input replaced after the preflight: the approved bytes are restored"

# ===== F1.3 the snapshot itself is tampered with
# (a) before the restore starts: the re-hash refuses, Valkey is not even stopped
world_reset; HOOK_ON="stop $API"; HOOK_CMD='printf x >>"$VR_SNAPSHOT_ROOT"/*/dump.rdb'
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'verified snapshot changed' "$W/err" || fail "F1.3a: a tampered snapshot was accepted"
assert_fenced_and_down "tampered snapshot"
log_has "stop -t 60 $VALKEY" && fail "F1.3a: Valkey was stopped before the snapshot was re-verified"
[[ ! -e "$W/vol" ]] || fail "F1.3a: something was staged from a tampered snapshot"
# (b) after the re-hash, while the replaced data is being kept: the staged copy is compared to the digest
world_reset; HOOK_ON="cp -a /data/. /copy/"; HOOK_CMD='printf x >>"$VR_SNAPSHOT_ROOT"/*/dump.rdb'
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'staged data does not match the verified snapshot' "$W/err" || { cat "$W/err" >&2; fail "F1.3b: tampered staging was accepted"; }
assert_fenced_and_down "tampered staging"
log_has "start $VALKEY" && fail "F1.3b: Valkey was started on unverified bytes"
log_has "tproj-vr-bootstrap" && fail "F1.3b: the bootstrap loaded unverified bytes"
# (c) the staging step itself corrupts what lands in the volume
world_reset; STAGE_CORRUPT=1
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'staged data does not match the verified snapshot' "$W/err" || fail "F1.3c: a corrupted staged copy was accepted"
assert_fenced_and_down "corrupted staging"
log_has "start $VALKEY" && fail "F1.3c: Valkey was started on a corrupted staged copy"
world_reset; STAGE_CORRUPT=1
run valkey_restore "$TMP/aof" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'staged data does not match' "$W/err" || fail "F1.3c: a corrupted staged AOF was accepted"
echo "ok - F1.3 tampered snapshot / staged copy: aborts, stays fenced, never starts on other bytes"

# ===== F1.4 re-runs reuse the recorded snapshot (re-hashed first); a different path/digest stays refused
world_reset; cp "$TMP/backup.rdb" "$W/operator.rdb"; FAIL="start $VALKEY"
run valkey_restore "$W/operator.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] || fail "setup: first run"
snap="$(snapshot_dir_of_marker)"; FAIL=""
cp "$VR_MARKER" "$W/marker.before"
cp "$TMP/evil.rdb" "$W/operator.rdb"             # operator input changed since the first run
run valkey_restore "$W/operator.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'different backup' "$W/err" || fail "F1.4: a re-run with different bytes was accepted"
cmp -s "$VR_MARKER" "$W/marker.before" || fail "F1.4: the refused re-run changed the marker"
run valkey_restore "$TMP/aof" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'different backup' "$W/err" || fail "F1.4: a re-run with a different path was accepted"
cp "$TMP/backup.rdb" "$W/operator.rdb"           # original bytes again
printf x >>"$snap/dump.rdb"                      # ... but the recorded snapshot was touched
: >"$W/docker.log"
run valkey_restore "$W/operator.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'verified snapshot changed' "$W/err" || fail "F1.4: a re-run on a tampered snapshot was accepted"
log_has "stop " && fail "F1.4: the refused re-run stopped something"
cp "$TMP/backup.rdb" "$snap/dump.rdb"            # snapshot intact again
run valkey_restore "$W/operator.rdb" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "F1.4: the re-run on the recorded snapshot failed"; }
[[ "$(ls "$W/snapshots" | wc -l)" -eq 1 && "$(snapshot_dir_of_marker)" == "$snap" ]] || fail "F1.4: the re-run must reuse the recorded snapshot and drop its own copy"
grep -Fq -- "-v $snap/dump.rdb:/backup/dump.rdb:ro" "$W/docker.log" || fail "F1.4: the re-run did not stage from the recorded snapshot"
echo "ok - F1.4 re-run reuses the recorded snapshot"

# ===== F1.5 nothing is left behind: failed preflights, reopen and abort
for bad in "$TMP/garbage.rdb" "$TMP/empty.rdb" "$TMP/noman"; do
    world_reset; run valkey_restore "$bad" --confirm-fence
    [[ "$RC" -ne 0 ]] || fail "F1.5: $bad accepted"
    [[ ! -e "$W/snapshots" || -z "$(ls -A "$W/snapshots")" ]] || fail "F1.5: a refused backup left a snapshot ($bad)"
done
world_reset; FAIL="run -d --name tproj-vr-fp-"; run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 && ! -e "$VR_MARKER" ]] && { [[ ! -e "$W/snapshots" ]] || [[ -z "$(ls -A "$W/snapshots")" ]]; } || fail "F1.5: a failed fingerprint left a snapshot"
verified_world; RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active
[[ -d "$W/snapshots" ]] || fail "F1.5: a verified restore must keep its snapshot"
run valkey_restore --reopen --confirm-reopen; expect_started "F1.5 reopen" temporary-active
[[ ! -e "$W/snapshots" ]] || fail "F1.5: reopen must remove the snapshot"
verified_world; run valkey_restore --abort --confirm-fence
[[ "$RC" == 0 && ! -e "$W/snapshots" ]] || fail "F1.5: abort must remove the snapshot"
echo "ok - F1.5 snapshots do not outlive their fence"
fi

# =============================================================================
# F3 - fenced rollback (VR_TEST_SECTION=f3)
# =============================================================================
if want f3; then
# a verified, fenced world whose kept copy (the OLD dataset) holds an AOF directory
rollback_world() {
    verified_world
    KEPT_TS="$(ls -1 "$W/replaced" | head -n1)"
    KEPT="$W/replaced/$KEPT_TS"
    cp -R "$TMP/aof" "$KEPT/appendonlydir"
    KEPT_SHA="$(vr_tree_digest "$KEPT/appendonlydir")"
    printf '%s' "$FP_OLD" >"$W/fp_backup"; printf '%s' "$FP_OLD" >"$W/fp_after_start"   # what the kept copy holds
    : >"$W/marker_trace"; : >"$W/probe"; rm -f "$W/hook_done"
}
assert_marker_whole_time() { grep -q 0 "$W/marker_trace" && fail "$1: the fence marker was missing during a docker call"; [[ -s "$W/marker_trace" ]] || fail "$1: no docker call was traced"; return 0; }

# ===== F3.1 rollback from the fenced state after a successful restore: marker kept, start paths refused, reopen works
rollback_world
HOOK_ON="start $VALKEY"; HOOK_CMD='probe_start_paths'
run valkey_restore --rollback "$KEPT/appendonlydir" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "F3.1: the rollback failed (rc $RC)"; }
[[ "$(marker_stage)" == verified && -e "$VR_MARKER" ]] || fail "F3.1: the rollback must end verified and still fenced"
[[ "$(vr_marker_get mode)" == rollback && "$(vr_marker_get backup_path)" == "$KEPT/appendonlydir" && "$(vr_marker_get backup_digest)" == "$KEPT_SHA" ]] \
    || fail "F3.1: the new target was not recorded in the marker"
[[ "$(vr_tree_digest "$W/vol/appendonlydir")" == "$KEPT_SHA" ]] || fail "F3.1: the volume does not hold the kept copy"
assert_marker_whole_time "F3.1"
[[ "$(wc -l <"$W/probe")" -eq "${#START_PATHS[@]}" ]] && ! grep -v ':1$' "$W/probe" || { cat "$W/probe" >&2; fail "F3.1: a start path was not refused in the middle of the rollback"; }
log_has "start $API" && fail "F3.1: a rollback must not start the API"
assert_order "stop -t 60 $VALKEY" "-v tvolume:/data -v $W/snapshots/"
[[ "$(ls "$W/snapshots" | wc -l)" -eq 1 && "$(snapshot_dir_of_marker)" == "$W/snapshots/"* ]] || fail "F3.1: the superseded snapshot must be dropped"
[[ "$(ls "$W/replaced" | wc -l)" -eq 2 ]] || fail "F3.1: the data the rollback replaced must be kept too"
grep -Fqx 'valkey_restore=verified' "$W/out" && grep -Fqx 'mode=rollback' "$W/out" && grep -Fqx 'fenced=true' "$W/out" || fail "F3.1: summary missing"
# --reopen is the only way back, and it works
RT_MODE=temporary-active; RT_EXPIRY=$((NOW + 3600)); RT_CLASS=active; : >"$W/docker.log"; : >"$W/hooks.log"
run valkey_restore --reopen --confirm-reopen; expect_started "F3.1 reopen" temporary-active
echo "ok - F3.1 rollback after a successful restore"

# ===== F3.2 rollback after an injected failure (stage 'restoring', Valkey stopped)
world_reset; FAIL="start $VALKEY"
run valkey_restore "$TMP/backup.rdb" --confirm-fence
[[ "$RC" -ne 0 && "$(marker_stage)" == restoring ]] || fail "F3.2 setup: expected a failed restore"
KEPT_TS="$(ls -1 "$W/replaced" | head -n1)"; KEPT="$W/replaced/$KEPT_TS"; cp -R "$TMP/aof" "$KEPT/appendonlydir"
printf '%s' "$FP_OLD" >"$W/fp_backup"; printf '%s' "$FP_OLD" >"$W/fp_after_start"
FAIL=""; : >"$W/marker_trace"; : >"$W/docker.log"
run valkey_restore --rollback "$KEPT/appendonlydir" --confirm-fence
[[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "F3.2: rollback after a failed restore failed"; }
[[ "$(marker_stage)" == verified && "$(vr_marker_get mode)" == rollback ]] || fail "F3.2: not verified/fenced after the rollback"
assert_marker_whole_time "F3.2"
log_has "start $API" && fail "F3.2: a rollback must not start the API"
[[ "$(vr_tree_digest "$W/vol/appendonlydir")" == "$(vr_tree_digest "$TMP/aof")" ]] || fail "F3.2: the volume does not hold the kept copy"
echo "ok - F3.2 rollback after an injected failure"

# ===== F3.3 a failing rollback stays fenced, prints the rollback resume command, and the same command resumes
rollback_world; FAIL="start $VALKEY"
run valkey_restore --rollback "$KEPT/appendonlydir" --confirm-fence
[[ "$RC" -ne 0 && -e "$VR_MARKER" ]] && ! api_up || fail "F3.3: a failed rollback must stay fenced with the API stopped"
[[ "$(marker_stage)" != verified && "$(vr_marker_get mode)" == rollback ]] || fail "F3.3: the failed rollback must not claim a verified state"
grep -Fq -- "Resume (idempotent): valkey-restore --rollback '$KEPT/appendonlydir' --confirm-fence" "$W/err" || { cat "$W/err" >&2; fail "F3.3: no rollback resume instruction"; }
grep -Fq -- "valkey-restore --rollback <replaced-copy>/appendonlydir" "$W/err" || fail "F3.3: the rollback instruction is missing"
assert_marker_whole_time "F3.3"
FAIL=""; : >"$W/marker_trace"
run valkey_restore --rollback "$KEPT/appendonlydir" --confirm-fence
[[ "$RC" == 0 && "$(marker_stage)" == verified ]] || { cat "$W/err" >&2; fail "F3.3: the same rollback command did not resume"; }
[[ "$(ls "$W/snapshots" | wc -l)" -eq 1 ]] || fail "F3.3: the resumed rollback should reuse one snapshot"
assert_marker_whole_time "F3.3 resume"
# a SIGTERM in the middle of a rollback is the same state
rollback_world
vr_stage_data_def="$(declare -f vr_stage_data)"; eval "${vr_stage_data_def/vr_stage_data/vr_stage_data_orig}"
vr_stage_data() { if [[ "$1" == "$VR_VOLUME" ]]; then kill -TERM "$BASHPID"; fi; vr_stage_data_orig "$@"; }
run valkey_restore --rollback "$KEPT/appendonlydir" --confirm-fence
eval "$vr_stage_data_def"
[[ "$RC" == 143 && -e "$VR_MARKER" ]] && ! api_up || fail "F3.3: SIGTERM during a rollback must leave the fence and the API down (rc $RC)"
echo "ok - F3.3 failing rollback stays fenced and resumes"

# ===== F3.4 only a kept copy under the replaced-data root is accepted; nothing is touched otherwise
rollback_world
ln -s "$TMP/backup.rdb" "$KEPT/dump.rdb"
mkdir -p "$W/replaced/elsewhere"; printf 'not a dump\n' >"$W/replaced/elsewhere/dump.rdb"
mkdir -p "$TMP/outside"; cp -R "$TMP/aof" "$TMP/outside/appendonlydir"
ln -s "$TMP/outside" "$W/replaced/linked"
cp "$VR_MARKER" "$W/marker.before"; : >"$W/docker.log"
for bad in "$TMP/backup.rdb" "$TMP/aof" "$TMP/outside/appendonlydir" "$W/replaced" "$KEPT" "$KEPT/appendonlydir/appendonly.aof.manifest" \
           "$W/replaced/../dump.rdb" "$W/replaced/$KEPT_TS/../$KEPT_TS/appendonlydir" "$KEPT/dump.rdb" "$W/replaced/linked/appendonlydir" \
           "$W/replaced/missing/appendonlydir" "relative/appendonlydir" "$W/replaced//$KEPT_TS/appendonlydir"; do
    run valkey_restore --rollback "$bad" --confirm-fence
    [[ "$RC" -ne 0 ]] || fail "F3.4: '$bad' was accepted"
    grep -Eq 'accepts only|kept copy|symbolic link|absolute path' "$W/err" || { cat "$W/err" >&2; fail "F3.4: no explanation for '$bad'"; }
    [[ ! -s "$W/docker.log" ]] || fail "F3.4: '$bad' touched docker"
    cmp -s "$VR_MARKER" "$W/marker.before" || fail "F3.4: '$bad' changed the marker"
done
# unusable content inside the root is refused by the preflight, after which the old target and the fence are intact
run valkey_restore --rollback "$W/replaced/elsewhere/dump.rdb" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -q 'not a Valkey/Redis RDB' "$W/err" || fail "F3.4: an invalid kept copy was accepted"
cmp -s "$VR_MARKER" "$W/marker.before" && [[ "$(marker_stage)" == verified ]] || fail "F3.4: the failed preflight must leave the marker untouched"
log_has "stop " && fail "F3.4: the failed preflight stopped something"
[[ "$(ls "$W/snapshots" | wc -l)" -eq 1 ]] || fail "F3.4: the failed preflight must not leave a snapshot"
echo "ok - F3.4 rollback path restrictions"

# ===== F3.5 without a fence, or without the confirmation flag, nothing happens
world_reset; mkdir -p "$W/replaced/x"; cp -R "$TMP/aof" "$W/replaced/x/appendonlydir"
run valkey_restore --rollback "$W/replaced/x/appendonlydir" --confirm-fence
[[ "$RC" -ne 0 && ! -s "$W/docker.log" && ! -e "$VR_MARKER" ]] && grep -q 'there is none' "$W/err" || fail "F3.5: a rollback without a fence must be refused"
api_up || fail "F3.5: a rollback without a fence stopped the API"
rollback_world; cp "$VR_MARKER" "$W/marker.before"; : >"$W/docker.log"
run valkey_restore --rollback "$KEPT/appendonlydir"
[[ "$RC" -ne 0 && ! -s "$W/docker.log" ]] && cmp -s "$VR_MARKER" "$W/marker.before" || fail "F3.5: a rollback without --confirm-fence was accepted"
run valkey_restore --rollback --confirm-fence
[[ "$RC" -ne 0 && ! -s "$W/docker.log" ]] || fail "F3.5: a rollback without a path was accepted"
run valkey_restore --rollback "$KEPT/appendonlydir" --confirm-fence --confirm-reopen
[[ "$RC" -ne 0 && ! -s "$W/docker.log" ]] || fail "F3.5: a rollback with the reopen flag was accepted"
echo "ok - F3.5 rollback needs an active fence and its flag"

# ===== F3.6 the old recovery text (restore the copy as a normal backup while fenced) no longer deadlocks
rollback_world; : >"$W/docker.log"
run valkey_restore "$KEPT/appendonlydir" --confirm-fence
[[ "$RC" -ne 0 ]] && grep -Fq -- "--rollback <kept-copy> --confirm-fence" "$W/err" || fail "F3.6: the refusal must point at --rollback"
log_has "stop " && fail "F3.6: the refusal stopped something"
echo "ok - F3.6 refusal names the rollback command"
fi

echo 'Fallback Valkey restore behavioral tests passed'
