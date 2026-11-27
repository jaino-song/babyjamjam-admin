#!/usr/bin/env bash
# Runs the real migrations up to the singleton layout on a private Unix socket.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
pg_bin=${PG_BIN:-$(pg_config --bindir)}
scratch=$(mktemp -d /tmp/bjj-case-cutover.XXXXXX)
cleanup() {
  if [[ -f "$scratch/data/postmaster.pid" ]]; then
    "$pg_bin/pg_ctl" -D "$scratch/data" -m fast -w stop >/dev/null
  fi
  find "$scratch" -depth -delete
}
trap cleanup EXIT
export PATH="$pg_bin:$PATH"
export PGHOST="$scratch" PGPORT=5432 PGUSER=case_cutover_test PGDATABASE=case_cutover
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGPASSWORD PGAPPNAME
initdb -D "$scratch/data" -U "$PGUSER" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 >"$scratch/init.log"
pg_ctl -D "$scratch/data" -o "-c listen_addresses='' -k $scratch" -l "$scratch/postgres.log" -w start >/dev/null
createdb "$PGDATABASE"

sql() { psql -XqAtv ON_ERROR_STOP=1 "$@"; }
apply() {
  if ! sql -f "$1" >"$scratch/patch.log" 2>&1; then
    cat "$scratch/patch.log" >&2
    return 1
  fi
}
for migration in prisma/migrations/*/migration.sql; do
  case "$migration" in
    */20260706100001_*/migration.sql)
      # Match the existing replay regression's PG18 catalog compatibility.
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
    */20261126010000_*/migration.sql) break ;;
  esac
  apply "$migration"
done

branch=00000000-0000-0000-0000-000000000001
sql -v branch="$branch" <<'SQL'
INSERT INTO branch (id, name, slug) VALUES (:'branch', 'QA-Cutover', 'qa-cutover');
INSERT INTO client (id, branch_id, name, voucher_client, start_date, end_date, duration)
VALUES (1, :'branch', 'QA-Cutover family', false, '2026-01-01', '2026-01-10', 10);
INSERT INTO employee (id, branch_id, name, phone, grade) VALUES (1, :'branch', 'QA-Cutover provider', 'synthetic', 'QA');
INSERT INTO employee_schedule (id, branch_id, client_id, primary_employee_id, work_address, start_date, end_date)
VALUES (1, :'branch', 1, 1, 'QA', '2026-01-01', '2026-01-10');

INSERT INTO client_baby (branch_id, client_id, ordinal) VALUES (:'branch', 1, 1), (:'branch', 1, 2);
INSERT INTO service_record_case (branch_id, client_id, baby_id, status, updated_at)
SELECT branch_id, client_id, id, 'COMPLETED', now() FROM client_baby WHERE ordinal = 1;
INSERT INTO service_record_assignment (branch_id, service_record_case_id, schedule_id, employee_id,
    employee_name_snapshot, start_date, end_date, updated_at)
SELECT branch_id, id, 1, 1, 'QA-Cutover provider', '2026-01-01', '2026-01-10', now() FROM service_record_case;
INSERT INTO service_record_day (branch_id, service_record_case_id, case_session_index, schedule_id,
    session_index, service_date, client_signature, client_signed_at, locked, updated_at)
SELECT branch_id, id, n, 1, n, DATE '2026-01-01' + n, 'QA-Synthetic signature', '2026-01-03T08:00:00Z', true, now()
FROM service_record_case CROSS JOIN generate_series(1, 2) n;
INSERT INTO service_record_token (branch_id, service_record_case_id, schedule_id, employee_id,
    link_token_hash, access_token_hash, expected_phone_hash, verified_at, expires_at)
SELECT branch_id, id, 1, 1, md5(id::text), md5(id::text || 'access'), md5(id::text || 'phone'),
    now(), now() + interval '2 days' FROM service_record_case;

