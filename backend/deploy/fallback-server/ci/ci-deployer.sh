#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly APPROVAL_HELPER="/usr/local/libexec/babyjamjam-fallback-server/automatic-approval.mjs"
readonly APPROVAL_FILE="$STATE_ROOT/temporary-active-approval"
readonly SCHEDULER_EVIDENCE_FILE="$STATE_ROOT/temporary-active-scheduler-evidence"
readonly APPROVED_DB_REF_HASH_FILE="$STATE_ROOT/approved-production-db-ref.sha256"
readonly APPROVED_PUBLIC_ROUTING_FILE="$STATE_ROOT/approved-public-routing.sha256"
readonly AUTOMATION_AUTHORITY_FILE="$STATE_ROOT/automatic-deploy-authority"
readonly ACTIVE_EXPIRY_FILE="$STATE_DIRECTORY/temporary-active-expiry"
readonly VALKEY_RESTORE_MARKER="$STATE_DIRECTORY/valkey-restore-fence"
readonly DEPLOY_USER="babyjamjam-ci-deployer"
readonly PUBLIC_API_HOST="api.babyjamjam.com"
readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly DIGEST_PATTERN='^sha256:[0-9a-f]{64}$'
readonly HASH_PATTERN='^[0-9a-f]{64}$'
readonly AUTOMATION_AUTHORITY_VALUE="github-main-lightnode-auto-deploy-v1"

die() {
    echo "$*" >&2
    exit 1
}

require_root_and_caller() {
    [[ "$EUID" -eq 0 ]] || die "The Fallback CI deployer must run through sudo."
    [[ "${SUDO_USER:-}" == "$DEPLOY_USER" ]] || die "The Fallback CI deployer caller is not authorized."
}

validate_protected_file() {
    local path="$1"
    local mode="$2"
    [[ -f "$path" && ! -L "$path" ]] || die "A protected Fallback deployment artifact is missing or unsafe."
    [[ "$(stat -c '%u:%g:%a' "$path")" == "0:0:$mode" ]] \
        || die "A protected Fallback deployment artifact has invalid ownership or mode."
}

read_single_line() {
    local path="$1"
    local pattern="$2"
    local value
    value="$(cat "$path")"
    [[ "$value" =~ $pattern && "$(wc -l <"$path")" -eq 1 ]] \
        || die "A protected Fallback deployment artifact is malformed."
    printf '%s\n' "$value"
}

approval_value() {
    local key="$1"
    awk -F= -v wanted="$key" '
        $1 == wanted { count += 1; value = substr($0, index($0, "=") + 1) }
        END { if (count == 1 && value != "") print value; else exit 1 }
    ' "$APPROVAL_FILE"
}

status_value() {
    local key="$1"
    local status_output="$2"
    awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = substr($0, length($1) + 2) }
        END { if (count == 1 && value != "") print value; else exit 1 }' <<<"$status_output"
}

# One resolver call per guard: prints the sorted unique IPv4 records of the
# public API host, one per line, and dies when none resolve or the resolver
# fails. Callers assign the result on its own line so `set -e` aborts when it
# dies in the substitution. errexit is NOT inherited inside `$(...)`, so every
# step here (and in hash_route_lines) fails explicitly with `|| die`: a getent
# that prints records but exits non-zero must never look like a good answer.
resolve_public_route_records() {
    local records
    records="$(getent ahostsv4 "$PUBLIC_API_HOST" \
        | awk '$2 == "STREAM" && $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print $1 }' \
        | sort -u)" || die "The public API route could not be resolved."
    [[ -n "$records" ]] || die "The public API route could not be resolved."
    printf '%s\n' "$records"
}

# sha256 of newline-terminated route text: the whole record set, or one record.
hash_route_lines() {
    local digest
    digest="$(printf '%s\n' "$1" | sha256sum | awk '{ print $1 }')" \
        || die "The public API route could not be hashed."
    [[ "$digest" =~ $HASH_PATTERN ]] || die "The public API route could not be hashed."
    printf '%s\n' "$digest"
}

require_fallback_route() {
    local approved_hash records current_hash
    validate_protected_file "$APPROVED_PUBLIC_ROUTING_FILE" 400
    approved_hash="$(read_single_line "$APPROVED_PUBLIC_ROUTING_FILE" "$HASH_PATTERN")"
    records="$(resolve_public_route_records)"
    current_hash="$(hash_route_lines "$records")" || die "The public API route could not be hashed."
    [[ "$current_hash" == "$approved_hash" ]] \
        || die "The public API route is not the approved Fallback target."
}

