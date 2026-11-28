#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
WORKFLOW="$REPOSITORY_ROOT/.github/workflows/backend-ci.yml"
OPERATIONS_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/lightsail-operations.yml"
INFRASTRUCTURE_TEMPLATE="$SCRIPT_DIR/github-oidc-ssm.yaml"
INSTALLER="$SCRIPT_DIR/install-ci-operator.sh"
ROLLBACK_SCRIPT="$SCRIPT_DIR/rollback.sh"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
EDGE_SCRIPT="$SCRIPT_DIR/deploy-edge.sh"
CI_OPERATOR="$SCRIPT_DIR/ci-operator.sh"
PREVIEW_OPERATOR="$SCRIPT_DIR/operator-preview.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local pattern="$2"
    local description="$3"

    grep -Eq -- "$pattern" "$file" || fail "$description"
}

assert_not_contains() {
    local file="$1"
    local pattern="$2"
    local description="$3"

    if grep -Eq -- "$pattern" "$file"; then
        fail "$description"
    fi
}

assert_ordered_contains() {
    local file="$1"
    local first_pattern="$2"
    local second_pattern="$3"
    local description="$4"
    local first_line
    local second_line

    first_line="$(grep -n -m1 -E -- "$first_pattern" "$file" | cut -d: -f1 || true)"
    second_line="$(grep -n -m1 -E -- "$second_pattern" "$file" | cut -d: -f1 || true)"
    [[ -n "$first_line" && -n "$second_line" && "$first_line" -lt "$second_line" ]] \
        || fail "$description"
}

assert_text_contains() {
    local text="$1"
    local pattern="$2"
    local description="$3"

    grep -Eq -- "$pattern" <<<"$text" || fail "$description"
}

assert_text_not_contains() {
    local text="$1"
    local pattern="$2"
    local description="$3"

    if grep -Eq -- "$pattern" <<<"$text"; then
        fail "$description"
    fi
}

yaml_block() {
    local file="$1"
    local header="$2"

    awk -v header="$header" '
        $0 == header && !in_block {
            indentation = match($0, /[^ ]/)
            in_block = 1
            print
            next
        }
        in_block && NF && match($0, /[^ ]/) <= indentation { exit }
        in_block { print }
    ' "$file"
}

assert_document_command() {
    local block="$1"
    local command="$2"

    assert_text_contains "$block" '^      UpdateMethod: NewVersion$' "document must update as a new version: $command"
    grep -Fxq -- "                - '$command'" <<<"$block" || fail "missing fixed document command: $command"
}

assert_document_output() {
    local document="$1"
    local variable="$2"
    local block

    block="$(yaml_block "$INFRASTRUCTURE_TEMPLATE" "  ${document}Name:")"
    grep -Fxq "    Value: !Ref $document" <<<"$block" || fail "output must reference $document"
    grep -Fxq "    Description: Set as the $variable GitHub repository variable." <<<"$block" \
        || fail "output must identify GitHub variable $variable"
}

assert_compose_env_isolation() {
    local file="$1"
    local description="$2"
    local compose_calls

    compose_calls="$(grep -E '(^|/usr/bin/)docker compose' "$file" || true)"
    [[ -n "$compose_calls" ]] || fail "$description: no Compose calls found"
    if grep -Ev -- '--env-file "\$(PROTECTED_COMPOSE_ENV_FILE|ROOT_COMPOSE_ENV_FILE)"' \
        <<<"$compose_calls" >/dev/null; then
        fail "$description: a Compose call can load an inherited working-directory .env"
    fi
}

[[ -r "$INFRASTRUCTURE_TEMPLATE" ]] || fail "missing OIDC/SSM template"
[[ -r "$INSTALLER" ]] || fail "missing CI operator installer"

assert_contains "$INSTALLER" '^#!/bin/bash$' "installer must use the fixed root Bash interpreter"

