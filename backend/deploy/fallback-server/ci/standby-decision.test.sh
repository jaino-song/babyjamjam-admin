#!/usr/bin/env bash
# Executes standby-decision.sh against real git histories. The decision used to
# live inline in the workflow where only its text could be checked, so reversing
# an ancestry test passed every check. This suite runs the decision, and then
# proves it can fail: it re-runs itself against mutated copies of the script
# (reversed polarity, swapped arguments, dropped health rule) and requires each
# run to fail. Offline; bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SELF="$ROOT/$(basename "${BASH_SOURCE[0]}")"
SCRIPT="${STANDBY_DECISION_SCRIPT:-$ROOT/standby-decision.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- fixture history:  A -> B -> C (main),  D branches off A
REPO="$TMP/repo"
git init -q "$REPO"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
commit() { git -C "$REPO" -c commit.gpgsign=false commit -q --no-verify --allow-empty -m "$1"; git -C "$REPO" rev-parse HEAD; }
A="$(commit A)"
B="$(commit B)"
C="$(commit C)"
git -C "$REPO" checkout -q -b diverged "$A"
D="$(commit D)"
git -C "$REPO" checkout -q -
UNKNOWN="$(printf 'e%.0s' {1..40})"

status_text() { # release [tag]
    printf '%s\n' "environment=fallback-server" "standby_release=$1"
    if [[ -n "${2:-}" ]]; then
        printf '%s\n' "current_tag=$2" "current_digest=sha256:$(printf '1%.0s' {1..64})"
    fi
    printf '%s\n' "public_routing=aws"
}

OUT="$TMP/out"
RC=0
decide_with() { # sha status-text -> RC, OUT
    RC=0
    (cd "$REPO" && printf '%s\n' "$2" | GITHUB_SHA="$1" bash "$SCRIPT") >"$OUT" 2>"$TMP/err" || RC=$?
}
expect() { # description sha status-text expected-decision
    decide_with "$2" "$3"
    local want_rc=0
    if [[ "$4" == refuse ]]; then want_rc=1; fi
    [[ "$(grep -c '^decision=' "$OUT" || true)" == 1 ]] || { cat "$OUT" "$TMP/err" >&2; fail "$1: expected exactly one decision line"; }
    grep -Fxq "decision=$4" "$OUT" || { cat "$OUT" "$TMP/err" >&2; fail "$1: expected decision=$4"; }
    grep -q '^reason=.' "$OUT" || fail "$1: no reason printed"
    if [[ "$want_rc" == 0 ]]; then
        [[ "$RC" == 0 ]] || fail "$1: exit $RC, expected 0"
    else
        [[ "$RC" != 0 ]] || fail "$1: refuse must exit non-zero"
    fi
}

expect "no release"                              "$C" "$(status_text none)"                       deploy
expect "present, current A, sha C"               "$C" "$(status_text present "$A")"               deploy
expect "present, current B, sha C"               "$C" "$(status_text present "$B")"               deploy
expect "present, current C, sha C"               "$C" "$(status_text present "$C")"               superseded
expect "present, current C, sha A"               "$A" "$(status_text present "$C")"               superseded
expect "present, current C, sha B"               "$B" "$(status_text present "$C")"               superseded
expect "recorded-unhealthy, current C, sha C"    "$C" "$(status_text recorded-unhealthy "$C")"    deploy
expect "recorded-unhealthy, current C, sha A"    "$A" "$(status_text recorded-unhealthy "$C")"    superseded
expect "recorded-unhealthy, current A, sha C"    "$C" "$(status_text recorded-unhealthy "$A")"    deploy
expect "present, current D (diverged), sha C"    "$C" "$(status_text present "$D")"               refuse
expect "present, current C, sha D (diverged)"    "$D" "$(status_text present "$C")"               refuse
expect "recorded-unhealthy, diverged"            "$C" "$(status_text recorded-unhealthy "$D")"    refuse
expect "current not in history"                  "$C" "$(status_text present "$UNKNOWN")"         refuse
expect "recorded-unhealthy, current not in history" "$C" "$(status_text recorded-unhealthy "$UNKNOWN")" refuse
expect "sha not in history"                      "$UNKNOWN" "$(status_text present "$C")"         refuse
echo "ok - ancestry decisions"