# Passive standby paths run only while LightNode receives NO public API traffic
# (Lightsail is primary). The route must resolve; an unresolvable route is a
# failure, never "not LightNode". The resolver result is assigned on its own line
# so `set -e` aborts when it dies inside the command substitution.
#
# The approved hash is the hash of LightNode's single IP, so the per-record check
# is only meaningful for that single-IP approved fallback. A mixed answer
# (Lightsail plus LightNode) hashes differently from the whole set, so every
# record is hashed on its own and any match refuses. If the approved hash ever
# covered several IPs no single record would match; the whole-set comparison
# still refuses then, so the guard fails closed.
#
# Deliberately a LightNode denylist, not a positive "approved primary" allowlist:
# that would need a new protected root-owned file and installer change, and the
# safety criterion is only "never replace standby while LightNode is a public
# route". An unknown non-LightNode IP does not route traffic to LightNode.
require_aws_route() {
    local approved_hash records current_hash record record_hash
    validate_protected_file "$APPROVED_PUBLIC_ROUTING_FILE" 400
    approved_hash="$(read_single_line "$APPROVED_PUBLIC_ROUTING_FILE" "$HASH_PATTERN")"
    records="$(resolve_public_route_records)"
    current_hash="$(hash_route_lines "$records")" || die "The public API route could not be hashed."
    [[ "$current_hash" != "$approved_hash" ]] \
        || die "LightNode is the public route; use replace, not the standby path."
    while IFS= read -r record; do
        record_hash="$(hash_route_lines "$record")" || die "The public API route could not be hashed."
        [[ "$record_hash" != "$approved_hash" ]] \
            || die "A mixed or LightNode public route was refused; LightNode still receives public traffic, so use replace, not the standby path."
    done <<<"$records"
}

require_automation_authority() {
    local authority
    validate_protected_file "$AUTOMATION_AUTHORITY_FILE" 400
    authority="$(read_single_line "$AUTOMATION_AUTHORITY_FILE" '^github-main-lightnode-auto-deploy-v1$')"
    [[ "$authority" == "$AUTOMATION_AUTHORITY_VALUE" ]] \
        || die "Automatic Fallback deployment authority is invalid."
}

# A fenced Valkey restore (operator `valkey-restore`) leaves this marker until
# the restored dataset is verified and the API reopened. An automatic `main`
# deployment must not recreate the API against a half-restored Valkey.
require_no_valkey_restore_fence() {
    [[ ! -e "$VALKEY_RESTORE_MARKER" && ! -L "$VALKEY_RESTORE_MARKER" ]] \
        || die "A Valkey restore fence is active ($VALKEY_RESTORE_MARKER); an automatic replacement must not start the API. Finish or abort the fenced restore on the host first."
}

validated_status() {
    local output
    validate_protected_file "$OPERATOR" 750
    output="$($OPERATOR status)"
    [[ "$(status_value environment "$output")" == "fallback-server" \
        && "$(status_value container_health "$output")" == "healthy" \
        && "$(status_value restart_count "$output")" == "0" \
        && "$(status_value db_readiness "$output")" == "ok" \
        && "$(status_value production_db_identity "$output")" == "ok" \
        && "$(status_value runtime_mode "$output")" == "temporary-active" \
        && "$(status_value schedulers_enabled "$output")" == "true" \
        && "$(status_value document_jobs_accepting "$output")" == "true" \
        && "$(status_value document_jobs_worker "$output")" == "true" ]] \
        || die "The active Fallback runtime is not safe for automatic replacement."
    if [[ "$(status_value automatic_shutdown "$output" || true)" == disabled ]]; then
        [[ "$(status_value lease_mode "$output")" == required \
            && "$(status_value lease_held "$output")" == true ]] \
            || die "The persistent Fallback host does not hold the scheduler lease."
    fi
    printf '%s\n' "$output"
}

emit_status() {
    local output
    require_fallback_route
    output="$(validated_status)"
    printf '%s\n' "$output" | awk -F= '$1 != "public_routing" { print }'
    printf '%s\n' "public_routing=fallback"
}

# A standby host is a passive Fallback Server: environment/identity verified,
# schedulers off. Anything else (including temporary-active) is refused.
require_passive_status() {
    local output="$1"
    [[ "$(status_value environment "$output")" == "fallback-server" \
        && "$(status_value production_db_identity "$output")" == "ok" \
        && "$(status_value runtime_mode "$output")" == "passive" \
        && "$(status_value schedulers_enabled "$output")" == "false" ]] \
        || die "The LightNode standby runtime is not a passive Fallback release."
}

