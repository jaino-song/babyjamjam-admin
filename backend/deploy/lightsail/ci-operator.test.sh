#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SCRIPT="$SCRIPT_DIR/ci-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

assert_equals() {
    local expected="$1"
    local actual="$2"

    if [[ "$actual" != "$expected" ]]; then
        fail "expected '$expected', got '$actual'"
    fi
}

[[ -r "$OPERATOR_SCRIPT" ]] || fail "missing CI operator: $OPERATOR_SCRIPT"
assert_equals '#!/bin/bash' "$(head -n 1 "$OPERATOR_SCRIPT")"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
# Keep the real deploy/recovery logic, with an unprivileged log directory.
sed -e "s#readonly LOG_ROOT=\"/var/log/babyjamjam-deploy\"#readonly LOG_ROOT=\"$TEST_ROOT/logs\"#" \
    -e 's#/usr/bin/install -d -o root -g root -m 0700 "\$LOG_ROOT"#/usr/bin/install -d -m 0700 "$LOG_ROOT"#' \
    "$OPERATOR_SCRIPT" >"$TEST_ROOT/ci-operator.sh"

# shellcheck source=backend/deploy/lightsail/ci-operator.sh
source "$TEST_ROOT/ci-operator.sh"

valid_sha="432bc4840b9a44a3357a442c9ef93b7cc9f41459"
valid_digest="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
valid_uuid="123e4567-e89b-12d3-a456-426614174000"

grep -Fq '/usr/bin/flock -E "$LOCK_CONTENTION_EXIT_STATUS" -w "$wait_seconds" 9' "$OPERATOR_SCRIPT" \
    || fail "db-reconcile lock acquisition must use explicit -E with bounded -w"
assert_equals "75" "$LOCK_CONTENTION_EXIT_STATUS"

validate_invocation status preview
validate_invocation status production
validate_invocation status production self
validate_invocation deploy preview "$valid_sha" "$valid_digest"
validate_invocation deploy production "$valid_sha" "$valid_digest"
validate_invocation deploy production "$valid_sha" "$valid_digest" self
validate_invocation standby preview
validate_invocation standby production
validate_invocation db-probe preview shared "$valid_uuid"
validate_invocation db-probe production direct "$valid_uuid"
validate_invocation db-reconcile preview "$valid_uuid"
validate_invocation db-reconcile production "$valid_uuid"

assert_fails validate_invocation status production public
assert_fails validate_invocation status production ""
assert_fails validate_invocation status production self extra
assert_fails validate_invocation deploy production "$valid_sha" "$valid_digest" public
assert_fails validate_invocation deploy production "$valid_sha" "$valid_digest" ""
assert_fails validate_invocation deploy production "$valid_sha" "$valid_digest" self extra
assert_fails validate_invocation standby
assert_fails validate_invocation standby development
assert_fails validate_invocation standby production extra
assert_fails validate_invocation deploy preview preview "$valid_digest"
assert_fails validate_invocation deploy preview "$valid_sha" sha256:short
assert_fails validate_invocation deploy development "$valid_sha" "$valid_digest"
assert_fails validate_invocation rollback production
assert_fails validate_invocation db-probe preview invalid-route "$valid_uuid"
assert_fails validate_invocation db-probe preview shared invalid-uuid
assert_fails validate_invocation db-probe preview shared 00000000-0000-0000-0000-000000000000
assert_fails validate_invocation db-reconcile preview invalid-uuid
assert_fails validate_invocation db-reconcile preview 123e4567-e89b-02d3-a456-426614174000
assert_fails validate_invocation db-reconcile development "$valid_uuid"

configure_environment preview
assert_equals "preview" "$DEPLOY_BRANCH"
assert_equals "false" "$EXPECTED_SCHEDULERS_ENABLED"
assert_equals "https://preview.api.babyjamjam.com/health" "$PUBLIC_HEALTH_URL"
assert_equals "$STATE_DIRECTORY/operator.lock" "$DEPLOY_LOCK_FILE"
assert_equals "$ROUTE_STATE_ROOT/preview/$ROUTE_STATE_FILE_NAME" "$ROUTE_STATE_FILE"

configure_environment production
assert_equals "main" "$DEPLOY_BRANCH"
assert_equals "true" "$EXPECTED_SCHEDULERS_ENABLED"
assert_equals "https://api.babyjamjam.com/health" "$PUBLIC_HEALTH_URL"
assert_equals "$ROUTE_STATE_ROOT/production/$ROUTE_STATE_FILE_NAME" "$ROUTE_STATE_FILE"

fetch_invocation=""

run_as_deployer() {
    fetch_invocation="$*"
}

configure_environment preview
fetch_environment_ref
assert_equals "/usr/bin/git -C $REPOSITORY_ROOT fetch --quiet --prune origin +refs/heads/preview:refs/remotes/origin/preview" "$fetch_invocation"

image_invocations=""

run_as_root() {
    image_invocations+="$*"$'\n'

    if [[ "$*" == *"inspect --format {{index .Config.Labels \"org.opencontainers.image.revision\"}}"* ]]; then
        echo "$valid_sha"
    fi
}

pull_release_image "$valid_sha" "$valid_digest"
[[ "$image_invocations" == *"pull $IMAGE_REPOSITORY@$valid_digest"* ]] || fail "immutable image was not pulled"
[[ "$image_invocations" == *"tag $IMAGE_REPOSITORY@$valid_digest $LOCAL_IMAGE_REPOSITORY:$valid_sha"* ]] || fail "verified image was not tagged locally"