# --- malformed input is a refusal, never a deploy
expect "empty status"                            "$C" ""                                          refuse
expect "unknown release state"                   "$C" "$(status_text bogus "$A")"                 refuse
expect "present without current_tag"            "$C" "$(status_text present)"                    refuse
expect "recorded-unhealthy without current_tag"  "$C" "$(status_text recorded-unhealthy)"         refuse
expect "current_tag not a sha"                   "$C" "$(status_text present not-a-sha)"          refuse
expect "current_tag is a short sha"              "$C" "$(status_text present "${A:0:12}")"        refuse
expect "duplicated standby_release"              "$C" "$(status_text none; echo standby_release=none)" refuse
expect "duplicated current_tag"                  "$C" "$(status_text present "$A"; echo "current_tag=$B")" refuse
expect "missing standby_release"                 "$C" "$(status_text none | grep -v '^standby_release=')" refuse
expect "wrong environment"                       "$C" "$(status_text none | sed 's/^environment=.*/environment=other/')" refuse
expect "route not aws"                           "$C" "$(status_text none | sed 's/^public_routing=.*/public_routing=fallback/')" refuse
expect "invalid GITHUB_SHA"                      "zz" "$(status_text none)"                       refuse
expect "empty GITHUB_SHA"                        ""   "$(status_text none)"                       refuse
echo "ok - malformed input is refused"