assert_contains "$WORKFLOW" 'packages:[[:space:]]*write' "workflow must publish the immutable image"
assert_contains "$WORKFLOW" 'id-token:[[:space:]]*write' "deploy job must use GitHub OIDC"
assert_contains "$WORKFLOW" 'docker/build-push-action@[0-9a-f]{40}' "Docker build action must be commit-pinned"
assert_contains "$OPERATIONS_WORKFLOW" 'aws-actions/configure-aws-credentials@[0-9a-f]{40}' "AWS credential action must be commit-pinned"
assert_contains "$WORKFLOW" 'persist-credentials:[[:space:]]*false' "checkout credentials must not persist"
assert_contains "$WORKFLOW" 'cache-to:[[:space:]]*type=gha' "workflow must cache Docker layers"
assert_contains "$OPERATIONS_WORKFLOW" 'aws ssm send-command' "Lightsail operations must deploy through SSM"
assert_contains "$OPERATIONS_WORKFLOW" 'aws ssm describe-instance-information' "Lightsail operations must preflight a unique online SSM node"
assert_contains "$OPERATIONS_WORKFLOW" 'max-concurrency[[:space:]]+1' "SSM must execute on at most one target at a time"
assert_contains "$OPERATIONS_WORKFLOW" 'schedulers_enabled' "deployment verification must check scheduler ownership"
assert_not_contains "$WORKFLOW" '^  approve-lightsail-production:' "backend CI must omit the Lightsail production approval job"
assert_contains "$OPERATIONS_WORKFLOW" 'AWS_PREVIEW_DEPLOY_ROLE_ARN' "preview must use a branch-scoped repository variable"
assert_contains "$OPERATIONS_WORKFLOW" 'AWS_PRODUCTION_DEPLOY_ROLE_ARN' "production must use a branch-scoped repository variable"
assert_contains "$WORKFLOW" 'cancel-in-progress:[[:space:]]*true' "superseded image builds must be cancelled"
assert_contains "$WORKFLOW" 'cancel-in-progress:[[:space:]]*false' "active deployments must not be cancelled"
assert_not_contains "$WORKFLOW" 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' "workflow must not use long-lived AWS keys"
assert_not_contains "$WORKFLOW" 'aws ssm|aws-actions/configure-aws-credentials|AWS_PREVIEW_|AWS_PRODUCTION_|LIGHTSAIL_SSM_TARGET_TAG' \
    "backend CI must omit Lightsail deployment commands and credentials"
assert_not_contains "$WORKFLOW" '^  deploy-lightsail:' "backend CI must omit the Lightsail deploy job"
assert_not_contains "$OPERATIONS_WORKFLOW" 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' "Lightsail operations must not use long-lived AWS keys"

operation_input="$(sed -n '/^      operation:$/,/^      [a-z_-]*:$/p' "$OPERATIONS_WORKFLOW")"
assert_text_contains "$operation_input" '^          - deploy$' "Lightsail operations must offer the deploy choice"
approval_job="$(sed -n '/^  approve-production:$/,/^  [a-z_-]*:$/p' "$OPERATIONS_WORKFLOW")"
assert_text_contains "$approval_job" '^    environment: production$' "Lightsail operations must gate production on approval"

assert_not_contains "$OPERATIONS_WORKFLOW" '^[[:space:]]+AWS_[A-Z_]+DOCUMENT_NAME:.*(&&|\|\|)' \
    "workflow must not use a chained expression to choose a document"
validation_step="$(yaml_block "$OPERATIONS_WORKFLOW" '      - name: Validate fixed operation boundary')"
assert_text_contains "$validation_step" 'GitHub variable %s is not set\. Update the CloudFormation stack' \
    "validation must identify a missing document variable and report how to set it"
operations_step="$(yaml_block "$OPERATIONS_WORKFLOW" '      - name: Run fixed Systems Manager operation')"
node_preflight="$(sed '/^          case "\$OPERATION" in/,$d' <<<"$operations_step")"
assert_text_contains "$node_preflight" 'printf .*managed_nodes=%s.*online_nodes=%s' \
    "node preflight must print managed and online counts"
assert_text_contains "$node_preflight" 'jq -r .*\.InstanceInformationList\[\] \|' \
    "node-status must report metadata for each node"
assert_text_contains "$node_preflight" '"ping_status=\\\(\.PingStatus\)"' "node-status must report ping status"
assert_text_contains "$node_preflight" '"last_ping=\\\(\.LastPingDateTime\)"' "node-status must report the last ping"
assert_text_contains "$node_preflight" '"agent_version=\\\(\.AgentVersion\)"' "node-status must report the agent version"
assert_text_not_contains "$node_preflight" 'InstanceId|IPAddress|ComputerName|\.Name|SourceId|(echo|printf).*\$nodes' \
    "node preflight must not log node identifiers, addresses, or the raw response"

standby_checkout="$(yaml_block "$OPERATIONS_WORKFLOW" '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0')"
standby_dns_guard="$(yaml_block "$OPERATIONS_WORKFLOW" '      - name: Verify production DNS is on LightNode before standby')"
assert_text_contains "$standby_checkout" "^        if: inputs.operation == 'standby'$" "checkout must run only for standby"
assert_text_contains "$standby_checkout" '^          persist-credentials: false$' "standby checkout must not persist credentials"
assert_text_contains "$standby_dns_guard" "^        if: inputs.operation == 'standby'$" "DNS guard must run only for standby"
assert_text_contains "$standby_dns_guard" 'node backend/deploy/fallback-server/ci/resolve-deploy-target\.mjs' \
    "standby must use the production routing resolver"