# The operator records the release it activated in its state directory
# (`current-image-tag`, `current-image-digest`), independent of whether the
# container is up. That recorded identity is what keeps an older queued run from
# rolling a stopped or restarting standby backwards. Sets RECORDED_TAG and
# RECORDED_DIGEST and returns 0 when a release is recorded; returns 1 only when
# NEITHER file exists. A partial, unsafe or malformed record dies: "cannot be
# read" is never "absent".
read_recorded_release() {
    local tag_file="$STATE_DIRECTORY/current-image-tag"
    local digest_file="$STATE_DIRECTORY/current-image-digest"
    local have_tag=0 have_digest=0
    RECORDED_TAG=""
    RECORDED_DIGEST=""
    if [[ -e "$STATE_DIRECTORY" || -L "$STATE_DIRECTORY" ]]; then
        [[ -d "$STATE_DIRECTORY" && ! -L "$STATE_DIRECTORY" ]] \
            || die "The Fallback state directory is unsafe."
    fi
    if [[ -e "$tag_file" || -L "$tag_file" ]]; then have_tag=1; fi
    if [[ -e "$digest_file" || -L "$digest_file" ]]; then have_digest=1; fi
    if [[ "$have_tag" -eq 0 && "$have_digest" -eq 0 ]]; then
        return 1
    fi
    [[ "$have_tag" -eq 1 && "$have_digest" -eq 1 ]] \
        || die "The recorded Fallback release identity is incomplete."
    validate_protected_file "$tag_file" 600
    validate_protected_file "$digest_file" 600
    # This function runs as an `if` condition, where `set -e` is suspended, so
    # each failure must abort explicitly.
    RECORDED_TAG="$(read_single_line "$tag_file" "$SHA_PATTERN")" \
        || die "The recorded Fallback release identity is malformed."
    RECORDED_DIGEST="$(read_single_line "$digest_file" "$DIGEST_PATTERN")" \
        || die "The recorded Fallback release identity is malformed."
}

emit_standby_status() {
    local output
    require_aws_route
    validate_protected_file "$OPERATOR" 750
    # A readable status must be a passive one. When the operator cannot report
    # (stopped, restarting, never deployed) the recorded release identity still
    # decides: a recorded release is reported as recorded-unhealthy so callers
    # keep their ancestry guard, and only a host with no record at all is "none".
    if output="$("$OPERATOR" status)"; then
        require_passive_status "$output"
        printf '%s\n' "$output" | awk -F= '$1 != "public_routing" { print }'
        printf '%s\n' "standby_release=present" "public_routing=aws"
        return 0
    fi
    if read_recorded_release; then
        printf '%s\n' "environment=fallback-server" \
            "standby_release=recorded-unhealthy" \
            "current_tag=$RECORDED_TAG" \
            "current_digest=$RECORDED_DIGEST" \
            "public_routing=aws"
        return 0
    fi
    printf '%s\n' "environment=fallback-server" "standby_release=none" "public_routing=aws"
}

