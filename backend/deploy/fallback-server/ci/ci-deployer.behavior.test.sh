#!/usr/bin/env bash
# Behavioral contract for the LightNode passive-standby CI commands
# (`standby-status`, `deploy-standby`) and their SSH dispatcher. It executes a
# copy of ci-deployer.sh with its entrypoint removed, the protected paths moved
# into a temp directory and the operator replaced by a stub. It never touches
# Docker, sudo, DNS or the network, and runs under bash 3.2 (macOS) and Linux.
#
# Every refusal is paired with a success path, so a command that blocks
# everything cannot pass.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/world"
COPY="$TMP/ci-deployer.sh"
STUB="$TMP/operator-stub.sh"
DISPATCH_COPY="$TMP/ssh-dispatch.sh"
DISPATCH_STUB="$TMP/sudo-stub.sh"
ALL_CALLS="$TMP/all-operator-calls.log"
: >"$ALL_CALLS"

fail() { echo "FAIL: $*" >&2; exit 1; }

SHA_A="$(printf 'a%.0s' {1..40})"
SHA_B="$(printf 'b%.0s' {1..40})"
DIG_A="sha256:$(printf '1%.0s' {1..64})"
DIG_B="sha256:$(printf '2%.0s' {1..64})"
FALLBACK_HASH="$(printf 'a%.0s' {1..64})"
AWS_HASH="$(printf 'b%.0s' {1..64})"

# --- the deployer copy: no entrypoint, protected paths and operator redirected
sed -e '$d' \
    -e "s|^readonly STATE_ROOT=.*|readonly STATE_ROOT=\"$W/root\"|" \
    -e "s|^readonly OPERATOR=.*|readonly OPERATOR=\"$STUB\"|" \
    "$ROOT/ci-deployer.sh" >"$COPY"
grep -q "$W/root" "$COPY" || fail "state root was not redirected"
grep -q "readonly OPERATOR=\"$STUB\"" "$COPY" || fail "operator was not redirected"
[[ "$(tail -n 1 "$ROOT/ci-deployer.sh")" == 'main "$@"' ]] || fail "main must stay the last line of ci-deployer.sh"

# --- an operator stub driven by files under $W
cat >"$STUB" <<'STUB'
#!/usr/bin/env bash
# Records every call; `status` replays status.out/status.rc, `deploy` replays
# deploy.rc and, on success, promotes status.after to the current status.
set -u
printf '%s\n' "$*" >>"$STUB_CALLS"
printf '%s\n' "$*" >>"$STUB_ALL_CALLS"
case "${1:-}" in
    status)
        if [[ -f "$STUB_WORLD/status.out" ]]; then cat "$STUB_WORLD/status.out"; fi
        exit "$(cat "$STUB_WORLD/status.rc" 2>/dev/null || echo 0)"
        ;;
    deploy)
        echo "OPERATOR-DEPLOY-STDOUT-SUMMARY"
        rc="$(cat "$STUB_WORLD/deploy.rc" 2>/dev/null || echo 0)"
        if [[ "$rc" == 0 && -f "$STUB_WORLD/status.after" ]]; then
            cp "$STUB_WORLD/status.after" "$STUB_WORLD/status.out"
            echo 0 >"$STUB_WORLD/status.rc"
        fi
        exit "$rc"
        ;;
    *)
        echo "unexpected operator command: $*" >&2
        exit 97
        ;;
esac
STUB
chmod 755 "$STUB"

status_block() { # tag digest mode schedulers [health] [restarts]
    local tag="$1" digest="$2" mode="$3" schedulers="$4" health="${5:-healthy}" restarts="${6:-0}"
    printf '%s\n' \
        "environment=fallback-server" \
        "current_tag=$tag" \
        "current_digest=$digest" \
        "container_health=$health" \
        "restart_count=$restarts" \
        "db_readiness=ok" \
        "production_db_identity=ok" \
        "public_routing=not_managed" \
        "runtime_mode=$mode" \
        "automatic_shutdown=enabled" \
        "schedulers_enabled=$schedulers" \
        "document_jobs_accepting=$schedulers" \
        "document_jobs_worker=$schedulers" \
        "lease_mode=off"
}

world_reset() {
    rm -rf "$W"
    mkdir -p "$W/root/state"
    printf '%s\n' "$FALLBACK_HASH" >"$W/root/approved-public-routing.sha256"
    printf '%s\n' "github-main-lightnode-auto-deploy-v1" >"$W/root/automatic-deploy-authority"
    : >"$W/calls.log"
    ROUTE_HASH="$AWS_HASH"
}