assert_text_contains "$standby_dns_guard" '"\$target" != "target=lightnode"' "standby must require LightNode routing"
assert_text_contains "$standby_dns_guard" 'Production DNS is not on LightNode\. Refusing to put the Lightsail host in standby\.' \
    "standby must explain why other DNS routes are refused"
assert_ordered_contains "$OPERATIONS_WORKFLOW" 'uses: actions/checkout@' 'name: Verify production DNS' \
    "standby must check out the resolver before running it"
assert_ordered_contains "$OPERATIONS_WORKFLOW" 'name: Verify production DNS' 'uses: aws-actions/configure-aws-credentials@' \
    "standby DNS must be verified before AWS authentication"

self_result="$(yaml_block "$OPERATIONS_WORKFLOW" '          if [[ "$HEALTH_SCOPE" == "self" ]]; then')"
assert_text_contains "$self_result" '"\$\(read_value public_health\)" == "skipped"' "self scope must report skipped public health"
assert_text_contains "$self_result" '"\$\(read_value health_scope\)" == "self"' "self scope must verify the host health scope"
for edge_check in edge_route edge_tls; do
    edge_result="$(yaml_block "$OPERATIONS_WORKFLOW" '            if [[ "$(read_value '"$edge_check"')" != "ok" ]]; then')"
    assert_text_contains "$edge_result" 'echo "::warning::' "self scope must warn when $edge_check fails"
done