(
configure_environment preview
migration_fixture="$(mktemp -d)"
trap 'rm -rf "$migration_fixture"' EXIT
hostile_compose_cwd="$migration_fixture/caller"
image_cwd="$migration_fixture/image"
mkdir -p "$hostile_compose_cwd" "$image_cwd/node_modules/prisma/build" "$image_cwd/prisma/scripts"
printf '%s\n' \
    'BACKEND_IMAGE_TAG=hostile' \
    'VALKEY_MEMORY_LIMIT=99g' \
    >"$hostile_compose_cwd/.env"
cat >"$image_cwd/node_modules/prisma/build/index.js" <<'JS'
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync("prisma-invocations", args.join(" ") + "\n");
console.error("fixture Prisma output");
if (args[0] === "db" && fs.existsSync("reject-guard")) process.exit(1);
JS

run_as_root() {
    local isolated_node=/usr/local/bin/node
    local fixture_node='"$1"'
    local -a compose_args=()
    while [[ "$1" != --entrypoint ]]; do
        compose_args+=("$1")
        shift
    done
    assert_equals "/usr/bin/env BACKEND_ENV_FILE=$STATE_DIRECTORY/backend.env BACKEND_IMAGE=$LOCAL_IMAGE_REPOSITORY BACKEND_IMAGE_TAG=$valid_sha BACKEND_CPU_LIMIT=0.5 BACKEND_MEMORY_LIMIT=1g BACKEND_NETWORK_ALIAS=api-preview COMPOSE_PROJECT_NAME=babyjamjam-backend-preview LIGHTSAIL_EDGE_NETWORK=babyjamjam-edge-preview VALKEY_DATA_VOLUME=babyjamjam-backend-preview_valkey_data /usr/bin/docker compose --env-file $ROOT_COMPOSE_ENV_FILE --project-directory $ROOT_ARTIFACT_DIRECTORY -f $ROOT_COMPOSE_ARTIFACT run --rm --no-deps" "${compose_args[*]}" || return 1
    assert_equals "--entrypoint /bin/sh api -c" "$1 $2 $3 $4" || return 1
    shift 4
    (
        cd "$image_cwd"
        /bin/sh -c "${1//"$isolated_node"/"$fixture_node"}" fixture "$(command -v node)"
    )
}

cd "$hostile_compose_cwd"
export BACKEND_IMAGE_TAG=hostile VALKEY_MEMORY_LIMIT=99g
deploy_args="migrate deploy --schema prisma/schema.prisma"
guard_path="prisma/scripts/verify-baby-case-stage-before-release.sql"
guard_args="db execute --schema prisma/schema.prisma --file $guard_path"
invocations="$image_cwd/prisma-invocations"

# Older images run only the original command, even with hostile caller values.
assert_equals "" "$(run_release_migrations "$valid_sha" 2>&1)"
assert_equals "$deploy_args" "$(<"$invocations")"

# A tagged image with the canonical migration requires the guard to be packaged.
mkdir -p "$image_cwd/prisma/migrations/20261126010000_baby_case_keys"
touch "$image_cwd/prisma/migrations/20261126010000_baby_case_keys/migration.sql"
: >"$invocations"
assert_fails run_release_migrations "$valid_sha"
assert_equals "" "$(<"$invocations")"
: >"$image_cwd/$guard_path"
assert_fails run_release_migrations "$valid_sha"
assert_equals "" "$(<"$invocations")"

cp "$SCRIPT_DIR/../../$guard_path" "$image_cwd/$guard_path"
run_release_migrations "$valid_sha"
assert_equals "$guard_args"$'\n'"$deploy_args" "$(<"$invocations")"

: >"$invocations"
touch "$image_cwd/reject-guard"
assert_fails run_release_migrations "$valid_sha"
assert_equals "$guard_args" "$(<"$invocations")"
)

rollback_invocation=""

run_as_root() {
    rollback_invocation="$*"
}

run_rollback_script "$valid_sha"
[[ "$rollback_invocation" == *"BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG=true"* ]] \
    || fail "automatic recovery must preserve the prior known-good rollback tag"
[[ "$rollback_invocation" == *"BACKEND_COMPOSE_FILE=$ROOT_COMPOSE_ARTIFACT"* \
    && "$rollback_invocation" == *"$ROOT_ROLLBACK_ARTIFACT preview $valid_sha"* ]] \
    || fail "automatic recovery must use only protected root artifacts"
[[ "$rollback_invocation" != *"$DEPLOY_WORKTREE"* ]] \
    || fail "automatic recovery must not execute an ubuntu-owned worktree artifact"

deploy_invocation=""
run_as_root() {
    deploy_invocation="$*"
}
run_deploy_script "$valid_sha"
[[ "$deploy_invocation" == *"BACKEND_COMPOSE_FILE=$ROOT_COMPOSE_ARTIFACT"* \
    && "$deploy_invocation" == *"$ROOT_DEPLOY_ARTIFACT preview"* ]] \
    || fail "deployment must use only protected root artifacts"
[[ "$deploy_invocation" != *"$DEPLOY_WORKTREE"* ]] \
    || fail "deployment must not execute an ubuntu-owned worktree artifact"

(
    ROUTE_STATE_FILE="$TEST_ROOT/missing-route-state"
    run_as_root() { printf '%s\n' "$@"; }
    expected_deploy_args="$(run_deploy_script "$valid_sha")"
    expected_rollback_args="$(run_rollback_script "$valid_sha")"
    for invocation in "$expected_deploy_args" "$expected_rollback_args"; do
        grep -Fxq 'BACKEND_HEALTH_SCOPE=public' <<<"$invocation" || fail "helper did not receive public scope"
    done
    HEALTH_SCOPE=self
    for invocation in "$(run_deploy_script "$valid_sha")" "$(run_rollback_script "$valid_sha")"; do
        grep -Fxq 'BACKEND_HEALTH_SCOPE=self' <<<"$invocation" || fail "helper did not receive self scope"
    done
)

