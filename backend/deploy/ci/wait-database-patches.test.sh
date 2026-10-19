#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/wait-database-patches.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

bash -n "$SCRIPT" || fail "wait-database-patches.sh must be syntactically valid bash"
[[ -x "$SCRIPT" ]] || fail "wait-database-patches.sh must be executable"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

FAKE_GH="$TMP_ROOT/gh"
STATE_DIR="$TMP_ROOT/state"
mkdir -p "$STATE_DIR"

# A fake `gh` CLI, driven entirely by environment variables and a per-run
# call-counter state file, so each test scenario below can script exactly
# what the real GitHub API/CLI would have returned across successive polls.
#
# It also enforces the query-shape contract the real script must uphold:
#   - the primary `workflows/database-patches.yml/runs?...` lookup URL must
#     contain both `head_sha=$HEAD_SHA` and `branch=$REF_NAME` (a preview run
#     for the same SHA must not satisfy a main gate, and vice versa);
#   - the fallback `gh run list ... --jq` expression must filter on
#     `$HEAD_SHA` (a stale/different-commit run must not satisfy the gate).
# A caller that drops either check gets exit 99 from the shim, which every
# scenario below turns into an empty/garbage lookup and a scenario failure.
cat >"$FAKE_GH" <<'FAKE_GH_EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${FAKE_GH_STATE_DIR:?FAKE_GH_STATE_DIR is required}"

cmd="${1:-}"; shift || true