assert_contains "$INFRASTRUCTURE_TEMPLATE" 'token.actions.githubusercontent.com:aud' "OIDC trust must pin the AWS audience"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'SeoulRegionOnly:' "Lightsail IAM/SSM stack must enforce the Seoul region"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Assert: !Equals' "Lightsail IAM/SSM stack must reject deployment outside Seoul"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '!Ref AWS::Region' "Lightsail IAM/SSM stack must compare the deployment region"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ap-northeast-2' "Lightsail IAM/SSM stack must pin Seoul as the deployment region"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'UpdateMethod:[[:space:]]*NewVersion' "SSM document names must remain stable across updates"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:ref:refs/heads/preview' "preview trust must pin the preview branch"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:ref:refs/heads/main' "production trust must pin the main branch"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:environment:' "deploy roles must not trust every workflow using an environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:SendCommand' "deploy roles must only submit SSM commands"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:DescribeInstanceInformation' "deploy roles must preflight SSM target uniqueness"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:resourceTag/DeploymentTarget' "SSM target must be tag-scoped"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^\[0-9a-f\]\{40\}\$"' "SSM document must validate commit SHA"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^sha256:\[0-9a-f\]\{64\}\$"' "SSM document must validate image digest"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator deploy preview' "preview document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator deploy production' "production document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '^  PreviewDiagnosticsDocument:' "preview diagnostics document must be account-owned"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '^  ProductionDiagnosticsDocument:' "production diagnostics document must be account-owned"
assert_contains "$INFRASTRUCTURE_TEMPLATE" "/usr/local/sbin/babyjamjam-ci-operator diagnostics preview'" "preview diagnostics document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" "/usr/local/sbin/babyjamjam-ci-operator diagnostics production'" "production diagnostics document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '^  AgentLightsailDiagnosticsPolicy:' "diagnostics IAM policy must be version-controlled in the stack"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Type:[[:space:]]*AWS::IAM::ManagedPolicy' "diagnostics IAM policy must be a managed policy"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ManagedPolicyName:[[:space:]]*AgentLightsailOperatorDiagnostics' "diagnostics IAM policy must have a stable source-of-truth name"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'PreviewDiagnosticsDocumentArn:' "preview diagnostics document ARN must be exported"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ProductionDiagnosticsDocumentArn:' "production diagnostics document ARN must be exported"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'AgentLightsailDiagnosticsPolicyArn:' "diagnostics policy ARN must be exported for explicit attachment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:ListCommands' "diagnostics policy must retain the fourth SSM read action"
preview_diagnostics_document_section="$(sed -n '/^  PreviewDiagnosticsDocument:/,/^  ProductionDeployDocument:/p' "$INFRASTRUCTURE_TEMPLATE")"
production_diagnostics_document_section="$(sed -n '/^  ProductionDiagnosticsDocument:/,/^  PreviewDbReconcileDocument:/p' "$INFRASTRUCTURE_TEMPLATE")"
assert_text_not_contains "$preview_diagnostics_document_section" 'parameters:' "preview diagnostics document must not accept parameters"
assert_text_not_contains "$production_diagnostics_document_section" 'parameters:' "production diagnostics document must not accept parameters"
assert_text_not_contains "$preview_diagnostics_document_section" 'CommitSha|ImageDigest|RequestId' "preview diagnostics document must not accept deployment or arbitrary parameters"
assert_text_not_contains "$production_diagnostics_document_section" 'CommitSha|ImageDigest|RequestId' "production diagnostics document must not accept deployment or arbitrary parameters"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'PreviewDbReconcileDocument:' "preview reconcile document must be defined"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ProductionDbReconcileDocument:' "production reconcile document must be defined"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Name:[[:space:]]*babyjamjam-preview-db-failover' "preview reconcile document name must be fixed for the worker"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Name:[[:space:]]*babyjamjam-production-db-failover' "production reconcile document name must be fixed for the worker"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'PreviewDbReconcileDocumentArn:' "preview reconcile document ARN must be exported"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ProductionDbReconcileDocumentArn:' "production reconcile document ARN must be exported"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Value:[[:space:]]*!Sub arn:\$\{AWS::Partition\}:ssm:\$\{AWS::Region\}:\$\{AWS::AccountId\}:document/\$\{PreviewDbReconcileDocument\}' "preview reconcile document ARN must be partition-aware and Ref-based"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Value:[[:space:]]*!Sub arn:\$\{AWS::Partition\}:ssm:\$\{AWS::Region\}:\$\{AWS::AccountId\}:document/\$\{ProductionDbReconcileDocument\}' "production reconcile document ARN must be partition-aware and Ref-based"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'GetAtt[[:space:]]+(Preview|Production)DbReconcileDocument\.Arn' "SSM documents must not use an unsupported Arn GetAtt"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator db-reconcile preview "{{ RequestId }}"' "preview reconcile document must pass only its fixed environment and UUID"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator db-reconcile production "{{ RequestId }}"' "production reconcile document must pass only its fixed environment and UUID"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^\[0-9a-fA-F\]\{8\}-' "reconcile document must validate UUID request IDs"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'db-reconcile.*CommitSha\|db-reconcile.*ImageDigest' "reconcile documents must not accept deployment parameters"
preview_deploy_role_section="$(sed -n '/^  PreviewDeployRole:/,/^  ProductionDeployRole:/p' "$INFRASTRUCTURE_TEMPLATE")"
production_deploy_role_section="$(sed -n '/^  ProductionDeployRole:/,/^  AgentLightsailDiagnosticsPolicy:/p' "$INFRASTRUCTURE_TEMPLATE")"
assert_text_not_contains "$preview_deploy_role_section" 'DbReconcileDocument' "preview deploy role must not gain failover document access"
assert_text_not_contains "$production_deploy_role_section" 'DbReconcileDocument' "production deploy role must not gain failover document access"
assert_text_not_contains "$preview_deploy_role_section" 'DiagnosticsDocument' "preview deploy role must not gain diagnostics document access"
assert_text_not_contains "$production_deploy_role_section" 'DiagnosticsDocument' "production deploy role must not gain diagnostics document access"
diagnostics_policy_section="$(sed -n '/^  AgentLightsailDiagnosticsPolicy:/,/^Outputs:/p' "$INFRASTRUCTURE_TEMPLATE")"
assert_text_contains "$diagnostics_policy_section" 'UseFixedDiagnosticsDocuments' "diagnostics policy must name the fixed document statement"
assert_text_contains "$diagnostics_policy_section" 'TargetTaggedManagedNode' "diagnostics policy must split target authorization from document authorization"
assert_text_contains "$diagnostics_policy_section" 'ssm:resourceTag/DeploymentTarget' "diagnostics target must be tag-scoped"
assert_text_contains "$diagnostics_policy_section" 'aws:RequestedRegion:[[:space:]]*ap-northeast-2' "diagnostics policy must be Seoul-region scoped"
assert_text_contains "$diagnostics_policy_section" 'ssm:DescribeInstanceInformation' "diagnostics policy must retain instance-information reads"
assert_text_contains "$diagnostics_policy_section" 'ssm:GetCommandInvocation' "diagnostics policy must retain invocation-output reads"
assert_text_contains "$diagnostics_policy_section" 'ssm:ListCommandInvocations' "diagnostics policy must retain invocation-list reads"
assert_text_contains "$diagnostics_policy_section" 'ssm:ListCommands' "diagnostics policy must retain command-list reads"
assert_text_not_contains "$diagnostics_policy_section" 'AWS-RunShellScript|StartSession|PreviewDeployDocument|ProductionDeployDocument' "diagnostics policy must not grant deployment or session access"
assert_text_not_contains "$diagnostics_policy_section" 'Users:|Groups:|Roles:' "diagnostics policy must remain unattached until explicitly approved"

