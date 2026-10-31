#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DEPLOYER="$SCRIPT_ROOT/ci-deployer.sh"
readonly INSTALLER="$SCRIPT_ROOT/install-ci-deployer.sh"
readonly DISPATCHER="$SCRIPT_ROOT/ssh-dispatch.sh"
readonly DECISION="$SCRIPT_ROOT/standby-decision.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    grep -Eq -- "$2" "$1" || fail "$3"
}

assert_not_contains() {
    if grep -Eq -- "$2" "$1"; then fail "$3"; fi
}

[[ -r "$DEPLOYER" ]] || fail "missing restricted LightNode CI deployer"
[[ -r "$INSTALLER" ]] || fail "missing restricted LightNode CI deployer installer"
[[ -r "$DISPATCHER" ]] || fail "missing forced-command SSH dispatcher"
[[ -r "$DECISION" ]] || fail "missing standby convergence decision script"

assert_contains "$DEPLOYER" 'SUDO_USER' \
    "deployer must bind authority to the dedicated SSH user"
assert_contains "$DEPLOYER" 'DEPLOY_USER="babyjamjam-ci-deployer"' \
    "deployer must pin the dedicated SSH user identity"
assert_contains "$DEPLOYER" 'automatic-deploy-authority' \
    "deployer must require an explicit root-owned automation authority artifact"
assert_contains "$DEPLOYER" 'approved-public-routing\.sha256' \
    "deployer must verify the protected public routing identity"
assert_contains "$DEPLOYER" '\$1 != "public_routing"' \
    "deployer must replace the operator routing marker instead of duplicating it"
assert_contains "$DEPLOYER" 'getent ahostsv4' \
    "deployer must resolve routing through the base host resolver without extra packages"
assert_not_contains "$DEPLOYER" '(^|[[:space:]])dig([[:space:]]|$)' \
    "deployer must not depend on an optional DNS package"
assert_contains "$DEPLOYER" 'status_value runtime_mode' \
    "deployer must require an active fallback runtime"
assert_contains "$DEPLOYER" 'temporary-active' \
    "deployer must pin the active fallback mode"
assert_contains "$DEPLOYER" 'replace-temporary-active' \
    "deployer must delegate replacement to the rollback-capable operator"
assert_contains "$DEPLOYER" 'replace-temporary-active "\$commit_sha" "\$image_digest" >&2' \
    "deployer must keep the operator replacement summary out of the status stream"
assert_contains "$DEPLOYER" 'current_tag' \
    "deployer must verify the final immutable release identity"
assert_contains "$DEPLOYER" 'valkey-restore-fence' \
    "deployer must know the Valkey restore fence marker"
assert_contains "$DEPLOYER" 'require_no_valkey_restore_fence' \
    "deployer must refuse an automatic replacement while a Valkey restore is fenced"
assert_not_contains "$DEPLOYER" '(AWS_ACCESS_KEY|AWS_SECRET|docker[[:space:]]+build|git[[:space:]]+checkout)' \
    "deployer must not accept cloud credentials or build mutable source"

assert_contains "$INSTALLER" 'babyjamjam-ci-deployer' \
    "installer must require the dedicated deployment user"
assert_contains "$INSTALLER" 'docker.*group' \
    "installer must reject Docker-group privilege"
assert_contains "$INSTALLER" '/etc/sudoers\.d/babyjamjam-fallback-ci-deployer' \
    "installer must install one dedicated sudoers rule"
assert_contains "$INSTALLER" 'visudo -cf' \
    "installer must validate the sudoers rule before activation"
assert_not_contains "$INSTALLER" '(authorized_keys|ssh-rsa|BEGIN .*PRIVATE KEY)' \
    "installer must not provision or embed SSH credentials"
assert_contains "$DISPATCHER" 'SSH_ORIGINAL_COMMAND' \
    "dispatcher must ignore the login shell and parse only the forced original command"
assert_contains "$DISPATCHER" '^    status\)' \
    "dispatcher must allow the fixed status command"
assert_contains "$DISPATCHER" '\[0-9a-f\]\{40\}' \
    "dispatcher must strictly validate replacement identity"
assert_contains "$DISPATCHER" 'sha256:\[0-9a-f\]\{64\}' \
    "dispatcher must strictly validate the immutable digest"
assert_not_contains "$DISPATCHER" '(eval|bash -c|sh -c)' \
    "dispatcher must not evaluate the original SSH command"

