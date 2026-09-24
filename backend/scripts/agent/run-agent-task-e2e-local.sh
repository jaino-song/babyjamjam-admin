#!/usr/bin/env bash
# Run the isolated agent-task persistence E2E suite locally against a
# throwaway, disposable Postgres cluster on 127.0.0.1:55433.
#
# This suite is guarded (see
# backend/test/agent-e2e/runtime/agent-task-persistence.helper.ts) to refuse
# any DATABASE_URL/DIRECT_URL that is not EXACTLY
# postgresql://bjj_test@127.0.0.1:55433/bjj_conversation_test — no password,
# no query string, no fragment. That guard is intentional and this script
# never weakens it: it only stands up a database that satisfies it, runs the
# migrations + suite against that database alone, and tears it down.
#
# Usage:
#   bash backend/scripts/agent/run-agent-task-e2e-local.sh [extra jest args...]
#
# What it does:
#   1. Refuses to start if something is already listening on 127.0.0.1:55433.
#   2. Creates a temp dir and initializes a fresh Postgres data directory in it
#      (trust auth, local only).
#   3. Starts Postgres bound to 127.0.0.1:55433, waits for readiness, and
#      creates the bjj_conversation_test database owned by bjj_test.
#   4. Exports DATABASE_URL/DIRECT_URL pinned to that exact throwaway target,
#      re-asserting the literal value before every migrate/jest invocation.
#   5. Exports the same CI job-level env backend-ci.yml's auth-e2e job sets
#      (dummy secrets, no live services) — see .github/workflows/backend-ci.yml.
#   6. Reads ONLY the key names (never values) out of every env file
#      ConfigModule can load (backend/.env.local, backend/.env, and the repo
#      root .env.local/.env) and exports an EMPTY value for every key this
#      script does not already set itself, so the env-file fallback (backend/.env
#      holds the shared dev database address and real vendor credentials)
#      cannot fill in anything real behind this script's back. dotenv-style
#      loaders never override an already-exported variable, so an empty
#      exported value wins. A line it cannot parse aborts the run.
#   7. Runs `pnpm run db:migrate:deploy` then the isolated conversation-task
#      E2E suite (AGENT_E2E=1), copying CI's exact --testPathPatterns.
#   8. On exit (success, failure, INT or TERM) stops Postgres and removes the
#      temp data directory unconditionally.
#
# This script never touches the deterministic agent-runtime E2E suite (it
# needs Valkey + an auth seed and stays CI-only), never edits package.json,
# CI, jest config or the guard above, and never prints/stores any .env value.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

readonly PGHOST="127.0.0.1"
readonly PGPORT="55433"
readonly PGUSER="bjj_test"
readonly PGDATABASE="bjj_conversation_test"
readonly APPROVED_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"

log() {
    printf '[run-agent-task-e2e-local] %s\n' "$1" >&2
}

fail() {
    log "ERROR: $1"
    exit 1
}

# --- 1. Refuse to start if the fixed port is already occupied -------------

if command -v pg_isready >/dev/null 2>&1 \
    && pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
    fail "127.0.0.1:${PGPORT} is already in use (something is answering pg_isready there). Stop it first — the port is fixed because the persistence guard pins it; there is no override."
fi
if command -v lsof >/dev/null 2>&1 \
    && lsof -nP -iTCP:"$PGPORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "127.0.0.1:${PGPORT} is already in use (lsof sees a listener). Stop it first — the port is fixed because the persistence guard pins it; there is no override."
fi

for bin in initdb pg_ctl pg_isready createdb; do
    command -v "$bin" >/dev/null 2>&1 || fail "required binary '$bin' not found on PATH (expected e.g. Homebrew PostgreSQL 16/17 under /opt/homebrew/bin)"
done

# --- 2-3. Stand up a throwaway Postgres cluster ----------------------------

TMP_DIR="$(mktemp -d)"
PG_STARTED=0

cleanup() {
    local exit_code=$?
    if [[ "$PG_STARTED" == "1" ]]; then
        log "stopping throwaway Postgres"
        pg_ctl -D "$TMP_DIR/data" -m fast stop >/dev/null 2>&1 || true
    fi
    log "removing temp dir $TMP_DIR"
    rm -rf "$TMP_DIR"
    exit "$exit_code"
}
trap cleanup EXIT INT TERM

log "initializing throwaway Postgres data directory in $TMP_DIR"
initdb --auth=trust -U "$PGUSER" -D "$TMP_DIR/data" >"$TMP_DIR/initdb.log" 2>&1 \
    || { cat "$TMP_DIR/initdb.log" >&2; fail "initdb failed"; }

log "starting throwaway Postgres on ${PGHOST}:${PGPORT}"
pg_ctl -D "$TMP_DIR/data" \
    -o "-c listen_addresses=${PGHOST} -p ${PGPORT} -k ${TMP_DIR}" \
    -l "$TMP_DIR/pg.log" \
    start