# Runs `main <args>` in a fresh shell with the host-only helpers replaced.
# set -e from the sourced script stays active, as in production.
run_main() {
    local rc=0
    STUB_WORLD="$W" STUB_CALLS="$W/calls.log" STUB_ALL_CALLS="$ALL_CALLS" ROUTE_HASH="$ROUTE_HASH" \
        bash -c '
            source "$1"; shift
            validate_protected_file() {
                [[ -e "$1" && ! -L "$1" ]] || die "A protected Fallback deployment artifact is missing or unsafe."
            }
            canonical_public_route_hash() {
                if [[ "$ROUTE_HASH" == unresolvable ]]; then die "The public API route could not be resolved."; fi
                printf "%s\n" "$ROUTE_HASH"
            }
            require_root_and_caller() { :; }
            main "$@"
        ' _ "$COPY" "$@" >"$W/out" 2>"$W/err" || rc=$?
    RC="$rc"
}

expect_ok() { [[ "$RC" == 0 ]] || { cat "$W/err" >&2; fail "$1 (exit $RC)"; }; }
expect_refused() { # description
    if [[ "$RC" == 0 ]]; then fail "$1 (exit 0, stdout: $(cat "$W/out"))"; fi
}
expect_err() { grep -Fq -- "$2" "$W/err" || { cat "$W/err" >&2; fail "$1: stderr lacks '$2'"; }; }
expect_out_line() { grep -Fxq -- "$2" "$W/out" || { cat "$W/out" >&2; fail "$1: stdout lacks line '$2'"; }; }
expect_no_out_line() { if grep -Fxq -- "$2" "$W/out"; then fail "$1: stdout has unexpected line '$2'"; fi; }
expect_no_operator_calls() { [[ ! -s "$W/calls.log" ]] || fail "$1: the operator was called: $(cat "$W/calls.log")"; }
expect_operator_called() { grep -Fxq -- "$2" "$W/calls.log" || fail "$1: operator call '$2' missing; saw: $(cat "$W/calls.log")"; }
expect_unique_key() {
    local count
    count="$(grep -c "^$2=" "$W/out" || true)"
    [[ "$count" == 1 ]] || { cat "$W/out" >&2; fail "$1: key $2 appears $count times"; }
}

DEPLOY_ARGS=(deploy-standby "$SHA_A" "$DIG_A")

# ===== 1. input validation (each refusal leaves the operator untouched)
world_reset; status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
for bad in "zz" "${SHA_A}0" "${SHA_A:1}" "$(printf 'A%.0s' {1..40})" ""; do
    run_main deploy-standby "$bad" "$DIG_A"
    expect_refused "deploy-standby accepted sha '$bad'"; expect_err "bad sha" "release identity is invalid"
    expect_no_operator_calls "bad sha '$bad'"
done
for bad in "sha256:zz" "$SHA_A" "sha256:${DIG_A#sha256:}0" "sha512:${DIG_A#sha256:}" ""; do
    run_main deploy-standby "$SHA_A" "$bad"
    expect_refused "deploy-standby accepted digest '$bad'"; expect_err "bad digest" "release identity is invalid"
    expect_no_operator_calls "bad digest '$bad'"
done
run_main deploy-standby "$SHA_A"; expect_refused "deploy-standby accepted a missing digest"
run_main deploy-standby "$SHA_A" "$DIG_A" extra; expect_refused "deploy-standby accepted an extra argument"
run_main standby-status extra; expect_refused "standby-status accepted an argument"
run_main bogus; expect_refused "unknown command accepted"; expect_err "unknown command" "standby-status|deploy-standby"
expect_no_operator_calls "argument validation"
echo "ok - identity and argument validation"