case "$cmd" in
    api)
        endpoint="${1:-}"; shift || true
        case "$endpoint" in
            */compare/*)
                [[ "${COMPARE_FAIL:-0}" == 1 ]] && exit 1
                if [[ -n "${CHANGED_FILES:-}" ]]; then
                    printf '%s\n' "${CHANGED_FILES}"
                fi
                ;;
            */actions/workflows/database-patches.yml/runs\?*)
                [[ "${PRIMARY_FAIL:-0}" == 1 ]] && exit 1
                if [[ -n "${HEAD_SHA:-}" && "$endpoint" != *"head_sha=$HEAD_SHA"* ]]; then
                    echo "fake gh: primary lookup URL missing head_sha=$HEAD_SHA: $endpoint" >&2
                    exit 99
                fi
                if [[ -n "${REF_NAME:-}" && "$endpoint" != *"branch=$REF_NAME"* ]]; then
                    echo "fake gh: primary lookup URL missing branch=$REF_NAME: $endpoint" >&2
                    exit 99
                fi
                if [[ -n "${RUNS_PRIMARY:-}" ]]; then
                    printf '%s\n' "${RUNS_PRIMARY}"
                fi
                ;;
            */actions/runs/*/jobs*)
                # Must precede the generic */actions/runs/* case, which would
                # otherwise swallow this endpoint. Serves a RAW jobs payload and
                # applies the script's own --jq filter with real jq, so the
                # script's name/conclusion extraction is genuinely exercised.
                id="${endpoint#*/actions/runs/}"
                id="${id%%/*}"
                counter_file="$state_dir/jobs_calls_$id"
                count=0
                [[ -f "$counter_file" ]] && count="$(cat "$counter_file")"
                count=$((count + 1))
                echo "$count" >"$counter_file"

                fail_always_var="JOBS_FAIL_ALWAYS_$id"
                [[ "${!fail_always_var:-0}" == 1 ]] && exit 1
                fail_until_var="JOBS_FAIL_UNTIL_$id"
                fail_until="${!fail_until_var:-0}"
                if (( count <= fail_until )); then
                    exit 1
                fi

                json_var="JOBS_JSON_$id"
                if [[ -z "${!json_var:-}" ]]; then
                    echo "fake gh: no JOBS_JSON_$id fixture for $endpoint" >&2
                    exit 98
                fi
                jq_expr=""
                args=("$@")
                for ((i = 0; i < ${#args[@]}; i++)); do
                    if [[ "${args[$i]}" == "--jq" ]]; then
                        jq_expr="${args[$((i + 1))]:-}"
                    fi
                done
                if [[ -n "$jq_expr" ]]; then
                    printf '%s' "${!json_var}" | /usr/bin/jq -r "$jq_expr"
                else
                    printf '%s' "${!json_var}"
                fi
                ;;
            */actions/runs/*)
                id="${endpoint##*/actions/runs/}"
                counter_file="$state_dir/calls_$id"
                count=0
                [[ -f "$counter_file" ]] && count="$(cat "$counter_file")"
                count=$((count + 1))
                echo "$count" >"$counter_file"

                fail_until_var="RUN_STATUS_FAIL_UNTIL_$id"
                fail_until="${!fail_until_var:-0}"
                if (( count <= fail_until )); then
                    exit 1
                fi

                seq_var="RUN_STATUS_SEQUENCE_$id"
                seq="${!seq_var:-completed:success}"
                IFS='|' read -r -a stages <<<"$seq"
                idx=$((count - 1))
                if (( idx >= ${#stages[@]} )); then
                    idx=$((${#stages[@]} - 1))
                fi
                stage="${stages[$idx]}"
                printf '%s %s\n' "${stage%%:*}" "${stage#*:}"
                ;;
            *)
                echo "fake gh: unhandled api endpoint: $endpoint" >&2
                exit 2
                ;;
        esac
        ;;
    run)
        sub="${1:-}"; shift || true
        case "$sub" in
            list)
                [[ "${FALLBACK_FAIL:-0}" == 1 ]] && exit 1
                jq_expr=""
                args=("$@")
                for ((i = 0; i < ${#args[@]}; i++)); do
                    if [[ "${args[$i]}" == "--jq" ]]; then
                        jq_expr="${args[$((i + 1))]:-}"
                    fi
                done
                if [[ -n "${HEAD_SHA:-}" && "$jq_expr" != *"$HEAD_SHA"* ]]; then
                    echo "fake gh: run list --jq missing HEAD_SHA=$HEAD_SHA: $jq_expr" >&2
                    exit 99
                fi
                if [[ -n "${RUNS_FALLBACK:-}" ]]; then
                    printf '%s\n' "${RUNS_FALLBACK}"
                fi
                ;;
            *)
                echo "fake gh: unhandled run subcommand: $sub" >&2
                exit 2
                ;;
        esac
        ;;
    *)
        echo "fake gh: unhandled command: $cmd" >&2
        exit 2
        ;;
esac
FAKE_GH_EOF
chmod 700 "$FAKE_GH"

ZERO_SHA="0000000000000000000000000000000000000000"
BEFORE_SHA_FIXTURE="1111111111111111111111111111111111111111"
HEAD_SHA_FIXTURE="2222222222222222222222222222222222222222"

# run_script [calls_dir]
# Optionally takes an explicit call-counter directory so a scenario can
# inspect how many times a given run id's status was polled afterward. When
# omitted, a fresh one is created and discarded (its contents don't matter).
# Note: a caller that needs to inspect the directory MUST pass it in rather
# than have run_script report it back, since `out="$(run_script)"` runs this
# function in a subshell — any variable it assigned would not propagate to
# the caller.
run_script() {
    local calls_dir="${1:-}"
    if [[ -z "$calls_dir" ]]; then
        calls_dir="$(mktemp -d "$STATE_DIR/calls.XXXXXX")"
    fi
    env \
        GH_BIN="$FAKE_GH" \
        FAKE_GH_STATE_DIR="$calls_dir" \
        GH_TOKEN=fake-token \
        GITHUB_REPOSITORY="acme/widgets" \
        HEAD_SHA="$HEAD_SHA_FIXTURE" \
        REF_NAME="main" \
        BEFORE_SHA="${BEFORE_SHA:-$BEFORE_SHA_FIXTURE}" \
        POLL_SECONDS="${POLL_SECONDS:-0}" \
        APPEAR_TIMEOUT_SECONDS="${APPEAR_TIMEOUT_SECONDS:-0}" \
        COMPLETE_TIMEOUT_SECONDS="${COMPLETE_TIMEOUT_SECONDS:-3600}" \
        CHANGED_FILES="${CHANGED_FILES:-}" \
        COMPARE_FAIL="${COMPARE_FAIL:-0}" \
        RUNS_PRIMARY="${RUNS_PRIMARY:-}" \
        PRIMARY_FAIL="${PRIMARY_FAIL:-0}" \
        RUNS_FALLBACK="${RUNS_FALLBACK:-}" \
        FALLBACK_FAIL="${FALLBACK_FAIL:-0}" \
        REQUIRED_JOB_NAME="${REQUIRED_JOB_NAME:-}" \
        bash "$SCRIPT"
}

reset_scenario_env() {
    unset BEFORE_SHA POLL_SECONDS APPEAR_TIMEOUT_SECONDS COMPLETE_TIMEOUT_SECONDS
    unset CHANGED_FILES COMPARE_FAIL RUNS_PRIMARY PRIMARY_FAIL RUNS_FALLBACK FALLBACK_FAIL
    unset REQUIRED_JOB_NAME
    for name in $(compgen -v | grep -E '^RUN_STATUS_SEQUENCE_|^RUN_STATUS_FAIL_UNTIL_|^JOBS_JSON_|^JOBS_FAIL_' || true); do
        unset "$name"
    done
}

# --- Scenario 1: no run + expected=no -> exit 0 fast, no prisma changes. ---
reset_scenario_env
CHANGED_FILES=$'backend/src/foo.ts\nREADME.md'
RUNS_PRIMARY=""
RUNS_FALLBACK=""
out="$(run_script)" || fail "scenario 1: expected exit 0 (no run expected) but the script failed: $out"
grep -Fq "No Database Patches run for $HEAD_SHA_FIXTURE" <<<"$out" \
    || fail "scenario 1: expected the no-run-expected message, got: $out"

# --- Scenario 2: no run + expected=yes -> exit 1 after the appear timeout. ---
reset_scenario_env
CHANGED_FILES=$'backend/prisma/migrations/20260903_x/migration.sql'
RUNS_PRIMARY=""
RUNS_FALLBACK=""
APPEAR_TIMEOUT_SECONDS=0
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 2: expected exit 1 when a required run never appears, got exit $status: $out"
grep -Fq '::error::' <<<"$out" || fail "scenario 2: expected an ::error:: annotation, got: $out"

# --- Scenario 3: run in_progress then success across two polls -> exit 0. ---
reset_scenario_env
RUNS_PRIMARY="101 in_progress -"
export RUN_STATUS_SEQUENCE_101="in_progress:-|completed:success"
out="$(run_script)" || fail "scenario 3: expected exit 0 once the run completes successfully: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 3: expected the success message, got: $out"

# --- Scenario 4: run completed with failure -> exit 1. ---
reset_scenario_env
RUNS_PRIMARY="102 completed failure"
export RUN_STATUS_SEQUENCE_102="completed:failure"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 4: expected exit 1 for a failed run, got exit $status: $out"
grep -Fq '::error::Database Patches run 102 concluded failure' <<<"$out" \
    || fail "scenario 4: expected a concluded-failure error message, got: $out"

# --- Scenario 5: primary lookup empty, fallback finds the run -> waits on it. ---
reset_scenario_env
RUNS_PRIMARY=""
RUNS_FALLBACK="103 completed success"
export RUN_STATUS_SEQUENCE_103="completed:success"
out="$(run_script)" || fail "scenario 5: expected exit 0 once the fallback-found run succeeds: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 5: expected the success message from the fallback-found run, got: $out"

# --- Scenario 6: unknown BEFORE_SHA (zeros) + no run -> exit 0 with a warning. ---
reset_scenario_env
BEFORE_SHA="$ZERO_SHA"
RUNS_PRIMARY=""
RUNS_FALLBACK=""
APPEAR_TIMEOUT_SECONDS=0
out="$(run_script)" || fail "scenario 6: expected exit 0 when BEFORE_SHA is unknown and no run appears: $out"
grep -Fq '::warning::' <<<"$out" \
    || fail "scenario 6: expected a ::warning:: annotation, got: $out"

# --- Scenario 7: run never completes -> exit 1 once COMPLETE_TIMEOUT_SECONDS
#     elapses. Also guards against POLL_SECONDS spinning without advancing
#     elapsed time. (Mutation check performed separately: changing this
#     branch's `exit 1` to `exit 0` must fail this scenario.)
reset_scenario_env
RUNS_PRIMARY="201 in_progress -"
export RUN_STATUS_SEQUENCE_201="in_progress:-"
POLL_SECONDS=1
COMPLETE_TIMEOUT_SECONDS=1
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 7: expected exit 1 once the complete-timeout elapses, got exit $status: $out"
grep -Fq 'timed out waiting' <<<"$out" \
    || fail "scenario 7: expected 'timed out waiting' in the output, got: $out"

# --- Scenario 8: a transient run-status lookup failure must not fail the
#     gate — the script must keep polling until the run is actually
#     completed. The shim fails the first 2 lookups for run 301, then
#     succeeds; the run's own status sequence only reaches "completed
#     success" once (default), so success is verifiable as having taken at
#     least 3 calls (2 failures + 1 real success), not been synthesized
#     from the failure branch itself. (Mutation check performed separately:
#     changing `|| echo "unknown -"` to `|| echo "completed success"` must
#     fail this scenario.)
reset_scenario_env
RUNS_PRIMARY="301 in_progress -"
export RUN_STATUS_FAIL_UNTIL_301=2
POLL_SECONDS=1
scenario8_calls_dir="$(mktemp -d "$STATE_DIR/calls.XXXXXX")"
out="$(run_script "$scenario8_calls_dir")" || fail "scenario 8: expected exit 0 once the transient status-lookup failures clear: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 8: expected the success message, got: $out"
calls_file="$scenario8_calls_dir/calls_301"
[[ -f "$calls_file" ]] || fail "scenario 8: expected a call-count file for run 301"
call_count="$(cat "$calls_file")"
(( call_count >= 3 )) \
    || fail "scenario 8: expected at least 3 status lookups (2 transient failures + 1 success), got $call_count"

# --- Scenario 9: primary lookup is scoped by both head_sha and branch — the
#     shared shim (see above) rejects any call missing either, so this
#     scenario just needs to succeed normally to prove the real script sends
#     both. (Mutation checks performed separately on the script's query
#     string and jq filter — see scenario 10 and the implementer's report.)
reset_scenario_env
RUNS_PRIMARY="401 completed success"
export RUN_STATUS_SEQUENCE_401="completed:success"
out="$(run_script)" || fail "scenario 9: expected exit 0 with a correctly head_sha+branch scoped primary URL: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 9: expected the success message, got: $out"

# --- Scenario 10: fallback `gh run list --jq` must filter on $HEAD_SHA —
#     same shared-shim mechanism, exercised via the fallback path (empty
#     primary lookup).
reset_scenario_env
RUNS_PRIMARY=""
RUNS_FALLBACK="501 completed success"
export RUN_STATUS_SEQUENCE_501="completed:success"
out="$(run_script)" || fail "scenario 10: expected exit 0 with a correctly HEAD_SHA-filtered fallback lookup: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 10: expected the success message, got: $out"

# --- BJJ-484: REQUIRED_JOB_NAME. A run can conclude "success" while the job
#     that patches this backend's database was skipped (preview push ran only
#     apply-preview). The jobs fixtures below are raw GitHub payloads; the fake
#     gh runs the script's own --jq over them with real jq.
REQUIRED_JOB="apply production database patches"

jobs_json() {
    # jobs_json <name:conclusion>...  ->  {"jobs":[{"name":..,"conclusion":..},..]}
    local entry first=true out='{"jobs":['
    for entry in "$@"; do
        [[ "$first" == true ]] || out+=','
        first=false
        out+="{\"name\":\"${entry%%:*}\",\"conclusion\":\"${entry#*:}\",\"status\":\"completed\"}"
    done
    printf '%s]}' "$out"
}

# --- Scenario 11: required job succeeded -> exit 0 (the permitting direction).
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="601 completed success"
export RUN_STATUS_SEQUENCE_601="completed:success"
export JOBS_JSON_601
JOBS_JSON_601="$(jobs_json "apply production database patches:success")"
out="$(run_script)" || fail "scenario 11: expected exit 0 when the required job succeeded: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 11: expected the success message, got: $out"

# --- Scenario 12: run success but required job skipped (the BJJ-484 incident
#     shape: preview push, apply-production skipped) -> exit 1.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="602 completed success"
export RUN_STATUS_SEQUENCE_602="completed:success"
export JOBS_JSON_602
JOBS_JSON_602="$(jobs_json "apply production database patches:skipped")"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 12: expected exit 1 for a skipped required job, got exit $status: $out"
grep -Fq '::error::Database Patches run 602' <<<"$out" \
    || fail "scenario 12: expected an error naming run 602, got: $out"
grep -Fq "job 'apply production database patches' is skipped" <<<"$out" \
    || fail "scenario 12: expected the job name and skipped conclusion, got: $out"
grep -Fq 'https://github.com/acme/widgets/actions/runs/602' <<<"$out" \
    || fail "scenario 12: expected the run URL, got: $out"
grep -Fq 'did not patch the database this backend uses' <<<"$out" \
    || fail "scenario 12: expected the wrong-database explanation, got: $out"
if grep -Fq 'Database Patches run(s) succeeded' <<<"$out"; then
    fail "scenario 12: a skipped required job must not print the success message: $out"
fi

# --- Scenario 13: run success but required job absent from the jobs list.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="603 completed success"
export RUN_STATUS_SEQUENCE_603="completed:success"
export JOBS_JSON_603
JOBS_JSON_603="$(jobs_json "apply dev database patches:success")"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 13: expected exit 1 for a missing required job, got exit $status: $out"
grep -Fq "job 'apply production database patches' is missing" <<<"$out" \
    || fail "scenario 13: expected the job to be reported missing, got: $out"

# --- Scenario 13b: a different job succeeded but the required one was skipped
#     (a preview push: apply-preview success, apply-production skipped) -> exit 1.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="604 completed success"
export RUN_STATUS_SEQUENCE_604="completed:success"
export JOBS_JSON_604
JOBS_JSON_604="$(jobs_json "apply preview database patches:success" "apply production database patches:skipped")"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 13b: expected exit 1 when only a different job succeeded, got exit $status: $out"
grep -Fq "job 'apply production database patches' is skipped" <<<"$out" \
    || fail "scenario 13b: expected the skipped required job, got: $out"

# --- Scenario 13c: required job failed -> exit 1 naming the conclusion.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="605 completed success"
export RUN_STATUS_SEQUENCE_605="completed:success"
export JOBS_JSON_605
JOBS_JSON_605="$(jobs_json "apply production database patches:failure")"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 13c: expected exit 1 for a failed required job, got exit $status: $out"
grep -Fq "is failure" <<<"$out" || fail "scenario 13c: expected the failure conclusion, got: $out"

# --- Scenario 13d: two runs for the commit; the second one skipped the
#     required job -> exit 1 (every run is checked, not just the first).
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY=$'606 completed success\n607 completed success'
export RUN_STATUS_SEQUENCE_606="completed:success"
export RUN_STATUS_SEQUENCE_607="completed:success"
export JOBS_JSON_606 JOBS_JSON_607
JOBS_JSON_606="$(jobs_json "apply production database patches:success")"
JOBS_JSON_607="$(jobs_json "apply production database patches:skipped")"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 13d: expected exit 1 when any run skipped the required job, got exit $status: $out"
grep -Fq '::error::Database Patches run 607' <<<"$out" \
    || fail "scenario 13d: expected the error to name run 607, got: $out"

# --- Scenario 14: a transient jobs lookup failure is retried, not read as
#     "missing" -> exit 0, after at least 3 lookups (2 failures + 1 success).
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="608 completed success"
export RUN_STATUS_SEQUENCE_608="completed:success"
export JOBS_JSON_608 JOBS_FAIL_UNTIL_608=2
JOBS_JSON_608="$(jobs_json "apply production database patches:success")"
scenario14_calls_dir="$(mktemp -d "$STATE_DIR/calls.XXXXXX")"
out="$(run_script "$scenario14_calls_dir")" || fail "scenario 14: expected exit 0 once the transient jobs lookup failures clear: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 14: expected the success message, got: $out"
call_count="$(cat "$scenario14_calls_dir/jobs_calls_608")"
(( call_count == 3 )) || fail "scenario 14: expected exactly 3 jobs lookups (2 transient failures + 1 success), got $call_count"

# --- Scenario 15: the jobs lookup never recovers -> fail closed with a
#     distinct error after 5 attempts, never a "missing"/"skipped" pass.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="609 completed success"
export RUN_STATUS_SEQUENCE_609="completed:success"
export JOBS_FAIL_ALWAYS_609=1
scenario15_calls_dir="$(mktemp -d "$STATE_DIR/calls.XXXXXX")"
set +e
out="$(run_script "$scenario15_calls_dir" 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 15: expected exit 1 when jobs can never be read, got exit $status: $out"
grep -Fq 'could not read jobs of run 609' <<<"$out" \
    || fail "scenario 15: expected the 'could not read jobs' error, got: $out"
call_count="$(cat "$scenario15_calls_dir/jobs_calls_609")"
(( call_count == 5 )) || fail "scenario 15: expected exactly 5 jobs lookup attempts, got $call_count"

# --- Scenario 16: REQUIRED_JOB_NAME unset -> the jobs endpoint is never
#     called and a success run passes exactly as before (no fixture is
#     provided, so any jobs call would exit 98 and fail the gate).
reset_scenario_env
RUNS_PRIMARY="610 completed success"
export RUN_STATUS_SEQUENCE_610="completed:success"
scenario16_calls_dir="$(mktemp -d "$STATE_DIR/calls.XXXXXX")"
out="$(run_script "$scenario16_calls_dir")" || fail "scenario 16: expected exit 0 with REQUIRED_JOB_NAME unset: $out"
grep -Fq 'Database Patches run(s) succeeded' <<<"$out" \
    || fail "scenario 16: expected the success message, got: $out"
[[ ! -e "$scenario16_calls_dir/jobs_calls_610" ]] \
    || fail "scenario 16: the jobs endpoint must not be called when REQUIRED_JOB_NAME is unset"

# --- Scenario 17: REQUIRED_JOB_NAME set but no run exists and none is
#     expected (no prisma changes) -> still proceeds; the job check is not
#     added to the no-run path.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
CHANGED_FILES=$'backend/src/foo.ts'
RUNS_PRIMARY=""
RUNS_FALLBACK=""
out="$(run_script)" || fail "scenario 17: expected exit 0 on the no-run path with REQUIRED_JOB_NAME set: $out"
grep -Fq "No Database Patches run for $HEAD_SHA_FIXTURE" <<<"$out" \
    || fail "scenario 17: expected the no-run-expected message, got: $out"

# --- Scenario 18: a failed run is still reported by the run-level check
#     before any job lookup, even with REQUIRED_JOB_NAME set.
reset_scenario_env
export REQUIRED_JOB_NAME="$REQUIRED_JOB"
RUNS_PRIMARY="611 completed failure"
export RUN_STATUS_SEQUENCE_611="completed:failure"
set +e
out="$(run_script 2>&1)"
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "scenario 18: expected exit 1 for a failed run, got exit $status: $out"
grep -Fq '::error::Database Patches run 611 concluded failure' <<<"$out" \
    || fail "scenario 18: expected the run-level failure message, got: $out"

echo "wait-database-patches unit tests passed"