# Status must derive the route from authoritative state and reuse the complete
# runtime invariant. The running container is deliberately not allowed to
# choose a different route.
(
configure_environment preview
ROUTE_STATE_ACTIVE_ROUTE=direct
status_verified_route_file="$TEST_ROOT/status-route"
probe_calls="$TEST_ROOT/status-probes"
require_root() { :; }
acquire_lock() { :; }
ensure_route_state() { :; }
load_route_state() { :; }
validate_backend_env_file() { :; }
load_current_release_identity() {
    CURRENT_ROUTE_IMAGE_TAG="$valid_sha"
    CURRENT_ROUTE_IMAGE_DIGEST="$valid_digest"
}
find_api_container() { printf '%s\n' status-api; }
read_recorded_tag() { printf '%s\n' "$valid_sha"; }
read_recorded_digest() { printf '%s\n' "$valid_digest"; }
verify_api_runtime() {
    printf '%s\n' "$1" >"$status_verified_route_file"
    return "${status_runtime_result:-0}"
}
run_as_root() {
    case "$*" in
        *"{{.Config.Image}}"*) printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:$valid_sha" ;;
        *"{{.RestartCount}}"*) printf '0\n' ;;
        *"{{if .State.Health}}"*) printf 'healthy\n' ;;
        *"{{range .Config.Env}}"*) printf 'SCHEDULERS_ENABLED=false\n' ;;
        "/usr/bin/curl --fail --silent --location --proto =https --proto-redir =https --connect-timeout 5 --max-time 10 $PUBLIC_HEALTH_URL")
            echo public >>"$probe_calls"
            [[ "$public_probe" == ok ]] || return 7
            printf '{"status":"ok"}\n'
            ;;
        "/usr/bin/curl --disable --fail --silent --proto =https --connect-timeout 5 --max-time 10 --resolve preview.api.babyjamjam.com:443:127.0.0.1 $PUBLIC_HEALTH_URL")
            echo verified >>"$probe_calls"
            case "$edge_probe" in
                verified) printf '{"status": "ok"}\n' ;;
                expired) return 60 ;;
                bad_body) printf '{"status":"unavailable"}\n' ;;
                unavailable) return 7 ;;
            esac
            ;;
        "/usr/bin/curl --disable --insecure --fail --silent --proto =https --connect-timeout 5 --max-time 10 --resolve preview.api.babyjamjam.com:443:127.0.0.1 $PUBLIC_HEALTH_URL")
            echo insecure >>"$probe_calls"
            case "$edge_probe" in
                expired) printf '{"status":"ok"}\n' ;;
                bad_body) printf '{"status":"unavailable"}\n' ;;
                unavailable) return 7 ;;
            esac
            ;;
        *) fail "unexpected status command: $*" ;;
    esac
}
status_runtime_result=0
public_probe=ok
edge_probe=unavailable
status_output="$(HEALTH_SCOPE=self main status preview)"
[[ "$(<"$status_verified_route_file")" == direct ]] || fail "status did not verify the persisted route"
[[ "$status_output" == *$'db_route=direct\n'* ]] || fail "status did not expose db_route"
[[ "$status_output" == *$'runtime_route=direct\n'* ]] || fail "status did not expose runtime_route"
[[ "$status_output" == *$'db_readiness=ok\n'* ]] || fail "status did not expose db readiness"
[[ "$status_output" == *$'\npublic_health=ok\nhealth_scope=public' ]] || fail "public scope fields are wrong"
[[ "$status_output" != *$'\nedge_'* ]] || fail "public scope emitted edge fields"
assert_equals public "$(<"$probe_calls")"

public_probe=failed
assert_fails main status preview
for edge_probe in verified expired bad_body unavailable; do
    : >"$probe_calls"
    status_output="$(main status preview self)" || fail "self status failed with edge probe $edge_probe"
    case "$edge_probe" in
        verified) expected_edge=$'edge_route=ok\nedge_tls=ok'; expected_calls=verified ;;
        expired) expected_edge=$'edge_route=ok\nedge_tls=failed'; expected_calls=$'verified\ninsecure' ;;
        bad_body|unavailable) expected_edge=$'edge_route=failed\nedge_tls=failed'; expected_calls=$'verified\ninsecure' ;;
    esac
    [[ "$status_output" == *$'\npublic_health=skipped\nhealth_scope=self\n'"$expected_edge" ]] \
        || fail "self scope reported unexpected fields for $edge_probe"
    [[ "$status_output" != *$'\npublic_health=ok'* ]] || fail "self scope reported public health"
    assert_equals "$expected_calls" "$(<"$probe_calls")"
done

status_runtime_result=1
public_probe=ok
assert_fails main status preview
assert_fails main status preview self
)

# ADR-010: the scheduler-owning host (production) must run the lease as
# `lightsail`. Preview never contests the lease, so its keys are not enforced.
(
configure_environment production
ROUTE_STATE_ACTIVE_ROUTE=direct
ensure_route_state() { :; }
load_route_state() { :; }
validate_backend_env_file() { :; }
load_current_release_identity() {
    CURRENT_ROUTE_IMAGE_TAG="$valid_sha"
    CURRENT_ROUTE_IMAGE_DIGEST="$valid_digest"
}
find_api_container() { printf '%s\n' status-api; }
read_recorded_tag() { printf '%s\n' "$valid_sha"; }
read_recorded_digest() { printf '%s\n' "$valid_digest"; }
verify_api_runtime() { return 0; }
lease_env_lines=$'SCHEDULERS_ENABLED=true\nSCHEDULER_LEASE_MODE=required\nSCHEDULER_LEASE_HOLDER_ID=lightsail'
run_as_root() {
    case "$*" in
        *"{{.Config.Image}}"*) printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:$valid_sha" ;;
        *"{{.RestartCount}}"*) printf '0\n' ;;
        *"{{if .State.Health}}"*) printf 'healthy\n' ;;
        *"{{range .Config.Env}}"*) printf '%s\n' "$lease_env_lines" ;;
        *curl*) printf '{"status":"ok"}\n' ;;
        *) : ;;
    esac
}
status_output="$(status_environment)"
[[ "$status_output" == *$'lease_mode=required\n'* ]] || fail "production status did not expose lease_mode"
[[ "$status_output" == *$'lease_holder=lightsail\n'* ]] || fail "production status did not expose lease_holder"

