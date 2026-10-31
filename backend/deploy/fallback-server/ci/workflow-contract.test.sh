#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPOSITORY_ROOT="$(git -C "$SCRIPT_ROOT" rev-parse --show-toplevel)"
readonly WORKFLOW="$REPOSITORY_ROOT/.github/workflows/backend-ci.yml"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    grep -Eq -- "$2" "$1" || fail "$3"
}

assert_text_contains() {
    grep -Eq -- "$2" <<<"$1" || fail "$3"
}

assert_contains "$WORKFLOW" '^  resolve-backend-deploy-target:' \
    "backend CI must resolve exactly one production deployment target"
assert_contains "$WORKFLOW" '^  wait-database-patches:' \
    "backend CI must wait for the same-commit Database Patches run before resolving a deploy target"
assert_contains "$WORKFLOW" 'run: bash backend/deploy/ci/wait-database-patches.sh' \
    "the wait job must run the wait-database-patches script"

# Extract one top-level job's block from the given workflow file: from its
# header line up to (but not including) the next top-level job header —
# generic over whichever job happens to follow next in the file, so
# reordering jobs doesn't silently widen or narrow the range.
extract_job() {
    local header_pattern="$1"
    local workflow_file="$2"
    awk -v header="$header_pattern" '
        $0 ~ header { found=1; print; next }
        found && /^  [a-z0-9-]*:$/ { exit }
        found { print }
    ' "$workflow_file"
}

wait_job="$(extract_job '^  wait-database-patches:' "$WORKFLOW")"
assert_text_contains "$wait_job" 'group:[[:space:]]*backend-deploy-wait-' \
    "the wait job must use a backend-deploy-wait- concurrency group so a newer push cancels an older run's wait"
assert_text_contains "$wait_job" 'cancel-in-progress:[[:space:]]*true' \
    "the wait job's concurrency group must cancel an in-progress (stale) wait, not queue behind it"

resolve_target_job="$(extract_job '^  resolve-backend-deploy-target:' "$WORKFLOW")"
assert_text_contains "$resolve_target_job" 'needs:[[:space:]]*\[build-lightsail-image,[[:space:]]*wait-database-patches\]' \
    "target resolution must depend on the Database Patches wait job"
assert_text_contains "$resolve_target_job" "needs\.wait-database-patches\.result == 'success'" \
    "target resolution must require the Database Patches wait job to succeed"
# The joined (newline-folded) form catches a weakened `&&` -> `||` between
# the two build/wait success checks, which the two separate substring
# assertions above would not: each half would still be present verbatim.
resolve_target_job_joined="$(tr '\n' ' ' <<<"$resolve_target_job")"
assert_text_contains "$resolve_target_job_joined" \
    "needs\.build-lightsail-image\.result == 'success' &&[[:space:]]+needs\.wait-database-patches\.result == 'success'" \
    "target resolution must require BOTH the build and the Database Patches wait job to succeed (not just either)"
assert_contains "$WORKFLOW" 'resolve-deploy-target\.mjs' \
    "backend CI must use the fail-closed target resolver"
assert_contains "$WORKFLOW" 'FALLBACK_DNS_SHA256' \
    "backend CI must compare the current route with the protected fallback identity"
assert_contains "$WORKFLOW" 'LIGHTSAIL_DNS_SHA256' \
    "backend CI must compare the current route with the protected Lightsail identity"
assert_contains "$WORKFLOW" '^  deploy-lightnode:' \
    "backend CI must define the LightNode replacement job"
assert_contains "$WORKFLOW" '^  lightnode-connection-smoke:' \
    "backend CI must expose a read-only LightNode connection smoke"
assert_contains "$WORKFLOW" "inputs.operation == 'lightnode-status'" \
    "LightNode connection smoke must require an explicit manual operation"
assert_contains "$WORKFLOW" "needs\.resolve-backend-deploy-target\.outputs\.target == 'lightnode'" \
    "LightNode deployment must require the resolved LightNode target"