self_status_document="$(yaml_block "$INFRASTRUCTURE_TEMPLATE" '  ProductionSelfStatusDocument:')"
self_deploy_document="$(yaml_block "$INFRASTRUCTURE_TEMPLATE" '  ProductionSelfDeployDocument:')"
standby_document="$(yaml_block "$INFRASTRUCTURE_TEMPLATE" '  HostStandbyDocument:')"
operator_path='/usr/local/sbin/babyjamjam-ci-operator'
assert_document_command "$self_status_document" "$operator_path status production self"
assert_document_command "$self_deploy_document" "$operator_path deploy production \"{{ CommitSha }}\" \"{{ ImageDigest }}\" self"
assert_document_command "$standby_document" "$operator_path standby production && $operator_path standby preview"
assert_text_not_contains "$self_status_document" 'parameters:' "self status must not accept parameters"
assert_text_not_contains "$standby_document" 'parameters:' "host standby must not accept parameters"

production_document_statement="$(yaml_block "$INFRASTRUCTURE_TEMPLATE" '              - Sid: UseProductionDocument')"
template_resources="$(yaml_block "$INFRASTRUCTURE_TEMPLATE" 'Resources:')"
for document in ProductionSelfStatusDocument ProductionSelfDeployDocument HostStandbyDocument; do
    grep -Fxq '                  - !Sub arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:document/${'"$document"'}' \
        <<<"$production_document_statement" || fail "production role must allow $document"
    assert_text_not_contains "$preview_deploy_role_section" "$document" "preview role must not refer to $document"
    assert_text_not_contains "$diagnostics_policy_section" "$document" "diagnostics policy must not refer to $document"
    referrers="$(awk -v document="$document" '
        /^  [A-Za-z][A-Za-z0-9]*:$/ { resource = $1; next }
        index($0, document) { print resource }
    ' <<<"$template_resources")"
    [[ "$referrers" == "ProductionDeployRole:" ]] || fail "only the production role may refer to $document"
done
assert_document_output ProductionSelfStatusDocument AWS_PRODUCTION_SELF_STATUS_DOCUMENT_NAME
assert_document_output ProductionSelfDeployDocument AWS_PRODUCTION_SELF_DEPLOY_DOCUMENT_NAME
assert_document_output HostStandbyDocument AWS_HOST_STANDBY_DOCUMENT_NAME

assert_contains "$INSTALLER" 'root:root' "CI operator must remain root-owned"
assert_contains "$INSTALLER" '0750' "CI operator must not be executable by unprivileged users"
assert_contains "$INSTALLER" 'root:root:600' "shared deployment locks must remain root-only"
assert_contains "$CI_OPERATOR" 'acquire_lock' "deploy and reconcile must use the shared operator lock"
assert_contains "$CI_OPERATOR" 'db_reconcile()' "reconcile must be implemented by the CI operator"
assert_contains "$CI_OPERATOR" 'up -d --no-build --no-deps --force-recreate api' "route changes must recreate only the API service without a protected-path build"
assert_contains "$CI_OPERATOR" 'EXPECTED_SCHEDULERS_ENABLED' "route verification must enforce scheduler ownership"
assert_contains "$CI_OPERATOR" 'SCHEDULER_LEASE_HOLDER_ID' \
    "status must enforce the scheduler lease identity on the scheduler-owning host (ADR-010)"