lease_env_lines=$'SCHEDULERS_ENABLED=true'
assert_fails status_environment
lease_env_lines=$'SCHEDULERS_ENABLED=true\nSCHEDULER_LEASE_MODE=off\nSCHEDULER_LEASE_HOLDER_ID=lightsail'
assert_fails status_environment
lease_env_lines=$'SCHEDULERS_ENABLED=true\nSCHEDULER_LEASE_MODE=required\nSCHEDULER_LEASE_HOLDER_ID=lightnode'
assert_fails status_environment

# Preview (schedulers off) reports the missing keys but does not enforce them.
configure_environment preview
lease_env_lines=$'SCHEDULERS_ENABLED=false'
status_output="$(status_environment)"
[[ "$status_output" == *$'lease_mode=missing\n'* ]] || fail "preview status did not report a missing lease mode"
)

# Exercise the actual runtime invariant in both accepting and refusing
# directions. Each failure model represents an observation that deploy and
# rollback status checks must reject.
(
configure_environment preview
CURRENT_ROUTE_IMAGE_TAG="$valid_sha"
CURRENT_ROUTE_IMAGE_DIGEST="$valid_digest"
probe_calls="$TEST_ROOT/runtime-probes"
find_api_container_optional() { printf '%s\n' api-container; }
read_recorded_digest() { printf '%s\n' "$valid_digest"; }
run_as_root() {
    case "$*" in
        "/usr/bin/timeout --kill-after=1s 10s /usr/bin/docker exec api-container /usr/local/bin/node -e $READY_NODE_SCRIPT")
            echo internal >>"$probe_calls"
            [[ "$runtime_failure_mode" != internal_ready_503 ]]
            ;;
        "/usr/bin/curl --fail --silent --show-error --location --proto =https --proto-redir =https --connect-timeout 5 --max-time 10 $PUBLIC_READY_URL")
            echo readiness >>"$probe_calls"
            [[ "$runtime_failure_mode" != readiness_503 && "$runtime_failure_mode" != public_probes_down ]]
            ;;
        "/usr/bin/curl --fail --silent --show-error --location --proto =https --proto-redir =https --connect-timeout 5 --max-time 10 $PUBLIC_HEALTH_URL")
            echo liveness >>"$probe_calls"
            [[ "$runtime_failure_mode" != liveness_failure && "$runtime_failure_mode" != public_probes_down ]]
            ;;
        *"docker ps"*)
            if [[ "$runtime_failure_mode" == multiple_api ]]; then
                printf 'api-one\napi-two\n'
            else
                printf 'api-one\n'
            fi
            ;;
        *"{{if .State.Health}}"*) printf 'healthy\n' ;;
        *"{{.RestartCount}}"*) printf '0\n' ;;
        *"{{.Id}}"*) printf 'sha256:runtime-image\n' ;;
        *"{{.Config.Image}}"*)
            if [[ "$runtime_failure_mode" == image_tag_mismatch ]]; then
                printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:0000000000000000000000000000000000000000"
            else
                printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:$valid_sha"
            fi
            ;;
        *"{{.Image}}"*) printf 'sha256:runtime-image\n' ;;
        *"{{index .Config.Labels"*) printf '%s\n' "$valid_sha" ;;
        *"{{join .RepoDigests"*) printf '%s@%s\n' "$IMAGE_REPOSITORY" "$valid_digest" ;;
        *"{{range .Config.Env"*)
            if [[ "$runtime_failure_mode" == scheduler_malformed ]]; then
                printf 'SCHEDULERS_ENABLED=false=malformed\nDATABASE_CONNECTION_MODE=direct\n'
            elif [[ "$runtime_failure_mode" == route_mismatch ]]; then
                printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=shared\n'
            elif [[ "$runtime_failure_mode" == route_malformed ]]; then
                printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=direct=malformed\n'
            else
                printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=direct\n'
            fi
            ;;
        *) fail "unexpected runtime command: $*" ;;
    esac
}
runtime_failure_mode=none
verify_api_runtime direct || fail "runtime invariant rejected a healthy direct deployment"
assert_equals $'internal\nreadiness\nliveness' "$(<"$probe_calls")"
for runtime_failure_mode in route_mismatch scheduler_malformed route_malformed readiness_503 liveness_failure image_tag_mismatch multiple_api public_probes_down; do
    assert_fails verify_api_runtime direct
done

HEALTH_SCOPE=self
runtime_failure_mode=public_probes_down
: >"$probe_calls"
verify_api_runtime direct || fail "self runtime was blocked by failing public probes"
assert_equals internal "$(<"$probe_calls")"
for runtime_failure_mode in internal_ready_503 route_mismatch scheduler_malformed image_tag_mismatch multiple_api; do
    assert_fails verify_api_runtime direct
done
)

