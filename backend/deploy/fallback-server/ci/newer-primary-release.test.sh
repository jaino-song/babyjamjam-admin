#!/usr/bin/env bash
# Executes newer-primary-release.sh against real git histories and fixture GitHub
# API responses. The workflow only fetches the two responses and feeds them in, so
# this is where "is this run still the newest successful Lightsail deploy?" is proved.
# It then proves the suite can fail: it re-runs itself against mutated copies of the
# script and requires each run to fail. Offline; bash 3.2 compatible; needs jq.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SELF="$ROOT/$(basename "${BASH_SOURCE[0]}")"
SCRIPT="${NEWER_PRIMARY_SCRIPT:-$ROOT/newer-primary-release.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
command -v jq >/dev/null || fail "jq is required"

# --- fixture history:  O -> A -> B -> C (main),  D branches off O
REPO="$TMP/repo"
git init -q "$REPO"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
commit() { git -C "$REPO" -c commit.gpgsign=false commit -q --no-verify --allow-empty -m "$1"; git -C "$REPO" rev-parse HEAD; }
O="$(commit O)"
A="$(commit A)"
B="$(commit B)"
C="$(commit C)"
git -C "$REPO" checkout -q -b diverged "$O"
D="$(commit D)"
git -C "$REPO" checkout -q -
UNKNOWN="$(printf 'e%.0s' {1..40})"

JOB_NAME="deploy Lightsail backend"
WORK="$TMP/work"
reset_work() { rm -rf "$WORK"; mkdir -p "$WORK/jobs"; : >"$WORK/runs.tsv"; }

# add_run id sha [event] [branch]  -> a run entry in the runs response
add_run() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "${3:-push}" "${4:-main}" >>"$WORK/runs.tsv"; }
write_runs() {
    jq -Rn '{total_count: 0, workflow_runs: [inputs | split("\t") | {id: (.[0] | tonumber), head_sha: .[1], event: .[2], head_branch: .[3]}]}
        | .total_count = (.workflow_runs | length)' <"$WORK/runs.tsv" >"$WORK/runs.json"
}
# add_jobs id status conclusion  -> that run's jobs response, with the Lightsail deploy job in that state
add_jobs() {
    jq -n --arg name "$JOB_NAME" --arg status "$2" --arg conclusion "$3" '
        [{name: "build image", status: "completed", conclusion: "success"},
         {name: $name, status: $status, conclusion: (if $conclusion == "null" then null else $conclusion end)},
         {name: "deploy LightNode standby backend", status: "completed", conclusion: "success"}]
        | {total_count: length, jobs: .}' >"$WORK/jobs/$1.json"
}

OUT="$TMP/out"
RC=0
run_decide() { # sha
    RC=0
    write_runs
    (cd "$REPO" && GITHUB_SHA="$1" bash "$SCRIPT" decide "$WORK/runs.json" "$WORK/jobs") >"$OUT" 2>"$TMP/err" || RC=$?
}
expect_newer() { # description sha expected-newer
    run_decide "$2"
    [[ "$RC" == 0 ]] || { cat "$OUT" "$TMP/err" >&2; fail "$1: exit $RC, expected 0"; }
    [[ "$(grep -c '^newer=' "$OUT" || true)" == 1 ]] || fail "$1: expected exactly one newer line"
    grep -Fxq "newer=$3" "$OUT" || { cat "$OUT" "$TMP/err" >&2; fail "$1: expected newer=$3"; }
    grep -q '^reason=.' "$OUT" || fail "$1: no reason printed"
}
expect_refuse() { # description sha
    run_decide "$2"
    [[ "$RC" != 0 ]] || { cat "$OUT" >&2; fail "$1: must exit non-zero"; }
    grep -Fxq "newer=refuse" "$OUT" || { cat "$OUT" "$TMP/err" >&2; fail "$1: expected newer=refuse"; }
    grep -q '^reason=.' "$OUT" || fail "$1: no reason printed"
}

# --- the audited scenario: O -> A -> B. Lightsail deployed A then B; B's standby job
# failed before deploying; A's standby job is re-run. A must see that B is newer.
reset_work
add_run 3 "$B"; add_jobs 3 completed success
add_run 2 "$A"; add_jobs 2 completed success
add_run 1 "$O"; add_jobs 1 completed success
expect_newer "O->A->B, run A: B deployed to Lightsail" "$A" "$B"
expect_newer "O->A->B, run B: nothing newer"           "$B" none
expect_newer "O->A->B, run O: A is newer (first match wins, newest first)" "$O" "$B"
echo "ok - the stale primary release scenario"