assert_contains "$CI_OPERATOR" 'run_public_liveness_check' "route verification must preserve the public liveness check"
assert_contains "$CI_OPERATOR" 'sharedOk' "reconcile output must expose only safe shared probe status"
assert_contains "$CI_OPERATOR" 'directOk' "reconcile output must expose only safe direct probe status"
assert_not_contains "$CI_OPERATOR" 'docker[[:space:]]+restart' "route changes must not use docker restart"
assert_not_contains "$CI_OPERATOR" 'docker[[:space:]]+compose[[:space:]]+run' "probes must not create a second Compose API instance"
assert_not_contains "$CI_OPERATOR" 'postgres(ql)?://' "operator source must not contain database URLs"
assert_not_contains "$CI_OPERATOR" '{{range \.Config\.Env}}{{println \.}}{{end}}' "operator must not print the full container environment"
assert_contains "$PREVIEW_OPERATOR" 'legacy preview operator is retired' "legacy preview operator must fail closed"
assert_not_contains "$PREVIEW_OPERATOR" 'docker|compose|BACKEND_ENV_FILE|DATABASE_CONNECTION_MODE|deploy\.sh|rollback\.sh' "legacy preview operator must not retain an unsafe alternate path"
assert_contains "$CI_OPERATOR" 'run_as_root' "fixed Docker/Compose operations must run from the root operator"
assert_contains "$CI_OPERATOR" 'id -nG ubuntu' "operator must inspect ubuntu Docker membership before automation"
assert_contains "$CI_OPERATOR" 'ubuntu must not belong to the docker group' "operator must fail closed on ubuntu Docker membership"
assert_contains "$CI_OPERATOR" 'root:root:600' "root operator must require an exact root-owned environment file"
assert_contains "$CI_OPERATOR" 'db_route=' "status must expose the authoritative database route"
assert_contains "$CI_OPERATOR" 'runtime_route=' "status must expose the verified runtime route"
assert_contains "$CI_OPERATOR" 'db_readiness=ok' "status must expose database readiness"
assert_contains "$CI_OPERATOR" 'verify_api_runtime "\$ROUTE_STATE_ACTIVE_ROUTE"' "status must verify the persisted route"
assert_contains "$CI_OPERATOR" 'run_internal_ready_check' "runtime invariant must include internal readiness"
assert_contains "$CI_OPERATOR" 'run_public_ready_check' "runtime invariant must include public readiness"
assert_contains "$CI_OPERATOR" 'run_public_liveness_check' "runtime invariant must include public liveness"
assert_contains "$CI_OPERATOR" '&& status_output="\$\(status_environment' "deploy success must require the full status invariant"
assert_contains "$CI_OPERATOR" '&& status_environment >>' "rollback recovery must require the full status invariant"
assert_not_contains "$CI_OPERATOR" 'run_as_deployer /usr/bin/docker' "Docker must not run as the ubuntu deployer"
assert_not_contains "$CI_OPERATOR" 'run_as_deployer /usr/bin/docker compose' "Compose must not run as the ubuntu deployer"
assert_contains "$DEPLOY_SCRIPT" 'DATABASE_CONNECTION_MODE' "deploy script must accept the persisted route mode"
assert_contains "$ROLLBACK_SCRIPT" 'DATABASE_CONNECTION_MODE' "rollback script must accept the persisted route mode"
assert_contains "$DEPLOY_SCRIPT" '^#!/bin/bash$' "deployment must use the fixed root Bash interpreter"
assert_contains "$ROLLBACK_SCRIPT" '^#!/bin/bash$' "rollback must use the fixed root Bash interpreter"
assert_contains "$DEPLOY_SCRIPT" 'group/world accessible' "deploy script must reject exposed backend environment files"
assert_contains "$ROLLBACK_SCRIPT" 'group/world accessible' "rollback script must reject exposed backend environment files"
assert_contains "$DEPLOY_SCRIPT" 'root:root mode 0600' "deploy script must require root-owned 0600 environment files"
assert_contains "$ROLLBACK_SCRIPT" 'root:root mode 0600' "rollback script must require root-owned 0600 environment files"
assert_contains "$DEPLOY_SCRIPT" 'must run as root' "manual deployment script must not expose an ubuntu Docker path"
assert_contains "$ROLLBACK_SCRIPT" 'must run as root' "manual rollback script must not expose an ubuntu Docker path"
assert_contains "$DEPLOY_SCRIPT" 'PROTECTED_ARTIFACT_DIRECTORY="/usr/local/libexec/babyjamjam-ci-operator"' "deployment must pin the protected runtime bundle"
assert_contains "$ROLLBACK_SCRIPT" 'PROTECTED_ARTIFACT_DIRECTORY="/usr/local/libexec/babyjamjam-ci-operator"' "rollback must pin the protected runtime bundle"
assert_contains "$DEPLOY_SCRIPT" 'PROTECTED_OPERATOR_PATH="/usr/local/sbin/babyjamjam-ci-operator"' "deployment must validate the installed operator entrypoint"
assert_contains "$ROLLBACK_SCRIPT" 'PROTECTED_OPERATOR_PATH="/usr/local/sbin/babyjamjam-ci-operator"' "rollback must validate the installed operator entrypoint"
assert_contains "$DEPLOY_SCRIPT" 'validate_protected_bundle_paths' "deployment must reject mixed or stale bundle paths"
assert_contains "$ROLLBACK_SCRIPT" 'validate_protected_bundle_paths' "rollback must reject mixed or stale bundle paths"
assert_contains "$DEPLOY_SCRIPT" 'readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' "deployment must declare the fixed operator PATH"
assert_contains "$ROLLBACK_SCRIPT" 'readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' "rollback must declare the fixed operator PATH"
assert_contains "$DEPLOY_SCRIPT" 'export PATH="\$SAFE_PATH"' "deployment must discard inherited PATH entries"
assert_contains "$ROLLBACK_SCRIPT" 'export PATH="\$SAFE_PATH"' "rollback must discard inherited PATH entries"
assert_contains "$DEPLOY_SCRIPT" 'repository deployment helper is retired' "repository deployment entrypoint must fail closed"
assert_contains "$ROLLBACK_SCRIPT" 'repository rollback helper is retired' "repository rollback entrypoint must fail closed"
assert_contains "$EDGE_SCRIPT" '^#!/bin/bash$' "retired edge helper must use the fixed root Bash interpreter"
assert_contains "$EDGE_SCRIPT" 'repository edge deployment helper is retired' "repository edge deployment must fail closed"
assert_not_contains "$EDGE_SCRIPT" 'docker|compose|Caddyfile|REPOSITORY_ROOT|git -C' "retired edge helper must not retain a root runtime path"
assert_not_contains "$DEPLOY_SCRIPT" 'REPOSITORY_ROOT' "deployment must not derive a Compose file from the repository"
assert_not_contains "$ROLLBACK_SCRIPT" 'REPOSITORY_ROOT' "rollback must not derive a Compose file from the repository"
assert_not_contains "$DEPLOY_SCRIPT" 'compose[^[:space:]]*[[:space:]].*build' "protected deployment must not build from a relative Compose context"
assert_ordered_contains "$DEPLOY_SCRIPT" 'up -d --no-build --remove-orphans' 'up -d --no-build --no-deps --force-recreate api' "protected deployment must start dependencies before recreating the API service"
assert_ordered_contains "$ROLLBACK_SCRIPT" 'up -d --no-build --remove-orphans' 'up -d --no-build --no-deps --force-recreate api' "protected rollback must start dependencies before recreating the API service"
assert_contains "$DEPLOY_SCRIPT" 'up -d --no-build --no-deps --force-recreate api' "protected deployment retries must recreate only the API service"
assert_contains "$ROLLBACK_SCRIPT" 'up -d --no-build --no-deps --force-recreate api' "protected rollback must recreate only the API service"
assert_contains "$DEPLOY_SCRIPT" 'requires BACKEND_BUILD_IMAGE=false and a preloaded image' "protected deployment must require a preloaded image"
assert_contains "$DEPLOY_SCRIPT" 'PROTECTED_COMPOSE_ENV_FILE="/dev/null"' "protected deployment must use a fixed empty interpolation environment"
assert_contains "$ROLLBACK_SCRIPT" 'PROTECTED_COMPOSE_ENV_FILE="/dev/null"' "protected rollback must use a fixed empty interpolation environment"
assert_contains "$CI_OPERATOR" 'ROOT_COMPOSE_ENV_FILE="/dev/null"' "root operator must use a fixed empty interpolation environment"
assert_contains "$DEPLOY_SCRIPT" 'cd "\$PROTECTED_ARTIFACT_DIRECTORY"' "protected deployment must enter the validated artifact directory"
assert_contains "$ROLLBACK_SCRIPT" 'cd "\$PROTECTED_ARTIFACT_DIRECTORY"' "protected rollback must enter the validated artifact directory"
assert_contains "$CI_OPERATOR" 'cd "\$ROOT_ARTIFACT_DIRECTORY"' "root operator must enter the validated artifact directory"
assert_contains "$DEPLOY_SCRIPT" '--project-directory "\$PROTECTED_ARTIFACT_DIRECTORY"' "protected deployment must pin the Compose project directory"
assert_contains "$ROLLBACK_SCRIPT" '--project-directory "\$PROTECTED_ARTIFACT_DIRECTORY"' "protected rollback must pin the Compose project directory"
assert_contains "$CI_OPERATOR" '--project-directory "\$ROOT_ARTIFACT_DIRECTORY"' "root operator must pin the Compose project directory"
assert_compose_env_isolation "$DEPLOY_SCRIPT" "protected deployment Compose isolation"
assert_compose_env_isolation "$ROLLBACK_SCRIPT" "protected rollback Compose isolation"
assert_compose_env_isolation "$CI_OPERATOR" "root operator Compose isolation"
assert_contains "$INSTALLER" 'must not belong to the docker group' "installer must fail closed on ubuntu Docker membership"
assert_not_contains "$INSTALLER" 'must belong to the docker group' "installer must not require ubuntu Docker membership"
assert_not_contains "$INSTALLER" 'sudoers' "CI operator must not grant a new sudo path"
assert_contains "$CI_OPERATOR" 'ROOT_ARTIFACT_DIRECTORY="/usr/local/libexec/babyjamjam-ci-operator"' "root operations must use a protected artifact bundle"
assert_contains "$CI_OPERATOR" 'validate_root_artifacts' "operator must validate the protected artifact bundle on every invocation"
assert_contains "$INSTALLER" 'INSTALLED_DEPLOY_ARTIFACT' "installer must own the protected deploy helper"
assert_contains "$INSTALLER" 'INSTALLED_ROLLBACK_ARTIFACT' "installer must own the protected rollback helper"
assert_contains "$INSTALLER" 'INSTALLED_COMPOSE_ARTIFACT' "installer must own the protected Compose definition"
assert_contains "$INSTALLER" 'INSTALLED_MANIFEST' "installer must own the versioned bundle manifest"
assert_contains "$INSTALLER" 'write_bundle_manifest' "installer must generate the bundle manifest from staged artifacts"
assert_contains "$INSTALLER" 'manifest_stage' "bundle manifest replacement must use an atomic staging path"
assert_contains "$INSTALLER" 'capture_install_snapshot "\$INSTALLED_COMPOSE_ARTIFACT"' "protected artifacts must join the compensating install transaction"
assert_contains "$CI_OPERATOR" 'ROOT_BUNDLE_MANIFEST' "root operator must validate the installed bundle manifest"
assert_contains "$CI_OPERATOR" 'diagnostics_environment' "root operator must expose fixed-environment diagnostics"
assert_contains "$CI_OPERATOR" 'redact_diagnostic_line' "diagnostics must redact sensitive log content"
assert_contains "$CI_OPERATOR" 'DIAGNOSTICS_MAX_OUTPUT_BYTES' "diagnostics must enforce an output byte cap"
assert_contains "$ROLLBACK_SCRIPT" 'PRESERVE_PREVIOUS_TAG.*==.*false.*current_tag' "automatic recovery must be able to preserve known-good tag history"
assert_contains "$CI_OPERATOR" 'restore_state_value.*previous-image-tag.*previous_tag' "automatic recovery must restore the rollback tag captured before deployment"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'Action:[[:space:]]*[\"]?[*]' "IAM actions must not use wildcards"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'Principal:[[:space:]]*[\"]?[*]' "IAM trust must not use a wildcard principal"