write_automatic_approval() {
    local commit_sha="$1"
    local image_digest="$2"
    local condition_hash db_hash egress_hash incident_id issued_at nonce old_expiry temporary

    validate_protected_file "$APPROVAL_FILE" 400
    validate_protected_file "$SCHEDULER_EVIDENCE_FILE" 400
    validate_protected_file "$APPROVED_DB_REF_HASH_FILE" 400
    condition_hash="$(sha256sum "$SCHEDULER_EVIDENCE_FILE" | awk '{ print $1 }')"
    db_hash="$(read_single_line "$APPROVED_DB_REF_HASH_FILE" "$HASH_PATTERN")"
    egress_hash="$(approval_value aligo_egress_ipv4_sha256)"
    incident_id="$(approval_value incident_id)"
    old_expiry="$(read_single_line "$ACTIVE_EXPIRY_FILE" '^[0-9]{10,}$')"
    [[ "$condition_hash" =~ $HASH_PATTERN && "$egress_hash" =~ $HASH_PATTERN \
        && "$incident_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$ ]] \
        || die "The current active approval cannot authorize an automatic replacement."

    # Persistent hosts still use fresh bounded approvals for each replacement,
    # but the previous transaction expiry does not limit the next transaction.
    if [[ "$(status_value automatic_shutdown "$(validated_status)" || true)" == disabled ]]; then old_expiry=0; fi
    issued_at="$(date +%s)"
    nonce="$(openssl rand -hex 32)"
    [[ "$nonce" =~ ^[0-9a-f]{64}$ ]] || die "Unable to create an automatic approval nonce."

    temporary="$(mktemp "$STATE_ROOT/.automatic-approval.XXXXXX")"
    trap 'rm -f "${temporary:-}"' RETURN
    validate_protected_file "$APPROVAL_HELPER" 750
    node "$APPROVAL_HELPER" \
        "$commit_sha" "$image_digest" "$incident_id" "$condition_hash" "$db_hash" \
        "$egress_hash" "$issued_at" "$old_expiry" "$nonce" >"$temporary"
    chown root:root "$temporary"
    chmod 400 "$temporary"
    mv -f "$temporary" "$APPROVAL_FILE"
    trap - RETURN
}

replace_release() {
    local commit_sha="$1"
    local image_digest="$2"
    local before_status after_status backup
    [[ "$commit_sha" =~ $SHA_PATTERN && "$image_digest" =~ $DIGEST_PATTERN ]] \
        || die "The requested Fallback release identity is invalid."
    require_no_valkey_restore_fence
    require_automation_authority
    require_fallback_route
    before_status="$(validated_status)"
    [[ "$(status_value current_tag "$before_status")" != "$commit_sha" \
        || "$(status_value current_digest "$before_status")" != "$image_digest" ]] \
        || {
            printf '%s\n' "$before_status" | awk -F= '$1 != "public_routing" { print }'
            printf '%s\n' "public_routing=fallback" "deployment_changed=false"
            return 0
        }

    validate_protected_file "$APPROVAL_FILE" 400
    backup="$(mktemp "$STATE_ROOT/.approval-backup.XXXXXX")"
    cp -p "$APPROVAL_FILE" "$backup"
    # The operator prints its own replacement summary (including a
    # public_routing=not_managed marker). Keep it on stderr so the caller's
    # stdout carries exactly one status block with unique keys.
    if ! write_automatic_approval "$commit_sha" "$image_digest" \
        || ! "$OPERATOR" replace-temporary-active "$commit_sha" "$image_digest" >&2; then
        cp -p "$backup" "$APPROVAL_FILE"
        rm -f "$backup"
        die "The automatic Fallback replacement failed; the previous approval was restored."
    fi
    rm -f "$backup"
    after_status="$(validated_status)"
    [[ "$(status_value current_tag "$after_status")" == "$commit_sha" \
        && "$(status_value current_digest "$after_status")" == "$image_digest" ]] \
        || die "The automatic Fallback replacement did not publish the requested immutable release."
    printf '%s\n' "$after_status" | awk -F= '$1 != "public_routing" { print }'
    printf '%s\n' "public_routing=fallback" "deployment_changed=true"
}

deploy_standby_release() {
    local commit_sha="$1"
    local image_digest="$2"
    local before_status after_status
    [[ "$commit_sha" =~ $SHA_PATTERN && "$image_digest" =~ $DIGEST_PATTERN ]] \
        || die "The requested Fallback release identity is invalid."
    require_no_valkey_restore_fence
    require_automation_authority
    require_aws_route
    validate_protected_file "$OPERATOR" 750
    # A readable status must be a passive one. An unreadable status (never
    # deployed, stopped) goes straight to the operator, whose own guards protect
    # a host whose state cannot be read.
    if before_status="$("$OPERATOR" status)"; then
        require_passive_status "$before_status"
        if [[ "$(status_value current_tag "$before_status")" == "$commit_sha" \
            && "$(status_value current_digest "$before_status")" == "$image_digest" ]]; then
            printf '%s\n' "$before_status" | awk -F= '$1 != "public_routing" { print }'
            printf '%s\n' "public_routing=aws" "deployment_changed=false"
            return 0
        fi
    fi

    # The operator prints its own status summary; keep it on stderr so stdout
    # carries exactly one status block with unique keys. It rolls back to the
    # previous image itself when activation fails.
    "$OPERATOR" deploy "$commit_sha" "$image_digest" >&2 \
        || die "The LightNode standby deployment failed; the operator restored the previous release where one existed."
    after_status="$("$OPERATOR" status)" \
        || die "The LightNode standby status could not be read after deployment."
    require_passive_status "$after_status"
    [[ "$(status_value current_tag "$after_status")" == "$commit_sha" \
        && "$(status_value current_digest "$after_status")" == "$image_digest" \
        && "$(status_value container_health "$after_status")" == "healthy" \
        && "$(status_value restart_count "$after_status")" == "0" ]] \
        || die "The LightNode standby deployment did not publish the requested healthy immutable release."
    printf '%s\n' "$after_status" | awk -F= '$1 != "public_routing" { print }'
    printf '%s\n' "public_routing=aws" "deployment_changed=true"
}

main() {
    require_root_and_caller
    case "${1:-}" in
        status)
            [[ "$#" -eq 1 ]] || die "Usage: babyjamjam-fallback-ci-deployer status"
            emit_status
            ;;
        replace)
            [[ "$#" -eq 3 ]] || die "Usage: babyjamjam-fallback-ci-deployer replace <commit-sha> <image-digest>"
            replace_release "$2" "$3"
            ;;
        standby-status)
            [[ "$#" -eq 1 ]] || die "Usage: babyjamjam-fallback-ci-deployer standby-status"
            emit_standby_status
            ;;
        deploy-standby)
            [[ "$#" -eq 3 ]] || die "Usage: babyjamjam-fallback-ci-deployer deploy-standby <commit-sha> <image-digest>"
            deploy_standby_release "$2" "$3"
            ;;
        *)
            die "Usage: babyjamjam-fallback-ci-deployer status|replace|standby-status|deploy-standby"
            ;;
    esac
}

main "$@"