# The starting and post-stop listings share a fixture that persists across
# command substitutions. Unexpected Docker commands fail in the fixture.
fixture_api_docker() {
    case "$*" in
        "/usr/bin/docker ps --filter label=com.docker.compose.project=$COMPOSE_PROJECT --filter label=com.docker.compose.service=api --format {{.ID}}")
            echo list >>"$docker_events"
            cat "$container_fixture"
            return "$list_result"
            ;;
        "/usr/bin/timeout --kill-after=1s 45s /usr/bin/docker stop --time 30 "*)
            [[ "$#" -eq 8 ]] || fail "unexpected stop arguments: $*"
            echo "stop $8" >>"$docker_events"
            [[ "$stop_result" == 0 ]] || return "$stop_result"
            if [[ "$leave_running" == false ]]; then
                awk -v stopped="$8" '$0 != stopped' "$container_fixture" >"$container_fixture.next"
                mv "$container_fixture.next" "$container_fixture"
            fi
            printf '%s\n' "$8"
            ;;
        *) fail "unexpected Docker command: $*" ;;
    esac
}

(
    container_fixture="$TEST_ROOT/standby-containers"
    docker_events="$TEST_ROOT/standby-events"
    run_as_root() { fixture_api_docker "$@"; }
    require_root() { echo root >>"$docker_events"; }
    acquire_lock() {
        [[ "$#" -eq 0 && "$DEPLOY_ENVIRONMENT" == production ]] || fail "standby lock was not configured"
        echo lock >>"$docker_events"
    }
    ensure_route_state() { fail "standby accessed route state"; }
    load_route_state() { fail "standby loaded route state"; }
    validate_backend_env_file() { fail "standby read backend.env"; }
    load_current_release_identity() { fail "standby loaded release identity"; }
    read_recorded_tag() { fail "standby read an image tag"; }
    find_api_container() { fail "standby required exactly one container"; }

    list_result=0
    stop_result=0
    leave_running=false
    for count in 0 1 2; do
        : >"$container_fixture"
        : >"$docker_events"
        expected_events=$'root\nlock\nlist'
        for (( index=1; index<=count; index++ )); do
            printf 'api-%s\n' "$index" >>"$container_fixture"
            expected_events+=$'\n'"stop api-$index"
        done
        output="$(main standby production)" || fail "standby failed with $count running containers"
        assert_equals $'environment=production\nstandby=ok\napi_stopped='"$count" "$output"
        assert_equals "$expected_events"$'\nlist' "$(<"$docker_events")"
    done

    printf 'api-1\n' >"$container_fixture"
    leave_running=true
    stdout_file="$TEST_ROOT/standby.stdout"
    stderr_file="$TEST_ROOT/standby.stderr"
    if (main standby production) >"$stdout_file" 2>"$stderr_file"; then
        fail "standby succeeded while an API container was still running"
    fi
    assert_equals "" "$(<"$stdout_file")"
    assert_equals "production API container is still running; standby was not reached." "$(<"$stderr_file")"

    : >"$docker_events"
    list_result=1
    if (main standby production) >"$stdout_file" 2>"$stderr_file"; then
        fail "standby succeeded after a failed container listing"
    fi
    assert_equals "" "$(<"$stdout_file")"
    assert_equals "Unable to list running production API containers." "$(<"$stderr_file")"
    assert_equals $'root\nlock\nlist' "$(<"$docker_events")"
)