# ===== 2. route guard: refuse when LightNode is the public route, and when it cannot be resolved
for cmd in standby-status deploy-standby; do
    world_reset; ROUTE_HASH="$FALLBACK_HASH"
    status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
    if [[ "$cmd" == standby-status ]]; then run_main standby-status; else run_main "${DEPLOY_ARGS[@]}"; fi
    expect_refused "$cmd ran while LightNode is the public route"
    expect_err "$cmd on the fallback route" "LightNode is the public route"
    expect_no_operator_calls "$cmd on the fallback route"

    world_reset; ROUTE_HASH=unresolvable
    status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
    if [[ "$cmd" == standby-status ]]; then run_main standby-status; else run_main "${DEPLOY_ARGS[@]}"; fi
    expect_refused "$cmd treated an unresolvable route as not-LightNode"
    expect_err "$cmd on an unresolvable route" "could not be resolved"
    if grep -Fq "LightNode is the public route" "$W/err"; then fail "$cmd conflated unresolvable with fallback"; fi
    expect_no_operator_calls "$cmd on an unresolvable route"

    world_reset; rm -f "$W/root/approved-public-routing.sha256"
    if [[ "$cmd" == standby-status ]]; then run_main standby-status; else run_main "${DEPLOY_ARGS[@]}"; fi
    expect_refused "$cmd ran without the protected routing identity"
    expect_no_operator_calls "$cmd without the routing identity"
done
echo "ok - route guard (fallback route, unresolvable route, missing identity)"

# ===== 3. deploy-standby fence and authority
world_reset; status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
: >"$W/root/state/valkey-restore-fence"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran while the Valkey restore fence is present"
expect_err "fence" "restore fence is active"; expect_no_operator_calls "fence"

world_reset; status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
rm -f "$W/root/automatic-deploy-authority"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran without automation authority"; expect_no_operator_calls "missing authority"

world_reset; status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
printf '%s\n' "something-else" >"$W/root/automatic-deploy-authority"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran with a wrong automation authority"; expect_no_operator_calls "wrong authority"
echo "ok - fence and automation authority"

# ===== 4. deploy-standby refuses non-passive hosts
world_reset
status_block "$SHA_B" "$DIG_B" temporary-active true >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran against a temporary-active host"
expect_err "temporary-active" "not a passive Fallback release"
[[ "$(cat "$W/calls.log")" == "status" ]] || fail "temporary-active host reached operator deploy: $(cat "$W/calls.log")"

# runtime_mode is checked on its own: temporary-active with schedulers reported
# off must still be refused (the schedulers check alone would let it through).
world_reset
status_block "$SHA_B" "$DIG_B" temporary-active false >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran against temporary-active reporting schedulers off"
[[ "$(cat "$W/calls.log")" == "status" ]] || fail "mode-only temporary-active host reached operator deploy"

world_reset
status_block "$SHA_B" "$DIG_B" bogus false >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran against an unknown runtime mode"
[[ "$(cat "$W/calls.log")" == "status" ]] || fail "unknown-mode host reached operator deploy"

world_reset
status_block "$SHA_B" "$DIG_B" passive true >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran against a passive host reporting schedulers on"
[[ "$(cat "$W/calls.log")" == "status" ]] || fail "schedulers-on host reached operator deploy"

world_reset
status_block "$SHA_B" "$DIG_B" passive false | sed 's/^production_db_identity=ok/production_db_identity=bad/' >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran against a host with an unverified DB identity"
[[ "$(cat "$W/calls.log")" == "status" ]] || fail "unverified-DB host reached operator deploy"

world_reset
status_block "$SHA_B" "$DIG_B" passive false | grep -v '^runtime_mode=' >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby ran against a status without runtime_mode"
echo "ok - non-passive hosts are refused before the operator deploys"

# ===== 5. deploy-standby success on a passive host
world_reset
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
status_block "$SHA_A" "$DIG_A" passive false >"$W/status.after"
run_main "${DEPLOY_ARGS[@]}"
expect_ok "deploy-standby on a passive host"
expect_operator_called "passive deploy" "deploy $SHA_A $DIG_A"
expect_out_line "passive deploy" "current_tag=$SHA_A"
expect_out_line "passive deploy" "current_digest=$DIG_A"
expect_out_line "passive deploy" "runtime_mode=passive"
expect_out_line "passive deploy" "schedulers_enabled=false"
expect_out_line "passive deploy" "container_health=healthy"
expect_out_line "passive deploy" "restart_count=0"
expect_out_line "passive deploy" "public_routing=aws"
expect_out_line "passive deploy" "deployment_changed=true"
expect_no_out_line "passive deploy" "public_routing=not_managed"
expect_unique_key "passive deploy" public_routing
expect_unique_key "passive deploy" deployment_changed
if grep -Fq OPERATOR-DEPLOY-STDOUT "$W/out"; then fail "operator deploy output leaked into the status stream"; fi
grep -Fq OPERATOR-DEPLOY-STDOUT "$W/err" || fail "operator deploy output was not kept on stderr"
echo "ok - deploy on a passive host"