protected_runtime_functions="$(
    /usr/bin/awk '
        /^(recreate_api_for_route|run_release_migrations|run_deploy_script|run_rollback_script)\(\)/ { capture = 1 }
        capture { print }
        capture && /^}/ { capture = 0 }
    ' "$CI_OPERATOR"
)"
if printf '%s\n' "$protected_runtime_functions" | /usr/bin/grep -Eq 'DEPLOY_WORKTREE|REPOSITORY_ROOT'; then
    fail "root Docker/Compose paths must not read or execute ubuntu-owned repository/worktree files"
fi
[[ "$protected_runtime_functions" == *ROOT_COMPOSE_ARTIFACT* ]] \
    || fail "root runtime functions must use the protected Compose artifact"
[[ "$protected_runtime_functions" == *ROOT_DEPLOY_ARTIFACT* ]] \
    || fail "root deployment must execute the protected deploy artifact"
[[ "$protected_runtime_functions" == *ROOT_ROLLBACK_ARTIFACT* ]] \
    || fail "root recovery must execute the protected rollback artifact"

# A hostile repository helper and Compose override must be inert when invoked
# as root. The repository entrypoints fail before Docker/Compose is resolved;
# the installed operator is the only path that can reach the protected bundle.
runtime_probe_root="$(mktemp -d)"
trap 'rm -rf "$runtime_probe_root"' EXIT
runtime_probe_marker="$runtime_probe_root/docker-called"
runtime_probe_docker="$runtime_probe_root/docker"
printf '%s\n' '#!/usr/bin/env bash' "printf '%s\\n' called > '$runtime_probe_marker'" >"$runtime_probe_docker"
chmod 0755 "$runtime_probe_docker"
printf '%s\n' 'malicious-compose' >"$runtime_probe_root/compose.lightsail.yml"
if PATH="$runtime_probe_root:$PATH" BACKEND_COMPOSE_FILE="$runtime_probe_root/compose.lightsail.yml" \
    "$DEPLOY_SCRIPT" preview >/dev/null 2>&1; then
    fail "repository deployment helper unexpectedly executed"
fi
if PATH="$runtime_probe_root:$PATH" BACKEND_COMPOSE_FILE="$runtime_probe_root/compose.lightsail.yml" \
    "$ROLLBACK_SCRIPT" preview deadbeef >/dev/null 2>&1; then
    fail "repository rollback helper unexpectedly executed"
fi
if PATH="$runtime_probe_root:$PATH" "$EDGE_SCRIPT" >/dev/null 2>&1; then
    fail "repository edge helper unexpectedly executed"
fi
[[ ! -e "$runtime_probe_marker" ]] || fail "repository mutation reached Docker"

migration_line="$(grep -n 'if ! run_release_migrations' "$CI_OPERATOR" | cut -d: -f1)"
activation_line="$(grep -n 'if run_deploy_script' "$CI_OPERATOR" | cut -d: -f1)"
[[ -n "$migration_line" && -n "$activation_line" && "$migration_line" -lt "$activation_line" ]] \
    || fail "release migrations must run before image activation"

echo "ci-automation contract tests passed"
