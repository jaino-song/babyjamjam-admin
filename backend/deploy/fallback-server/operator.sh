#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly ARTIFACT_ROOT="/usr/local/libexec/babyjamjam-fallback-server"
readonly COMPOSE_FILE="$ARTIFACT_ROOT/compose.yml"
readonly ACTIVE_COMPOSE_FILE="$ARTIFACT_ROOT/compose.temporary-active.yml"
readonly DB_IDENTITY_HELPER="$ARTIFACT_ROOT/production-db-identity.sh"
readonly BUNDLE_MANIFEST="$ARTIFACT_ROOT/bundle.manifest"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly SHUTDOWN_POLICY_FILE="$STATE_ROOT/automatic-shutdown-policy"
readonly ENV_FILE="$STATE_ROOT/backend.env"
readonly APPROVED_DB_REF_HASH_FILE="$STATE_ROOT/approved-production-db-ref.sha256"
readonly TEMPORARY_ACTIVE_APPROVAL_FILE="$STATE_ROOT/temporary-active-approval"
readonly TEMPORARY_STOP_UNIT="babyjamjam-fallback-temporary-active-stop"
readonly TEMPORARY_GUARD_TIMER="babyjamjam-fallback-temporary-active-guard.timer"
readonly RUNTIME_MODE_FILE="$STATE_DIRECTORY/runtime-mode"
readonly ACTIVE_EXPIRY_FILE="$STATE_DIRECTORY/temporary-active-expiry"
readonly APPROVAL_NONCES_FILE="$STATE_DIRECTORY/used-temporary-active-nonces"
readonly SCHEDULER_EVIDENCE_FILE="$STATE_ROOT/temporary-active-scheduler-evidence"
readonly ACTIVE_LINKAGE_FILE="$STATE_DIRECTORY/temporary-active-linkage"
readonly LOCK_FILE="$STATE_DIRECTORY/operator.lock"
readonly IMAGE_REPOSITORY="ghcr.io/jaino-song/babyjamjam-admin-backend"
readonly LOCAL_IMAGE_REPOSITORY="babyjamjam-backend"
readonly PROJECT_NAME="babyjamjam-fallback-server"
readonly LOOPBACK_READY_URL="http://127.0.0.1:3101/health/ready"
readonly LOOPBACK_LEASE_URL="http://127.0.0.1:3101/health/lease"
readonly COMPOSE_ENV_FILE="/dev/null"
readonly VALKEY_RESTORE_READY_WINDOW_SECONDS=150
# Fenced Valkey restore seams. Plain assignments, NOT `${VAR:-default}`: this
# operator runs as root, so a caller environment must never redirect it. Tests
# (and only tests) re-assign these after sourcing the file.
VR_PROJECT="$PROJECT_NAME"
VR_VOLUME="babyjamjam-fallback-server-valkey-data"
VR_VALKEY_SERVICE="valkey"
VR_API_SERVICE="api"
VR_MARKER="$STATE_DIRECTORY/valkey-restore-fence"
VR_REPLACED_ROOT="$STATE_ROOT/valkey-replaced"
VR_SNAPSHOT_ROOT="$STATE_ROOT/valkey-restore-snapshot"
VR_STREAM_KEY="realtime:entity-changes"
VR_DOCKER_BIN="/usr/bin/docker"
VR_ATTEMPTS=60
readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly DIGEST_PATTERN='^sha256:[0-9a-f]{64}$'
readonly REQUIRED_ENV_KEYS=(
    DATABASE_URL
    DIRECT_URL
    JWT_SECRET
    KAKAO_CLIENT_ID
    KAKAO_CLIENT_SECRET
    KAKAO_CALLBACK_URL
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
    EFORMSIGN_USER_EMAIL
    EFORMSIGN_API_URL
    EFORMSIGN_DOC_API_URL
    EFORMSIGN_API_KEY
    EFORMSIGN_PRIVATE_KEY
    EFORMSIGN_COMPANY_ID
    EFORMSIGN_WEBHOOK_SECRET
    RECEIPT_LINK_HASH_SALT
    PRODUCTION_FRONTEND_URL
    PRODUCTION_MOBILE_FRONTEND_URL
    MOBILE_SERVICE_RECORD_BASE_URL
)
readonly PASSIVE_ENV_KEYS=(
    SCHEDULERS_ENABLED
    SERVICE_RECORD_AUTO_FINALIZE_ENABLED
    CONTRACT_AUTO_FINALIZE_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED
    EFORMSIGN_RECONCILE_ALLOW_UNLOCKED
    MESSAGE_TRIGGER_JOBS_WORKER_ENABLED
)
readonly ACTIVE_TRUE_ENV_KEYS=(
    SCHEDULERS_ENABLED
    SERVICE_RECORD_AUTO_FINALIZE_ENABLED
    CONTRACT_AUTO_FINALIZE_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED
)

usage() {
    cat >&2 <<'EOF'
Usage:
  babyjamjam-fallback-server status
  babyjamjam-fallback-server adopt-persistent-active
  babyjamjam-fallback-server deploy <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server temporary-active <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server extend-temporary-active <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server replace-temporary-active <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server rollback
  babyjamjam-fallback-server stop
  babyjamjam-fallback-server valkey-restore <absolute-backup-path> --confirm-fence
  babyjamjam-fallback-server valkey-restore --reopen --confirm-reopen
  babyjamjam-fallback-server valkey-restore --rollback <kept-copy-path> --confirm-fence
  babyjamjam-fallback-server valkey-restore --abort --confirm-fence

This operator manages the loopback-bound Fallback Server. Ordinary deploy is
passive; temporary-active requires the separately approved expiry artifact. It
does not change DNS, Cloudflare, Vercel, AWS, Aligo, migrations, or scheduler
ownership.

valkey-restore is the only supported way to restore Valkey data: it fences the
backend, restores into a freshly started Valkey process and verifies the dataset
before --reopen. While its fence marker exists every start path refuses.
--rollback is the only way back to data it kept: it runs inside the fence.
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

# A fenced Valkey restore leaves a durable marker. flock only covers one
# invocation, and `stop` clears the temporary-active state, so without a marker
# a later `main` push (ci-deployer) could recreate the API against a
# half-restored Valkey. Only STARTING paths call this; stop, guard-expiry, the
# expiry unit and status stay available while fenced.
fenced_by_valkey_restore() {
    [[ -e "$VR_MARKER" || -L "$VR_MARKER" ]]
}

refuse_if_valkey_restore_fenced() {
    fenced_by_valkey_restore || return 0
    die "A Valkey restore fence is active ($VR_MARKER); the backend must not be started. Finish with 'valkey-restore --reopen --confirm-reopen' after a verified restore, or discard it with 'valkey-restore --abort --confirm-fence'."
}

# Persistent operation is an explicit root-owned host policy, never a caller env.
automatic_shutdown_disabled() {
    [[ -e "$SHUTDOWN_POLICY_FILE" || -L "$SHUTDOWN_POLICY_FILE" ]] || return 1
    [[ -f "$SHUTDOWN_POLICY_FILE" && ! -L "$SHUTDOWN_POLICY_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$SHUTDOWN_POLICY_FILE")" == "root:root:400" \
        && "$(/usr/bin/cat "$SHUTDOWN_POLICY_FILE")" == "disabled" \
        && "$(/usr/bin/wc -l <"$SHUTDOWN_POLICY_FILE")" -eq 1 ]] \
        || die "The automatic shutdown policy is invalid."
}

verify_shutdown_masks() {
    local unit
    for unit in babyjamjam-fallback-temporary-active-{guard,stop}.{service,timer}; do
        [[ -L "/etc/systemd/system/$unit" \
            && "$(/usr/bin/readlink "/etc/systemd/system/$unit")" == /dev/null \
            && "$(/usr/bin/systemctl is-enabled "$unit" 2>/dev/null || true)" == masked ]] || return 1
        ! /usr/bin/systemctl is-active --quiet "$unit" || return 1
    done
}

active_restart_policy() {
    if automatic_shutdown_disabled; then printf '%s' unless-stopped; else printf '%s' no; fi
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "The Fallback Server operator must run as root."
}

sha256_file() {
    local path="$1"
    local output

    if [[ -x /usr/bin/sha256sum ]]; then
        output="$(/usr/bin/sha256sum "$path")"
    elif [[ -x /usr/bin/shasum ]]; then
        output="$(/usr/bin/shasum -a 256 "$path")"
    else
        die "A SHA-256 utility is required."
    fi
    output="${output%% *}"
    [[ "$output" =~ ^[0-9a-f]{64}$ ]] || die "Unable to hash a protected Fallback Server artifact."
    printf '%s\n' "$output"
}

validate_bundle() {
    local compose_digest
    local identity_digest
    local active_compose_digest
    local guard_service_digest
    local guard_timer_digest
    local operator_digest

    [[ "$0" == "$INSTALLED_OPERATOR" ]] \
        || die "Invoke the installed Fallback Server operator."
    [[ -d "$ARTIFACT_ROOT" && ! -L "$ARTIFACT_ROOT" ]] \
        || die "The protected Fallback Server artifact directory is missing or invalid."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$ARTIFACT_ROOT")" == "root:root:700" ]] \
        || die "The protected Fallback Server artifact directory has unsafe ownership or mode."
    [[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$COMPOSE_FILE")" == "root:root:640" ]] \
        || die "The protected Fallback Server Compose artifact is missing or unsafe."
    [[ -f "$ACTIVE_COMPOSE_FILE" && ! -L "$ACTIVE_COMPOSE_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$ACTIVE_COMPOSE_FILE")" == "root:root:640" ]] \
        || die "The protected temporary-active Compose artifact is missing or unsafe."
    [[ -f "$DB_IDENTITY_HELPER" && ! -L "$DB_IDENTITY_HELPER" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$DB_IDENTITY_HELPER")" == "root:root:750" ]] \
        || die "The protected Production DB identity helper is missing or unsafe."
    [[ -f "$BUNDLE_MANIFEST" && ! -L "$BUNDLE_MANIFEST" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$BUNDLE_MANIFEST")" == "root:root:640" ]] \
        || die "The Fallback Server bundle manifest is missing or unsafe."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")" == "root:root:750" ]] \
        || die "The installed Fallback Server operator is missing or unsafe."

    operator_digest="$(sha256_file "$INSTALLED_OPERATOR")"
    compose_digest="$(sha256_file "$COMPOSE_FILE")"
    active_compose_digest="$(sha256_file "$ACTIVE_COMPOSE_FILE")"
    identity_digest="$(sha256_file "$DB_IDENTITY_HELPER")"
    /usr/bin/grep -Fqx "operator.sh=$operator_digest" "$BUNDLE_MANIFEST" \
        || die "The installed Fallback Server operator does not match its manifest."
    /usr/bin/grep -Fqx "compose.yml=$compose_digest" "$BUNDLE_MANIFEST" \
        || die "The Fallback Server Compose artifact does not match its manifest."
    /usr/bin/grep -Fqx "compose.temporary-active.yml=$active_compose_digest" "$BUNDLE_MANIFEST" \
        || die "The temporary-active Compose artifact does not match its manifest."
    /usr/bin/grep -Fqx "production-db-identity.sh=$identity_digest" "$BUNDLE_MANIFEST" \
        || die "The Production DB identity helper does not match its manifest."
    if automatic_shutdown_disabled; then
        verify_shutdown_masks || die "Automatic shutdown must remain masked and inactive."
    else
        guard_service_digest="$(sha256_file /etc/systemd/system/babyjamjam-fallback-temporary-active-guard.service)"
        guard_timer_digest="$(sha256_file /etc/systemd/system/babyjamjam-fallback-temporary-active-guard.timer)"
        /usr/bin/grep -Fqx "systemd/babyjamjam-fallback-temporary-active-guard.service=$guard_service_digest" "$BUNDLE_MANIFEST" \
            || die "The temporary-active expiry guard service does not match its manifest."
        /usr/bin/grep -Fqx "systemd/babyjamjam-fallback-temporary-active-guard.timer=$guard_timer_digest" "$BUNDLE_MANIFEST" \
            || die "The temporary-active expiry guard timer does not match its manifest."
    fi
    [[ "$(/usr/bin/wc -l <"$BUNDLE_MANIFEST")" -eq 6 ]] \
        || die "The Fallback Server bundle manifest is incomplete."
}

validate_env_file() {
    local key

    [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] \
        || die "The Fallback Server environment file is missing or invalid."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$ENV_FILE")" == "root:root:600" ]] \
        || die "The Fallback Server environment file must be root:root mode 600."

    for key in "${REQUIRED_ENV_KEYS[@]}"; do
        /usr/bin/awk -F= -v wanted="$key" '
            $1 == wanted {
                value = substr($0, index($0, "=") + 1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
                if (value != "" && value != "\"\"" && value != "\047\047") found += 1
            }
            END { exit found == 1 ? 0 : 1 }
        ' "$ENV_FILE" || die "The Fallback Server environment file is missing a required value."
    done
}