INSERT INTO message_trigger_rule (id, name, template_key, event_type, offset_type, recipient_type, updated_at)
VALUES ('system:service_record_link', 'QA-Record link', 'SERVICE_RECORD_LINK', 'service_start', 'same_day', 'PRIMARY_EMPLOYEE', now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO message_trigger_job (id, branch_id, rule_id, scheduled_for, client_id, employee_schedule_id,
    recipient_type, template_key, dedupe_key, updated_at)
VALUES ('qa-pending', :'branch', 'system:service_record_link', now(), 1, 1,
    'PRIMARY_EMPLOYEE', 'SERVICE_RECORD_LINK', 'qa-pending', now());
SQL

legacy_patch=prisma/migrations/20260713000000_add_client_service_record_case/migration.sql
cat >"$scratch/old-writer.sql" <<'SQL'
-- Historical singleton header conflict target emitted by the old writer.
INSERT INTO service_record (branch_id, service_record_case_id, schedule_id, baby_name, updated_at)
SELECT branch_id, id, 1, 'QA-First', now() FROM service_record_case WHERE client_id = 1
ON CONFLICT (schedule_id) DO UPDATE SET baby_name = EXCLUDED.baby_name;
SQL
apply "$scratch/old-writer.sql"
record_fingerprint() {
  sql <<'SQL'
SELECT md5(to_jsonb(c)::text),
       (SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY case_session_index)::text)
        FROM service_record_day d WHERE d.service_record_case_id = c.id),
       (SELECT md5(to_jsonb(t)::text) FROM service_record_token t WHERE t.service_record_case_id = c.id)
FROM service_record_case c WHERE c.status = 'COMPLETED';
SQL
}

cat >"$scratch/claim.sql" <<'SQL'
UPDATE message_trigger_job SET status = 'processing', claim_token = 'qa-claim',
    processing_deadline_at = now() + interval '1 minute'
WHERE id = 'qa-pending' AND status = 'pending';
SQL
release_claim() {
  sql -c "UPDATE message_trigger_job SET status = 'pending', claim_token = NULL,
          processing_deadline_at = NULL WHERE id = 'qa-pending';"
}
renew() {
  sql -c "UPDATE scheduler_lease SET holder_id = 'lightnode', instance_id = 'qa-rehearsal-instance',
          acquired_at = LEAST(acquired_at, now()), renewed_at = now(), expires_at = now() + interval '90s'
          WHERE name = 'background-owner';"
}
layout() {
  sql <<'SQL'
SELECT count(*) FILTER (WHERE indexname IN (
           'service_record_case_client_id_key', 'service_record_schedule_id_key',
           'service_record_assignment_schedule_id_key', 'service_record_day_schedule_id_session_index_key')),
       count(*) FILTER (WHERE indexname IN (
           'uq_record_hdr_sched_case', 'uq_record_asn_sched_case', 'uq_record_day_sched_case_session',
           'uq_record_hdr_sched_unbound', 'uq_record_day_sched_session_unbound',
           'uq_record_case_unbound_client', 'idx_record_case_client'))
FROM pg_indexes WHERE schemaname = 'public';
SQL
}
legacy_unchanged() {
  [[ $(layout) == '4|0' ]]
  [[ $(sql -c "SELECT status FROM message_trigger_job WHERE id = 'qa-pending'") == pending ]]
}
refuse() {
  local expected="$1"
  shift
  if "$@" >"$scratch/refusal.log" 2>&1 || ! grep -Fq "$expected" "$scratch/refusal.log"; then
    cat "$scratch/refusal.log" >&2
    return 1
  fi
}
cutover() { ./scripts/cutover-baby-case-keys.sh "$@"; }
check() { apply prisma/scripts/verify-baby-case-stage-before-release.sql; }

refuse 'freshly renewed LightNode' cutover apply
legacy_unchanged
renew
cutover rehearse
legacy_unchanged
apply "$scratch/old-writer.sql"

apply "$scratch/claim.sql"
refuse 'Outstanding service-record link claim' cutover apply
release_claim
legacy_unchanged
for state in prepared started uncertain; do
  sql -v state="$state" -v branch="$branch" <<'SQL'