assert_contains "$WORKFLOW" "needs\.resolve-backend-deploy-target\.outputs\.target == 'lightsail'" \
    "Lightsail deployment must require the resolved Lightsail target"
assert_contains "$WORKFLOW" "'status'" \
    "LightNode deployment must invoke only the forced status command"
assert_contains "$WORKFLOW" '"replace \$GITHUB_SHA \$IMAGE_DIGEST"' \
    "LightNode deployment must invoke only the forced replacement command"
assert_contains "$WORKFLOW" 'StrictHostKeyChecking=yes' \
    "LightNode SSH must fail closed on host-key mismatch"
assert_contains "$WORKFLOW" 'count == 1 && value != ""' \
    "LightNode status reader must reject missing or duplicated status keys"
assert_contains "$WORKFLOW" '::error::LightNode status' \
    "LightNode status assertions must fail with a visible reason"
assert_contains "$WORKFLOW" 'expect_status lease_mode required' \
    "LightNode replacement must confirm the deployed runtime contests the scheduler lease (ADR-010)"

# The Cloud Run preview deploy job contract (BJJ-341). Takes the workflow
# path as an argument so the mutation self-check below can re-run the exact
# same assertions against a mutated copy.
assert_deploy_cloudrun_contract() {
    local workflow_file="$1"
    local cloudrun_job
    cloudrun_job="$(extract_job '^  deploy-cloudrun:' "$workflow_file")"
    [[ -n "$cloudrun_job" ]] \
        || fail "backend CI must define the Cloud Run preview deploy job"

    # Gating: every `if:` clause must be present, AND-ed together (the
    # joined form catches a relaxed `&&` -> `||` that per-clause
    # assertions would not).
    local cloudrun_if
    cloudrun_if="$(awk '/^    if:/{f=1} f{print} /^    needs:/{exit}' <<<"$cloudrun_job")"
    local cloudrun_if_joined
    cloudrun_if_joined="$(tr '\n' ' ' <<<"$cloudrun_if")"
    assert_text_contains "$cloudrun_if_joined" "github\.event_name == 'push'" \
        "the Cloud Run deploy job must run only on push events"
    assert_text_contains "$cloudrun_if_joined" "github\.ref_name == 'preview'" \
        "the Cloud Run deploy job must run only on the preview branch"
    assert_text_contains "$cloudrun_if_joined" "needs\.build-lightsail-image\.result == 'success'" \
        "the Cloud Run deploy job must require the image build to succeed"
    assert_text_contains "$cloudrun_if_joined" "needs\.wait-database-patches\.result == 'success'" \
        "the Cloud Run deploy job must require the Database Patches wait job to succeed"
    assert_text_contains "$cloudrun_if_joined" "needs\.resolve-backend-deploy-target\.result == 'success'" \
        "the Cloud Run deploy job must require target resolution to succeed"
    assert_text_contains "$cloudrun_if_joined" "needs\.resolve-backend-deploy-target\.outputs\.target == 'cloudrun'" \
        "the Cloud Run deploy job must run only when the resolved target is cloudrun"
    assert_text_contains "$cloudrun_if_joined" \
        "always\(\) &&[[:space:]]+github\.event_name == 'push' &&[[:space:]]+github\.ref_name == 'preview' &&[[:space:]]+needs\.build-lightsail-image\.result == 'success' &&[[:space:]]+needs\.wait-database-patches\.result == 'success' &&[[:space:]]+needs\.resolve-backend-deploy-target\.result == 'success' &&[[:space:]]+needs\.resolve-backend-deploy-target\.outputs\.target == 'cloudrun'" \
        "the Cloud Run deploy job must keep every if-clause AND-ed, not relaxed to ||"

    assert_text_contains "$cloudrun_job" \
        'needs:[[:space:]]*\[build-lightsail-image,[[:space:]]*wait-database-patches,[[:space:]]*resolve-backend-deploy-target\]' \
        "the Cloud Run deploy job must depend on the build, wait, and target-resolution jobs"

    # Permissions: exactly the minimal three — nothing broader.
    local cloudrun_permissions
    cloudrun_permissions="$(awk '/^    permissions:/{f=1; next} f && /^      /{print; next} f{exit}' <<<"$cloudrun_job")"
    [[ "$(grep -c . <<<"$cloudrun_permissions")" -eq 3 ]] \
        || fail "the Cloud Run deploy job must declare exactly three permission entries"
    assert_text_contains "$cloudrun_permissions" '^      contents:[[:space:]]*read$' \
        "the Cloud Run deploy job must grant only read on contents"
    assert_text_contains "$cloudrun_permissions" '^      id-token:[[:space:]]*write$' \
        "the Cloud Run deploy job must request write on id-token for GCP OIDC"
    assert_text_contains "$cloudrun_permissions" '^      packages:[[:space:]]*read$' \
        "the Cloud Run deploy job must grant only read on packages"

    # No GitHub environment gate on the preview deploy.
    if grep -Eq '^    environment:' <<<"$cloudrun_job"; then
        fail "the Cloud Run deploy job must not declare a GitHub environment"
    fi

    # Digest pinning: the input digest must be shape-validated and the
    # copied Artifact Registry digest must be compared with the built one.
    assert_text_contains "$cloudrun_job" '\^sha256:\[0-9a-f\]\{64\}\$' \
        "the Cloud Run deploy job must validate the IMAGE_DIGEST shape before deploying"
    assert_text_contains "$cloudrun_job" '\$ar_digest" != "\$IMAGE_DIGEST" \]\]' \
        "the Cloud Run deploy job must compare the Artifact Registry digest with IMAGE_DIGEST"
    assert_text_contains "$cloudrun_job" '::error::Artifact Registry digest mismatch' \
        "the Cloud Run deploy job must fail visibly on an Artifact Registry digest mismatch"

    # Post-deploy invariants: single instance, schedulers off, lease mode
    # off, and Aligo disabled as a plain empty value (omitted counts as
    # empty — the Cloud Run API omits empty-string fields; never a secret
    # ref, never a missing entry).
    assert_text_contains "$cloudrun_job" 'autoscaling\.knative\.dev/maxScale' \
        "the Cloud Run deploy job must read the maxScale annotation"
    assert_text_contains "$cloudrun_job" 'max_scale" == "1"' \
        "the Cloud Run deploy job must require maxScale to be exactly 1"
    assert_text_contains "$cloudrun_job" 'plain_env_value SCHEDULERS_ENABLED' \
        "the Cloud Run deploy job must check the SCHEDULERS_ENABLED env value"
    assert_text_contains "$cloudrun_job" 'schedulers_enabled" == "false"' \
        "the Cloud Run deploy job must require SCHEDULERS_ENABLED to be plain 'false'"
    assert_text_contains "$cloudrun_job" 'plain_env_value SCHEDULER_LEASE_MODE' \
        "the Cloud Run deploy job must check the SCHEDULER_LEASE_MODE env value"
    assert_text_contains "$cloudrun_job" 'lease_mode_env" == "off"' \
        "the Cloud Run deploy job must require SCHEDULER_LEASE_MODE to be plain 'off'"
    assert_text_contains "$cloudrun_job" '\-\-arg name "ALIGO_API_KEY"' \
        "the Cloud Run deploy job must check the ALIGO_API_KEY env entry"
    assert_text_contains "$cloudrun_job" '\(\.value // ""\) == ""' \
        "the ALIGO_API_KEY check must treat an omitted Cloud Run env value as empty"
    assert_text_contains "$cloudrun_job" 'aligo_state" == "<plain-empty>"' \
        "the Cloud Run deploy job must require ALIGO_API_KEY to be plain empty (Aligo disabled on preview)"
}