(
    state_fixture="$TEST_ROOT/release-state"
    container_fixture="$TEST_ROOT/deploy-containers"
    docker_events="$TEST_ROOT/deploy-events"
    stdout_file="$TEST_ROOT/deploy.stdout"
    stderr_file="$TEST_ROOT/deploy.stderr"
    mkdir "$state_fixture"
    old_tag=0000000000000000000000000000000000000001
    original_previous_tag=0000000000000000000000000000000000000002
    old_digest="sha256:${old_tag}${old_tag:0:24}"
    original_previous_digest="sha256:${original_previous_tag}${original_previous_tag:0:24}"
    require_root() { :; }
    acquire_lock() {
        STATE_DIRECTORY="$state_fixture"
        echo lock >>"$docker_events"
    }
    ensure_route_state() { echo route >>"$docker_events"; }
    validate_backend_env_file() { :; }
    prepare_deploy_worktree() { :; }
    pull_release_image() { echo pull >>"$docker_events"; }
    run_release_migrations() { echo migrate >>"$docker_events"; }
    run_as_root() {
        case "$*" in
            "/usr/bin/docker image inspect $LOCAL_IMAGE_REPOSITORY:$old_tag") return 0 ;;
            *) fixture_api_docker "$@" ;;
        esac
    }
    run_deploy_script() {
        assert_equals "$expected_scope" "$HEALTH_SCOPE"
        echo deploy >>"$docker_events"
        printf 'new-api\n' >"$container_fixture"
        printf '%s\n' "$1" >"$state_fixture/current-image-tag"
        printf '%s\n' "$old_tag" >"$state_fixture/previous-image-tag"
        [[ "$failure_point" != activation ]]
    }
    run_rollback_script() {
        echo "rollback $1" >>"$docker_events"
        printf '%s\n' "$1" >"$state_fixture/current-image-tag"
    }
    status_environment() {
        echo status >>"$docker_events"
        if [[ "$scenario" == restore_failed ]]; then
            rm "$state_fixture/previous-image-digest"
            mkdir "$state_fixture/previous-image-digest"
        fi
        [[ "$scenario" == serving ]] || return 1
        if [[ "$failure_point" == status ]]; then
            grep -Fxq "rollback $old_tag" "$docker_events"
        fi
    }

    for scenario in standby_public standby_self stop_failed restore_failed still_running missing_previous serving list_failed; do
        printf '%s\n' "$old_tag" >"$state_fixture/current-image-tag"
        printf '%s\n' "$old_digest" >"$state_fixture/current-image-digest"
        printf '%s\n' "$original_previous_tag" >"$state_fixture/previous-image-tag"
        printf '%s\n' "$original_previous_digest" >"$state_fixture/previous-image-digest"
        : >"$container_fixture"
        : >"$docker_events"
        list_result=0
        stop_result=0
        leave_running=false
        failure_point=status
        expected_scope=public
        scope_args=()
        case "$scenario" in
            standby_self) expected_scope=self; scope_args=(self); failure_point=activation ;;
            stop_failed) stop_result=124 ;;
            restore_failed) rm "$state_fixture/previous-image-digest" ;;
            still_running) leave_running=true ;;
            missing_previous) rm "$state_fixture"/previous-image-{tag,digest} ;;
            serving) printf 'old-api\n' >"$container_fixture" ;;
            list_failed) list_result=1 ;;
        esac

        if (main deploy production "$valid_sha" "$valid_digest" "${scope_args[@]}") >"$stdout_file" 2>"$stderr_file"; then
            fail "deploy succeeded with simulated $scenario failure"
        fi
        assert_equals "" "$(<"$stdout_file")"
        error="$(<"$stderr_file")"
        events="$(<"$docker_events")"
        case "$scenario" in
            standby_public|standby_self|missing_previous)
                [[ "$error" == "Deployment failed and the host was returned to standby (API stopped). Diagnostic log retained at "* ]] \
                    || fail "unexpected standby recovery message: $error"
                [[ "$events" == *$'\nstop new-api\nlist' && "$events" != *rollback* ]] \
                    || fail "standby recovery did not stop and check the new API"
                assert_equals "" "$(<"$container_fixture")"
                ;;
            stop_failed|restore_failed|still_running)
                [[ "$error" == "Deployment and automatic recovery both failed. Diagnostic log retained at "* ]] \
                    || fail "unexpected failed recovery message: $error"
                [[ "$events" == *$'\nstop new-api'* && "$events" != *rollback* ]] \
                    || fail "failed standby recovery used the wrong recovery path"
                if [[ "$scenario" == restore_failed ]]; then
                    rmdir "$state_fixture/previous-image-digest"
                fi
                continue
                ;;
            serving)
                [[ "$error" == "Deployment failed and the previous healthy image was restored. Diagnostic log retained at "* ]] \
                    || fail "unexpected serving recovery message: $error"
                [[ "$events" == *$'\n'"rollback $old_tag"$'\nstatus' && "$events" != *stop* ]] \
                    || fail "serving recovery did not roll back the active API"
                ;;
            list_failed)
                assert_equals "Unable to list running production API containers." "$error"
                assert_equals $'lock\nlist' "$events"
                continue
                ;;
        esac
        [[ -f "${error##* }" ]] || fail "deployment diagnostic log was not retained"
        assert_equals "$old_tag" "$(<"$state_fixture/current-image-tag")"
        assert_equals "$old_digest" "$(<"$state_fixture/current-image-digest")"
        if [[ "$scenario" == missing_previous ]]; then
            [[ ! -e "$state_fixture/previous-image-tag" && ! -e "$state_fixture/previous-image-digest" ]] \
                || fail "standby recovery left state that was previously missing"
        else
            assert_equals "$original_previous_tag" "$(<"$state_fixture/previous-image-tag")"
            assert_equals "$original_previous_digest" "$(<"$state_fixture/previous-image-digest")"
        fi
    done
)

