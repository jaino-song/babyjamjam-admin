#!/usr/bin/env bash
# Decide whether a NEWER backend release than this run's has already deployed
# to Lightsail (the primary), from two GitHub API responses the workflow saves
# to files and from the git history of the checkout it runs in.
#
#   newer-primary-release.sh list   <runs.json>              (env GITHUB_SHA)
#       prints the id of every run whose head commit is a strict descendant of
#       GITHUB_SHA, one per line: the runs whose Lightsail deploy job must be
#       fetched. Nothing is printed when there are none.
#   newer-primary-release.sh decide <runs.json> <jobs-dir>   (env GITHUB_SHA)
#       <jobs-dir>/<run-id>.json holds that run's jobs response. Prints
#       `newer=<sha>|none` and a `reason=` line. Exits non-zero, printing
#       `newer=refuse`, on anything it cannot rely on.
#
# <runs.json> is `GET /repos/{repo}/actions/workflows/backend-ci.yml/runs
# ?branch=main&event=push&per_page=100`. One page (the newest 100 `main` push
# runs) is enough: a newer release that old has long been followed by newer
# ones, and every run newer than this one is on that page unless 100 runs were
# pushed in between. <jobs-dir>/<id>.json is `GET /repos/{repo}/actions/runs/{id}
# /jobs?filter=latest&per_page=100` (a re-run is judged by its latest attempt).
#
# Fail closed: a response that is not what this script expects, a run commit
# that is not in the local history (a run pushed after this checkout), or a
# descendant run without its jobs file, is an error, never "no newer release".
# Only a Lightsail deploy job that is `completed` with conclusion `success`
# counts. The jobs API returns display names, so the job is matched by the name
# `deploy Lightsail backend` and must appear exactly once in a run.
set -euo pipefail

readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly ID_PATTERN='^[0-9]+$'
readonly DEPLOY_JOB_NAME='deploy Lightsail backend'

fail() {
    printf 'newer=refuse\nreason=%s\n' "$1"
    exit 1
}

usage_fail() {
    fail "usage: newer-primary-release.sh list <runs.json> | decide <runs.json> <jobs-dir>"
}

# Prints "<id> <head_sha>" for each strict descendant of $sha, newest first as
# the API returns them. Exits through fail() on any malformed run.
descendant_runs() { # runs-file sha
    local runs_file="$1" sha="$2" run_lines line event branch run_id head extra
    [[ -f "$runs_file" ]] || fail "the runs response $runs_file does not exist"
    jq -e '(.workflow_runs | type) == "array"' "$runs_file" >/dev/null 2>&1 \
        || fail "the runs response is not a JSON object with a workflow_runs array"
    git cat-file -e "${sha}^{commit}" 2>/dev/null \
        || fail "this commit $sha is not in the repository"
    # Read to a variable first: a jq failure must stop here, not truncate a loop.
    run_lines="$(jq -r '.workflow_runs[]
        | [.event, .head_branch, .id, .head_sha]
        | map(if type == "string" or type == "number" then tostring else "-" end)
        | join(" ")' "$runs_file")" || fail "a run entry in the runs response could not be read"
    while IFS= read -r line; do
        [[ -n "$line" ]] || continue
        extra=""
        read -r event branch run_id head extra <<<"$line"
        [[ -z "$extra" ]] || fail "a run entry has unexpected content"
        [[ "$run_id" =~ $ID_PATTERN ]] || fail "a run has no numeric id"
        [[ "$head" =~ $SHA_PATTERN ]] || fail "run $run_id has no 40-hex head_sha"
        [[ "$event" != - && "$branch" != - ]] || fail "run $run_id has no event or head_branch"
        # The query already asks for main pushes; anything else is not a release.
        [[ "$event" == push && "$branch" == main ]] || continue
        [[ "$head" != "$sha" ]] || continue
        git cat-file -e "${head}^{commit}" 2>/dev/null \
            || fail "run $run_id head $head is not in this checkout's history"
        if git merge-base --is-ancestor "$sha" "$head"; then
            printf '%s %s\n' "$run_id" "$head"
        fi
    done <<<"$run_lines"
}

# Prints "<status> <conclusion>" for the single Lightsail deploy job of a run.
deploy_job_state() { # jobs-file run-id
    local jobs_file="$1" run_id="$2" count state
    [[ -f "$jobs_file" ]] || fail "the jobs of newer run $run_id were not fetched"
    jq -e '(.jobs | type) == "array" and (.total_count | type) == "number"
        and .total_count == (.jobs | length)' "$jobs_file" >/dev/null 2>&1 \
        || fail "the jobs response of run $run_id is malformed or truncated"
    count="$(jq --arg name "$DEPLOY_JOB_NAME" '[.jobs[] | select(.name == $name)] | length' "$jobs_file")" \
        || fail "a job entry in the jobs response of run $run_id could not be read"
    [[ "$count" == 1 ]] \
        || fail "run $run_id has $count jobs named '$DEPLOY_JOB_NAME' (expected exactly 1)"
    state="$(jq -r --arg name "$DEPLOY_JOB_NAME" '.jobs[] | select(.name == $name)
        | [.status, .conclusion]
        | map(if type == "string" then . else "-" end)
        | join(" ")' "$jobs_file")" || fail "the Lightsail deploy job of run $run_id could not be read"
    [[ "$state" =~ ^[a-z_]+\ ([a-z_]+|-)$ ]] \
        || fail "the Lightsail deploy job of run $run_id has no readable status"
    printf '%s\n' "$state"
}

main() {
    local mode="${1:-}" sha="${GITHUB_SHA:-}"
    local runs_file jobs_dir descendants run_id head state status conclusion

    [[ "$sha" =~ $SHA_PATTERN ]] || fail "GITHUB_SHA is not a 40-hex commit"
    case "$mode" in
        list)
            [[ "$#" -eq 2 ]] || usage_fail
            descendants="$(descendant_runs "$2" "$sha")" || { printf '%s\n' "$descendants"; exit 1; }
            if [[ -n "$descendants" ]]; then
                awk '{ print $1 }' <<<"$descendants"
            fi
            ;;
        decide)
            [[ "$#" -eq 3 ]] || usage_fail
            runs_file="$2"
            jobs_dir="$3"
            descendants="$(descendant_runs "$runs_file" "$sha")" || { printf '%s\n' "$descendants"; exit 1; }
            while read -r run_id head; do
                [[ -n "$run_id" ]] || continue
                state="$(deploy_job_state "$jobs_dir/$run_id.json" "$run_id")" \
                    || { printf '%s\n' "$state"; exit 1; }
                read -r status conclusion <<<"$state"
                if [[ "$status" == completed && "$conclusion" == success ]]; then
                    printf 'newer=%s\nreason=run %s deployed %s to Lightsail after %s\n' \
                        "$head" "$run_id" "$head" "$sha"
                    return 0
                fi
            done <<<"$descendants"
            printf 'newer=none\nreason=no newer commit has a successful Lightsail deploy\n'
            ;;
        *) usage_fail ;;
    esac
}

main "$@"