# ===== 6. deploy-standby proceeds when the operator status cannot be read
world_reset
echo 1 >"$W/status.rc"
status_block "$SHA_A" "$DIG_A" passive false >"$W/status.after"
run_main "${DEPLOY_ARGS[@]}"
expect_ok "deploy-standby on a host whose operator status fails"
expect_operator_called "unreadable status" "deploy $SHA_A $DIG_A"
expect_out_line "unreadable status" "deployment_changed=true"
expect_out_line "unreadable status" "public_routing=aws"
echo "ok - deploy proceeds to the operator when its status is unreadable"

# ===== 7. idempotent no-op on the same release; a different release still deploys
world_reset
status_block "$SHA_A" "$DIG_A" passive false >"$W/status.out"
run_main "${DEPLOY_ARGS[@]}"
expect_ok "idempotent deploy-standby"
expect_out_line "no-op" "deployment_changed=false"
expect_out_line "no-op" "public_routing=aws"
expect_out_line "no-op" "current_tag=$SHA_A"
expect_unique_key "no-op" public_routing
if grep -q '^deploy ' "$W/calls.log"; then fail "no-op deploy still called the operator deploy"; fi

world_reset
status_block "$SHA_A" "$DIG_B" passive false >"$W/status.out"
status_block "$SHA_A" "$DIG_A" passive false >"$W/status.after"
run_main "${DEPLOY_ARGS[@]}"
expect_ok "same tag, different digest"
expect_operator_called "same tag different digest" "deploy $SHA_A $DIG_A"
expect_out_line "same tag different digest" "deployment_changed=true"
echo "ok - idempotent no-op, and a changed digest still deploys"

# ===== 8. operator deploy failure and post-deploy verification failure
world_reset
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
echo 1 >"$W/deploy.rc"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "operator deploy failure was reported as success"
expect_err "operator deploy failure" "standby deployment failed"
if grep -q '^deployment_changed=' "$W/out"; then fail "failed deploy printed deployment_changed"; fi

world_reset
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.after"   # operator "succeeded" but the old release is still running
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby accepted a host still running the previous release"
expect_err "stale release" "did not publish the requested"

world_reset
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
status_block "$SHA_A" "$DIG_A" passive false unhealthy >"$W/status.after"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby accepted an unhealthy container"

world_reset
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
status_block "$SHA_A" "$DIG_A" passive false healthy 2 >"$W/status.after"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby accepted a restarted container"

world_reset
status_block "$SHA_B" "$DIG_B" passive false >"$W/status.out"
status_block "$SHA_A" "$DIG_A" temporary-active true >"$W/status.after"
run_main "${DEPLOY_ARGS[@]}"
expect_refused "deploy-standby accepted a post-deploy temporary-active host"
echo "ok - deploy failures and post-deploy verification"

# ===== 9. standby-status
world_reset
echo 1 >"$W/status.rc"
run_main standby-status
expect_ok "standby-status with no release"
[[ "$(cat "$W/out")" == "$(printf '%s\n' environment=fallback-server standby_release=none public_routing=aws)" ]] \
    || fail "standby-status with no release printed: $(cat "$W/out")"

world_reset
status_block "$SHA_A" "$DIG_A" passive false >"$W/status.out"
run_main standby-status
expect_ok "standby-status with a passive release"
expect_out_line "present" "standby_release=present"
expect_out_line "present" "public_routing=aws"
expect_out_line "present" "current_tag=$SHA_A"
expect_out_line "present" "runtime_mode=passive"
expect_unique_key "present" public_routing
expect_no_out_line "present" "public_routing=not_managed"

world_reset
status_block "$SHA_A" "$DIG_A" temporary-active true >"$W/status.out"
run_main standby-status
expect_refused "standby-status reported a temporary-active host"
expect_err "temporary-active" "not a passive Fallback release"
if grep -q '^standby_release=' "$W/out"; then fail "standby-status printed a release for a non-passive host"; fi

world_reset
status_block "$SHA_A" "$DIG_A" temporary-active false >"$W/status.out"
run_main standby-status
expect_refused "standby-status accepted temporary-active reporting schedulers off"

world_reset
status_block "$SHA_A" "$DIG_A" passive true >"$W/status.out"
run_main standby-status
expect_refused "standby-status accepted a passive host with schedulers on"