validate_state_boundary() {
    local metadata

    [[ -d "$STATE_ROOT" && ! -L "$STATE_ROOT" ]] \
        || die "The Fallback Server state root is missing or unsafe."
    metadata="$(/usr/bin/stat -c '%U:%G:%a' "$STATE_ROOT" 2>/dev/null)" \
        || die "The Fallback Server state root metadata is unavailable."
    [[ "$metadata" == "root:root:700" ]] \
        || die "The Fallback Server state root must be root:root mode 700."

    if [[ ! -e "$STATE_DIRECTORY" && ! -L "$STATE_DIRECTORY" ]]; then
        /usr/bin/install -d -o root -g root -m 700 "$STATE_DIRECTORY"
    fi
    [[ -d "$STATE_DIRECTORY" && ! -L "$STATE_DIRECTORY" ]] \
        || die "The Fallback Server state directory is missing or unsafe."
    metadata="$(/usr/bin/stat -c '%U:%G:%a' "$STATE_DIRECTORY" 2>/dev/null)" \
        || die "The Fallback Server state directory metadata is unavailable."
    [[ "$metadata" == "root:root:700" ]] \
        || die "The Fallback Server state directory must be root:root mode 700."

    [[ ! -L "$LOCK_FILE" ]] \
        || die "The Fallback Server operator lock path is a symbolic link."
    if [[ ! -e "$LOCK_FILE" ]]; then
        /usr/bin/install -o root -g root -m 600 /dev/null "$LOCK_FILE"
    fi
    [[ -f "$LOCK_FILE" && ! -L "$LOCK_FILE" ]] \
        || die "The Fallback Server operator lock path is missing or unsafe."
    metadata="$(/usr/bin/stat -c '%U:%G:%a' "$LOCK_FILE" 2>/dev/null)" \
        || die "The Fallback Server operator lock metadata is unavailable."
    [[ "$metadata" == "root:root:600" ]] \
        || die "The Fallback Server operator lock must be root:root mode 600."
}

validate_production_db_identity() {
    local output

    output="$("$DB_IDENTITY_HELPER" "$ENV_FILE" "$APPROVED_DB_REF_HASH_FILE")" \
        || die "The Fallback Server Production DB identity check failed."
    [[ "$output" == "production_db_identity=ok" ]] \
        || die "The Fallback Server Production DB identity check failed."
}

validate_release() {
    local commit_sha="$1"
    local image_digest="$2"

    [[ "$commit_sha" =~ $SHA_PATTERN ]] || die "The release commit must be a 40-character lowercase SHA."
    [[ "$image_digest" =~ $DIGEST_PATTERN ]] || die "The image digest must be a SHA-256 digest."
}

runtime_env_for() {
    /usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null
}

discover_running_api_container() {
    local matches count
    matches="$(/usr/bin/docker ps -q --filter "label=com.docker.compose.project=$PROJECT_NAME" --filter 'label=com.docker.compose.service=api')" || return 1
    count="$(printf '%s\n' "$matches" | /usr/bin/awk 'NF {c++} END{print c+0}')"
    [[ "$count" == 0 ]] && return 0
    [[ "$count" == 1 ]] || return 1
    [[ "$matches" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    printf '%s\n' "$matches"
}

stop_discovered_api_container() {
    local container_id remaining
    container_id="$(discover_running_api_container)" || return 1
    [[ -z "$container_id" ]] && return 0
    /usr/bin/docker stop "$container_id" >/dev/null 2>&1 || return 1
    remaining="$(discover_running_api_container)" || return 1
    [[ -z "$remaining" ]]
}

refuse_active_or_unknown_runtime() {
    local mode tag container_id gates key
    mode="$(read_state runtime-mode || true)"
    [[ -z "$mode" || "$mode" == "passive" ]] || die "An active or unknown Fallback runtime must be stopped first."
    tag="$(read_state current-image-tag || true)"
    if [[ ! "$tag" =~ $SHA_PATTERN ]]; then
        container_id="$(discover_running_api_container)" || die "The running Fallback runtime cannot be safely identified."
        [[ -z "$container_id" ]] && return 0
    else
        container_id="$(container_id_for "$tag" || true)"
    fi
    [[ -z "$container_id" ]] && return 0
    gates="$(runtime_env_for "$container_id" || true)"
    [[ -n "$gates" ]] || die "The running Fallback runtime cannot be safely identified."
    [[ "$gates" != *$'SCHEDULERS_ENABLED=true'* ]] || die "The running Fallback runtime is active."
    for key in "${ACTIVE_TRUE_ENV_KEYS[@]}"; do
        [[ "$gates" != *"$key=true"* ]] || die "The running Fallback runtime is active."
    done
    for key in "${PASSIVE_ENV_KEYS[@]}"; do
        [[ "$gates" == *"$key=false"* ]] || die "The running Fallback runtime is unsafe."
    done
}

compose() {
    /usr/bin/env \
        BACKEND_ENV_FILE="$ENV_FILE" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$1" \
        DATABASE_CONNECTION_MODE="shared" \
        /usr/bin/docker compose --env-file "$COMPOSE_ENV_FILE" \
        --project-directory "$ARTIFACT_ROOT" -f "$COMPOSE_FILE" "${@:2}"
}

active_compose() {
    /usr/bin/env \
        ACTIVE_RESTART_POLICY="$(active_restart_policy)" \
        BACKEND_ENV_FILE="$ENV_FILE" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$1" \
        DATABASE_CONNECTION_MODE="shared" \
        /usr/bin/docker compose --env-file "$COMPOSE_ENV_FILE" \
        --project-directory "$ARTIFACT_ROOT" -f "$ACTIVE_COMPOSE_FILE" "${@:2}"
}

approval_value() {
    local key="$1"
    /usr/bin/awk -F= -v wanted="$key" '
        $1 == wanted { count += 1; value = substr($0, index($0, "=") + 1) }
        END { if (count == 1 && value != "") print value; else exit 1 }
    ' "$TEMPORARY_ACTIVE_APPROVAL_FILE"
}

validate_temporary_active_approval() {
    local schema incident_id condition_hash evidence_hash approval_tag approval_digest approval_db_hash approval_egress_hash issued nonce expiry now line_count

    [[ -f "$TEMPORARY_ACTIVE_APPROVAL_FILE" && ! -L "$TEMPORARY_ACTIVE_APPROVAL_FILE" ]] \
        || die "The temporary-active approval artifact is missing or unsafe."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$TEMPORARY_ACTIVE_APPROVAL_FILE")" == "root:root:400" ]] \
        || die "The temporary-active approval artifact must be root:root mode 400."
    line_count="$(/usr/bin/wc -l <"$TEMPORARY_ACTIVE_APPROVAL_FILE")"
    [[ "$line_count" == "10" ]] || die "The temporary-active approval artifact schema is invalid."
    schema="$(approval_value schema_version || true)"
    incident_id="$(approval_value incident_id || true)"
    condition_hash="$(approval_value primary_scheduler_condition_ref_sha256 || true)"
    approval_tag="$(approval_value image_tag || true)"
    approval_digest="$(approval_value image_digest || true)"
    approval_db_hash="$(approval_value production_db_ref_sha256 || true)"
    approval_egress_hash="$(approval_value aligo_egress_ipv4_sha256 || true)"
    issued="$(approval_value issued_at_unix || true)"
    nonce="$(approval_value approval_nonce || true)"
    expiry="$(approval_value expires_at_unix || true)"
    [[ "$schema" == "1" && "$incident_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$ ]] \
        || die "The temporary-active approval artifact schema is invalid."
    [[ "$approval_tag" =~ $SHA_PATTERN && "$approval_digest" =~ $DIGEST_PATTERN \
        && "$approval_db_hash" =~ ^[0-9a-f]{64}$ && "$approval_egress_hash" =~ ^[0-9a-f]{64}$ \
        && "$condition_hash" =~ ^[0-9a-f]{64}$ && "$issued" =~ ^[0-9]{10,}$ \
        && "$nonce" =~ ^[a-f0-9]{32,128}$ && "$expiry" =~ ^[0-9]{10,}$ ]] || die "The temporary-active approval artifact schema is invalid."
    now="$(/usr/bin/date +%s)"
    if [[ "${3:-}" == existing-policy ]] && automatic_shutdown_disabled; then
        (( issued <= now + 60 && issued <= expiry && expiry - issued <= 172800 )) \
            || die "The existing active approval timing is invalid."
    else
        (( issued <= now + 60 && issued <= expiry && expiry > now + 300 && expiry - issued <= 172800 )) \
            || die "The temporary-active approval timing is invalid."
        [[ ! -f "$APPROVAL_NONCES_FILE" ]] || ! /usr/bin/grep -Fqx "$nonce" "$APPROVAL_NONCES_FILE" \
            || die "The temporary-active approval nonce was already used."
    fi
    [[ "$approval_tag" == "$1" && "$approval_digest" == "$2" ]] \
        || die "The temporary-active approval does not match the requested immutable release."
    /usr/bin/grep -Fqx "$approval_db_hash" "$APPROVED_DB_REF_HASH_FILE" \
        || die "The temporary-active approval does not match the approved Production DB reference."
    [[ -f "$SCHEDULER_EVIDENCE_FILE" && ! -L "$SCHEDULER_EVIDENCE_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$SCHEDULER_EVIDENCE_FILE")" == "root:root:400" ]] \
        || die "The temporary-active scheduler evidence artifact is missing or unsafe."
    [[ "$(/usr/bin/wc -c <"$SCHEDULER_EVIDENCE_FILE")" -le 4096 ]] \
        || die "The temporary-active scheduler evidence artifact is oversized."
    evidence_hash="$(sha256_file "$SCHEDULER_EVIDENCE_FILE")"
    [[ "$condition_hash" == "$evidence_hash" ]] || die "The temporary-active approval does not match scheduler evidence."
    printf '%s %s %s %s\n' "$approval_egress_hash" "$nonce" "$incident_id" "$condition_hash"
}

claim_approval_nonce() {
    local nonce="$1" temporary
    [[ ! -f "$APPROVAL_NONCES_FILE" ]] || ! /usr/bin/grep -Fqx "$nonce" "$APPROVAL_NONCES_FILE" \
        || die "The temporary-active approval nonce was already used."
    temporary="$(/usr/bin/mktemp "$STATE_DIRECTORY/.used-temporary-active-nonces.XXXXXX")"
    [[ -f "$APPROVAL_NONCES_FILE" ]] && /usr/bin/cat "$APPROVAL_NONCES_FILE" >"$temporary"
    printf '%s\n' "$nonce" >>"$temporary"
    /usr/bin/chown root:root "$temporary" && /usr/bin/chmod 600 "$temporary" && /usr/bin/mv -f "$temporary" "$APPROVAL_NONCES_FILE"
}

validate_active_aligo_env() {
    local key
    for key in ALIGO_API_KEY ALIGO_USER_ID ALIGO_SENDER_PHONE; do
        /usr/bin/awk -F= -v wanted="$key" '
            $1 == wanted { count += 1; value=substr($0,index($0,"=")+1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); if ((value=="\"\"" || value=="\047\047" || value=="") ) invalid=1 }
            END{exit (count==1 && invalid!=1)?0:1}
        ' "$ENV_FILE" \
            || die "Temporary-active requires a nonempty Aligo credential."
    done
}

verify_image_identity() {
    local tag="$1" digest="$2" local_id immutable_id revision running_id="${3:-}"
    local_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_IMAGE_REPOSITORY:$tag")" || die "The local approved image is unavailable."
    immutable_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$IMAGE_REPOSITORY@$digest")" || die "The immutable approved image is unavailable."
    revision="$(/usr/bin/docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$LOCAL_IMAGE_REPOSITORY:$tag")" || die "The approved image revision is unavailable."
    [[ "$local_id" == "$immutable_id" && "$revision" == "$tag" ]] || die "The approved image identity does not match."
    if [[ -n "$running_id" ]]; then [[ "$running_id" == "$local_id" ]] || die "The running image identity does not match."; fi
}

egress_hash() {
    local endpoint="$1" value digest
    value="$(/usr/bin/curl --fail --silent --show-error --connect-timeout 3 --max-time 8 "$endpoint")" \
        || return 1
    [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
    digest="$(printf '%s' "$value" | /usr/bin/sha256sum | /usr/bin/awk '{print $1}')" || return 1
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$digest"
}

verify_approved_egress() {
    local expected_hash="$1" tag="$2" first_hash second_hash
    /usr/bin/docker network inspect "${PROJECT_NAME}_outbound" >/dev/null 2>&1 || die "The temporary-active outbound network is unavailable."
    first_hash="$(/usr/bin/docker run --rm --network "${PROJECT_NAME}_outbound" "$LOCAL_IMAGE_REPOSITORY:$tag" node -e 'fetch("https://api.ipify.org").then(r=>r.ok?r.text():Promise.reject()).then(x=>{x=x.trim();const p=x.split(".");if(!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(x)||p.some(n=>Number(n)>255))throw 0;process.stdout.write(require("crypto").createHash("sha256").update(x).digest("hex"))}).catch(()=>process.exit(1))' 2>/dev/null)" || die "The first container egress observation failed."
    second_hash="$(/usr/bin/docker run --rm --network "${PROJECT_NAME}_outbound" "$LOCAL_IMAGE_REPOSITORY:$tag" node -e 'fetch("https://ifconfig.me/ip").then(r=>r.ok?r.text():Promise.reject()).then(x=>{x=x.trim();const p=x.split(".");if(!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(x)||p.some(n=>Number(n)>255))throw 0;process.stdout.write(require("crypto").createHash("sha256").update(x).digest("hex"))}).catch(()=>process.exit(1))' 2>/dev/null)" || die "The second container egress observation failed."
    [[ "$first_hash" =~ ^[0-9a-f]{64}$ && "$second_hash" =~ ^[0-9a-f]{64}$ ]] || die "The container egress observation is invalid."
    [[ "$first_hash" == "$second_hash" && "$first_hash" == "$expected_hash" ]] \
        || die "The temporary-active egress observations do not match the approved hash."
}

clear_temporary_expiry_timer() {
    /usr/bin/systemctl stop "$TEMPORARY_STOP_UNIT.timer" >/dev/null 2>&1 || true
    /usr/bin/systemctl reset-failed "$TEMPORARY_STOP_UNIT.timer" >/dev/null 2>&1 || true
}

clear_temporary_active_state() {
    /usr/bin/rm -f "$RUNTIME_MODE_FILE" "$ACTIVE_EXPIRY_FILE" "$ACTIVE_LINKAGE_FILE"
    /usr/bin/systemctl disable "$TEMPORARY_GUARD_TIMER" >/dev/null 2>&1 || true
    /usr/bin/systemctl stop "$TEMPORARY_GUARD_TIMER" >/dev/null 2>&1 || true
}

cleanup_active_after_failure() {
    local tag="$1"
    active_compose "$tag" stop api >/dev/null 2>&1 || return 1
    if container_id_for "$tag" >/dev/null 2>&1; then return 1; fi
    clear_temporary_expiry_timer
    clear_temporary_active_state
    return 0
}

guard_expiry() {
    automatic_shutdown_disabled && return 0
    local expiry now tag mode container_id gates
    mode="$(read_state runtime-mode || true)"
    # `tag` was declared but never assigned, so `set -u` aborted the guard at its
    # first use; the guard could not stop an expired runtime.
    tag="$(read_state current-image-tag || true)"
    if [[ "$mode" != "temporary-active" ]]; then
        if [[ "$tag" =~ $SHA_PATTERN ]]; then
            container_id="$(container_id_for "$tag" || true)"
        else
            container_id="$(discover_running_api_container)" || return 1
        fi
        [[ -z "$container_id" ]] && return 0
        gates="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null || true)"
        if [[ "$gates" == *$'SCHEDULERS_ENABLED=true'* ]] || [[ -z "$gates" ]]; then
            if [[ "$tag" =~ $SHA_PATTERN ]]; then
                active_compose "$tag" stop api >/dev/null 2>&1 || return 1
                container_id_for "$tag" >/dev/null 2>&1 && return 1
            else
                stop_discovered_api_container || return 1
            fi
            clear_temporary_expiry_timer
            clear_temporary_active_state
        fi
        return 0
    fi
    expiry="$(read_state temporary-active-expiry || true)"
    [[ "$expiry" =~ ^[0-9]{10,}$ ]] || expiry=0
    now="$(/usr/bin/date +%s)"
    (( now < expiry )) && return 0
    if [[ "$tag" =~ $SHA_PATTERN ]]; then
        compose "$tag" stop api >/dev/null 2>&1 || return 1
        if container_id_for "$tag" >/dev/null 2>&1; then return 1; fi
    else
        stop_discovered_api_container || return 1
    fi
    # Do not stop this service from itself; disable prevents a future tick.
    clear_temporary_expiry_timer
    clear_temporary_active_state
}

try_schedule_temporary_expiry_stop() {
    local expiry="$1"
    if automatic_shutdown_disabled; then verify_shutdown_masks; return; fi
    clear_temporary_expiry_timer
    /usr/bin/systemd-run --unit="$TEMPORARY_STOP_UNIT" --on-calendar="@$expiry" \
        --timer-property=Persistent=true --service-type=oneshot "$INSTALLED_OPERATOR" stop >/dev/null \
        || return 1
    /usr/bin/systemctl is-active --quiet "$TEMPORARY_STOP_UNIT.timer" \
        || { clear_temporary_expiry_timer; return 1; }
}

schedule_temporary_expiry_stop() {
    try_schedule_temporary_expiry_stop "$1" \
        || die "The temporary-active expiry stop could not be scheduled."
}

read_state() {
    local name="$1"
    local path="$STATE_DIRECTORY/$name"
    local value

    [[ -f "$path" && ! -L "$path" ]] || return 1
    value="$(<"$path")"
    [[ -n "$value" ]] || return 1
    printf '%s\n' "$value"
}

write_state() {
    local name="$1"
    local value="$2"
    local temporary

    temporary="$(/usr/bin/mktemp "$STATE_DIRECTORY/.${name}.XXXXXX")"
    printf '%s\n' "$value" >"$temporary"
    /usr/bin/chown root:root "$temporary"
    /usr/bin/chmod 600 "$temporary"
    /usr/bin/mv -f "$temporary" "$STATE_DIRECTORY/$name"
}

current_unix_time() {
    /usr/bin/date +%s
}

release_image_ids() {
    {
        /usr/bin/docker images --no-trunc --format '{{.ID}}' "$LOCAL_IMAGE_REPOSITORY"
        /usr/bin/docker images --no-trunc --format '{{.ID}}' "$IMAGE_REPOSITORY"
    } | /usr/bin/sort -u
}

image_id_for_reference() {
    /usr/bin/docker image inspect --format '{{.Id}}' "$1" 2>/dev/null
}

container_image_ids() {
    local container_ids
    container_ids="$(/usr/bin/docker ps -aq)" || return 1
    [[ -n "$container_ids" ]] || return 0
    # shellcheck disable=SC2086
    /usr/bin/docker inspect --format '{{.Image}}' $container_ids
}

remove_image_id() {
    /usr/bin/docker rmi -f "$1" >/dev/null
}

# Every release leaves a ~3.5 GB image behind; with nothing removing them the
# 50 GB host filled up and a pull failed with "no space left on device"
# (2026-09-30). Before each pull, keep only what a rollback or a container can
# still need: the current and previous recorded releases, the image about to be
# deployed, and anything a container (running or stopped) uses. Best effort: a
# failure here must never block the deployment it makes room for.
prune_stale_release_images() {
    local target_digest="$1"
    local keep="" name value id in_use candidates

    for name in current-image-tag previous-image-tag; do
        value="$(read_state "$name" || true)"
        [[ -n "$value" ]] || continue
        id="$(image_id_for_reference "$LOCAL_IMAGE_REPOSITORY:$value" || true)"
        [[ -n "$id" ]] && keep+=" $id"
    done
    for value in "$target_digest" "$(read_state current-image-digest || true)" \
        "$(read_state previous-image-digest || true)"; do
        [[ -n "$value" ]] || continue
        id="$(image_id_for_reference "$IMAGE_REPOSITORY@$value" || true)"
        [[ -n "$id" ]] && keep+=" $id"
    done
    # Without the container list we cannot tell what is in use: skip pruning.
    in_use="$(container_image_ids)" || return 0
    keep+=" $(printf '%s ' $in_use)"
    candidates="$(release_image_ids)" || return 0

    for id in $candidates; do
        [[ " $keep " == *" $id "* ]] && continue
        remove_image_id "$id" || true
    done
    return 0
}

pull_release_image() {
    local commit_sha="$1"
    local image_digest="$2"
    local immutable_reference="$IMAGE_REPOSITORY@$image_digest"
    local image_revision

    prune_stale_release_images "$image_digest" || true
    /usr/bin/docker pull "$immutable_reference" >/dev/null
    image_revision="$(/usr/bin/docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$immutable_reference")"
    [[ "$image_revision" == "$commit_sha" ]] \
        || die "The pulled image revision does not match the requested commit."
    /usr/bin/docker tag "$immutable_reference" "$LOCAL_IMAGE_REPOSITORY:$commit_sha"
}

container_id_for() {
    local commit_sha="$1"
    local container_id

    container_id="$(compose "$commit_sha" ps -q api)"
    [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    printf '%s\n' "$container_id"
}

wait_until_ready() {
    local commit_sha="$1"
    local container_id
    local health

    for _attempt in $(/usr/bin/seq 1 60); do
        container_id="$(container_id_for "$commit_sha" || true)"
        if [[ -n "$container_id" ]]; then
            health="$(/usr/bin/docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")"
            if [[ "$health" == "healthy" ]] \
                && /usr/bin/curl --fail --silent --show-error \
                    --connect-timeout 2 --max-time 5 "$LOOPBACK_READY_URL" >/dev/null; then
                return 0
            fi
        fi
        /usr/bin/sleep 2
    done
    return 1
}

# Thin wrapper so tests can stub the curl call without overriding the
# absolute-path binary invocation itself.
lease_curl() {
    /usr/bin/curl "$@"
}

# Display-only lease observation for `status`. The endpoint arrived with ADR-010,
# so a release that predates it (or a momentary loopback failure) must degrade to
# "unknown" rather than fail status: the CI deployer runs `status` against the OLD
# release before replacing it.
lease_status_fields() {
    local body mode held
    if body="$(lease_curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "$LOOPBACK_LEASE_URL" 2>/dev/null)"; then
        body="$(printf '%s' "$body" | /usr/bin/tr -d '\r\n')"
        mode="$(printf '%s' "$body" | /usr/bin/sed -nE 's/.*"mode":"([a-z]*)".*/\1/p')"
        held="$(printf '%s' "$body" | /usr/bin/sed -nE 's/.*"held":(true|false).*/\1/p')"
    fi
    printf 'lease_mode=%s\n' "${mode:-unknown}"
    printf 'lease_held=%s\n' "${held:-unknown}"
}

verify_passive_runtime() {
    local commit_sha="$1"
    local container_id
    local key
    local value

    container_id="$(container_id_for "$commit_sha")" \
        || die "The Fallback Server API container is not running."
    for key in "${PASSIVE_ENV_KEYS[@]}"; do
        value="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
            | /usr/bin/awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = tolower($2) } END { if (count == 1) print value; else exit 1 }')" \
            || die "A passive Fallback runtime gate is missing or duplicated."
        [[ "$value" == "false" ]] || die "A passive Fallback runtime gate is not disabled."
    done
}

verify_temporary_active_runtime() {
    local commit_sha="$1"
    local container_id key value

    container_id="$(container_id_for "$commit_sha")" \
        || die "The temporary-active Fallback Server API container is not running."
    for key in "${ACTIVE_TRUE_ENV_KEYS[@]}"; do
        value="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
            | /usr/bin/awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = tolower($2) } END { if (count == 1) print value; else exit 1 }')" \
            || die "A temporary-active runtime gate is missing or duplicated."
        [[ "$value" == "true" ]] || die "A temporary-active runtime gate is not enabled."
    done
    for key in EFORMSIGN_RECONCILE_ALLOW_UNLOCKED MESSAGE_TRIGGER_JOBS_WORKER_ENABLED; do
        value="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
            | /usr/bin/awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = tolower($2) } END { if (count == 1) print value; else exit 1 }')" \
            || die "A temporary-active disabled runtime gate is missing or duplicated."
        [[ "$value" == "false" ]] || die "A temporary-active disabled runtime gate is not disabled."
    done
}

