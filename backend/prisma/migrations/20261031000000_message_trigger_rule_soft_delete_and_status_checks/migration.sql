-- Keep the column and filtered index on application rollback: an older app
-- cannot safely interpret deleted rules. Roll forward after the first delete.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "message_trigger_rule"
    ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

DROP INDEX IF EXISTS "uniq_message_trigger_rule_default";
CREATE UNIQUE INDEX "uniq_message_trigger_rule_default"
    ON "message_trigger_rule" ("branch_id", "template_key")
    WHERE "is_default" = true AND "deleted_at" IS NULL;

-- Application writers: MessageTriggerJobStatus; MessageLogEntity / mapper,
-- SMS delivery/retry and message-delivery controller; CarrierResultState.
-- canceled/needs_setup in message history are job projections, not log writes.
DO $$
DECLARE
    entry RECORD;
    violations BIGINT;
    offending_values TEXT[];
BEGIN
    FOR entry IN SELECT * FROM (VALUES
        ('message_trigger_job', 'message_trigger_job_status_check', 'status',
         'status IN (''pending'', ''processing'', ''dispatching'', ''sent'', ''failed'', ''needs_setup'', ''canceled'')'),
        ('message_log', 'message_log_status_check', 'status',
         'status IN (''pending'', ''sent'', ''failed'')'),
        ('message_log', 'message_log_carrier_result_state_check', 'carrier_result_state',
         'carrier_result_state IS NULL OR carrier_result_state IN (''delivered'', ''failed'', ''unconfirmed'', ''lookup_error'')')
    ) AS checks(table_name, constraint_name, column_name, predicate)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = to_regclass(format('%I', entry.table_name))
              AND conname = entry.constraint_name
        ) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                           entry.table_name, entry.constraint_name, entry.predicate);
        END IF;

        EXECUTE format('SELECT count(*) FROM %I WHERE NOT (%s)',
                       entry.table_name, entry.predicate) INTO violations;
        IF violations = 0 THEN
            EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I',
                           entry.table_name, entry.constraint_name);
        ELSE
            EXECUTE format('SELECT array_agg(value ORDER BY value) FROM (SELECT DISTINCT %I::text AS value FROM %I WHERE NOT (%s) ORDER BY value LIMIT 20) AS offending',
                           entry.column_name, entry.table_name, entry.predicate) INTO offending_values;
            RAISE EXCEPTION '%: % legacy row(s) violate the CHECK; offending values (at most 20): %',
                            entry.constraint_name, violations, offending_values;
        END IF;
    END LOOP;
END $$;

COMMIT;