# --- no descendant success falls through
reset_work
add_run 2 "$A"; add_jobs 2 completed success
add_run 1 "$O"; add_jobs 1 completed success
expect_newer "only this run and an older one" "$A" none
reset_work
expect_newer "no runs at all" "$A" none
echo "ok - nothing newer"

# --- a descendant whose Lightsail deploy did not succeed does not count
for state in "completed failure" "completed skipped" "completed cancelled" "in_progress null" "queued null" "completed timed_out"; do
    reset_work
    add_run 2 "$B"; add_jobs 2 $state
    add_run 1 "$A"; add_jobs 1 completed success
    expect_newer "descendant deploy job is '$state'" "$A" none
done
# a failed newer deploy does not hide an even newer success
reset_work
add_run 3 "$C"; add_jobs 3 completed success
add_run 2 "$B"; add_jobs 2 completed failure
expect_newer "failed B then successful C" "$A" "$C"
echo "ok - only a completed success counts"

# --- runs that are not strict descendants do not count, whatever they concluded
reset_work
add_run 3 "$A"; add_jobs 3 completed success            # this very commit (a re-run)
add_run 2 "$D"; add_jobs 2 completed success            # diverged
add_run 1 "$O"; add_jobs 1 completed success            # older
expect_newer "same commit, diverged and older successes" "$A" none
reset_work
add_run 2 "$B" pull_request main; add_jobs 2 completed success
add_run 1 "$B" push feature;       add_jobs 1 completed success
expect_newer "descendant runs that are not main pushes" "$A" none
echo "ok - non-descendants are ignored"

# --- only descendants are listed for fetching
reset_work
add_run 5 "$C"; add_run 4 "$B"; add_run 3 "$A"; add_run 2 "$D"; add_run 1 "$O"
write_runs
LISTED="$(cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" list "$WORK/runs.json")"
[[ "$LISTED" == "$(printf '5\n4')" ]] || fail "list printed '$LISTED', expected the runs of C and B only"
LISTED="$(cd "$REPO" && GITHUB_SHA="$C" bash "$SCRIPT" list "$WORK/runs.json")"
[[ -z "$LISTED" ]] || fail "list printed '$LISTED' for the newest commit"
echo "ok - list prints descendant runs only"

# --- malformed input refuses; never "nothing newer"
reset_work
add_run 2 "$B"; add_jobs 2 completed success
expect_refuse "invalid GITHUB_SHA" "zz"
expect_refuse "empty GITHUB_SHA" ""
expect_refuse "GITHUB_SHA not in history" "$UNKNOWN"

reset_work; add_run 2 "$UNKNOWN"; add_jobs 2 completed success
expect_refuse "a run commit absent from local history" "$A"

reset_work; add_run 2 "$B"
expect_refuse "descendant run without a jobs file" "$A"

reset_work; add_run 2 "$B"; echo '{' >"$WORK/jobs/2.json"
expect_refuse "jobs file is not JSON" "$A"

reset_work; add_run 2 "$B"; echo '{"total_count":0,"jobs":[]}' >"$WORK/jobs/2.json"
expect_refuse "run without the Lightsail deploy job" "$A"

reset_work; add_run 2 "$B"
jq -n --arg n "$JOB_NAME" '{total_count:2,jobs:[{name:$n,status:"completed",conclusion:"failure"},{name:$n,status:"completed",conclusion:"success"}]}' >"$WORK/jobs/2.json"
expect_refuse "run with two Lightsail deploy jobs" "$A"

reset_work; add_run 2 "$B"
jq -n '{total_count:1,jobs:[{name:"deploy-lightsail",status:"completed",conclusion:"success"}]}' >"$WORK/jobs/2.json"
expect_refuse "the job id is not the display name the API returns" "$A"

reset_work; add_run 2 "$B"
jq -n --arg n "$JOB_NAME" '{total_count:150,jobs:[{name:$n,status:"completed",conclusion:"success"}]}' >"$WORK/jobs/2.json"
expect_refuse "truncated jobs page" "$A"

reset_work; add_run 2 "$B"
jq -n --arg n "$JOB_NAME" '{total_count:1,jobs:[{name:$n,conclusion:"success"}]}' >"$WORK/jobs/2.json"
expect_refuse "job without a status" "$A"

reset_work; add_run 2 "$B"; echo '{"jobs":[]}' >"$WORK/jobs/2.json"
expect_refuse "jobs response without total_count" "$A"

