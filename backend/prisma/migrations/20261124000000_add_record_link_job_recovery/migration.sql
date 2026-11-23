BEGIN;

ALTER TABLE message_trigger_job
    ADD COLUMN IF NOT EXISTS recovery_reason text,
    ADD COLUMN IF NOT EXISTS recovery_epoch timestamptz(3),
    ADD COLUMN IF NOT EXISTS first_blocked_at timestamptz(3),
    ADD COLUMN IF NOT EXISTS recovery_state text,
    ADD COLUMN IF NOT EXISTS recovery_transition_status text,
    ADD COLUMN IF NOT EXISTS next_check_at timestamptz(6),
    ADD COLUMN IF NOT EXISTS original_job_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_trigger_job_original_job_id
    ON message_trigger_job (original_job_id);

CREATE INDEX IF NOT EXISTS idx_message_trigger_job_recovery_due
    ON message_trigger_job (recovery_reason, recovery_state, next_check_at, id)
    INCLUDE (branch_id)
    WHERE recovery_epoch IS NOT NULL AND next_check_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_trigger_job_recovery_branch_due
    ON message_trigger_job (branch_id, recovery_reason, recovery_state, next_check_at, id)
    WHERE recovery_epoch IS NOT NULL AND next_check_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_trigger_job_recovery_client
    ON message_trigger_job (branch_id, client_id, recovery_reason, recovery_state)
    WHERE recovery_reason IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'message_trigger_job'::regclass
                   AND conname = 'message_trigger_job_original_job_id_fkey') THEN
        ALTER TABLE message_trigger_job ADD CONSTRAINT message_trigger_job_original_job_id_fkey
            FOREIGN KEY (original_job_id) REFERENCES message_trigger_job (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'message_trigger_job'::regclass
                   AND conname = 'ck_message_trigger_job_record_link_recovery') THEN
        ALTER TABLE message_trigger_job ADD CONSTRAINT ck_message_trigger_job_record_link_recovery CHECK ((
            CASE
                WHEN original_job_id IS NOT NULL THEN
                    original_job_id <> id AND dedupe_key = 'record-retry:' || original_job_id
                    AND branch_id IS NOT NULL AND rule_id = 'system:service_record_link'
                    AND template_key = 'SERVICE_RECORD_LINK' AND recipient_type = 'PRIMARY_EMPLOYEE'
                    AND recovery_reason = 'record_link_pre_booking' AND recovery_epoch IS NOT NULL
                    AND first_blocked_at IS NULL AND recovery_state IS NULL
                    AND recovery_transition_status IS NULL AND next_check_at IS NULL
                WHEN recovery_reason IS NOT NULL THEN
                    recovery_reason = 'record_link_pre_booking' AND status = 'canceled'
                    AND branch_id IS NOT NULL AND rule_id = 'system:service_record_link'
                    AND template_key = 'SERVICE_RECORD_LINK' AND recipient_type = 'PRIMARY_EMPLOYEE'
                    AND first_blocked_at IS NOT NULL
                    AND CASE recovery_state
                        WHEN 'awaiting_transition' THEN recovery_transition_status IS NULL AND next_check_at IS NULL
                        WHEN 'eligible' THEN recovery_epoch IS NOT NULL
                            AND recovery_transition_status IN ('waiting', 'active') AND next_check_at IS NOT NULL
                        WHEN 'ineligible_terminal' THEN next_check_at IS NULL
                        WHEN 'admitted' THEN recovery_epoch IS NOT NULL
                            AND recovery_transition_status IN ('waiting', 'active') AND next_check_at IS NULL
                        ELSE false
                    END
                ELSE recovery_epoch IS NULL AND first_blocked_at IS NULL AND recovery_state IS NULL
                    AND recovery_transition_status IS NULL AND next_check_at IS NULL
                    AND dedupe_key NOT LIKE 'record-retry:%'
            END
        ) IS TRUE);
    END IF;
END
$$;

COMMIT;