assert_deploy_cloudrun_contract "$WORKFLOW"

# Self-check: the contract must actually bite. Remove the
# wait-database-patches success clause from a temp copy and require the
# exact same assertions to FAIL on it.
cloudrun_mutation="$(mktemp)"
trap 'rm -f "$cloudrun_mutation"' EXIT
sed '/needs\.wait-database-patches\.result/d' "$WORKFLOW" > "$cloudrun_mutation"
if ( assert_deploy_cloudrun_contract "$cloudrun_mutation" ) >/dev/null 2>&1; then
    rm -f "$cloudrun_mutation"
    trap - EXIT
    fail "the deploy-cloudrun contract self-check must fail when the wait-database-patches clause is removed"
fi
rm -f "$cloudrun_mutation"
trap - EXIT

# The LightNode passive-standby job: after Lightsail (primary) deploys a `main`
# release, the standby converges to it by ancestry. Takes the workflow path so
# the mutation self-checks below re-run the exact same assertions on a mutated
# copy.
assert_deploy_standby_contract() {
    local workflow_file="$1"
    local standby_job standby_if standby_if_joined
    standby_job="$(extract_job '^  deploy-lightnode-standby:' "$workflow_file")"
    [[ -n "$standby_job" ]] || fail "backend CI must define the LightNode standby deploy job"

    standby_if="$(awk '/^    if:/{f=1} f{print} /^    needs:/{exit}' <<<"$standby_job")"
    standby_if_joined="$(tr '\n' ' ' <<<"$standby_if")"
    assert_text_contains "$standby_if_joined" \
        "always\(\) &&[[:space:]]+github\.event_name == 'push' &&[[:space:]]+github\.ref_name == 'main' &&[[:space:]]+needs\.build-lightsail-image\.result == 'success' &&[[:space:]]+needs\.resolve-backend-deploy-target\.result == 'success' &&[[:space:]]+needs\.deploy-lightsail\.result == 'success' &&[[:space:]]+needs\.resolve-backend-deploy-target\.outputs\.target == 'lightsail'" \
        "the standby job must run only on a main push after build, target resolution and the Lightsail deploy all succeeded, every clause AND-ed"
    assert_text_contains "$standby_job" \
        'needs:[[:space:]]*\[build-lightsail-image,[[:space:]]*resolve-backend-deploy-target,[[:space:]]*deploy-lightsail\]' \
        "the standby job must depend on the build, target resolution and the Lightsail deploy"
    assert_text_contains "$standby_job" 'group:[[:space:]]*lightnode-standby-main' \
        "the standby job must use its own concurrency group"
    assert_text_contains "$standby_job" 'cancel-in-progress:[[:space:]]*false' \
        "the standby job must not cancel an active deployment"
    assert_text_contains "$standby_job" 'fetch-depth:[[:space:]]*0' \
        "the standby job needs full history for the ancestry comparison"
    assert_text_contains "$standby_job" 'persist-credentials:[[:space:]]*false' \
        "the standby job must not persist checkout credentials"
    assert_text_contains "$standby_job" 'timeout-minutes:[[:space:]]*40' \
        "the standby job must carry the deployment timeout"
    local standby_permissions
    standby_permissions="$(awk '/^    permissions:/{f=1; next} f && /^      /{print; next} f{exit}' <<<"$standby_job")"
    [[ "$(grep -c . <<<"$standby_permissions")" -eq 1 ]] \
        || fail "the standby job must declare exactly one permission entry"
    assert_text_contains "$standby_permissions" '^      contents:[[:space:]]*read$' \
        "the standby job must grant only read on contents"
    assert_text_contains "$standby_job" "'standby-status'" \
        "the standby job must read the standby with the forced standby-status command"
    assert_text_contains "$standby_job" '"deploy-standby \$GITHUB_SHA \$IMAGE_DIGEST"' \
        "the standby job must deploy only through the forced deploy-standby command"
    assert_text_contains "$standby_job" 'StrictHostKeyChecking=yes' \
        "the standby SSH must fail closed on host-key mismatch"
    assert_text_contains "$standby_job" 'count == 1 && value != ""' \
        "the standby status reader must reject missing or duplicated status keys"
    # The ancestry decision is executed by tests (standby-decision.test.sh); the
    # job may only call it and act on its decision, never re-implement it.
    assert_text_contains "$standby_job" 'bash backend/deploy/fallback-server/ci/standby-decision\.sh' \
        "the standby job must take its convergence decision from standby-decision.sh"
    assert_text_contains "$standby_job" '\| bash backend/deploy/fallback-server/ci/standby-decision\.sh\)"; then' \
        "the standby job must stop when standby-decision.sh refuses"
    assert_text_contains "$standby_job" '^            deploy\) ;;$' \
        "the standby job must deploy only on a deploy decision"
    assert_text_contains "$standby_job" '^            superseded\)$' \
        "the standby job must report a superseded run and stop"
    assert_text_contains "$standby_job" "decision is '[$]decision' [(]expected 'deploy' or 'superseded'[)]" \
        "the standby job must fail on any other decision"
    if grep -Eq 'git (merge-base|cat-file)' <<<"$standby_job"; then
        fail "the standby job must not re-implement the ancestry decision inline"
    fi
    assert_contains "$workflow_file" '^          bash backend/deploy/fallback-server/ci/standby-decision\.test\.sh$' \
        "backend CI must run the standby decision tests"
    assert_text_contains "$standby_job" 'expect_status runtime_mode passive' \
        "the standby job must assert the passive runtime"
    assert_text_contains "$standby_job" 'expect_status schedulers_enabled false' \
        "the standby job must assert schedulers are off"
    assert_text_contains "$standby_job" 'expect_status public_routing aws' \
        "the standby job must assert the public route stays on AWS"
    assert_text_contains "$standby_job" 'expect_status restart_count 0' \
        "the standby job must assert no restarts"
    # The Lightsail OIDC contract slices from deploy-lightsail to the end of the
    # file, so this job must never carry a GitHub environment key.
    if grep -Eq 'environment:' <<<"$standby_job"; then
        fail "the standby job must not contain a GitHub environment key"
    fi
    if grep -Eq 'api\.babyjamjam\.com' <<<"$standby_job"; then
        fail "the standby job must not probe the public API host (that host is Lightsail)"
    fi
    if grep -Eq 'replace-temporary-active|temporary-active|"replace |rollback' <<<"$standby_job"; then
        fail "the standby job must not use the active-fallback commands"
    fi
}