INSERT INTO message_log (branch_id, provider, template_key, receiver, message_body, provider_acceptance_state, updated_at)
VALUES (:'branch', 'aligo_sms', 'service_record_link_sms', 'synthetic', 'QA-Try', :'state', now());
SQL
  refuse 'Outstanding or uncertain service-record SMS attempt' cutover apply
  sql -c "DELETE FROM message_log WHERE receiver = 'synthetic'"
  legacy_unchanged
done
sql -c "UPDATE service_record_case SET status = 'FINALIZING'"
refuse 'Outstanding or uncertain service-record document attempt' cutover apply
sql -c "UPDATE service_record_case SET status = 'COMPLETED'"
legacy_unchanged

sql <<'SQL'
-- Prisma ledger shape. Manual SQL replay normally has no ledger row here.
CREATE TABLE _prisma_migrations (
    id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
    migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0
);
INSERT INTO _prisma_migrations (id, checksum, migration_name) VALUES ('qa-ledger', 'qa', 'qa_patch');
SQL
refuse 'Active, failed or conflicting Prisma migration ledger entry' cutover apply
sql -c "UPDATE _prisma_migrations SET finished_at = now(), migration_name = '20261126010000_baby_case_keys'"
refuse 'Active, failed or conflicting Prisma migration ledger entry' cutover apply
sql -c "UPDATE _prisma_migrations SET finished_at = NULL, rolled_back_at = now()"
legacy_unchanged

sql -c 'CREATE UNIQUE INDEX qa_duplicate_singleton_key ON service_record(schedule_id)'
refuse 'Unexpected duplicate global key' cutover apply
sql -c 'DROP INDEX qa_duplicate_singleton_key'
legacy_unchanged

fixture_before=$(record_fingerprint)

# Additional sessions coordinate through advisory locks used only in the
# disposable test. Await actual waiting state instead of a fixed sleep.
wait_for() {
  local condition="$1"
  for ((i=0; i<100; i++)); do
    [[ $(sql -c "SELECT EXISTS ($condition)") == t ]] && return
    sleep 0.025
  done
  echo "Timed out waiting for fixture lock: $condition" >&2
  return 1
}

mkfifo "$scratch/session"
PGAPPNAME=qa-blocker sql <"$scratch/session" >"$scratch/blocker.log" 2>&1 &
blocker=$!
exec 3>"$scratch/session"
send() { printf '%s\n' "$1" >&3; }

send 'BEGIN;'
send 'UPDATE service_record SET baby_name = baby_name;'
wait_for "SELECT 1 FROM pg_stat_activity WHERE application_name = 'qa-blocker' AND state = 'idle in transaction' AND query LIKE 'UPDATE service_record %'"
refuse 'could not obtain lock' cutover apply
send 'ROLLBACK;'
wait_for "SELECT 1 FROM pg_stat_activity WHERE application_name = 'qa-blocker' AND state = 'idle'"
legacy_unchanged

sql <<'SQL'
CREATE FUNCTION qa_pause_after_index() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
    -- Use the complete server statement deadline on the watchdog path and
    -- give the multi-session assertions time to run on slower machines.
    IF current_setting('qa.cutover_pause', true) = 'long' THEN
        PERFORM set_config('lock_timeout', '0', true);
    END IF;
    PERFORM pg_advisory_xact_lock(81274591);
END $$;
CREATE EVENT TRIGGER qa_pause_after_index ON ddl_command_end WHEN TAG IN ('CREATE INDEX')
EXECUTE FUNCTION qa_pause_after_index();
SQL
await_pause() {
  wait_for "SELECT 1 FROM pg_stat_activity WHERE application_name = 'bjj-baby-case-key-cutover' AND wait_event = 'advisory'"
}
hold_stage() {
  send 'SELECT pg_advisory_lock(81274591);'
  wait_for "SELECT 1 FROM pg_stat_activity WHERE application_name = 'qa-blocker' AND query LIKE 'SELECT pg_advisory_lock%' AND state = 'idle'"
}
release_stage() { send 'SELECT pg_advisory_unlock(81274591);'; }