# --- the status may also be passed as a file
printf '%s\n' "$(status_text present "$C")" >"$TMP/status.txt"
RC=0
(cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" "$TMP/status.txt") >"$OUT" 2>/dev/null || RC=$?
[[ "$RC" == 0 ]] && grep -Fxq "decision=superseded" "$OUT" || fail "status passed as a file was not honoured"
RC=0
(cd "$REPO" && GITHUB_SHA="$A" bash "$SCRIPT" "$TMP/missing.txt") >"$OUT" 2>/dev/null || RC=$?
[[ "$RC" != 0 ]] || fail "a missing status file must refuse"
echo "ok - status file argument"

# --- a newer release already on Lightsail turns a deploy into superseded, nothing else.
# History A -> B -> C; the standby is still at A. B's run arrives after C deployed to
# Lightsail (the standby job for C failed before deploying): B must not deploy.
expect_newer() { # description sha status-text newer-value expected-decision
    RC=0
    (cd "$REPO" && printf '%s\n' "$3" | GITHUB_SHA="$2" NEWER_PRIMARY_RELEASE="$4" bash "$SCRIPT") >"$OUT" 2>"$TMP/err" || RC=$?
    [[ "$(grep -c '^decision=' "$OUT" || true)" == 1 ]] || { cat "$OUT" "$TMP/err" >&2; fail "$1: expected exactly one decision line"; }
    grep -Fxq "decision=$5" "$OUT" || { cat "$OUT" "$TMP/err" >&2; fail "$1: expected decision=$5"; }
    if [[ "$5" == refuse ]]; then
        [[ "$RC" != 0 ]] || fail "$1: refuse must exit non-zero"
    else
        [[ "$RC" == 0 ]] || fail "$1: exit $RC, expected 0"
    fi
}
expect_newer "standby at A, run B, C already deployed"  "$B" "$(status_text present "$A")"              "$C"   superseded
grep -q "$C" "$OUT" || fail "the superseded reason must name the newer release"
expect_newer "standby at A, run B, nothing newer"       "$B" "$(status_text present "$A")"              none   deploy
expect_newer "no release, a newer one deployed"          "$B" "$(status_text none)"                      "$C"   superseded
expect_newer "no release, nothing newer"                 "$B" "$(status_text none)"                      none   deploy
expect_newer "unhealthy same release, a newer one deployed" "$C" "$(status_text recorded-unhealthy "$C")" "$D"  superseded
expect_newer "unhealthy same release, nothing newer"     "$C" "$(status_text recorded-unhealthy "$C")"   none   deploy
expect_newer "already superseded stays superseded"       "$A" "$(status_text present "$C")"              "$C"   superseded
expect_newer "already superseded, nothing newer"         "$A" "$(status_text present "$C")"              none   superseded
# The newer-release input may only turn deploy into superseded; every refusal stands.
expect_newer "diverged still refuses"                    "$C" "$(status_text present "$D")"              "$C"   refuse
expect_newer "unknown release still refuses"             "$C" "$(status_text present "$UNKNOWN")"        "$C"   refuse
expect_newer "wrong route still refuses"                 "$C" "$(status_text none | sed 's/^public_routing=.*/public_routing=fallback/')" "$C" refuse
expect_newer "bad status still refuses"                  "$C" "$(status_text bogus "$A")"                "$C"   refuse
expect_newer "empty status still refuses"                "$C" ""                                         "$C"   refuse
# A malformed newer-release input is a refusal, never "nothing newer".
expect_newer "empty newer value"                         "$C" "$(status_text none)"                      ""     refuse
expect_newer "short newer sha"                           "$C" "$(status_text none)"                      "${B:0:12}" refuse
expect_newer "garbage newer value"                       "$C" "$(status_text none)"                      refuse-me refuse
expect_newer "uppercase newer sha"                       "$C" "$(status_text none)"                      "$(printf '%s' "$B" | tr 'a-f' 'A-F')" refuse
echo "ok - a newer Lightsail release supersedes only a deploy"

if [[ -n "${STANDBY_DECISION_SCRIPT:-}" ]]; then
    echo "Standby decision suite passed against $SCRIPT"
    exit 0
fi

# --- self-check: the suite must fail against a script with a broken guard
mutate() { # description sed-expression
    local mutant="$TMP/mutant.sh"
    sed "$2" "$SCRIPT" >"$mutant"
    if cmp -s "$SCRIPT" "$mutant"; then fail "mutation did not change the script: $1"; fi
    if STANDBY_DECISION_SCRIPT="$mutant" bash "$SELF" >/dev/null 2>&1; then
        fail "the suite still passes with a broken guard: $1"
    fi
    echo "ok - suite fails when: $1"
}
mutate "both ancestry tests reversed (negated)" \
    's/if git merge-base --is-ancestor/if ! git merge-base --is-ancestor/'
mutate "superseded test negated" \
    '/--is-ancestor "\$sha" "\$current_tag"/s/if git/if ! git/'
mutate "deploy test negated" \
    '/if git merge-base --is-ancestor "\$current_tag" "\$sha"/s/if git/if ! git/'
mutate "superseded ancestor arguments swapped" \
    's/--is-ancestor "\$sha" "\$current_tag"/--is-ancestor "\$current_tag" "\$sha"/'
mutate "deploy ancestor arguments swapped" \
    's/--is-ancestor "\$current_tag" "\$sha"; then/--is-ancestor "\$sha" "\$current_tag"; then/'
mutate "an unhealthy host is no longer redeployed at the same release" \
    's/== recorded-unhealthy \]\]/== never-matches ]]/'
mutate "an unhealthy host is no longer treated as having a release" \
    's/present | recorded-unhealthy) ;;/present) ;;/'
mutate "a newer Lightsail release no longer supersedes a deploy" \
    's/if \[\[ -n "\${newer_primary:-}" \&\& "\$newer_primary" != none \]\]; then/if false; then/'
mutate "a malformed newer-release value is accepted" \
    's/|| refuse "NEWER_PRIMARY_RELEASE is neither.*/|| true/'
mutate "the newer-release input overrides a refusal" \
    's/^    refuse "the standby release \$current_tag has diverged.*/    decide_deploy diverged; return 0/'
mutate "divergence deploys instead of refusing" \
    's/^    refuse "the standby release \$current_tag has diverged.*/    decide deploy diverged; return 0/'

echo "Standby decision tests passed"
