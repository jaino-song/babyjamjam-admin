#!/usr/bin/env bash

set -euo pipefail

readonly WORKFLOW_FILE="lightsail-operations.yml"
readonly DEFAULT_DISCOVERY_INTERVAL_SECONDS="2"
readonly MAX_DISCOVERY_ATTEMPTS="30"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

usage() {
    cat >&2 <<'EOF'
Usage:
  lightsail-cli.sh status <preview|production> [--self] [--no-watch]
  lightsail-cli.sh deploy <preview|production> [--self] [--no-watch]
  lightsail-cli.sh node-status <preview|production> [--no-watch]
  lightsail-cli.sh standby [--no-watch]
  lightsail-cli.sh operator-upgrade [--no-watch]

The command uses the authenticated GitHub CLI.
standby and --self are production-only and require GitHub production approval.
EOF
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

action="${1:-}"
environment="${2:-}"
watch_run="true"
self_scope="false"

case "$action" in
    status|deploy|node-status)
        [[ "$environment" == "preview" || "$environment" == "production" ]] || {
            usage
            fail "Environment must be preview or production."
        }
        shift 2
        ;;
    standby|operator-upgrade)
        environment="production"
        shift
        ;;
    *)
        usage
        exit 1
        ;;
esac

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --no-watch)
            [[ "$watch_run" == "true" ]] || break
            watch_run="false"
            ;;
        --self)
            [[ "$self_scope" == "false" && "$environment" == "production" &&
                ( "$action" == "status" || "$action" == "deploy" ) ]] || break
            self_scope="true"
            ;;
        *) break ;;
    esac
    shift
done
if [[ "$#" -gt 0 ]]; then
    usage
    exit 1
fi

case "$environment" in
    preview) workflow_ref="preview" ;;
    production) workflow_ref="main" ;;
    *) fail "Unsupported environment." ;;
esac

require_command gh
require_command uuidgen
gh auth status >/dev/null

request_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
[[ "$request_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || fail "Unable to generate a valid operation request id."

dispatch_args=(
    --ref "$workflow_ref"
    -f "operation=$action"
    -f "environment=$environment"
    -f "request_id=$request_id"
)
if [[ "$self_scope" == "true" ]]; then
    dispatch_args+=(-f health_scope=self)
fi
gh workflow run lightsail-operations.yml "${dispatch_args[@]}"

discovery_interval="${BABYJAMJAM_RUN_DISCOVERY_INTERVAL_SECONDS:-$DEFAULT_DISCOVERY_INTERVAL_SECONDS}"
[[ "$discovery_interval" =~ ^[0-9]+$ && "$discovery_interval" -le 10 ]] \
    || fail "Run discovery interval must be an integer from 0 to 10."

run_id=""
for _attempt in $(seq 1 "$MAX_DISCOVERY_ATTEMPTS"); do
    run_id="$(gh run list \
        --workflow "$WORKFLOW_FILE" \
        --event workflow_dispatch \
        --limit 30 \
        --json databaseId,displayTitle \
        --jq ".[] | select(.displayTitle | contains(\"$request_id\")) | .databaseId" \
        | head -n 1)"
    if [[ "$run_id" =~ ^[0-9]+$ ]]; then
        break
    fi
    sleep "$discovery_interval"
done

[[ "$run_id" =~ ^[0-9]+$ ]] \
    || fail "The workflow was dispatched, but its run could not be located. Request id: $request_id"

printf 'Dispatched %s for %s: run %s\n' "$action" "$environment" "$run_id"
if [[ "$watch_run" == "true" ]]; then
    gh run watch "$run_id" --exit-status
else
    gh run view "$run_id" --web
fi