verify_temporary_guard() {
    if automatic_shutdown_disabled; then verify_shutdown_masks; return; fi
    /usr/bin/systemctl is-enabled --quiet "$TEMPORARY_GUARD_TIMER" \
        && /usr/bin/systemctl is-active --quiet "$TEMPORARY_GUARD_TIMER"
}

running_image_id_for() {
    /usr/bin/docker inspect --format '{{.Image}}' "$1"
}

verify_active_container_health() {
    local container_id="$1" health restart_count

    health="$(/usr/bin/docker inspect --format '{{.State.Health.Status}}' "$container_id")" \
        || return 1
    restart_count="$(/usr/bin/docker inspect --format '{{.RestartCount}}' "$container_id")" \
        || return 1
    [[ "$health" == "healthy" && "$restart_count" == "0" ]] \
        && /usr/bin/curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
            "$LOOPBACK_READY_URL" >/dev/null
}

restore_temporary_extension() {
    local expiry="$1" linkage="$2"

    try_schedule_temporary_expiry_stop "$expiry" \
        && write_state temporary-active-expiry "$expiry" \
        && write_state temporary-active-linkage "$linkage"
}

# Reconcile an already running host after an explicitly requested no-shutdown
# recovery. Reuse the protected release/evidence; never invent approval inputs.
adopt_persistent_active_release() {
    local tag digest container approval_data egress nonce incident evidence lease
    refuse_if_valkey_restore_fenced
    automatic_shutdown_disabled || die "Persistent operation requires the protected shutdown policy."
    verify_shutdown_masks || die "All automatic shutdown units must remain masked and inactive."
    validate_env_file
    validate_production_db_identity
    tag="$(read_state current-image-tag)"
    digest="$(read_state current-image-digest)"
    validate_release "$tag" "$digest"
    container="$(container_id_for "$tag")"
    [[ -n "$(discover_running_api_container)" ]] || die "The active API is not unique."
    verify_active_container_health "$container" || die "The active API is not healthy."
    verify_temporary_active_runtime "$tag"
    verify_image_identity "$tag" "$digest" "$(running_image_id_for "$container")"
    lease="$(lease_status_fields)"
    /usr/bin/grep -Fqx 'lease_mode=required' <<<"$lease" \
        && /usr/bin/grep -Fqx 'lease_held=true' <<<"$lease" || die "The active host does not hold the scheduler lease."
    approval_data="$(validate_temporary_active_approval "$tag" "$digest" existing-policy)"
    read -r egress nonce incident evidence <<<"$approval_data"
    verify_approved_egress "$egress" "$tag"
    write_state temporary-active-expiry "$(approval_value expires_at_unix)"
    write_state temporary-active-linkage "$incident $evidence $nonce"
    write_state runtime-mode temporary-active
    status_release
}