# A real stage has already entered CREATE INDEX when its advisory lock waits.
# The test stall can outlast the server lock timeout, which must roll back.
renew
hold_stage
cutover apply >"$scratch/timeout.log" 2>&1 &
attempt=$!
await_pause
if wait "$attempt" || ! grep -Fq 'lock timeout' "$scratch/timeout.log"; then
  cat "$scratch/timeout.log" >&2
  exit 1
fi
release_stage
legacy_unchanged
apply "$scratch/old-writer.sql"

# An index build that exceeds the server statement deadline also rolls back.
hold_stage
PGOPTIONS='-c qa.cutover_pause=long' refuse 'statement timeout' cutover apply
release_stage
legacy_unchanged

# Stop the client mid-stage. A server-side timeout still unwinds the fence.
hold_stage
PGOPTIONS='-c qa.cutover_pause=long' ./scripts/cutover-baby-case-keys.sh apply >"$scratch/disconnect.log" 2>&1 &
attempt=$!
await_pause
kill -KILL "$attempt"
wait "$attempt" 2>/dev/null || true
wait_for "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'bjj-baby-case-key-cutover')"
release_stage
legacy_unchanged

# A change to the real lease row after staging began invalidates the result.
hold_stage
PGOPTIONS='-c qa.cutover_pause=long' cutover apply >"$scratch/owner-change.log" 2>&1 &
attempt=$!
await_pause
sql -c "UPDATE scheduler_lease SET instance_id = 'qa-replacement-instance' WHERE name = 'background-owner'"
release_stage
if wait "$attempt" || ! grep -Fq 'ownership changed or became stale' "$scratch/owner-change.log"; then
  cat "$scratch/owner-change.log" >&2
  exit 1
fi
legacy_unchanged

# Damage a retained index inside the stage transaction to prove that a
# failure of the post-stage verifier undoes the DDL as well as the fence.
sql <<'SQL'
CREATE FUNCTION qa_damage_stage() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
    IF to_regclass('public.uniq_service_record_day_case_session') IS NOT NULL THEN
        ALTER INDEX public.uniq_service_record_day_case_session RENAME TO qa_damaged_index;
    END IF;
END $$;
CREATE EVENT TRIGGER qa_damage_stage ON ddl_command_end WHEN TAG IN ('CREATE INDEX')
EXECUTE FUNCTION qa_damage_stage();
SQL
renew
refuse 'Missing or incorrect staged baby case index' cutover apply
legacy_unchanged
[[ $(sql -c "SELECT to_regclass('public.uniq_service_record_day_case_session') IS NOT NULL") == t ]]
sql -c 'DROP EVENT TRIGGER qa_damage_stage'

# Pause again, test actual singleton writer/replay and dispatch admission
# using short client lock deadlines, then commit with a genuine concurrent
# renewal of the disposable lease row.
renew
hold_stage
PGOPTIONS='-c qa.cutover_pause=long' cutover apply >"$scratch/success.log" 2>&1 &
attempt=$!
await_pause
PGOPTIONS='-c lock_timeout=70ms' refuse 'lock timeout' sql -f "$scratch/old-writer.sql"
PGOPTIONS='-c lock_timeout=70ms' refuse 'lock timeout' sql -f "$legacy_patch"
PGOPTIONS='-c lock_timeout=70ms' refuse 'lock timeout' sql -f "$scratch/claim.sql"
refuse 'could not obtain lock' cutover apply
[[ $(sql -c "SELECT status FROM message_trigger_job WHERE id = 'qa-pending'") == pending ]]
sql -c "UPDATE branch SET name = name WHERE slug = 'qa-cutover'"
renew
release_stage
if ! wait "$attempt"; then
  cat "$scratch/success.log" >&2
  exit 1
fi
cat "$scratch/success.log"
exec 3>&-
wait "$blocker"
check
[[ $(layout) == '0|7' ]]
refuse 'Expected the complete singleton case-key layout' cutover apply
refuse 'no unique or exclusion constraint' sql -f "$scratch/old-writer.sql"

