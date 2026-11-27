-- Operator only, before per-baby writes are enabled, with writers paused.
-- psql -X -v ON_ERROR_STOP=1 --single-transaction -f rollback-baby-record-foundation.sql
-- Revert the derived data. Leave the additive schema and migration ledger in place.
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public, pg_temp;
LOCK TABLE client, employee, employee_schedule, service_record_case,
    service_record_assignment, service_record_token, service_record_day, service_record,
    eformsign_doc, message_trigger_job, client_baby, service_record_team_slot,
    service_record_baby_assignment, service_record_job_member IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM service_record_job_member)
       OR EXISTS (SELECT 1 FROM message_trigger_job WHERE recipient_employee_id IS NOT NULL)
       OR EXISTS (
           SELECT 1 FROM client_baby b JOIN client c ON c.id = b.client_id
           WHERE NOT b.legacy_backfilled OR NOT b.active OR b.ordinal <> 1
              OR c.fetal_type IS DISTINCT FROM 'SINGLETON'
              OR c.fetal_confirmation IS DISTINCT FROM 'CONFIRMED'
       )
       OR EXISTS (SELECT 1 FROM service_record_team_slot WHERE NOT legacy_backfilled OR NOT active)
       OR EXISTS (
           SELECT 1 FROM service_record_baby_assignment
           WHERE NOT legacy_backfilled OR ended_at IS NOT NULL OR version <> 1
       ) THEN
        RAISE EXCEPTION 'Baby record foundation reversal requires unchanged preactivation backfill data';
    END IF;
END $$;

-- Disable only the foundation's immutable-history guards, under transaction
-- locks. All ownership FKs and legacy triggers stay enabled.
ALTER TABLE service_record_case DISABLE TRIGGER guard_record_case_baby;
ALTER TABLE service_record_baby_assignment DISABLE TRIGGER guard_record_assignment_history;
ALTER TABLE service_record_team_slot DISABLE TRIGGER guard_record_team_slot_identity;
ALTER TABLE client_baby DISABLE TRIGGER guard_client_baby_identity;

DELETE FROM service_record_baby_assignment WHERE legacy_backfilled;
DELETE FROM service_record_team_slot WHERE legacy_backfilled;
UPDATE service_record_case rc SET baby_id = NULL
FROM client_baby b WHERE rc.baby_id = b.id AND b.legacy_backfilled;
UPDATE client c SET fetal_type = NULL, fetal_confirmation = NULL
FROM client_baby b WHERE c.id = b.client_id AND b.legacy_backfilled;
DELETE FROM client_baby WHERE legacy_backfilled;

ALTER TABLE client_baby ENABLE TRIGGER guard_client_baby_identity;
ALTER TABLE service_record_team_slot ENABLE TRIGGER guard_record_team_slot_identity;
ALTER TABLE service_record_baby_assignment ENABLE TRIGGER guard_record_assignment_history;
ALTER TABLE service_record_case ENABLE TRIGGER guard_record_case_baby;