extend_temporary_active_release() {
    local commit_sha="$1" image_digest="$2" approval_data approval_egress_hash approval_nonce incident_id evidence_hash
    local old_expiry old_linkage new_expiry new_linkage current_tag current_digest container_before container_after now
    refuse_if_valkey_restore_fenced

    validate_release "$commit_sha" "$image_digest"
    [[ "$(read_state runtime-mode || true)" == "temporary-active" ]] \
        || die "A temporary-active runtime is required for extension."
    validate_env_file
    validate_production_db_identity
    approval_data="$(validate_temporary_active_approval "$commit_sha" "$image_digest")"
    read -r approval_egress_hash approval_nonce incident_id evidence_hash <<<"$approval_data"
    validate_active_aligo_env
    current_tag="$(read_state current-image-tag)" || die "No active Fallback Server release is recorded."
    current_digest="$(read_state current-image-digest)" || die "No active Fallback Server image digest is recorded."
    [[ "$current_tag" == "$commit_sha" && "$current_digest" == "$image_digest" ]] \
        || die "The extension release must match the running active release."
    old_expiry="$(read_state temporary-active-expiry)" || die "The current temporary-active expiry is missing."
    old_linkage="$(read_state temporary-active-linkage)" || die "The current temporary-active linkage is missing."
    new_expiry="$(approval_value expires_at_unix)"
    now="$(current_unix_time)"
    [[ "$old_expiry" =~ ^[0-9]{10,}$ && "$new_expiry" =~ ^[0-9]{10,}$ \
        && "$now" -lt "$old_expiry" && "$old_expiry" -lt "$new_expiry" ]] \
        || die "The temporary-active extension must move a live expiry forward."
    container_before="$(container_id_for "$commit_sha")" \
        || die "The temporary-active Fallback Server API container is not running."
    verify_active_container_health "$container_before" \
        || die "The temporary-active Fallback Server API container is not healthy and stable."
    verify_temporary_active_runtime "$commit_sha"
    verify_image_identity "$commit_sha" "$image_digest" "$(running_image_id_for "$container_before")"
    verify_approved_egress "$approval_egress_hash" "$commit_sha"
    claim_approval_nonce "$approval_nonce"
    if ! try_schedule_temporary_expiry_stop "$new_expiry"; then
        restore_temporary_extension "$old_expiry" "$old_linkage" \
            || die "The extension failed and the previous expiry could not be restored."
        die "The temporary-active extension timer could not be scheduled."
    fi
    new_linkage="$incident_id $evidence_hash $approval_nonce"
    if ! write_state temporary-active-expiry "$new_expiry" \
        || ! write_state temporary-active-linkage "$new_linkage"; then
        restore_temporary_extension "$old_expiry" "$old_linkage" \
            || die "The extension failed and the previous state could not be restored."
        die "The temporary-active extension state could not be recorded."
    fi
    container_after="$(container_id_for "$commit_sha" || true)"
    if [[ "$container_after" != "$container_before" ]] \
        || ! verify_temporary_guard \
        || ! verify_active_container_health "$container_after" \
        || ! ( verify_temporary_active_runtime "$commit_sha" \
            && verify_image_identity "$commit_sha" "$image_digest" "$(running_image_id_for "$container_after")" ); then
        restore_temporary_extension "$old_expiry" "$old_linkage" \
            || die "The extension verification failed and the previous state could not be restored."
        die "The temporary-active extension verification failed."
    fi
    (( $(current_unix_time) < new_expiry )) \
        || { restore_temporary_extension "$old_expiry" "$old_linkage" || true; die "The temporary-active extension expired during verification."; }
    printf '%s\n' \
        "environment=fallback-server" \
        "temporary_active_extended=true" \
        "container_restarted=false" \
        "expiry_stop_scheduled=$(automatic_shutdown_disabled && printf false || printf true)" \
        "public_routing=not_managed"
}

restore_replaced_active_release() {
    local old_tag="$1" old_digest="$2" old_expiry="$3" old_linkage="$4" container_id

    active_compose "$old_tag" up -d --no-build --no-deps --force-recreate api \
        || return 1
    wait_until_ready "$old_tag" || return 1
    container_id="$(container_id_for "$old_tag")" || return 1
    verify_active_container_health "$container_id" || return 1
    ( verify_temporary_active_runtime "$old_tag" \
        && verify_image_identity "$old_tag" "$old_digest" "$(running_image_id_for "$container_id")" ) \
        || return 1
    try_schedule_temporary_expiry_stop "$old_expiry" || return 1
    write_state runtime-mode temporary-active \
        && write_state temporary-active-expiry "$old_expiry" \
        && write_state temporary-active-linkage "$old_linkage" \
        && write_state current-image-tag "$old_tag" \
        && write_state current-image-digest "$old_digest" \
        && verify_temporary_guard
}

replace_temporary_active_release() {
    local commit_sha="$1" image_digest="$2" approval_data approval_egress_hash approval_nonce incident_id evidence_hash
    local old_tag old_digest old_expiry old_linkage new_expiry new_linkage old_container new_container now
    refuse_if_valkey_restore_fenced

    validate_release "$commit_sha" "$image_digest"
    [[ "$(read_state runtime-mode || true)" == "temporary-active" ]] \
        || die "A temporary-active runtime is required for replacement."
    validate_env_file
    validate_production_db_identity
    approval_data="$(validate_temporary_active_approval "$commit_sha" "$image_digest")"
    read -r approval_egress_hash approval_nonce incident_id evidence_hash <<<"$approval_data"
    validate_active_aligo_env
    old_tag="$(read_state current-image-tag)" || die "No active Fallback Server release is recorded."
    old_digest="$(read_state current-image-digest)" || die "No active Fallback Server image digest is recorded."
    old_expiry="$(read_state temporary-active-expiry)" || die "The current temporary-active expiry is missing."
    old_linkage="$(read_state temporary-active-linkage)" || die "The current temporary-active linkage is missing."
    new_expiry="$(approval_value expires_at_unix)"
    now="$(current_unix_time)"
    [[ "$old_tag" =~ $SHA_PATTERN && "$old_digest" =~ $DIGEST_PATTERN \
        && "$old_expiry" =~ ^[0-9]{10,}$ && "$new_expiry" =~ ^[0-9]{10,}$ ]] \
        && { automatic_shutdown_disabled || [[ "$now" -lt "$old_expiry" && "$old_expiry" -lt "$new_expiry" ]]; } \
        || die "The replacement approval must extend a live temporary-active window."
    [[ "$old_tag" != "$commit_sha" || "$old_digest" != "$image_digest" ]] \
        || die "The replacement release already matches the active runtime."
    old_container="$(container_id_for "$old_tag")" \
        || die "The temporary-active Fallback Server API container is not running."
    verify_active_container_health "$old_container" \
        || die "The temporary-active Fallback Server API container is not healthy and stable."
    verify_temporary_active_runtime "$old_tag"
    verify_image_identity "$old_tag" "$old_digest" "$(running_image_id_for "$old_container")"

    # Mirror Lightsail deployment ordering: pull and verify the immutable image
    # while the current API is still healthy, then keep only the final Compose
    # recreate and readiness wait inside the user-visible interruption window.
    pull_release_image "$commit_sha" "$image_digest" \
        || die "The replacement image could not be preloaded; the active runtime was left unchanged."
    verify_image_identity "$commit_sha" "$image_digest"
    verify_approved_egress "$approval_egress_hash" "$commit_sha"
    claim_approval_nonce "$approval_nonce"
    if ! try_schedule_temporary_expiry_stop "$new_expiry"; then
        restore_temporary_extension "$old_expiry" "$old_linkage" \
            || die "The replacement failed and the previous expiry could not be restored."
        die "The temporary-active replacement timer could not be scheduled."
    fi
    new_linkage="$incident_id $evidence_hash $approval_nonce"

    if ! active_compose "$commit_sha" up -d --no-build --no-deps --force-recreate api \
        || ! wait_until_ready "$commit_sha" \
        || ! new_container="$(container_id_for "$commit_sha")" \
        || ! verify_active_container_health "$new_container" \
        || ! ( verify_temporary_active_runtime "$commit_sha" \
            && verify_image_identity "$commit_sha" "$image_digest" "$(running_image_id_for "$new_container")" \
            && verify_temporary_guard ); then
        restore_replaced_active_release "$old_tag" "$old_digest" "$old_expiry" "$old_linkage" \
            || die "The active replacement failed and automatic rollback also failed."
        die "The active replacement failed and the previous release was restored."
    fi

    if ! write_state previous-image-tag "$old_tag" \
        || ! write_state previous-image-digest "$old_digest" \
        || ! write_state current-image-tag "$commit_sha" \
        || ! write_state current-image-digest "$image_digest" \
        || ! write_state runtime-mode temporary-active \
        || ! write_state temporary-active-expiry "$new_expiry" \
        || ! write_state temporary-active-linkage "$new_linkage"; then
        restore_replaced_active_release "$old_tag" "$old_digest" "$old_expiry" "$old_linkage" \
            || die "The replacement state write failed and automatic rollback also failed."
        die "The replacement state write failed and the previous release was restored."
    fi
    (( $(current_unix_time) < new_expiry )) \
        || { restore_replaced_active_release "$old_tag" "$old_digest" "$old_expiry" "$old_linkage" || true; die "The replacement approval expired during verification."; }
    printf '%s\n' \
        "environment=fallback-server" \
        "temporary_active_replaced=true" \
        "image_preloaded=true" \
        "container_restarted=true" \
        "expiry_stop_scheduled=$(automatic_shutdown_disabled && printf false || printf true)" \
        "public_routing=not_managed"
}

temporary_activate_release() {
    local commit_sha="$1" image_digest="$2" approval_data approval_egress_hash approval_nonce incident_id evidence_hash expiry current_tag current_digest container_id
    refuse_if_valkey_restore_fenced

    validate_release "$commit_sha" "$image_digest"
    refuse_active_or_unknown_runtime
    if [[ "$(read_state runtime-mode || true)" == "temporary-active" ]]; then
        die "An existing temporary-active runtime must be stopped before replacement."
    fi
    validate_env_file
    validate_production_db_identity
    approval_data="$(validate_temporary_active_approval "$commit_sha" "$image_digest")"
    read -r approval_egress_hash approval_nonce incident_id evidence_hash <<<"$approval_data"
    validate_active_aligo_env
    current_tag="$(read_state current-image-tag)" || die "No passive Fallback Server release is recorded."
    current_digest="$(read_state current-image-digest)" || die "No passive Fallback Server image digest is recorded."
    [[ "$current_tag" == "$commit_sha" && "$current_digest" == "$image_digest" ]] \
        || die "The temporary-active release must match the recorded passive release."
    verify_image_identity "$commit_sha" "$image_digest"
    verify_approved_egress "$approval_egress_hash" "$commit_sha"
    claim_approval_nonce "$approval_nonce"
    expiry="$(approval_value expires_at_unix)"
    schedule_temporary_expiry_stop "$expiry"
    write_state runtime-mode temporary-active
    write_state temporary-active-expiry "$expiry"
    write_state temporary-active-linkage "$incident_id $evidence_hash $approval_nonce"
    /usr/bin/systemctl enable --now "$TEMPORARY_GUARD_TIMER" >/dev/null \
        || { clear_temporary_expiry_timer; clear_temporary_active_state; die "The temporary-active reboot-safe expiry guard could not be enabled."; }
    if ! active_compose "$commit_sha" up -d --no-build; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active Fallback Server startup failed."
    fi
    if ! wait_until_ready "$commit_sha" || ! verify_temporary_active_runtime "$commit_sha"; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active Fallback Server runtime verification failed."
    fi
    if ! container_id="$(container_id_for "$commit_sha")"; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active API container is unavailable."
    fi
    if ! verify_image_identity "$commit_sha" "$image_digest" "$(/usr/bin/docker inspect --format '{{.Image}}' "$container_id")"; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active running image identity is invalid."
    fi
    (( $(/usr/bin/date +%s) < expiry )) || { cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."; die "The temporary-active approval expired during startup."; }
    printf '%s\n' \
        "environment=fallback-server" \
        "temporary_active=true" \
        "expiry_stop_scheduled=$(automatic_shutdown_disabled && printf false || printf true)" \
        "public_routing=not_managed"
}

activate_release() {
    local commit_sha="$1"

    validate_production_db_identity
    compose "$commit_sha" up -d --no-build
    wait_until_ready "$commit_sha" || return 1
    verify_passive_runtime "$commit_sha"
}

deploy_release() {
    local commit_sha="$1"
    local image_digest="$2"
    local current_digest=""
    local current_tag=""
    refuse_if_valkey_restore_fenced

    validate_release "$commit_sha" "$image_digest"
    refuse_active_or_unknown_runtime
    [[ "$(read_state runtime-mode || true)" != "temporary-active" ]] \
        || die "Stop the temporary-active runtime before passive deployment."
    validate_env_file
    validate_production_db_identity
    current_tag="$(read_state current-image-tag || true)"
    current_digest="$(read_state current-image-digest || true)"
    if [[ -n "$current_tag" || -n "$current_digest" ]]; then
        [[ "$current_tag" =~ $SHA_PATTERN && "$current_digest" =~ $DIGEST_PATTERN ]] \
            || die "The recorded Fallback Server rollback state is incomplete."
        /usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$current_tag" >/dev/null 2>&1 \
            || die "The recorded Fallback Server rollback image is unavailable."
    fi
    pull_release_image "$commit_sha" "$image_digest"

    if ! activate_release "$commit_sha"; then
        if [[ "$current_tag" =~ $SHA_PATTERN && "$current_digest" =~ $DIGEST_PATTERN \
            && -n "$(/usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$current_tag" --format '{{.Id}}' 2>/dev/null || true)" ]]; then
            activate_release "$current_tag" \
                || die "The Fallback Server deployment failed and automatic rollback also failed."
        else
            compose "$commit_sha" stop api >/dev/null 2>&1 || true
        fi
        die "The Fallback Server deployment failed readiness or passive-runtime verification."
    fi

    if [[ "$current_tag" =~ $SHA_PATTERN && "$current_digest" =~ $DIGEST_PATTERN ]]; then
        write_state previous-image-tag "$current_tag"
        write_state previous-image-digest "$current_digest"
    fi
    write_state current-image-tag "$commit_sha"
    write_state current-image-digest "$image_digest"
    status_release
}

status_release() {
    local commit_sha
    local container_health
    local container_id
    local immutable_image_id
    local image_digest
    local image_revision
    local local_image_id
    local restart_count
    local running_image_id
    local runtime_mode expiry now
    local lease_fields

    validate_env_file
    validate_production_db_identity
    commit_sha="$(read_state current-image-tag)" || die "No healthy Fallback Server release is recorded."
    image_digest="$(read_state current-image-digest)" || die "No Fallback Server image digest is recorded."
    validate_release "$commit_sha" "$image_digest"
    container_id="$(container_id_for "$commit_sha")" || die "The Fallback Server API container is not running."
    local_image_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_IMAGE_REPOSITORY:$commit_sha")" \
        || die "The recorded Fallback Server image is missing."
    immutable_image_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$IMAGE_REPOSITORY@$image_digest")" \
        || die "The recorded immutable Fallback Server image is missing."
    [[ "$local_image_id" == "$immutable_image_id" ]] \
        || die "The recorded Fallback Server tag does not match its immutable digest."
    running_image_id="$(/usr/bin/docker inspect --format '{{.Image}}' "$container_id")"
    [[ "$running_image_id" == "$local_image_id" ]] \
        || die "The running Fallback Server container does not match the recorded release."
    image_revision="$(/usr/bin/docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$LOCAL_IMAGE_REPOSITORY:$commit_sha")"
    [[ "$image_revision" == "$commit_sha" ]] \
        || die "The recorded Fallback Server image revision is invalid."
    container_health="$(/usr/bin/docker inspect --format '{{.State.Health.Status}}' "$container_id")"
    restart_count="$(/usr/bin/docker inspect --format '{{.RestartCount}}' "$container_id")"
    [[ "$container_health" == "healthy" ]] || die "The Fallback Server API container is not healthy."
    [[ "$restart_count" == "0" ]] || die "The Fallback Server API container has restarted."
    /usr/bin/curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
        "$LOOPBACK_READY_URL" >/dev/null || die "The Fallback Server readiness endpoint failed."
    runtime_mode="$(read_state runtime-mode || true)"
    if [[ -z "$runtime_mode" ]]; then
        [[ ! -e "$ACTIVE_EXPIRY_FILE" ]] || die "Fallback runtime state is inconsistent."
        runtime_mode="passive"
    fi
    if [[ "$runtime_mode" == "temporary-active" ]]; then
        expiry="$(read_state temporary-active-expiry)" || die "Temporary-active expiry state is missing."
        [[ "$(read_state temporary-active-linkage || true)" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}[[:space:]][0-9a-f]{64}[[:space:]][a-f0-9]{32,128}$ ]] \
            || die "Temporary-active approval linkage is missing or invalid."
        now="$(/usr/bin/date +%s)"
        [[ "$expiry" =~ ^[0-9]{10,}$ ]] && { automatic_shutdown_disabled || [[ "$now" -lt "$expiry" ]]; } || die "Temporary-active approval is expired."
        verify_temporary_guard || die "Temporary-active guard is not enabled and active."
        verify_temporary_active_runtime "$commit_sha"
    elif [[ "$runtime_mode" == "passive" ]]; then
        [[ ! -e "$ACTIVE_EXPIRY_FILE" ]] || die "Fallback runtime state is inconsistent."
        verify_passive_runtime "$commit_sha"
    else
        die "Fallback runtime mode is invalid."
    fi

    lease_fields="$(lease_status_fields)"

    printf '%s\n' \
        "environment=fallback-server" \
        "current_tag=$commit_sha" \
        "current_digest=$image_digest" \
        "container_health=$container_health" \
        "restart_count=$restart_count" \
        "db_readiness=ok" \
        "production_db_identity=ok" \
        "public_routing=not_managed" \
        "runtime_mode=$runtime_mode" \
        "automatic_shutdown=$(automatic_shutdown_disabled && printf disabled || printf enabled)" \
        "schedulers_enabled=$([[ "$runtime_mode" == temporary-active ]] && printf true || printf false)" \
        "document_jobs_accepting=$([[ "$runtime_mode" == temporary-active ]] && printf true || printf false)" \
        "document_jobs_worker=$([[ "$runtime_mode" == temporary-active ]] && printf true || printf false)" \
        "$lease_fields"
}

