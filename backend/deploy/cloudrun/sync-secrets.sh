#!/usr/bin/env bash
# sync-secrets.sh — create/update Secret Manager secrets for the preview
# Cloud Run service (BJJ-341).
#
# Usage: sync-secrets.sh <env-file> <gcp-project-id> [--dry-run] [--allow-undeployed]
#
# Secret names come ONLY from the secretKeyRef entries in service.preview.yaml
# (resolved relative to this script's own directory). The key exclusion list
# lives in excluded-keys.txt next to this script (shared with the manifest test).
#
# Exit codes:
#   0  success (or dry-run success / undeployed keys allowed)
#   1  usage error, unreadable env file, parse error, missing/empty secret value,
#      or a KAKAO_CALLBACK_URL that is not a run.app callback URL
#   3  undeployed env-file keys found and --allow-undeployed was not passed
#
# Secret values are never printed, logged, or passed as command-line
# arguments; they travel only through stdin/stdout pipes into shasum/gcloud.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$SCRIPT_DIR/service.preview.yaml"
EXCLUDED_FILE="$SCRIPT_DIR/excluded-keys.txt"

ENV_KEYS=()
ENV_VALUES=()
MANIFEST_NAMES=()
SECRET_KEYS=()
EXCLUDED_KEYS=()

TAB_CHAR=$'\t'
KEY_RE='^[A-Za-z_][A-Za-z0-9_]*$'

usage() {
    echo "Usage: sync-secrets.sh <env-file> <gcp-project-id> [--dry-run] [--allow-undeployed]" >&2
}

trim() {
    local s="$1"
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    printf '%s' "$s"
}

strip_one_quote_layer() {
    local v="$1"
    if [ "${#v}" -ge 2 ]; then
        case "$v" in
            \"*\")
                v="${v#\"}"
                v="${v%\"}"
                ;;
            \'*\')
                v="${v#\'}"
                v="${v%\'}"
                ;;
        esac
    fi
    printf '%s' "$v"
}

find_env_index() {
    # $1 = key. Sets REPLY_INDEX on success.
    local needle="$1" i n="${#ENV_KEYS[@]}"
    [ "$n" -eq 0 ] && return 1
    for ((i = 0; i < n; i++)); do
        if [ "${ENV_KEYS[$i]}" = "$needle" ]; then
            REPLY_INDEX="$i"
            return 0
        fi
    done
    return 1
}

# Parse the env file WITHOUT source/eval: line by line, skipping blanks and
# # comments, accepting KEY=VALUE and "export KEY=VALUE", trimming surrounding
# whitespace off the value before stripping one layer of matching surrounding
# quotes. Values may contain "=". A quoted value keeps "#" literally; an
# unquoted value containing " #" (dotenv inline-comment syntax) is refused
# instead of being guessed at.
parse_env_file() {
    local file="$1"
    local raw line key value lineno=0
    while IFS= read -r raw || [ -n "$raw" ]; do
        lineno=$((lineno + 1))
        line="$(trim "$raw")"
        case "$line" in
            "" | "#"*) continue ;;
        esac
        if [ "${line#export}" != "$line" ]; then
            local rest="${line#export}"
            case "$rest" in
                " "* | "$TAB_CHAR"*)
                    line="$(trim "$rest")"
                    ;;
            esac
        fi
        case "$line" in
            *=*)
                key="${line%%=*}"
                value="${line#*=}"
                ;;
            *)
                echo "line $lineno: invalid" >&2
                exit 1
                ;;
        esac
        key="$(trim "$key")"
        if ! [[ "$key" =~ $KEY_RE ]]; then
            echo "line $lineno: invalid" >&2
            exit 1
        fi
        value="$(trim "$value")"
        case "$value" in
            \"* | \'*)
                value="$(strip_one_quote_layer "$value")"
                ;;
            *" #"*)
                # dotenv would treat this as an inline comment; guessing either
                # way silently diverges, so refuse the line (never print it).
                echo "line $lineno: invalid" >&2
                exit 1
                ;;
        esac
        if find_env_index "$key"; then
            ENV_VALUES[$REPLY_INDEX]="$value"
        else
            ENV_KEYS+=("$key")
            ENV_VALUES+=("$value")
        fi
    done <"$file"
}

parse_manifest() {
    local line in_ref=0 val
    while IFS= read -r line; do
        case "$line" in
            "" | "#"*) continue ;;
        esac
        if [ "$in_ref" -eq 1 ]; then
            case "$line" in
                *name:*)
                    in_ref=0
                    val="$(trim "${line#*name:}")"
                    val="$(strip_one_quote_layer "$val")"
                    SECRET_KEYS+=("$val")
                    MANIFEST_NAMES+=("$val")
                    ;;
            esac
            continue
        fi
        case "$line" in
            *secretKeyRef:*)
                in_ref=1
                ;;
            *-\ name:*)
                val="$(trim "${line#*- name:}")"
                val="$(strip_one_quote_layer "$val")"
                MANIFEST_NAMES+=("$val")
                ;;
        esac
    done <"$MANIFEST"
}

parse_excluded() {
    local line key
    while IFS= read -r line || [ -n "$line" ]; do
        line="$(trim "$line")"
        case "$line" in
            "" | "#"*) continue ;;
        esac
        case "$line" in
            *"#"*) key="$(trim "${line%%#*}")" ;;
            *) key="$line" ;;
        esac
        if [ -n "$key" ]; then
            EXCLUDED_KEYS+=("$key")
        fi
    done <"$EXCLUDED_FILE"
}

