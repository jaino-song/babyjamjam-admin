#!/usr/bin/env bash
# Requires installed PostgreSQL server binaries and the backend's Prisma CLI.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
pg_bin=${PG_BIN:-$(pg_config --bindir)}
scratch=$(mktemp -d /tmp/bjj-record-replay.XXXXXX)
cleanup() {
  if [[ -f "$scratch/data/postmaster.pid" ]]; then
    "$pg_bin/pg_ctl" -D "$scratch/data" -m fast -w stop >/dev/null
  fi
  find "$scratch" -depth -delete
}
trap cleanup EXIT

export PGHOST="$scratch" PGPORT=5432 PGUSER=replay_test PGDATABASE=replay
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGPASSWORD
export CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
export DATABASE_URL="postgresql://replay_test@localhost/replay?host=$scratch"
export DIRECT_URL="$DATABASE_URL"

"$pg_bin/initdb" -D "$scratch/data" -U "$PGUSER" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 >"$scratch/init.log"
"$pg_bin/pg_ctl" -D "$scratch/data" -o "-c listen_addresses='' -k $scratch" -l "$scratch/postgres.log" -w start >/dev/null
"$pg_bin/createdb" "$PGDATABASE"

sql() { "$pg_bin/psql" -XqAtv ON_ERROR_STOP=1 "$@"; }
replay() { ./scripts/replay-service-record-patch.sh "$@"; }
apply() {
  if ! sql -f "$1" >"$scratch/patch.log" 2>&1; then
    cat "$scratch/patch.log" >&2
    return 1
  fi
}
stage_check=prisma/scripts/verify-baby-case-stage-before-release.sql
apply "$stage_check"

for migration in prisma/migrations/*/migration.sql; do
  case "$migration" in
    */20260706100001_*/migration.sql)
      # PG18 creates catalog entries for NOT NULL; PG16 returns no rows here.
      # Align only those generated names before the historical rename checks.
      sql <<'SQL'
SELECT format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', conrelid::regclass, conname,
              replace(conname, 'alimtalk', 'message'))
FROM pg_constraint
WHERE contype = 'n' AND conrelid IN ('message_log'::regclass,
    'alimtalk_trigger_rule'::regclass, 'alimtalk_trigger_job'::regclass)
  AND conname LIKE 'alimtalk%'
\gexec
SQL
      ;;
    */20260713000000_*/migration.sql) replay cases ;;
    */20261126010000_*/migration.sql)
      "$pg_bin/createdb" --template="$PGDATABASE" fresh
      PGDATABASE=fresh apply "$migration"
      PGDATABASE=fresh apply "$stage_check"
      break
      ;;
  esac
  apply "$migration"
done

schedule_repair=prisma/migrations/20260902000000_repair_replacement_schedule_start_date/migration.sql
termination=prisma/migrations/20260903000000_add_employee_schedule_terminated_at/migration.sql
branch=00000000-0000-0000-0000-000000000001
sql -v branch="$branch" <<'SQL'
INSERT INTO branch (id, name, slug) VALUES (:'branch', 'QA-Replay', 'qa-replay');
INSERT INTO client (id, branch_id, name, voucher_client, start_date, end_date, duration)
VALUES (1, :'branch', 'QA-Replay family', false, '2026-01-01', '2026-01-10', 10);
INSERT INTO employee (id, branch_id, name, phone, grade) VALUES (1, :'branch', 'QA-Replay provider', 'synthetic', 'QA');
INSERT INTO employee_schedule (id, branch_id, client_id, primary_employee_id, work_address, start_date, end_date)
VALUES (1, :'branch', 1, 1, 'QA', '2026-01-01', '2026-01-05'),
       (2, :'branch', 1, 1, 'QA', '2026-01-01', '2026-01-10');
SQL
replay cases
replay "$schedule_repair"
replay "$termination"
replay verify-schedules
[[ $(sql -c 'SELECT count(*) FROM service_record_case') == 1 ]]
[[ $(sql -c 'SELECT start_date FROM service_record_assignment WHERE schedule_id = 2') == 2026-01-05 ]]

refuse_replay() {
  if replay "$1" >"$scratch/refusal.log" 2>&1 || ! grep -Fq "$2" "$scratch/refusal.log"; then
    cat "$scratch/refusal.log" >&2
    return 1
  fi
}
sql -c 'CREATE INDEX idx_record_case_client ON service_record_case (client_id)'
refuse_replay cases 'Legacy baby case key still present'
sql -c 'DROP INDEX idx_record_case_client'

apply prisma/scripts/stage-baby-case-keys.sql
sql -c 'ALTER INDEX uq_record_day_sched_session_unbound RENAME TO qa_missing_key'
refuse_replay cases 'Missing or incorrect staged baby case index'
sql -c 'ALTER INDEX qa_missing_key RENAME TO uq_record_day_sched_session_unbound'

sql -v branch="$branch" <<'SQL'
INSERT INTO client_baby (branch_id, client_id, ordinal) VALUES (:'branch', 1, 1), (:'branch', 1, 2);
UPDATE service_record_case SET baby_id = (SELECT id FROM client_baby WHERE ordinal = 1),
    status = 'COMPLETED', baby_name = 'QA-First signed record' WHERE client_id = 1;
INSERT INTO service_record_case (branch_id, client_id, baby_id, baby_name, updated_at)
SELECT branch_id, client_id, id, 'QA-Second record', now() FROM client_baby WHERE ordinal = 2;
INSERT INTO service_record_assignment (branch_id, service_record_case_id, schedule_id, employee_id,
    employee_name_snapshot, start_date, end_date, updated_at)
