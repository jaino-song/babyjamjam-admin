#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")/.."

# These are repository-owned SQL inputs. The replay owns the transaction so
# that neither a case-key cutover nor a retry can split the check and writes.
execute_sql() {
  printf 'EXECUTE $patch_sql$\n'
  sed -E '/^BEGIN(;| ISOLATION LEVEL REPEATABLE READ READ ONLY;)$/d; /^COMMIT;$/d' "$1"
  printf '\n$patch_sql$;\n'
}

case "${1:-}" in
  cases)
    legacy=prisma/migrations/20260713000000_add_client_service_record_case/migration.sql
    common=(prisma/migrations/20260713110000_align_service_record_case_schema/migration.sql
      prisma/scripts/verify-service-record-cases.sql)
    ;;
  prisma/migrations/20260902000000_repair_replacement_schedule_start_date/migration.sql|\
  prisma/migrations/20260903000000_add_employee_schedule_terminated_at/migration.sql)
    legacy="$1"
    common=()
    ;;
  verify-schedules)
    legacy=""
    common=(prisma/scripts/verify-replacement-schedule-start-date.sql)
    ;;
  *)
    echo 'Unknown service-record replay operation' >&2
    exit 1
    ;;
esac

# Finish rendering (and check all reads) before passing anything to Prisma.
sql="$(
  set -e
  printf "BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL search_path = public, pg_temp;\n"
  cat prisma/scripts/select-service-record-replay-layout.sql
  cat <<'SQL'
DO $replay$
BEGIN
    IF current_setting('bjj.service_record_replay_layout') = 'case' THEN
SQL
  execute_sql prisma/scripts/verify-baby-case-stage-before-release.sql
  printf 'SET LOCAL search_path = public, pg_temp;\n'
  if [[ -n "$legacy" ]]; then
    printf 'ELSE\n'
    execute_sql "$legacy"
  fi
  printf 'END IF;\n'
  for file in "${common[@]}"; do
    execute_sql "$file"
  done
  printf 'END\n$replay$;\nCOMMIT;\n'
)"

./scripts/run-prisma-db-execute.sh --schema prisma/schema.prisma --stdin <<< "$sql"