check_required_secrets() {
    local i n="${#SECRET_KEYS[@]}" missing=0 key
    [ "$n" -eq 0 ] && return 0
    for ((i = 0; i < n; i++)); do
        key="${SECRET_KEYS[$i]}"
        if find_env_index "$key"; then
            if [ -z "${ENV_VALUES[$REPLY_INDEX]}" ]; then
                echo "missing-or-empty: $key" >&2
                missing=$((missing + 1))
            fi
        else
            echo "missing-or-empty: $key" >&2
            missing=$((missing + 1))
        fi
    done
    if [ "$missing" -gt 0 ]; then
        exit 1
    fi
}

# Preview must not reuse production's Kakao callback: the nonce cookie is
# host-only, so the callback has to land on this Cloud Run service itself.
check_preview_values() {
    local callback_re='^https://[A-Za-z0-9._-]+[.]run[.]app/auth/kakao/callback$'
    if find_env_index "KAKAO_CALLBACK_URL"; then
        if ! [[ "${ENV_VALUES[$REPLY_INDEX]}" =~ $callback_re ]]; then
            echo "invalid-preview-value: KAKAO_CALLBACK_URL (expected https://<service>.run.app/auth/kakao/callback)" >&2
            exit 1
        fi
    fi
}

guard_undeployed() {
    local i j n="${#ENV_KEYS[@]}" nm ne key found violations=0
    [ "$n" -eq 0 ] && return 0
    nm="${#MANIFEST_NAMES[@]}"
    ne="${#EXCLUDED_KEYS[@]}"
    for ((i = 0; i < n; i++)); do
        key="${ENV_KEYS[$i]}"
        found=0
        for ((j = 0; j < nm; j++)); do
            if [ "${MANIFEST_NAMES[$j]}" = "$key" ]; then
                found=1
                break
            fi
        done
        if [ "$found" -eq 0 ]; then
            for ((j = 0; j < ne; j++)); do
                if [ "${EXCLUDED_KEYS[$j]}" = "$key" ]; then
                    found=1
                    break
                fi
            done
        fi
        if [ "$found" -eq 0 ]; then
            echo "not-deployed: $key" >&2
            violations=$((violations + 1))
        fi
    done
    if [ "$violations" -gt 0 ] && [ "$allow_undeployed" -eq 0 ]; then
        exit 3
    fi
}

hash_stdin() {
    # Hashes stdin only; the value never becomes an argument or echoed variable.
    "${HASH_CMD[@]}" | awk '{print $1}'
}

sync_key() {
    local key="$1" value="$2"
    local created=0 new_hash cur_hash
    if gcloud secrets describe "$key" --project="$project" >/dev/null 2>&1; then
        :
    else
        created=1
        gcloud secrets create "$key" --project="$project" --replication-policy=automatic >/dev/null
    fi
    new_hash="$(printf '%s' "$value" | hash_stdin)"
    if cur_hash="$(gcloud secrets versions access latest --secret="$key" --project="$project" 2>/dev/null | hash_stdin)"; then
        if [ "$new_hash" = "$cur_hash" ]; then
            echo "$key: unchanged"
            return 0
        fi
    fi
    printf '%s' "$value" | gcloud secrets versions add "$key" --project="$project" --data-file=- >/dev/null
    if [ "$created" -eq 1 ]; then
        echo "$key: created"
    else
        echo "$key: updated"
    fi
}

main() {
    local env_file="" project="" dry_run=0 allow_undeployed=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --dry-run)
                dry_run=1
                ;;
            --allow-undeployed)
                allow_undeployed=1
                ;;
            -h | --help)
                usage
                exit 0
                ;;
            *)
                if [ -z "$env_file" ]; then
                    env_file="$1"
                elif [ -z "$project" ]; then
                    project="$1"
                else
                    usage
                    exit 1
                fi
                ;;
        esac
        shift
    done

    if [ -z "$env_file" ] || [ -z "$project" ]; then
        usage
        exit 1
    fi
    if [ ! -f "$env_file" ] || [ ! -r "$env_file" ]; then
        echo "sync-secrets.sh: env file not readable: $env_file" >&2
        exit 1
    fi
    if [ ! -f "$MANIFEST" ]; then
        echo "sync-secrets.sh: manifest not found: $MANIFEST" >&2
        exit 1
    fi
    if [ ! -f "$EXCLUDED_FILE" ]; then
        echo "sync-secrets.sh: exclusion list not found: $EXCLUDED_FILE" >&2
        exit 1
    fi

    parse_manifest
    parse_excluded
    parse_env_file "$env_file"

    # Before touching GCP: every manifest secret must exist with a value.
    check_required_secrets
    check_preview_values
    guard_undeployed

    if [ "$dry_run" -eq 1 ]; then
        local i n="${#SECRET_KEYS[@]}"
        for ((i = 0; i < n; i++)); do
            echo "${SECRET_KEYS[$i]}: would-sync"
        done
        exit 0
    fi

    if command -v shasum >/dev/null 2>&1; then
        HASH_CMD=(shasum -a 256)
    else
        HASH_CMD=(sha256sum)
    fi

    local i n="${#SECRET_KEYS[@]}" key
    for ((i = 0; i < n; i++)); do
        key="${SECRET_KEYS[$i]}"
        if find_env_index "$key"; then
            sync_key "$key" "${ENV_VALUES[$REPLY_INDEX]}"
        fi
    done
}

main "$@"