sql -v branch="$branch" <<'SQL'
BEGIN;
INSERT INTO service_record_case (branch_id, client_id, baby_id, updated_at)
SELECT branch_id, client_id, id, now() FROM client_baby WHERE ordinal = 2
ON CONFLICT (baby_id) DO NOTHING;
INSERT INTO service_record_assignment (branch_id, service_record_case_id, schedule_id, employee_id,
    employee_name_snapshot, start_date, end_date, updated_at)
SELECT c.branch_id, c.id, 1, 1, 'QA-Cutover provider', '2026-01-01', '2026-01-10', now()
FROM service_record_case c JOIN client_baby b ON b.id = c.baby_id WHERE b.ordinal = 2
ON CONFLICT (schedule_id, service_record_case_id) DO NOTHING;
INSERT INTO service_record (branch_id, service_record_case_id, schedule_id, baby_name, updated_at)
SELECT c.branch_id, c.id, 1, 'QA-Second', now() FROM service_record_case c
JOIN client_baby b ON b.id = c.baby_id WHERE b.ordinal = 2
ON CONFLICT (schedule_id, service_record_case_id) DO UPDATE SET baby_name = EXCLUDED.baby_name;
INSERT INTO service_record_day (branch_id, service_record_case_id, case_session_index, schedule_id,
    session_index, service_date, updated_at)
SELECT c.branch_id, c.id, 1, 1, 1, DATE '2026-01-02', now() FROM service_record_case c
JOIN client_baby b ON b.id = c.baby_id WHERE b.ordinal = 2
ON CONFLICT (schedule_id, service_record_case_id, session_index) DO NOTHING;
INSERT INTO service_record_team_slot (branch_id, client_id, schedule_id, employee_id, slot)
VALUES (:'branch', 1, 1, 1, 1);
INSERT INTO service_record_baby_assignment (branch_id, client_id, baby_id, schedule_id, team_slot_id, employee_id)
SELECT b.branch_id, b.client_id, b.id, s.schedule_id, s.id, s.employee_id
FROM client_baby b JOIN service_record_team_slot s USING (branch_id, client_id);
INSERT INTO message_trigger_job (id, branch_id, rule_id, scheduled_for, client_id, employee_schedule_id,
    recipient_type, recipient_employee_id, template_key, dedupe_key, updated_at)
VALUES ('qa-group', :'branch', 'system:service_record_link', now(), 1, 1,
    'PRIMARY_EMPLOYEE', 1, 'SERVICE_RECORD_LINK', 'qa-group', now());
INSERT INTO service_record_job_member (job_id, service_record_case_id, branch_id, client_id, schedule_id,
    baby_id, employee_id, assignment_version)
SELECT 'qa-group', c.id, a.branch_id, a.client_id, a.schedule_id, a.baby_id, a.employee_id, a.version
FROM service_record_baby_assignment a JOIN service_record_case c ON c.baby_id = a.baby_id;
COMMIT;
SQL
[[ $(sql <<'SQL'
SELECT
    (SELECT count(*) FROM service_record_job_member WHERE job_id = 'qa-group'),
    (SELECT count(*) FROM service_record_day d
     JOIN service_record_case c ON c.id = d.service_record_case_id
     JOIN client_baby b ON b.id = c.baby_id AND b.ordinal = 1
     JOIN service_record_token t ON t.service_record_case_id = c.id
     WHERE c.status = 'COMPLETED' AND d.client_signed_at IS NOT NULL AND d.locked
       AND d.client_signature = 'QA-Synthetic signature'
       AND t.active AND t.revoked_at IS NULL AND t.verified_at IS NOT NULL AND t.expires_at > now()
       AND t.link_token_hash = md5(c.id::text)),
    (SELECT count(*) FROM service_record_day WHERE schedule_id = 1 AND session_index = 1),
    (SELECT count(*) FROM message_log);
SQL
) == '2|2|2|0' ]]
[[ $(record_fingerprint) == "$fixture_before" ]]
refuse 'could not create unique index' sql -c 'CREATE UNIQUE INDEX service_record_schedule_id_key ON service_record (schedule_id)'
check
echo 'Disposable PostgreSQL cutover passed: drain, refusals, timeout, disconnect, rollback, live renewal and sibling records.'