# Run the helper bodies with their host-only boundary checks removed from
# temporary copies. BASH_ENV supplies the Docker and curl stubs before either
# helper sets its fixed PATH.
(
    helper_directory="$TEST_ROOT/helpers"
    helper_state="$TEST_ROOT/helper-state"
    helper_stubs="$TEST_ROOT/helper-stubs"
    helper_calls="$TEST_ROOT/helper-calls"
    mkdir "$helper_directory" "$helper_state"
    cat >"$helper_stubs" <<'EOF'
docker() {
    case "$*" in
        "network inspect "*|"volume inspect "*|"image inspect "*|"compose "*)
            printf 'docker\n' >>"$HELPER_CALLS"
            if [[ "$*" == *" ps -q api" ]]; then
                printf 'fixture-api\n'
            fi
            ;;
        "inspect --format "*)
            printf 'internal\n' >>"$HELPER_CALLS"
            printf '%s\n' "$HELPER_API_HEALTH"
            ;;
        *) printf 'Unexpected Docker invocation: %s\n' "$*" >&2; exit 2 ;;
    esac
}
curl() {
    [[ "$*" == "--fail --silent --location --proto =http,https --proto-redir =http,https --connect-timeout 5 --max-time 10 https://example.invalid/health" ]] \
        || exit 2
    printf 'public\n' >>"$HELPER_CALLS"
    return "$HELPER_CURL_RESULT"
}
sleep() { :; }
EOF

    old_helper_tag=0000000000000000000000000000000000000001
    previous_helper_tag=0000000000000000000000000000000000000002
    helper_env=(
        "BASH_ENV=$helper_stubs"
        "HELPER_CALLS=$helper_calls"
        "BACKEND_PUBLIC_HEALTH_URL=https://example.invalid/health"
        "DEPLOY_STATE_DIRECTORY=$helper_state"
        "BACKEND_IMAGE_TAG=$valid_sha"
    )
    for helper in deploy rollback; do
        sed -e 's/^if \[\[ "\$EUID" -ne 0 \]\]; then$/if false; then/' \
            -e "s#^readonly PROTECTED_ARTIFACT_DIRECTORY=.*#readonly PROTECTED_ARTIFACT_DIRECTORY=\"$helper_directory\"#" \
            -e '/^validate_protected_runtime_bundle$/d' \
            -e '/^validate_env_file_permissions$/d' \
            "$SCRIPT_DIR/$helper.sh" >"$helper_directory/$helper.sh"
        helper_args=(production)
        if [[ "$helper" == rollback ]]; then
            helper_args+=("$valid_sha")
        fi
        for scenario in invalid empty default_down public_ok self_ok self_unhealthy; do
            printf '%s\n' "$old_helper_tag" >"$helper_state/current-image-tag"
            printf '%s\n' "$previous_helper_tag" >"$helper_state/previous-image-tag"
            : >"$helper_calls"
            helper_options=()
            api_health=healthy
            curl_result=7
            case "$scenario" in
                invalid) helper_options=(BACKEND_HEALTH_SCOPE=invalid) ;;
                empty) helper_options=(BACKEND_HEALTH_SCOPE=) ;;
                public_ok) helper_options=(BACKEND_HEALTH_SCOPE=public); curl_result=0 ;;
                self_ok) helper_options=(BACKEND_HEALTH_SCOPE=self) ;;
                self_unhealthy) helper_options=(BACKEND_HEALTH_SCOPE=self); api_health=unhealthy ;;
            esac
            helper_status=0
            output="$(/usr/bin/env -i "${helper_env[@]}" "${helper_options[@]}" \
                "HELPER_API_HEALTH=$api_health" "HELPER_CURL_RESULT=$curl_result" \
                /bin/bash "$helper_directory/$helper.sh" "${helper_args[@]}" 2>&1)" || helper_status=$?
            case "$scenario" in
                invalid|empty)
                    assert_equals 1 "$helper_status"
                    assert_equals "BACKEND_HEALTH_SCOPE must be public or self." "$output"
                    assert_equals "" "$(<"$helper_calls")"
                    ;;
                default_down)
                    assert_equals 1 "$helper_status"
                    [[ "$output" == *"timed out waiting for the public health check:"* ]] || fail "$helper: $output"
                    assert_equals 30 "$(grep -c '^public$' "$helper_calls")"
                    ;;
                public_ok|self_ok)
                    assert_equals 0 "$helper_status"
                    assert_equals "$valid_sha" "$(<"$helper_state/current-image-tag")"
                    assert_equals "$old_helper_tag" "$(<"$helper_state/previous-image-tag")"
                    assert_equals 1 "$(grep -c '^internal$' "$helper_calls")"
                    if [[ "$scenario" == self_ok ]]; then
                        [[ "$output" == *"after the internal API health check: $valid_sha" ]] || fail "$helper: $output"
                        assert_equals 0 "$(grep -c '^public$' "$helper_calls" || true)"
                    else
                        [[ "$output" == *"after API and public proxy health checks: $valid_sha" ]] || fail "$helper: $output"
                        assert_equals 1 "$(grep -c '^public$' "$helper_calls")"
                    fi
                    continue
                    ;;
                self_unhealthy)
                    assert_equals 1 "$helper_status"
                    [[ "$output" == *"failed with API state: unhealthy" ]] || fail "$helper: $output"
                    assert_equals 0 "$(grep -c '^public$' "$helper_calls" || true)"
                    ;;
            esac
            assert_equals "$old_helper_tag" "$(<"$helper_state/current-image-tag")"
            assert_equals "$previous_helper_tag" "$(<"$helper_state/previous-image-tag")"
        done
    done

    : >"$helper_calls"
    output="$(/usr/bin/env -i "${helper_env[@]}" BACKEND_HEALTH_SCOPE=self BACKEND_PUBLIC_HEALTH_REQUIRED=false \
        HELPER_API_HEALTH=healthy HELPER_CURL_RESULT=7 \
        /bin/bash "$helper_directory/deploy.sh" production 2>&1)"
    [[ "$output" == $'Started production after the internal API health check only; deployment state was not recorded.\nDeploy the shared edge, then rerun with BACKEND_PUBLIC_HEALTH_REQUIRED=true.' ]] \
        || fail "legacy public health switch changed: $output"
    assert_equals "$old_helper_tag" "$(<"$helper_state/current-image-tag")"
    assert_equals "$previous_helper_tag" "$(<"$helper_state/previous-image-tag")"
    assert_equals 0 "$(grep -c '^public$' "$helper_calls" || true)"
)

# The typed contention boundary is portable to non-Linux CI: the real flock
# exercise below is supplemental, while this contract test proves that only
# status 75 can produce a deferral and all other failures return without any
# route-state access or stdout envelope.
(
    configure_environment preview
    lock_route_calls=0
    ensure_route_state() {
        lock_route_calls=$((lock_route_calls + 1))
        fail "lock contention read route state"
    }
    load_route_state() {
        lock_route_calls=$((lock_route_calls + 1))
        fail "lock contention loaded route state"
    }
    acquire_lock() { return 75; }

    lock_deferral_output="$(db_reconcile "$valid_uuid")"
    assert_equals \
        '{"schemaVersion":1,"source":"babyjamjam-db-failover-lock","controlPlaneOk":true,"environment":"preview","requestId":"123e4567-e89b-12d3-a456-426614174000","status":"DEFERRED","reason":"operator_lock_busy","retryAfterSeconds":5}' \
        "$lock_deferral_output"
    assert_equals "0" "$lock_route_calls"

    acquire_lock() {
        echo "simulated flock runtime failure" >&2
        return 74
    }
    set +e
    invalid_output="$(db_reconcile "$valid_uuid" 2>/dev/null)"
    invalid_status=$?
    set -e
    assert_equals "74" "$invalid_status"
    assert_equals "" "$invalid_output"
    assert_equals "0" "$lock_route_calls"
)
echo "Portable lock-contention contract tests passed"