world_reset
status_block "$SHA_A" "$DIG_A" passive false | sed 's/^environment=fallback-server/environment=other/' >"$W/status.out"
run_main standby-status
expect_refused "standby-status accepted a foreign environment"
echo "ok - standby-status"

# ===== 10. existing commands are unchanged: status keeps requiring the fallback route
world_reset   # route is AWS, the approved identity is the fallback hash
status_block "$SHA_A" "$DIG_A" passive false >"$W/status.out"
run_main status
expect_refused "legacy status ran while the route is not the approved Fallback target"
expect_err "legacy status" "not the approved Fallback target"
run_main replace "$SHA_A" "$DIG_A"
expect_refused "legacy replace ran while the route is not the approved Fallback target"
expect_err "legacy replace" "not the approved Fallback target"
expect_no_operator_calls "legacy commands off the fallback route"
echo "ok - status and replace keep their fallback-route refusal"

# ===== 11. the new commands never reach destructive operator commands
if grep -Eq '^(replace-temporary-active|temporary-active|stop|rollback|valkey-restore)( |$)' "$ALL_CALLS"; then
    fail "a standby command called a forbidden operator command: $(sort -u "$ALL_CALLS" | tr '\n' ';')"
fi
grep -Eq '^deploy ' "$ALL_CALLS" || fail "the test run never exercised operator deploy"
echo "ok - only status and deploy reach the operator"

# ===== 12. SSH dispatcher: exact forms accepted, variants rejected
sed -e "s|/usr/bin/sudo -n|$DISPATCH_STUB|" "$ROOT/ssh-dispatch.sh" >"$DISPATCH_COPY"
grep -Fq "$DISPATCH_STUB" "$DISPATCH_COPY" || fail "dispatcher sudo was not redirected"
cat >"$DISPATCH_STUB" <<'STUB'
#!/usr/bin/env bash
printf 'SUDO:'
printf ' %s' "$@"
printf '\n'
STUB
chmod 755 "$DISPATCH_STUB"

dispatch() { # original-command -> sets DRC, DOUT
    DRC=0
    DOUT="$(SSH_ORIGINAL_COMMAND="$1" bash "$DISPATCH_COPY" 2>/dev/null)" || DRC=$?
}
expect_dispatched() { # command expected-argument-list
    dispatch "$1"
    [[ "$DRC" == 0 ]] || fail "dispatcher rejected '$1'"
    [[ "$DOUT" == "SUDO: /usr/local/sbin/babyjamjam-fallback-ci-deployer $2" ]] \
        || fail "dispatcher mapped '$1' to '$DOUT'"
}
expect_rejected() {
    dispatch "$1"
    [[ "$DRC" != 0 && -z "$DOUT" ]] || fail "dispatcher accepted '$1' -> '$DOUT'"
}
expect_dispatched "status" "status"
expect_dispatched "standby-status" "standby-status"
expect_dispatched "deploy-standby $SHA_A $DIG_A" "deploy-standby $SHA_A $DIG_A"
expect_dispatched "replace $SHA_A $DIG_A" "replace $SHA_A $DIG_A"
expect_rejected ""
expect_rejected "standby-status extra"
expect_rejected "standby-status "
expect_rejected "standby-statusx"
expect_rejected "deploy-standby"
expect_rejected "deploy-standby "
expect_rejected "deploy-standby $SHA_A"
expect_rejected "deploy-standby $SHA_A $DIG_A extra"
expect_rejected "deploy-standby $SHA_A $DIG_A; id"
expect_rejected "deploy-standby $SHA_A $DIG_A && id"
expect_rejected "deploy-standby \$(id) $DIG_A"
expect_rejected "deploy-standby ${SHA_A}0 $DIG_A"
expect_rejected "deploy-standby $(printf 'A%.0s' {1..40}) $DIG_A"
expect_rejected "deploy-standby $SHA_A sha256:zz"
expect_rejected "deploy-standby  $SHA_A $DIG_A"
expect_rejected "deploy-standby $SHA_A  $DIG_A"
expect_rejected "deploy-standby $SHA_A $DIG_A
status"
expect_rejected "replace-temporary-active $SHA_A $DIG_A"
expect_rejected "deploy $SHA_A $DIG_A"
expect_rejected "stop"
expect_rejected "rollback"
expect_rejected "status; id"
echo "ok - ssh dispatcher accepts the exact forms and rejects variants"

echo "Fallback CI deployer behavior tests passed"