rollback_release() {
    local current_digest
    local current_tag
    local previous_digest
    local previous_tag
    refuse_if_valkey_restore_fenced

    refuse_active_or_unknown_runtime
    current_tag="$(read_state current-image-tag)" || die "No current Fallback Server release is recorded."
    current_digest="$(read_state current-image-digest)" || die "No current Fallback Server digest is recorded."
    previous_tag="$(read_state previous-image-tag)" || die "No previous Fallback Server release is recorded."
    previous_digest="$(read_state previous-image-digest)" || die "No previous Fallback Server digest is recorded."
    validate_release "$previous_tag" "$previous_digest"
    /usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$previous_tag" >/dev/null 2>&1 \
        || die "The previous Fallback Server image is not present locally."
    activate_release "$previous_tag" || die "The Fallback Server rollback failed."
    write_state current-image-tag "$previous_tag"
    write_state current-image-digest "$previous_digest"
    write_state previous-image-tag "$current_tag"
    write_state previous-image-digest "$current_digest"
    status_release
}

stop_release() {
    local current_tag

    current_tag="$(read_state current-image-tag)" || die "No current Fallback Server release is recorded."
    compose "$current_tag" stop api >/dev/null
    if container_id_for "$current_tag" >/dev/null 2>&1; then
        die "The Fallback Server API container did not stop."
    fi
    clear_temporary_expiry_timer
    clear_temporary_active_state
    printf '%s\n' \
        "environment=fallback-server" \
        "runtime=stopped" \
        "public_routing=not_managed"
}

# --- Fenced Valkey restore ---------------------------------------------------
# The backend shares realtime change hints through a Valkey Stream and proves
# stream continuity against the running Valkey process identity (run_id,
# master_replid). Every Valkey restart changes that identity, so a restore that
# goes through a freshly started process is always detected by clients. A live
# in-place restore (RESTORE ... REPLACE, key copies into a running server,
# swapping the volume under a running container) keeps the identity and would
# make clients believe they missed nothing. This command is therefore the only
# supported restore path (amendment A5):
#   preflight -> fence -> restore into a fresh process -> verify -> (separately) reopen
# Every stage is idempotent and a failure leaves the backend stopped and the
# fence marker in place. Nothing here mutates DNS, schemas or scheduler state.

vr_docker() { "$VR_DOCKER_BIN" "$@"; }
vr_sleep() { /usr/bin/sleep "$1"; }
vr_note() { printf 'valkey-restore: %s\n' "$*" >&2; }
vr_cli() {
    local container="$1"
    shift
    vr_docker exec "$container" valkey-cli --raw "$@"
}

VR_ACTIVE=0
VR_CLEANUP_CONTAINERS=()
VR_CLEANUP_VOLUMES=()
VR_BACKUP_PATH=""
VR_BACKUP_FORM=""
VR_BACKUP_DIGEST=""
VR_SNAPSHOT_DIR=""
VR_PENDING_SNAPSHOT=""
VR_MODE=restore
VR_IMAGE=""
VR_VALKEY_CID=""
VR_OBSERVED_RUN_ID=""
VR_EXPECTED_FP=""
VR_NEW_RUN_ID=""
VR_NEW_REPLID=""
VR_REOPEN_MODE=""
VR_REOPEN_REASON=""
VR_STAMP=""