SELECT branch_id, id, 1, 1, 'QA-Sibling provider', '2026-01-02', '2026-01-04', now()
FROM service_record_case WHERE status <> 'COMPLETED';
INSERT INTO service_record (branch_id, service_record_case_id, schedule_id, baby_name, updated_at)
SELECT branch_id, id, 1, baby_name, now() FROM service_record_case;
INSERT INTO service_record_day (branch_id, service_record_case_id, case_session_index, schedule_id,
    session_index, service_date, client_signature, client_signed_at, locked, updated_at)
SELECT branch_id, id, 1, 1, 1, '2026-01-02', 'QA-Synthetic signature', '2026-01-02T08:00:00Z', true, now()
FROM service_record_case WHERE status = 'COMPLETED';
INSERT INTO service_record_day (branch_id, service_record_case_id, case_session_index, schedule_id,
    session_index, service_date, updated_at)
SELECT branch_id, id, 1, 1, 1, '2026-01-02', now() FROM service_record_case WHERE status <> 'COMPLETED';
INSERT INTO service_record_token (branch_id, service_record_case_id, schedule_id, employee_id,
    link_token_hash, access_token_hash, expected_phone_hash, verified_at, expires_at)
SELECT branch_id, id, 1, 1, md5(id::text), md5(id::text || 'access'), md5(id::text || 'phone'),
    now(), now() + interval '2 days' FROM service_record_case WHERE status = 'COMPLETED';
-- The scalar handover repair would rewrite this schedule on its next replay.
UPDATE employee_schedule SET start_date = '2026-01-03' WHERE id = 2;
SQL

fingerprint() {
  local table
  for table in "$@"; do
    sql -c "SELECT count(*), md5(jsonb_agg(to_jsonb(row) ORDER BY id)::text) FROM $table row"
  done
}
record_tables=(service_record_case service_record service_record_assignment service_record_day service_record_token)
before=$(fingerprint employee_schedule "${record_tables[@]}")
legacy_case_patch=prisma/migrations/20260713000000_add_client_service_record_case/migration.sql
if sql -f "$legacy_case_patch" >"$scratch/refusal.log" 2>&1 ||
  ! grep -Fq 'service_record_case_client_id_key' "$scratch/refusal.log"; then
  cat "$scratch/refusal.log" >&2
  exit 1
fi

replay_all() {
  replay cases
  replay "$schedule_repair"
  replay "$termination"
  replay verify-schedules
}
replay_all
replay_all
[[ $(fingerprint employee_schedule "${record_tables[@]}") == "$before" ]]

# An ordinary client update leaves both live schedules unflagged.
records_before=$(fingerprint "${record_tables[@]}")
sql -c "UPDATE client SET service_status = 'terminated' WHERE id = 1"
refuse_replay verify-schedules '2 schedule(s) of terminated clients are missing terminated_at'
replay_all
[[ $(sql <<'SQL'
SELECT count(*) FROM employee_schedule
WHERE client_id = 1 AND terminated_at = '2026-01-10'::date::timestamptz
  AND (id, start_date, end_date) IN
    ((1, DATE '2026-01-01', DATE '2026-01-05'), (2, DATE '2026-01-03', DATE '2026-01-10'));
SQL
) == 2 ]]
[[ $(fingerprint "${record_tables[@]}") == "$records_before" ]]

# The old early-termination writer could also leave an inverted schedule.
# Preserve the original termination date, even though the client has a later end date.
sql -c "UPDATE employee_schedule SET end_date = '2025-12-31', terminated_at = NULL WHERE id = 1"
refuse_replay verify-schedules '1 employee_schedule row(s) have an inverted date range'
replay_all
[[ $(sql <<'SQL'
SELECT count(*) FROM employee_schedule
WHERE client_id = 1 AND (id, start_date, end_date, terminated_at) IN (
  (1, DATE '2026-01-01', DATE '2026-01-01', DATE '2025-12-31'::timestamptz),
  (2, DATE '2026-01-03', DATE '2026-01-10', DATE '2026-01-10'::timestamptz)
);
SQL
) == 2 ]]
[[ $(fingerprint "${record_tables[@]}") == "$records_before" ]]
after_healing=$(fingerprint employee_schedule "${record_tables[@]}")
replay_all
[[ $(fingerprint employee_schedule "${record_tables[@]}") == "$after_healing" ]]

[[ $(sql -c 'SELECT count(*) FROM service_record_day WHERE schedule_id = 1 AND session_index = 1') == 2 ]]
[[ $(sql <<'SQL'
SELECT count(*) FROM service_record_token t
JOIN service_record_day d ON d.service_record_case_id = t.service_record_case_id AND d.branch_id = t.branch_id
WHERE t.link_token_hash = md5(d.service_record_case_id::text)
  AND t.access_token_hash = md5(d.service_record_case_id::text || 'access')
  AND t.active AND t.revoked_at IS NULL AND t.verified_at IS NOT NULL AND t.expires_at > now()
  AND d.client_signed_at IS NOT NULL AND d.locked;
SQL
) == 1 ]]
apply "$stage_check"

sql <<'SQL'
DO $$
DECLARE conflicting_index text;
BEGIN
    INSERT INTO service_record_day (branch_id, service_record_case_id, schedule_id, session_index,
        service_date, updated_at)
    SELECT branch_id, service_record_case_id, schedule_id, session_index, service_date, now()
    FROM service_record_day WHERE client_signed_at IS NOT NULL;
    RAISE EXCEPTION 'Expected a same-case duplicate day to be rejected';
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS conflicting_index = CONSTRAINT_NAME;
    IF conflicting_index <> 'uq_record_day_sched_case_session' THEN
        RAISE;
    END IF;
END $$;
SQL
echo 'Service-record replay passed on disposable PostgreSQL (fresh, singleton, staged siblings, corrupt stage).'