assert_contains "$DEPLOYER" '^require_aws_route\(\)' \
    "deployer must guard the passive standby path with an AWS-route check"
[[ "$(grep -Ec '^    records="\$\(resolve_public_route_records\)"$' "$DEPLOYER")" == 2 ]] \
    || fail "both route guards must assign the resolved records on their own line so an unresolvable route aborts"
assert_not_contains "$DEPLOYER" '\[\[ *"\$\(resolve_public_route_records\)"' \
    "the route resolver must never be inlined into a comparison"
assert_not_contains "$DEPLOYER" 'canonical_public_route_hash' \
    "the route hash must derive from the single resolver, not a second getent path"
[[ "$(grep -c 'getent ahostsv4' "$DEPLOYER")" == 1 ]] \
    || fail "the public route must be resolved by exactly one getent call"
assert_contains "$DEPLOYER" '^    done <<<"\$records"$' \
    "the AWS-route guard must check every resolved record, not only the whole set"
assert_contains "$DEPLOYER" '"\$OPERATOR" deploy "\$commit_sha" "\$image_digest" >&2' \
    "standby deployment must reuse the operator passive deploy and keep its summary on stderr"
assert_contains "$DEPLOYER" '^        standby-status\)' "deployer must route standby-status"
assert_contains "$DEPLOYER" '^        deploy-standby\)' "deployer must route deploy-standby"
assert_contains "$DEPLOYER" 'status_value runtime_mode "\$output"\)" == "passive"' \
    "standby paths must require the passive runtime"
assert_contains "$DEPLOYER" 'status_value schedulers_enabled "\$output"\)" == "false"' \
    "standby paths must require schedulers off"
assert_contains "$DEPLOYER" '^read_recorded_release\(\)' \
    "standby-status must read the recorded release identity separately from runtime health"
assert_contains "$DEPLOYER" 'STATE_DIRECTORY/current-image-tag' \
    "the recorded release tag must come from the operator state directory"
assert_contains "$DEPLOYER" 'STATE_DIRECTORY/current-image-digest' \
    "the recorded release digest must come from the operator state directory"
assert_contains "$DEPLOYER" 'standby_release=recorded-unhealthy' \
    "standby-status must report a recorded but unhealthy release"
assert_not_contains "$DEPLOYER" 'ancestor' \
    "the root deployer must not decide ancestry; the host has no git history"
[[ "$(tail -n 1 "$DEPLOYER")" == 'main "$@"' ]] || fail "main must remain the last line of the deployer"
assert_contains "$DEPLOYER" '^readonly VALKEY_RESTORE_MARKER=' \
    "the restore-fence marker line form must stay stable for the fence test"

assert_contains "$DISPATCHER" '^    standby-status\)' \
    "dispatcher must allow the bare standby-status command"
assert_contains "$DISPATCHER" '\^deploy-standby' \
    "dispatcher must strictly parse deploy-standby"

# The sudoers rule lists exactly four commands, no more.
sudoers_entries="$(grep -c 'NOPASSWD: \$DESTINATION' "$INSTALLER" || true)"
[[ "$sudoers_entries" -eq 4 ]] || fail "the sudoers rule must list exactly four commands (found $sudoers_entries)"
assert_contains "$INSTALLER" 'NOPASSWD: \$DESTINATION status"' "sudoers must allow status"
assert_contains "$INSTALLER" 'NOPASSWD: \$DESTINATION replace \*"' "sudoers must allow replace"
assert_contains "$INSTALLER" 'NOPASSWD: \$DESTINATION standby-status"' "sudoers must allow standby-status"
assert_contains "$INSTALLER" 'NOPASSWD: \$DESTINATION deploy-standby \*"' "sudoers must allow deploy-standby"
assert_not_contains "$INSTALLER" 'NOPASSWD: \$DESTINATION (replace-temporary-active|temporary-active|stop|rollback|deploy )' \
    "sudoers must not expose destructive or non-CI operator commands"
assert_not_contains "$INSTALLER" 'NOPASSWD: ALL' "sudoers must not grant unrestricted commands"

bash -n "$DEPLOYER" "$INSTALLER" "$DISPATCHER" "$DECISION"
if [[ "$EUID" -ne 0 ]]; then
    if "$DEPLOYER" status >/dev/null 2>&1; then
        fail "deployer must reject direct non-root execution"
    fi
    if "$INSTALLER" >/dev/null 2>&1; then
        fail "installer must reject direct non-root execution"
    fi
fi
echo "Fallback CI deployer contract tests passed"