# Exercise the host-boundary checks on the Linux deployment host where GNU
# stat and root ownership are available. macOS local runs retain the static
# contract checks above and report this host-only harness as skipped.
if [[ "$(uname -s)" == Linux && "$EUID" -eq 0 ]]; then
    boundary_root="$(mktemp -d /opt/babyjamjam-env-boundary.XXXXXX)"
    boundary_real="$boundary_root/real"
    boundary_env_file="$boundary_real/backend.env"
    mkdir -m 0700 "$boundary_real"
    printf '%s\n' 'DATABASE_URL=postgresql://db-user:db-password@example.invalid/db' >"$boundary_env_file"
    chown root:root "$boundary_root" "$boundary_real" "$boundary_env_file"
    chmod 0700 "$boundary_root" "$boundary_real"
    chmod 0600 "$boundary_env_file"
    BACKEND_ENV_FILE="$boundary_env_file"
    validate_backend_env_file || fail "root:root 0600 environment file was rejected"

    boundary_rejection_without_secret() {
        local boundary_output
        local boundary_status

        set +e
        boundary_output="$(validate_backend_env_file 2>&1)"
        boundary_status=$?
        set -e
        [[ "$boundary_status" -ne 0 ]] || fail "unsafe environment boundary was accepted"
        [[ "$boundary_output" != *"db-password"* ]] \
            || fail "environment validation emitted secret content"
    }

    chmod 0640 "$boundary_env_file"
    boundary_rejection_without_secret
    chmod 0600 "$boundary_env_file"
    if /usr/bin/id ubuntu >/dev/null 2>&1; then
        chown ubuntu:ubuntu "$boundary_env_file"
        boundary_rejection_without_secret
        chown root:root "$boundary_env_file"
    fi
    chmod 0770 "$boundary_real"
    boundary_rejection_without_secret
    chmod 0700 "$boundary_real"

    boundary_secret_source="$boundary_root/secret-source"
    printf '%s\n' 'DATABASE_URL=postgresql://db-user:db-password@example.invalid/db' >"$boundary_secret_source"
    chown root:root "$boundary_secret_source"
    chmod 0600 "$boundary_secret_source"
    rm -f "$boundary_env_file"
    ln -s "$boundary_secret_source" "$boundary_env_file"
    boundary_rejection_without_secret
    rm -f "$boundary_env_file"
    ln -s "$boundary_real" "$boundary_root/link"
    BACKEND_ENV_FILE="$boundary_root/link/backend.env"
    boundary_rejection_without_secret
    rm -f "$boundary_root/link"

    rm -rf "$boundary_root"
    echo "Linux environment-boundary tests passed"

    # A real host lock held by another process defers only db-reconcile. The
    # route-state functions deliberately fail if the bounded contention path
    # reads or mutates them.
    (
        lock_test_root="$(mktemp -d /opt/babyjamjam-lock-contention.XXXXXX)"
        lock_test_state="$lock_test_root/state"
        lock_test_file="$lock_test_state/operator.lock"
        lock_test_route_directory="$lock_test_root/route"
        lock_test_route_file="$lock_test_route_directory/$ROUTE_STATE_FILE_NAME"
        mkdir -m 0700 "$lock_test_state"
        install -o root -g root -m 0600 /dev/null "$lock_test_file"
        configure_environment preview
        STATE_DIRECTORY="$lock_test_state"
        DEPLOY_LOCK_FILE="$lock_test_file"
        ROUTE_STATE_DIRECTORY="$lock_test_route_directory"
        ROUTE_STATE_FILE="$lock_test_route_file"
        ensure_route_state() { fail "lock contention read route state"; }
        load_route_state() { fail "lock contention loaded route state"; }

        exec 8>>"$lock_test_file"
        /usr/bin/flock -n 8 || fail "could not hold real test lock"
        lock_deferral_output="$(db_reconcile "$valid_uuid" 2>"$lock_test_root/contention.stderr")"
        assert_equals 0 "$?"
        assert_equals \
            '{"schemaVersion":1,"source":"babyjamjam-db-failover-lock","controlPlaneOk":true,"environment":"preview","requestId":"123e4567-e89b-12d3-a456-426614174000","status":"DEFERRED","reason":"operator_lock_busy","retryAfterSeconds":5}' \
            "$lock_deferral_output"
        [[ ! -e "$lock_test_route_file" ]] || fail "lock contention created route state"
        [[ ! -d "$lock_test_route_directory" ]] || fail "lock contention created route state directory"
        [[ "$(wc -l <"$lock_test_root/contention.stderr")" -eq 0 ]] \
            || fail "lock contention emitted unexpected stderr"
        exec 8>&-
        exec 9>&-

        assert_invalid_lock() {
            local invalid_output
            local invalid_status

            set +e
            invalid_output="$(db_reconcile "$valid_uuid" 2>"$lock_test_root/invalid.stderr")"
            invalid_status=$?
            set -e
            [[ "$invalid_status" -ne 0 ]] || fail "invalid lock was accepted"
            [[ -z "$invalid_output" ]] || fail "invalid lock emitted a deferral envelope"
            [[ "$(wc -l <"$lock_test_root/invalid.stderr")" -gt 0 ]] \
                || fail "invalid lock did not fail closed"
        }

        rm -f "$lock_test_file"
        assert_invalid_lock

        install -o root -g root -m 0600 /dev/null "$lock_test_file"
        ln -s "$lock_test_file" "$lock_test_root/lock-target"
        rm -f "$lock_test_file"
        ln -s "$lock_test_root/lock-target" "$lock_test_file"
        assert_invalid_lock
        rm -f "$lock_test_file" "$lock_test_root/lock-target"

        install -o root -g root -m 0640 /dev/null "$lock_test_file"
        assert_invalid_lock
        rm -f "$lock_test_file"

        install -o root -g root -m 0600 /dev/null "$lock_test_file"
        if /usr/bin/id ubuntu >/dev/null 2>&1; then
            chown ubuntu:ubuntu "$lock_test_file"
            assert_invalid_lock
        fi
        rm -rf "$lock_test_root"
    )
    echo "Linux lock-contention tests passed"
else
    echo "Linux environment-boundary tests skipped on this host"
fi

echo "ci-operator tests passed"