PG_STARTED=1

log "waiting for Postgres readiness"
ready=0
for _ in $(seq 1 60); do
    if pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 0.5
done
[[ "$ready" == "1" ]] || { cat "$TMP_DIR/pg.log" >&2; fail "Postgres never became ready on ${PGHOST}:${PGPORT}"; }

log "creating database ${PGDATABASE}"
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"

# --- 4. Pin DATABASE_URL/DIRECT_URL to the exact approved target -----------

export DATABASE_URL="$APPROVED_URL"
export DIRECT_URL="$APPROVED_URL"

assert_approved_database_target() {
    [[ "${DATABASE_URL:-}" == "$APPROVED_URL" ]] || fail "DATABASE_URL drifted from the approved throwaway target"
    [[ "${DIRECT_URL:-}" == "$APPROVED_URL" ]] || fail "DIRECT_URL drifted from the approved throwaway target"
}

# --- 5. CI job-level env (dummy values only, nothing live) -----------------

export CI=true
export NODE_ENV=test
export TENANT_ISOLATION_MODE=observe
export VALKEY_URL="redis://127.0.0.1:6379"
export JWT_SECRET="local-agent-e2e-dummy-jwt-signing-key-32chars-min"
export AUTH_EMAIL_TOKEN_HMAC_SECRET="local-agent-e2e-dummy-email-hmac-secret-32chars"
export EMAIL_TRANSPORT=smtp
export SMTP_HOST=localhost
export SMTP_PORT=1025
export E2E_VENDOR_STUBS=1
export DEVELOPMENT_FRONTEND_URL="http://localhost:3000"
export DEVELOPMENT_MOBILE_FRONTEND_URL="http://localhost:3002"
export STORAGE_BOOTSTRAP_DISABLED=1
export AGENT_E2E=1

# Note: nothing listens on VALKEY_URL locally (no Docker/Valkey on this
# machine). The task-persistence suite this script targets does not need it;
# the deterministic agent-runtime suite that does need it stays CI-only.

# --- 6. Blank every other key backend/.env defines --------------------------
#
# ConfigModule's env-file loading never overrides an already-exported
# variable, so exporting an empty value here for every OTHER key that
# backend/.env defines guarantees the real shared-DB / vendor-credential
# values in that file can never reach the process — without ever reading or
# printing them.

# Every env file backend/app.module.ts ENV_FILE_PATHS can load when jest runs
# from backend/ (cwd-relative and __dirname-relative entries resolve to these).
readonly ENV_FILES=(
    "$BACKEND_DIR/.env.local"
    "$BACKEND_DIR/.env"
    "$BACKEND_DIR/../.env.local"
    "$BACKEND_DIR/../.env"
)
readonly SCRIPT_OWNED_KEYS=(
    DATABASE_URL DIRECT_URL
    CI NODE_ENV TENANT_ISOLATION_MODE VALKEY_URL
    JWT_SECRET AUTH_EMAIL_TOKEN_HMAC_SECRET
    EMAIL_TRANSPORT SMTP_HOST SMTP_PORT E2E_VENDOR_STUBS
    DEVELOPMENT_FRONTEND_URL DEVELOPMENT_MOBILE_FRONTEND_URL
    STORAGE_BOOTSTRAP_DISABLED AGENT_E2E
)

is_script_owned_key() {
    local candidate="$1"
    local owned
    for owned in "${SCRIPT_OWNED_KEYS[@]}"; do
        [[ "$candidate" == "$owned" ]] && return 0
    done
    return 1
}

# Parse key names the way dotenv does (optional leading whitespace and an
# optional `export ` prefix; blank and comment lines ignored). Any other
# assignment-looking line whose key is not a valid shell name cannot be
# blanked, so fail closed rather than let its value reach the process.
for env_file in "${ENV_FILES[@]}"; do
    [[ -f "$env_file" ]] || continue
    log "blanking every non-script-owned key declared in $(basename "$(dirname "$env_file")")/$(basename "$env_file") (names only, no values read)"
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
            key_name="${BASH_REMATCH[2]}"
            is_script_owned_key "$key_name" && continue
            export "$key_name"=""
        elif [[ "$line" =~ = ]]; then
            fail "cannot safely blank an entry in $env_file (unrecognised key shape); fix that line before running this script"
        fi
    done < "$env_file"
done

# --- 7. Migrate then run the isolated conversation-task E2E suite ----------

cd "$BACKEND_DIR"

assert_approved_database_target
log "running prisma migrate deploy against the throwaway database"
pnpm run db:migrate:deploy

assert_approved_database_target
log "running the isolated agent-task persistence E2E suite"
pnpm run test:agent-e2e --testPathPatterns='test/agent-e2e/runtime/agent-task-.*\.e2e\.spec\.ts$' "$@"

log "done"