reset_work; echo 'not json' >"$WORK/runs.json"
RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" decide "$WORK/runs.json" "$WORK/jobs") >"$OUT" 2>&1 || RC=$?
[[ "$RC" != 0 ]] && grep -Fxq "newer=refuse" "$OUT" || fail "a runs response that is not JSON must refuse"
echo '{"message":"Bad credentials"}' >"$WORK/runs.json"
RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" decide "$WORK/runs.json" "$WORK/jobs") >"$OUT" 2>&1 || RC=$?
[[ "$RC" != 0 ]] && grep -Fxq "newer=refuse" "$OUT" || fail "an API error body must refuse"
RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" decide "$TMP/missing.json" "$WORK/jobs") >"$OUT" 2>&1 || RC=$?
[[ "$RC" != 0 ]] || fail "a missing runs file must refuse"
RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" list "$WORK/runs.json") >"$OUT" 2>&1 || RC=$?
[[ "$RC" != 0 ]] || fail "list must refuse an API error body"

for malformed_run in '{"workflow_runs":[{"id":"x","head_sha":"B","event":"push","head_branch":"main"}]}' \
    '{"workflow_runs":[{"id":2,"head_sha":"short","event":"push","head_branch":"main"}]}' \
    '{"workflow_runs":[{"id":2,"event":"push","head_branch":"main"}]}' \
    '{"workflow_runs":[{"id":2,"head_sha":"B","head_branch":"main"}]}' \
    '{"workflow_runs":[7]}'; do
    printf '%s\n' "${malformed_run//B/$B}" >"$WORK/runs.json"
    RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" decide "$WORK/runs.json" "$WORK/jobs") >"$OUT" 2>&1 || RC=$?
    [[ "$RC" != 0 ]] && grep -Fxq "newer=refuse" "$OUT" || fail "a malformed run entry must refuse: $malformed_run"
done

RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT") >"$OUT" 2>&1 || RC=$?
[[ "$RC" != 0 ]] || fail "no mode must refuse"
RC=0; (cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" decide "$WORK/runs.json") >"$OUT" 2>&1 || RC=$?
[[ "$RC" != 0 ]] || fail "decide without a jobs directory must refuse"
echo "ok - malformed input is refused"

if [[ -n "${NEWER_PRIMARY_SCRIPT:-}" ]]; then
    echo "Newer primary release suite passed against $SCRIPT"
    exit 0
fi

# --- self-check: the suite must fail against a script with a broken guard
mutate() { # description sed-expression
    local mutant="$TMP/mutant.sh"
    sed "$2" "$SCRIPT" >"$mutant"
    if cmp -s "$SCRIPT" "$mutant"; then fail "mutation did not change the script: $1"; fi
    if NEWER_PRIMARY_SCRIPT="$mutant" bash "$SELF" >/dev/null 2>&1; then
        fail "the suite still passes with a broken guard: $1"
    fi
    echo "ok - suite fails when: $1"
}
mutate "descendant polarity flipped" \
    's/if git merge-base --is-ancestor "\$sha" "\$head"; then/if ! git merge-base --is-ancestor "$sha" "$head"; then/'
mutate "descendant ancestor arguments swapped" \
    's/--is-ancestor "\$sha" "\$head"/--is-ancestor "$head" "$sha"/'
mutate "this run itself counts as newer" \
    's/^        \[\[ "\$head" != "\$sha" \]\] || continue$/        true/'
mutate "a failed deploy counts as success" \
    's/\[\[ "\$status" == completed \&\& "\$conclusion" == success \]\]/[[ "$status" == completed ]]/'
mutate "a deploy that is not completed counts" \
    's/\[\[ "\$status" == completed \&\& "\$conclusion" == success \]\]/[[ "$conclusion" == success || "$status" == in_progress ]]/'
mutate "an absent or repeated deploy job is tolerated" \
    's/^    \[\[ "\$count" == 1 \]\] \\$/    [[ "$count" -le 5 ]] \\/;s/^    \[\[ "\$state" =~ .*/    [[ -n "$state" ]] \\/'
mutate "a run missing from local history is skipped" \
    's/^            || fail "run \$run_id head \$head is not in this checkout.s history"/            || continue/'
mutate "a missing jobs file is treated as not deployed" \
    's/\[\[ -f "\$jobs_file" \]\] || fail .*/[[ -f "$jobs_file" ]] || { printf "completed failure\\n"; return 0; }/'
mutate "the run event and branch are not checked" \
    's/^        \[\[ "\$event" == push \&\& "\$branch" == main \]\] || continue$/        true/'
mutate "a truncated jobs page is accepted" \
    's/ and .total_count == (.jobs | length)//'

echo "Newer primary release tests passed"