assert_deploy_standby_contract "$WORKFLOW"

# Self-checks: the standby contract must bite. Each mutation removes one
# load-bearing clause from a temp copy and the same assertions must FAIL on it.
standby_mutation="$(mktemp)"
trap 'rm -f "$standby_mutation"' EXIT
standby_mutations=(
    "/needs\.deploy-lightsail\.result == 'success'/d"
    's/fetch-depth: 0/fetch-depth: 1/'
    's|^              \| bash backend/deploy/fallback-server/ci/standby-decision.sh)"; then|              \| cat)"; then|'
    's/^            deploy) ;;$/            deploy) exit 0 ;;/'
    's/^            superseded)$/            superseded-never)/'
    '/standby-decision.test.sh$/d'
    's/group: lightnode-standby-main/group: lightsail-deploy-main/'
    's/expect_status runtime_mode passive/expect_status runtime_mode active/'
    's/^      # Full history:/      # environment: Full history:/'
)
for mutation in "${standby_mutations[@]}"; do
    sed "$mutation" "$WORKFLOW" > "$standby_mutation"
    if cmp -s "$WORKFLOW" "$standby_mutation"; then
        fail "standby contract self-check mutation did not change the workflow: $mutation"
    fi
    if ( assert_deploy_standby_contract "$standby_mutation" ) >/dev/null 2>&1; then
        fail "the deploy-lightnode-standby contract self-check must fail for mutation: $mutation"
    fi
done
rm -f "$standby_mutation"
trap - EXIT

echo "Fallback deployment workflow contract tests passed"