# Runs inside the container (busybox sh). Prints key=value lines describing what
# the dataset is: persistent (TTL-less) key count, DBSIZE, the realtime stream's
# last-generated-id (or none), and a hash over a sorted sample of persistent key
# names and types. Volatile keys (rate limits, locks) are left out of the exact
# comparison because they legitimately expire between preflight and verify.
readonly VALKEY_FINGERPRINT_SCRIPT='
set -eu
stream=$1; limit=$2
cli() { valkey-cli --raw "$@" | tr -d "\r"; }
ks=$(cli INFO keyspace)
line=$(printf "%s\n" "$ks" | grep "^db0:" || true)
keys=0; exp=0
if [ -n "$line" ]; then
  keys=${line#*keys=}; keys=${keys%%,*}
  exp=${line#*expires=}; exp=${exp%%,*}
fi
other=$(printf "%s\n" "$ks" | grep -c "^db[1-9]" || true)
echo "persistent_keys=$((keys-exp))"
echo "dbsize=$(cli DBSIZE)"
echo "other_dbs=$other"
sid=none
if [ "$(cli EXISTS "$stream")" = 1 ]; then
  sid=$(cli XINFO STREAM "$stream" | grep -A1 "^last-generated-id\$" | tail -n 1)
fi
echo "stream_last_id=${sid:-none}"
sample=$(cli --scan | sort | while IFS= read -r k; do
  [ "$(cli TTL "$k")" = -1 ] || continue
  printf "%s\t%s\n" "$k" "$(cli TYPE "$k")"
done | head -n "$limit")
echo "sample_count=$(printf "%s" "$sample" | grep -c . || true)"
echo "sample_sha256=$(printf "%s" "$sample" | sha256sum | cut -d" " -f1)"
'

# Staging scripts. The volume is emptied first, so a stale appendonlydir can never
# shadow a staged RDB (Valkey 8 with appendonly yes loads only appendonlydir and
# ignores dump.rdb). Ownership is the image's own valkey user: files written by
# root are 0600 root, which the server (uid 999) cannot read.
readonly VALKEY_STAGE_RDB_SCRIPT='
set -eu
find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp /backup/dump.rdb /data/dump.rdb
chown valkey:valkey /data /data/dump.rdb
chmod 640 /data/dump.rdb
'
readonly VALKEY_STAGE_AOF_SCRIPT='
set -eu
find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R /backup/appendonlydir /data/appendonlydir
chown -R valkey:valkey /data
chmod -R u+rwX,g+rX,o-rwx /data/appendonlydir
'
# Runs in a throwaway container with the data volume mounted read-only: prints
# the digest of exactly what was staged, with the same algorithm as
# vr_snapshot_digest (a file hash for an RDB, a hash over the sorted per-file
# hashes for the AOF directory). Anything else in the volume is an error.
readonly VALKEY_STAGED_DIGEST_SCRIPT='
set -eu
cd /data
if [ "$1" = rdb ]; then
  [ "$(ls -A)" = dump.rdb ] || exit 2
  sha256sum dump.rdb | cut -d" " -f1
else
  [ "$(ls -A)" = appendonlydir ] || exit 2
  cd appendonlydir
  [ -z "$(find . ! -type f ! -type d)" ] || exit 2
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d" " -f1
fi
'

# ---- marker ---------------------------------------------------------------

vr_marker_get() {
    /usr/bin/awk -F= -v key="$1" '
        $1 == key { value = substr($0, index($0, "=") + 1); found = 1; exit }
        END { if (found) print value; else exit 1 }
    ' "$VR_MARKER"
}

# Rewritten atomically: a crash between the temp write and the rename leaves the
# previous complete marker, never a torn one.
vr_marker_put() { vr_marker_put_many "$1=$2"; }

# Several keys in ONE rename, for changes that must never be seen half-applied
# (a rollback retargets the snapshot, digest and fingerprint together).
vr_marker_put_many() {
    local pair temporary keys=""
    for pair in "$@"; do
        [[ "$pair" == *=* && "$pair" != *$'\n'* ]] || die "valkey-restore: a marker entry must be one key=value line."
        keys+="${pair%%=*}"$'\n'
    done
    temporary="$(/usr/bin/mktemp "${VR_MARKER%/*}/.valkey-restore-fence.XXXXXX")"
    {
        if [[ -f "$VR_MARKER" ]]; then
            /usr/bin/awk -F= -v keys="$keys" '
                BEGIN { n = split(keys, list, "\n"); for (i = 1; i <= n; i++) if (list[i] != "") drop[list[i]] = 1 }
                !($1 in drop)
            ' "$VR_MARKER"
        fi
        printf '%s\n' "$@"
    } >"$temporary"
    /usr/bin/chmod 600 "$temporary"
    /usr/bin/mv -f "$temporary" "$VR_MARKER"
}

# The snapshot is only meaningful while a fence owns it: it goes with the marker.
vr_snapshot_purge() {
    [[ -n "$VR_SNAPSHOT_ROOT" && "$VR_SNAPSHOT_ROOT" == /*/* ]] || return 0
    /usr/bin/rm -rf -- "$VR_SNAPSHOT_ROOT" || vr_note "could not remove $VR_SNAPSHOT_ROOT; remove it by hand."
}

vr_clear_fence() {
    /usr/bin/rm -f "$VR_MARKER"
    vr_snapshot_purge
}

# ---- cleanup and recovery text --------------------------------------------

vr_cleanup() {
    local item
    for item in ${VR_CLEANUP_CONTAINERS[@]+"${VR_CLEANUP_CONTAINERS[@]}"}; do
        vr_docker rm -f "$item" >/dev/null 2>&1 || true
    done
    for item in ${VR_CLEANUP_VOLUMES[@]+"${VR_CLEANUP_VOLUMES[@]}"}; do
        vr_docker volume rm -f "$item" >/dev/null 2>&1 || true
    done
    VR_CLEANUP_CONTAINERS=()
    VR_CLEANUP_VOLUMES=()
    # A snapshot the fence marker has not adopted yet is nobody's: drop it.
    if [[ -n "$VR_PENDING_SNAPSHOT" ]]; then
        /usr/bin/rm -rf -- "$VR_PENDING_SNAPSHOT" || true
        VR_PENDING_SNAPSHOT=""
    fi
}

# Leftovers of an interrupted run: throwaway fingerprint volumes and a bootstrap
# container. Matched by this project's reserved prefix only.
vr_remove_leftovers() {
    local prefix="$VR_PROJECT-vr-" item
    for item in $(vr_docker ps -aq --filter "name=^/$prefix" 2>/dev/null || true); do
        vr_docker rm -f "$item" >/dev/null 2>&1 || true
    done
    for item in $(vr_docker volume ls -q 2>/dev/null | /usr/bin/grep -E "^$prefix" || true); do
        vr_docker volume rm -f "$item" >/dev/null 2>&1 || true
    done
}

vr_print_recovery() {
    local stage mode
    if ! fenced_by_valkey_restore; then
        vr_note "stopped before the fence was written: the backend and Valkey were not touched."
        return 0
    fi
    stage="$(vr_marker_get stage 2>/dev/null || echo unknown)"
    mode="$(vr_marker_get mode 2>/dev/null || echo restore)"
    vr_note "INTERRUPTED at stage '$stage'. The backend stays stopped and the fence marker ($VR_MARKER) stays in place."
    if [[ "$stage" == verified || "$stage" == reopening ]]; then
        vr_note "The restore itself is verified. Retry the reopen: valkey-restore --reopen --confirm-reopen"
    elif [[ "$mode" == rollback ]]; then
        vr_note "Resume (idempotent): valkey-restore --rollback '$(vr_marker_get backup_path 2>/dev/null || echo '<kept-copy>')' --confirm-fence"
    else
        vr_note "Resume (idempotent): valkey-restore '$(vr_marker_get backup_path 2>/dev/null || echo '<backup>')' --confirm-fence"
    fi
    vr_note "Roll back to the data that was replaced (the fence is kept throughout): valkey-restore --rollback <replaced-copy>/appendonlydir (or <replaced-copy>/dump.rdb) --confirm-fence; copies: $(vr_marker_get replaced_copies 2>/dev/null || echo none)"
    vr_note "Give up without restarting the backend: valkey-restore --abort --confirm-fence"
}

vr_on_exit() {
    local status=$?
    trap - EXIT
    vr_cleanup
    if [[ "$status" -ne 0 && "$VR_ACTIVE" == 1 ]]; then vr_print_recovery; fi
    exit "$status"
}

vr_arm_traps() {
    VR_ACTIVE=1
    trap vr_on_exit EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
}

# ---- docker lookups -------------------------------------------------------

vr_service_containers() {
    local flag=-q
    [[ "$2" == all ]] && flag=-aq
    vr_docker ps "$flag" \
        --filter "label=com.docker.compose.project=$VR_PROJECT" \
        --filter "label=com.docker.compose.service=$1"
}

vr_single_container() {
    local ids count
    ids="$(vr_service_containers "$1" "$2")" || return 1
    count="$(printf '%s\n' "$ids" | /usr/bin/awk 'NF {c++} END {print c+0}')"
    [[ "$count" == 1 && "$ids" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    printf '%s\n' "$ids"
}

vr_container_running() {
    [[ "$(vr_docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null)" == true ]]
}

vr_info_field() {
    local value
    value="$(vr_cli "$1" INFO "$2" | /usr/bin/tr -d '\r' | /usr/bin/awk -F: -v field="$3" '
        $1 == field { value = substr($0, index($0, ":") + 1); count += 1 }
        END { if (count == 1) print value; else exit 1 }
    ')" || return 1
    printf '%s\n' "$value"
}

vr_ping_ok() {
    [[ "$(vr_cli "$1" PING 2>/dev/null | /usr/bin/tr -d '\r')" == PONG ]]
}

vr_loaded() {
    [[ "$(vr_info_field "$1" persistence loading 2>/dev/null || true)" == 0 ]]
}

vr_wait() {
    local what="$1" attempt
    shift
    for attempt in $(/usr/bin/seq 1 "$VR_ATTEMPTS"); do
        if "$@" >/dev/null 2>&1; then return 0; fi
        vr_sleep 1
    done
    die "valkey-restore: timed out waiting for $what. The backend stays stopped."
}

vr_stop_container() {
    vr_docker stop -t 60 "$1" >/dev/null
    vr_container_running "$1" && die "valkey-restore: container $1 did not stop. The backend stays stopped."
    return 0
}

# ---- backup inspection ----------------------------------------------------

vr_tree_digest() {
    local listing
    listing="$(cd "$1" && /usr/bin/find . -type f -print0 | LC_ALL=C /usr/bin/sort -z | /usr/bin/xargs -0 /usr/bin/sha256sum)" \
        || die "valkey-restore: unable to hash the AOF backup directory."
    printf '%s\n' "$listing" | /usr/bin/sha256sum | /usr/bin/awk '{ print $1 }'
}

# The operator-supplied path is read exactly once, by vr_snapshot_take. Every
# later step (integrity check, throwaway fingerprint load, staging) works on the
# snapshot, so the bytes that were checked are the bytes that get restored.
vr_source_check() {
    local path="$1"
    [[ "$path" =~ ^/[A-Za-z0-9._/+@=-]+$ ]] \
        || die "valkey-restore: the backup must be an absolute path of letters, digits and . _ / + @ = - only."
    [[ ! -L "$path" ]] || die "valkey-restore: the backup must not be a symbolic link."
    if [[ -f "$path" ]]; then
        [[ -r "$path" ]] || die "valkey-restore: the backup file is unreadable or empty."
        VR_BACKUP_FORM=rdb
    elif [[ -d "$path" ]]; then
        [[ -r "$path" ]] || die "valkey-restore: the AOF backup directory is unreadable."
        VR_BACKUP_FORM=aof
    else
        die "valkey-restore: the backup does not exist."
    fi
    VR_BACKUP_PATH="$path"
}

vr_snapshot_digest() {
    if [[ "$VR_BACKUP_FORM" == rdb ]]; then sha256_file "$1/dump.rdb"; else vr_tree_digest "$1/appendonlydir"; fi
}

vr_snapshot_take() {
    local dir="$VR_SNAPSHOT_ROOT/$VR_STAMP" magic
    [[ -n "$VR_SNAPSHOT_ROOT" && "$VR_SNAPSHOT_ROOT" == /*/* ]] || die "valkey-restore: the snapshot area is not configured."
    [[ ! -L "$VR_SNAPSHOT_ROOT" ]] || die "valkey-restore: the snapshot area must not be a symbolic link."
    ( umask 077; /usr/bin/install -d -m 700 "$VR_SNAPSHOT_ROOT" "$dir" ) \
        || die "valkey-restore: unable to create the protected snapshot area."
    [[ -O "$VR_SNAPSHOT_ROOT" ]] || die "valkey-restore: the snapshot area is not owned by the operator."
    VR_PENDING_SNAPSHOT="$dir"
    if [[ "$VR_BACKUP_FORM" == rdb ]]; then
        ( umask 077; /usr/bin/cp --no-dereference -- "$VR_BACKUP_PATH" "$dir/dump.rdb" ) \
            || die "valkey-restore: unable to copy the backup into the protected snapshot."
    else
        ( umask 077; /usr/bin/cp -R --no-dereference -- "$VR_BACKUP_PATH" "$dir/appendonlydir" ) \
            || die "valkey-restore: unable to copy the backup into the protected snapshot."
    fi
    /usr/bin/chmod -R go-rwx "$dir"
    # From here on only the snapshot is looked at, never the operator path again.
    if [[ "$VR_BACKUP_FORM" == rdb ]]; then
        [[ -f "$dir/dump.rdb" && ! -L "$dir/dump.rdb" && -s "$dir/dump.rdb" ]] \
            || die "valkey-restore: the backup file is unreadable or empty."
        magic="$(/usr/bin/head -c 6 "$dir/dump.rdb" 2>/dev/null || true)"
        [[ "$magic" == REDIS* || "$magic" == VALKEY ]] \
            || die "valkey-restore: the backup file is not a Valkey/Redis RDB (bad magic)."
    else
        [[ -d "$dir/appendonlydir" && ! -L "$dir/appendonlydir" && -f "$dir/appendonlydir/appendonly.aof.manifest" \
            && ! -L "$dir/appendonlydir/appendonly.aof.manifest" ]] \
            || die "valkey-restore: an AOF backup must be the multi-part appendonlydir (appendonly.aof.manifest missing)."
        [[ -z "$(/usr/bin/find "$dir/appendonlydir" ! -type f ! -type d -print -quit)" ]] \
            || die "valkey-restore: the AOF backup directory may contain only regular files."
    fi
    VR_BACKUP_DIGEST="$(vr_snapshot_digest "$dir")"
    [[ "$VR_BACKUP_DIGEST" =~ ^[0-9a-f]{64}$ ]] || die "valkey-restore: unable to fingerprint the backup."
    VR_SNAPSHOT_DIR="$dir"
}

# Re-hash the recorded snapshot: a snapshot someone touched after the preflight
# is refused (the fence stays), never restored.
vr_snapshot_verify() {
    local actual
    [[ -n "$VR_SNAPSHOT_DIR" && "$VR_SNAPSHOT_DIR" == "$VR_SNAPSHOT_ROOT"/* && -d "$VR_SNAPSHOT_DIR" \
        && ! -L "$VR_SNAPSHOT_DIR" && -O "$VR_SNAPSHOT_DIR" ]] \
        || die "valkey-restore: the verified snapshot is missing or not protected. The backend stays stopped; the fence stays in place. Start over with --abort."
    actual="$(vr_snapshot_digest "$VR_SNAPSHOT_DIR")" \
        || die "valkey-restore: unable to re-hash the verified snapshot. The backend stays stopped; the fence stays in place."
    [[ "$actual" == "$VR_BACKUP_DIGEST" ]] \
        || die "valkey-restore: the verified snapshot changed after the preflight (digest mismatch). Nothing was restored from it. The backend stays stopped; the fence stays in place; use --abort and start over."
}

# What is in the data volume right now must be the snapshot's bytes, byte for byte.
vr_verify_staged() {
    local actual
    actual="$(vr_docker run --rm --network none --user 0 --entrypoint sh -v "$VR_VOLUME:/data:ro" "$VR_IMAGE" \
        -c "$VALKEY_STAGED_DIGEST_SCRIPT" sh "$VR_BACKUP_FORM")" \
        || die "valkey-restore: unable to read back the staged data. The backend stays stopped; the fence stays in place."
    actual="$(printf '%s' "$actual" | /usr/bin/tr -d '\r\n')"
    [[ "$actual" == "$VR_BACKUP_DIGEST" ]] \
        || die "valkey-restore: the staged data does not match the verified snapshot (expected $VR_BACKUP_DIGEST, got ${actual:-<none>}). Valkey was not started on it. The backend stays stopped; the fence stays in place."
}

# A rollback may only use data this procedure kept itself.
vr_check_rollback_path() {
    local path="$1" root="${VR_REPLACED_ROOT%/}" rest real_root
    [[ "$path" =~ ^/[A-Za-z0-9._/+@=-]+$ && "$path" != *//* ]] \
        || die "valkey-restore --rollback: the kept copy must be an absolute path of letters, digits and . _ / + @ = - only."
    [[ "$path" == "$root"/* ]] \
        || die "valkey-restore --rollback accepts only a kept copy under $root/<timestamp>/ (the data a restore replaced); '$path' is outside it."
    rest="${path#"$root"/}"
    [[ "$rest" =~ ^([A-Za-z0-9._-]+)/(appendonlydir|dump\.rdb)$ && "${BASH_REMATCH[1]}" != . && "${BASH_REMATCH[1]}" != .. ]] \
        || die "valkey-restore --rollback accepts only $root/<timestamp>/appendonlydir or $root/<timestamp>/dump.rdb."
    [[ ! -L "$root" && ! -L "$root/${rest%%/*}" && ! -L "$path" && -e "$path" ]] \
        || die "valkey-restore --rollback: the kept copy does not exist or goes through a symbolic link."
    real_root="$(/usr/bin/realpath -e -- "$root")" \
        && [[ "$(/usr/bin/realpath -e -- "$path")" == "$real_root/$rest" ]] \
        || die "valkey-restore --rollback: the kept copy resolves outside $root."
}

# ---- fingerprint ----------------------------------------------------------

vr_fp_get() {
    printf '%s\n' "$1" | /usr/bin/awk -F= -v key="$2" '$1 == key { print substr($0, index($0, "=") + 1); exit }'
}

vr_fingerprint() {
    local output
    output="$(vr_docker exec "$1" sh -c "$VALKEY_FINGERPRINT_SCRIPT" sh "$VR_STREAM_KEY" 200)" \
        || die "valkey-restore: unable to fingerprint the dataset."
    printf '%s\n' "$output" | /usr/bin/tr -d '\r'
}

# Exact for everything that cannot change without a restore going wrong; DBSIZE
# may only shrink (expiry) and never below the persistent key count.
vr_fingerprint_matches() {
    local expected="$1" actual="$2" key want have bad=0 persistent
    for key in persistent_keys other_dbs stream_last_id sample_count sample_sha256; do
        want="$(vr_fp_get "$expected" "$key")"
        have="$(vr_fp_get "$actual" "$key")"
        if [[ -z "$want" || "$want" != "$have" ]]; then
            vr_note "fingerprint mismatch on $key (expected ${want:-<missing>}, got ${have:-<missing>})."
            bad=1
        fi
    done
    want="$(vr_fp_get "$expected" dbsize)"
    have="$(vr_fp_get "$actual" dbsize)"
    persistent="$(vr_fp_get "$actual" persistent_keys)"
    if ! [[ "$want" =~ ^[0-9]+$ && "$have" =~ ^[0-9]+$ && "$persistent" =~ ^[0-9]+$ ]] \
        || (( have > want || have < persistent )); then
        vr_note "fingerprint mismatch on dbsize (expected at most ${want:-<missing>}, got ${have:-<missing>})."
        bad=1
    fi
    return "$bad"
}

vr_fp_one_line() { printf '%s' "$1" | /usr/bin/tr '\n' ';'; }
vr_fp_from_line() { printf '%s' "$1" | /usr/bin/tr ';' '\n'; }

# ---- staging and throwaway instance --------------------------------------

vr_stage_data() {
    local volume="$1" mount script
    if [[ "$VR_BACKUP_FORM" == rdb ]]; then
        mount="$VR_SNAPSHOT_DIR/dump.rdb:/backup/dump.rdb:ro"
        script="$VALKEY_STAGE_RDB_SCRIPT"
    else
        mount="$VR_SNAPSHOT_DIR/appendonlydir:/backup/appendonlydir:ro"
        script="$VALKEY_STAGE_AOF_SCRIPT"
    fi
    vr_docker run --rm --network none --user 0 --entrypoint sh \
        -v "$volume:/data" -v "$mount" "$VR_IMAGE" -c "$script" >/dev/null
}

vr_check_staged() {
    local check
    if [[ "$VR_BACKUP_FORM" == rdb ]]; then check='valkey-check-rdb /data/dump.rdb'; else check='valkey-check-aof /data/appendonlydir/appendonly.aof.manifest'; fi
    vr_docker run --rm --network none --user 0 --entrypoint sh -v "$1:/data" "$VR_IMAGE" -c "$check" >/dev/null 2>&1
}

# Load the backup into a throwaway, network-less instance on a throwaway volume
# and record what the restored dataset must look like.
vr_backup_fingerprint() {
    local volume="$VR_PROJECT-vr-fp-$VR_STAMP" name="$VR_PROJECT-vr-fp-$VR_STAMP" appendonly=no
    [[ "$VR_BACKUP_FORM" == aof ]] && appendonly=yes
    VR_CLEANUP_VOLUMES+=("$volume")
    VR_CLEANUP_CONTAINERS+=("$name")
    vr_docker volume create "$volume" >/dev/null
    vr_stage_data "$volume" || die "valkey-restore: unable to stage the backup for inspection."
    vr_check_staged "$volume" || die "valkey-restore: the backup failed the Valkey integrity check."
    vr_docker run -d --name "$name" --network none -v "$volume:/data" "$VR_IMAGE" \
        valkey-server --save "" --appendonly "$appendonly" >/dev/null \
        || die "valkey-restore: unable to start the throwaway Valkey."
    vr_wait "the throwaway Valkey to answer PING" vr_ping_ok "$name"
    vr_wait "the throwaway Valkey to finish loading the backup" vr_loaded "$name"
    VR_EXPECTED_FP="$(vr_fingerprint "$name")"
    vr_docker rm -f "$name" >/dev/null 2>&1 || true
    vr_docker volume rm -f "$volume" >/dev/null 2>&1 || true
    VR_CLEANUP_CONTAINERS=()
    VR_CLEANUP_VOLUMES=()
}

# ---- stages ---------------------------------------------------------------

vr_resolve_target() {
    local mounted
    VR_VALKEY_CID="$(vr_single_container "$VR_VALKEY_SERVICE" all)" \
        || die "valkey-restore: expected exactly one $VR_VALKEY_SERVICE container in compose project $VR_PROJECT."
    mounted="$(vr_docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$VR_VALKEY_CID")" \
        || die "valkey-restore: unable to inspect the Valkey container."
    [[ "$mounted" == "$VR_VOLUME" ]] \
        || die "valkey-restore: the Valkey container does not use the expected data volume ($VR_VOLUME)."
    VR_IMAGE="$(vr_docker inspect --format '{{.Image}}' "$VR_VALKEY_CID")" \
        || die "valkey-restore: unable to resolve the Valkey image."
    [[ "$VR_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || die "valkey-restore: the Valkey image identity is invalid."
    VR_OBSERVED_RUN_ID=""
    if vr_container_running "$VR_VALKEY_CID"; then
        VR_OBSERVED_RUN_ID="$(vr_info_field "$VR_VALKEY_CID" server run_id || true)"
    fi
}

vr_marker_create() {
    local temporary running="$1" all="$2"
    temporary="$(/usr/bin/mktemp "${VR_MARKER%/*}/.valkey-restore-fence.XXXXXX")"
    printf '%s\n' \
        "schema=1" \
        "created_at_unix=$(current_unix_time)" \
        "stage=fencing" \
        "backup_path=$VR_BACKUP_PATH" \
        "backup_form=$VR_BACKUP_FORM" \
        "backup_digest=$VR_BACKUP_DIGEST" \
        "snapshot_dir=$VR_SNAPSHOT_DIR" \
        "mode=restore" \
        "project=$VR_PROJECT" \
        "volume=$VR_VOLUME" \
        "valkey_cid=$VR_VALKEY_CID" \
        "old_run_id=${VR_OBSERVED_RUN_ID:-none}" \
        "expected_fingerprint=$(vr_fp_one_line "$VR_EXPECTED_FP")" \
        "api_cids=$(printf '%s' "$all" | /usr/bin/tr '\n' ' ' | /usr/bin/sed 's/ *$//')" \
        "api_was_running=$([[ -n "$running" ]] && printf 1 || printf 0)" \
        "replaced_copies=" >"$temporary"
    /usr/bin/chmod 600 "$temporary"
    /usr/bin/mv -f "$temporary" "$VR_MARKER"
    VR_PENDING_SNAPSHOT=""
}

# Rollback inside the fence: the snapshot, its digest and its fingerprint switch
# together in ONE rename, so an interruption leaves either the old consistent
# target or the new one, never a mix. The fence marker is never removed.
vr_marker_retarget() {
    local old
    vr_marker_put_many \
        "mode=rollback" \
        "stage=fencing" \
        "backup_path=$VR_BACKUP_PATH" \
        "backup_form=$VR_BACKUP_FORM" \
        "backup_digest=$VR_BACKUP_DIGEST" \
        "snapshot_dir=$VR_SNAPSHOT_DIR" \
        "expected_fingerprint=$(vr_fp_one_line "$VR_EXPECTED_FP")" \
        "new_run_id=" \
        "verified_at_unix="
    VR_PENDING_SNAPSHOT=""
    for old in "$VR_SNAPSHOT_ROOT"/*; do
        [[ "$old" != "$VR_SNAPSHOT_DIR" && -e "$old" ]] || continue
        /usr/bin/rm -rf -- "$old" || true
    done
}

vr_fence() {
    local running all cid
    if ! fenced_by_valkey_restore; then
        running="$(vr_service_containers "$VR_API_SERVICE" running)" || die "valkey-restore: unable to list the API containers."
        all="$(vr_service_containers "$VR_API_SERVICE" all)" || die "valkey-restore: unable to list the API containers."
        vr_marker_create "$running" "$all"
    else
        vr_marker_put stage fencing
    fi
    running="$(vr_service_containers "$VR_API_SERVICE" running)" || die "valkey-restore: unable to list the API containers."
    for cid in $running; do
        vr_docker stop "$cid" >/dev/null || die "valkey-restore: unable to stop the API container. The fence stays in place."
    done
    [[ -z "$(vr_service_containers "$VR_API_SERVICE" running)" ]] \
        || die "valkey-restore: an API container is still running. The fence stays in place."
    vr_marker_put stage fenced
}

vr_copy_replaced() {
    local destination="$VR_REPLACED_ROOT/$VR_STAMP" existing
    /usr/bin/install -d -m 700 "$VR_REPLACED_ROOT" "$destination"
    vr_docker run --rm --network none --user 0 --entrypoint sh \
        -v "$VR_VOLUME:/data:ro" -v "$destination:/copy" "$VR_IMAGE" -c 'set -eu; cp -a /data/. /copy/' >/dev/null \
        || die "valkey-restore: unable to keep a copy of the replaced data. Nothing was replaced."
    existing="$(vr_marker_get replaced_copies 2>/dev/null || true)"
    vr_marker_put replaced_copies "${existing:+$existing }$destination"
    vr_note "kept the replaced data in $destination"
}

# RDB: Valkey 8 with appendonly yes loads only appendonlydir, so an RDB is loaded
# once with appendonly off and converted to a fresh AOF before the normal start.
vr_bootstrap_rdb() {
    local name="$VR_PROJECT-vr-bootstrap-$VR_STAMP"
    VR_CLEANUP_CONTAINERS+=("$name")
    vr_docker run -d --name "$name" --network none -v "$VR_VOLUME:/data" "$VR_IMAGE" \
        valkey-server --appendonly no --save "" >/dev/null \
        || die "valkey-restore: unable to start the bootstrap Valkey. The backend stays stopped."
    vr_wait "the bootstrap Valkey to answer PING" vr_ping_ok "$name"
    vr_wait "the bootstrap Valkey to finish loading the RDB" vr_loaded "$name"
    [[ "$(vr_cli "$name" CONFIG SET appendonly yes | /usr/bin/tr -d '\r')" == OK ]] \
        || die "valkey-restore: unable to enable the AOF on the bootstrap Valkey."
    vr_wait "the AOF rewrite to finish" vr_aof_rewrite_done "$name"
    vr_docker stop -t 60 "$name" >/dev/null || die "valkey-restore: unable to stop the bootstrap Valkey."
    vr_docker rm "$name" >/dev/null || die "valkey-restore: unable to remove the bootstrap Valkey."
    VR_CLEANUP_CONTAINERS=()
}

vr_aof_rewrite_done() {
    [[ "$(vr_info_field "$1" persistence aof_enabled)" == 1 \
        && "$(vr_info_field "$1" persistence aof_rewrite_in_progress)" == 0 \
        && "$(vr_info_field "$1" persistence aof_rewrite_scheduled)" == 0 \
        && "$(vr_info_field "$1" persistence aof_last_bgrewrite_status)" == ok ]]
}

vr_restore_data() {
    vr_marker_put stage restoring
    vr_snapshot_verify
    vr_container_running "$VR_VALKEY_CID" && vr_stop_container "$VR_VALKEY_CID"
    vr_copy_replaced
    vr_stage_data "$VR_VOLUME" || die "valkey-restore: unable to stage the backup into the data volume. The backend stays stopped."
    vr_verify_staged
    if [[ "$VR_BACKUP_FORM" == rdb ]]; then vr_bootstrap_rdb; fi
    vr_docker start "$VR_VALKEY_CID" >/dev/null || die "valkey-restore: unable to start Valkey. The backend stays stopped."
    vr_wait "Valkey to answer PING" vr_ping_ok "$VR_VALKEY_CID"
    vr_wait "Valkey to finish loading" vr_loaded "$VR_VALKEY_CID"
    vr_marker_put stage restored
}

vr_verify() {
    local role aof actual previous
    vr_ping_ok "$VR_VALKEY_CID" || die "valkey-restore: Valkey does not answer PING. The backend stays stopped."
    role="$(vr_info_field "$VR_VALKEY_CID" replication role)" || die "valkey-restore: unable to read the Valkey role."
    [[ "$role" == master ]] || die "valkey-restore: Valkey is not a master (role=$role). The backend stays stopped."
    aof="$(vr_info_field "$VR_VALKEY_CID" persistence aof_enabled)" || die "valkey-restore: unable to read the AOF state."
    [[ "$aof" == 1 ]] || die "valkey-restore: the restored Valkey is not running with the AOF. The backend stays stopped."
    actual="$(vr_fingerprint "$VR_VALKEY_CID")"
    vr_fingerprint_matches "$VR_EXPECTED_FP" "$actual" \
        || die "valkey-restore: the restored dataset does not match the backup (an old appendonlydir shadowing the RDB looks exactly like this). The backend stays stopped; the fence stays in place."
    VR_NEW_RUN_ID="$(vr_info_field "$VR_VALKEY_CID" server run_id)" || die "valkey-restore: unable to read the Valkey run_id."
    VR_NEW_REPLID="$(vr_info_field "$VR_VALKEY_CID" replication master_replid || true)"
    previous="$(vr_marker_get old_run_id)"
    [[ -n "$VR_NEW_RUN_ID" && "$VR_NEW_RUN_ID" != "$previous" && "$VR_NEW_RUN_ID" != "$VR_OBSERVED_RUN_ID" ]] \
        || die "valkey-restore: the Valkey run_id did not change; the continuity proof would not see this restore. The backend stays stopped."
    vr_marker_put new_run_id "$VR_NEW_RUN_ID"
    vr_marker_put verified_at_unix "$(current_unix_time)"
    vr_marker_put stage verified
}

# ---- commands -------------------------------------------------------------

valkey_restore_run() {
    local source="$1" mode="${2:-restore}"
    VR_MODE="$mode"
    VR_STAMP="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)-$BASHPID"
    vr_arm_traps
    vr_remove_leftovers
    vr_source_check "$source"
    vr_resolve_target
    if fenced_by_valkey_restore; then
        [[ "$(vr_marker_get project || true)" == "$VR_PROJECT" ]] \
            || die "valkey-restore: the fence ($VR_MARKER) belongs to another compose project."
        vr_snapshot_take
        if [[ "$(vr_marker_get backup_digest || true)" == "$VR_BACKUP_DIGEST" \
            && "$(vr_marker_get backup_path || true)" == "$VR_BACKUP_PATH" ]]; then
            # Same backup: resume with the snapshot taken at the first preflight
            # (re-hashed below), not with the copy that was just made.
            /usr/bin/rm -rf -- "$VR_PENDING_SNAPSHOT"
            VR_PENDING_SNAPSHOT=""
            VR_BACKUP_FORM="$(vr_marker_get backup_form)"
            VR_BACKUP_DIGEST="$(vr_marker_get backup_digest)"
            VR_SNAPSHOT_DIR="$(vr_marker_get snapshot_dir || true)"
            vr_snapshot_verify
            VR_EXPECTED_FP="$(vr_fp_from_line "$(vr_marker_get expected_fingerprint)")"
            if [[ "$(vr_marker_get stage || true)" == verified && -n "$VR_OBSERVED_RUN_ID" \
                && "$VR_OBSERVED_RUN_ID" == "$(vr_marker_get new_run_id || true)" ]] \
                && vr_fingerprint_matches "$VR_EXPECTED_FP" "$(vr_fingerprint "$VR_VALKEY_CID")"; then
                vr_note "already restored and verified; nothing to redo."
                VR_ACTIVE=0
                printf '%s\n' "environment=fallback-server" "valkey_restore=verified" "fenced=true" \
                    "next=valkey-restore --reopen --confirm-reopen"
                return 0
            fi
        elif [[ "$mode" == rollback ]]; then
            vr_backup_fingerprint
            vr_marker_retarget
        else
            die "valkey-restore: a fence for a different backup is active ($VR_MARKER). Re-run with that backup, roll back with 'valkey-restore --rollback <kept-copy> --confirm-fence', or --abort first."
        fi
    else
        [[ "$mode" == restore ]] || die "valkey-restore --rollback only runs inside an active fence."
        vr_snapshot_purge
        vr_snapshot_take
        vr_backup_fingerprint
    fi
    vr_fence
    vr_restore_data
    vr_verify
    VR_ACTIVE=0
    printf '%s\n' \
        "environment=fallback-server" \
        "valkey_restore=verified" \
        "fenced=true" \
        "mode=$mode" \
        "backup_form=$VR_BACKUP_FORM" \
        "backup_digest=$VR_BACKUP_DIGEST" \
        "old_run_id=$(vr_marker_get old_run_id)" \
        "new_run_id=$VR_NEW_RUN_ID" \
        "new_master_replid=${VR_NEW_REPLID:-unknown}" \
        "replaced_copies=$(vr_marker_get replaced_copies)" \
        "next=valkey-restore --reopen --confirm-reopen"
}

# The gate that decides whether the API may be started again. Reads the live
# approval/policy state, never the state recorded at fence time: the expiry guard
# may have fired meanwhile. Sets VR_REOPEN_MODE or VR_REOPEN_REASON.
vr_reopen_decision() {
    local mode expiry now
    VR_REOPEN_MODE=""
    VR_REOPEN_REASON=""
    mode="$(read_state runtime-mode || true)"
    if [[ -z "$mode" || "$mode" == passive ]]; then
        if [[ -e "$ACTIVE_EXPIRY_FILE" ]]; then
            VR_REOPEN_REASON="the runtime state is inconsistent (an active expiry exists without an active mode); use the normal temporary-active flow or 'stop'."
            return 1
        fi
        VR_REOPEN_MODE=passive
        return 0
    fi
    if [[ "$mode" != temporary-active ]]; then
        VR_REOPEN_REASON="the runtime mode '$mode' is invalid; use the normal deploy flow."
        return 1
    fi
    if automatic_shutdown_disabled; then
        if ! verify_shutdown_masks; then
            VR_REOPEN_REASON="persistent operation is on but the shutdown units are not masked and inactive; fix that, then use 'adopt-persistent-active'."
            return 1
        fi
        VR_REOPEN_MODE=persistent-active
        return 0
    fi
    expiry="$(read_state temporary-active-expiry || true)"
    now="$(current_unix_time)"
    if ! [[ "$expiry" =~ ^[0-9]{10,}$ ]] || (( expiry <= now + VALKEY_RESTORE_READY_WINDOW_SECONDS )); then
        VR_REOPEN_REASON="the temporary-active approval has expired or leaves less than ${VALKEY_RESTORE_READY_WINDOW_SECONDS}s; issue a fresh approval and use the normal 'temporary-active' flow."
        return 1
    fi
    if ! vr_expiry_timer_active; then
        VR_REOPEN_REASON="the temporary-active expiry timer is no longer active; use the normal 'temporary-active' flow."
        return 1
    fi
    VR_REOPEN_MODE=temporary-active
}

vr_expiry_timer_active() { /usr/bin/systemctl is-active --quiet "$TEMPORARY_STOP_UNIT.timer"; }

vr_container_gate_class() {
    local env key active=1 passive=1
    env="$(runtime_env_for "$1" || true)"
    if [[ -z "$env" ]]; then printf unknown; return 0; fi
    for key in "${ACTIVE_TRUE_ENV_KEYS[@]}"; do
        printf '%s\n' "$env" | /usr/bin/grep -Fxq "$key=true" || active=0
    done
    for key in "${PASSIVE_ENV_KEYS[@]}"; do
        printf '%s\n' "$env" | /usr/bin/grep -Fxq "$key=false" || passive=0
    done
    if [[ "$active" == 1 ]]; then printf active; elif [[ "$passive" == 1 ]]; then printf passive; else printf unknown; fi
}

vr_reopen_wait_ready() { wait_until_ready "$1"; }
vr_reopen_status() { status_release; }

vr_stop_api_again() {
    local cid
    for cid in $(vr_service_containers "$VR_API_SERVICE" running || true); do
        vr_docker stop "$cid" >/dev/null 2>&1 || true
    done
    [[ -z "$(vr_service_containers "$VR_API_SERVICE" running || true)" ]]
}

# Step d already passed, so the restore itself is finished: release the fence but
# do not start the API, and say which normal flow to use. A partially reopened API
# (stage 'reopening') is stopped first so "not started" is true.
vr_release_without_start() {
    local stage="$1"
    shift
    if [[ "$stage" == reopening ]]; then vr_stop_api_again || die "valkey-restore: unable to stop the partially reopened API. The fence stays in place."; fi
    vr_clear_fence
    VR_ACTIVE=0
    die "valkey-restore: the Valkey restore is verified and the fence is released, but the API was NOT started: $*"
}

valkey_restore_reopen() {
    local stage cid expected_run actual_run cids tag class want status_output lease
    fenced_by_valkey_restore || die "valkey-restore: no fence is active; nothing to reopen."
    vr_arm_traps
    stage="$(vr_marker_get stage || true)"
    [[ "$stage" == verified || "$stage" == reopening ]] \
        || die "valkey-restore: the restore is not verified (stage '$stage'). Re-run 'valkey-restore <backup> --confirm-fence' or --abort."
    VR_PROJECT="$(vr_marker_get project)"
    VR_VALKEY_CID="$(vr_marker_get valkey_cid)"
    VR_EXPECTED_FP="$(vr_fp_from_line "$(vr_marker_get expected_fingerprint)")"
    expected_run="$(vr_marker_get new_run_id)"
    vr_container_running "$VR_VALKEY_CID" || die "valkey-restore: Valkey is not running; the verification no longer holds. Re-run the restore."
    actual_run="$(vr_info_field "$VR_VALKEY_CID" server run_id || true)"
    [[ "$actual_run" == "$expected_run" ]] \
        || die "valkey-restore: Valkey restarted since it was verified; the verification no longer holds. Re-run the restore."
    vr_ping_ok "$VR_VALKEY_CID" || die "valkey-restore: Valkey does not answer PING."
    if [[ "$stage" == verified ]]; then
        vr_fingerprint_matches "$VR_EXPECTED_FP" "$(vr_fingerprint "$VR_VALKEY_CID")" \
            || die "valkey-restore: the Valkey dataset no longer matches the backup. Re-run the restore."
    fi
    cids="$(vr_marker_get api_cids || true)"
    if [[ "$(vr_marker_get api_was_running)" != 1 ]]; then
        vr_clear_fence
        VR_ACTIVE=0
        printf '%s\n' "environment=fallback-server" "valkey_restore=reopened" "api_started=false" \
            "reason=the API was not running when the fence began; start it with the normal flow."
        return 0
    fi
    vr_reopen_decision || vr_release_without_start "$stage" "$VR_REOPEN_REASON"
    case "$VR_REOPEN_MODE" in
        passive) want=passive ;;
        *) want=active ;;
    esac
    for cid in $cids; do
        class="$(vr_container_gate_class "$cid")"
        [[ "$class" == "$want" ]] \
            || vr_release_without_start "$stage" "the recorded API container is '$class' while the runtime state says '$VR_REOPEN_MODE'; use the matching normal flow."
    done
    tag="$(read_state current-image-tag || true)"
    [[ "$tag" =~ $SHA_PATTERN ]] || vr_release_without_start "$stage" "no release is recorded; use the normal deploy flow."
    vr_marker_put stage reopening
    # `docker start` of the same container: `up` could recreate it with a new id
    # or restart policy and break the preserved-container invariant of
    # extend-temporary-active.
    for cid in $cids; do
        vr_docker start "$cid" >/dev/null \
            || { vr_stop_api_again || true; die "valkey-restore: unable to start the API container; it was stopped again and the fence stays in place."; }
    done
    if ! vr_reopen_wait_ready "$tag"; then
        vr_stop_api_again || true
        die "valkey-restore: the API did not become ready; it was stopped again and the fence stays in place."
    fi
    if ! status_output="$(vr_reopen_status)"; then
        vr_stop_api_again || true
        die "valkey-restore: the reopened API failed verification; it was stopped again and the fence stays in place."
    fi
    vr_clear_fence
    VR_ACTIVE=0
    lease="$(lease_status_fields)"
    printf '%s\n' "environment=fallback-server" "valkey_restore=reopened" "api_started=true" "reopen_mode=$VR_REOPEN_MODE"
    printf '%s\n' "$status_output"
    # The scheduler lease is released by the stopped API (SIGTERM) or lapses
    # within its 90 s TTL; the restarted instance (same holder id, new instance
    # id) re-acquires it. Display only, like `status`.
    printf '%s\n' "$lease"
}

valkey_restore_abort() {
    local stage
    fenced_by_valkey_restore || die "valkey-restore: no fence is active; nothing to abort."
    stage="$(vr_marker_get stage || echo unknown)"
    vr_clear_fence
    printf '%s\n' \
        "environment=fallback-server" \
        "valkey_restore=aborted" \
        "aborted_stage=$stage" \
        "api_started=false" \
        "note=The backend stays stopped. Valkey data may be partially restored until a verified restore or rollback; start the backend only through the normal flow."
}

valkey_restore() {
    local mode=restore backup="" confirm_fence=0 confirm_reopen=0 arg
    for arg in "$@"; do
        case "$arg" in
            --reopen) mode=reopen ;;
            --abort) mode=abort ;;
            --rollback) mode=rollback ;;
            --confirm-fence) confirm_fence=1 ;;
            --confirm-reopen) confirm_reopen=1 ;;
            --*) usage; exit 1 ;;
            *) [[ -z "$backup" ]] || { usage; exit 1; }; backup="$arg" ;;
        esac
    done
    # Explicit flags, no TTY prompt: the operator runs non-interactively as root.
    # Everything below the flag checks may stop containers; nothing above does.
    case "$mode" in
        restore)
            [[ -n "$backup" && "$confirm_reopen" == 0 ]] || { usage; exit 1; }
            [[ "$confirm_fence" == 1 ]] \
                || die "valkey-restore stops the backend and replaces the Valkey data. Re-run with --confirm-fence to proceed."
            valkey_restore_run "$backup"
            ;;
        rollback)
            [[ -n "$backup" && "$confirm_reopen" == 0 ]] || { usage; exit 1; }
            [[ "$confirm_fence" == 1 ]] \
                || die "valkey-restore --rollback replaces the Valkey data with a kept copy, inside the fence. Re-run with --confirm-fence to proceed."
            # A rollback never opens a fence of its own: without one, a normal
            # restore (preflight, fence, verify) is the path.
            fenced_by_valkey_restore \
                || die "valkey-restore --rollback only runs inside an active fence ($VR_MARKER) and there is none. Restore the kept copy with a normal 'valkey-restore <kept-copy> --confirm-fence' instead."
            vr_check_rollback_path "$backup"
            valkey_restore_run "$backup" rollback
            ;;
        reopen)
            [[ -z "$backup" && "$confirm_fence" == 0 ]] || { usage; exit 1; }
            [[ "$confirm_reopen" == 1 ]] \
                || die "valkey-restore --reopen starts the backend against the restored Valkey. Re-run with --confirm-reopen to proceed."
            valkey_restore_reopen
            ;;
        abort)
            [[ -z "$backup" && "$confirm_reopen" == 0 ]] || { usage; exit 1; }
            [[ "$confirm_fence" == 1 ]] \
                || die "valkey-restore --abort discards the fence without restarting the backend. Re-run with --confirm-fence to proceed."
            valkey_restore_abort
            ;;
    esac
}

main() {
    local action="${1:-}"

    require_root
    validate_bundle
    validate_state_boundary
    exec 9>"$LOCK_FILE"
    /usr/bin/flock -w 5 9 || die "Another Fallback Server operation is active."

    case "$action" in
        adopt-persistent-active)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            adopt_persistent_active_release
            ;;
        status)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            # Informational only (stderr keeps the key=value stream the
            # controller parses unchanged); status never refuses on the fence.
            if fenced_by_valkey_restore; then echo "A Valkey restore fence is active ($VR_MARKER); the backend is expected to be stopped." >&2; fi
            status_release
            ;;
        deploy)
            [[ "$#" -eq 3 ]] || { usage; exit 1; }
            deploy_release "$2" "$3"
            ;;
        temporary-active)
            [[ "$#" -eq 3 ]] || { usage; exit 1; }
            temporary_activate_release "$2" "$3"
            ;;
        extend-temporary-active)
            [[ "$#" -eq 3 ]] || { usage; exit 1; }
            extend_temporary_active_release "$2" "$3"
            ;;
        replace-temporary-active)
            [[ "$#" -eq 3 ]] || { usage; exit 1; }
            replace_temporary_active_release "$2" "$3"
            ;;
        guard-expiry)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            guard_expiry
            ;;
        rollback)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            rollback_release
            ;;
        stop)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            stop_release
            ;;
        valkey-restore)
            [[ "$#" -ge 2 && "$#" -le 4 ]] || { usage; exit 1; }
            valkey_restore "${@:2}"
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
