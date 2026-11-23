DO $$
BEGIN
    IF (SELECT count(*) FROM pg_attribute
        WHERE attrelid = 'message_trigger_job'::regclass AND attnum > 0 AND NOT attisdropped
          AND NOT attnotnull AND NOT atthasdef
          AND attname IN ('recovery_reason', 'recovery_epoch', 'first_blocked_at',
                          'recovery_state', 'recovery_transition_status', 'next_check_at', 'original_job_id')) <> 7
    THEN
        RAISE EXCEPTION 'Expected seven nullable recovery columns without defaults';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('uq_message_trigger_job_original_job_id')
          AND indrelid = 'message_trigger_job'::regclass AND indisunique AND indisvalid
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('idx_message_trigger_job_recovery_due')
          AND indrelid = 'message_trigger_job'::regclass AND indisvalid AND indpred IS NOT NULL
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('idx_message_trigger_job_recovery_branch_due')
          AND indrelid = 'message_trigger_job'::regclass AND indisvalid AND indpred IS NOT NULL
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('idx_message_trigger_job_recovery_client')
          AND indrelid = 'message_trigger_job'::regclass AND indisvalid
    ) THEN
        RAISE EXCEPTION 'Missing service-record link recovery indexes';
    END IF;
    IF (SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'message_trigger_job'::regclass AND convalidated
          AND conname IN ('message_trigger_job_original_job_id_fkey', 'ck_message_trigger_job_record_link_recovery')) <> 2
    THEN
        RAISE EXCEPTION 'Missing service-record link recovery constraints';
    END IF;
END
$$;
