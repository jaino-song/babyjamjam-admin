DO $$
DECLARE
    definition text;
    -- Canonical pg_get_constraintdef(oid, false) from PostgreSQL 16 with the
    -- approved receipt recovery migration applied.
    expected constant text := $check$CHECK ((
CASE
    WHEN ((original_job_id IS NOT NULL) AND (recovery_reason = 'record_link_pre_booking'::text)) THEN ((original_job_id <> id) AND (dedupe_key = ('record-retry:'::text || original_job_id)) AND (branch_id IS NOT NULL) AND (rule_id = 'system:service_record_link'::text) AND (template_key = 'SERVICE_RECORD_LINK'::text) AND (recipient_type = 'PRIMARY_EMPLOYEE'::text) AND (recovery_reason = 'record_link_pre_booking'::text) AND (recovery_epoch IS NOT NULL) AND (first_blocked_at IS NULL) AND (recovery_state IS NULL) AND (recovery_transition_status IS NULL) AND (next_check_at IS NULL))
    WHEN ((original_job_id IS NULL) AND (recovery_reason = 'record_link_pre_booking'::text)) THEN ((recovery_reason = 'record_link_pre_booking'::text) AND (status = 'canceled'::text) AND (branch_id IS NOT NULL) AND (rule_id = 'system:service_record_link'::text) AND (template_key = 'SERVICE_RECORD_LINK'::text) AND (recipient_type = 'PRIMARY_EMPLOYEE'::text) AND (first_blocked_at IS NOT NULL) AND
    CASE recovery_state
        WHEN 'awaiting_transition'::text THEN ((recovery_transition_status IS NULL) AND (next_check_at IS NULL))
        WHEN 'eligible'::text THEN ((recovery_epoch IS NOT NULL) AND (recovery_transition_status = ANY (ARRAY['waiting'::text, 'active'::text])) AND (next_check_at IS NOT NULL))
        WHEN 'ineligible_terminal'::text THEN (next_check_at IS NULL)
        WHEN 'admitted'::text THEN ((recovery_epoch IS NOT NULL) AND (recovery_transition_status = ANY (ARRAY['waiting'::text, 'active'::text])) AND (next_check_at IS NULL))
        ELSE false
    END)
    WHEN (recovery_reason = ANY (ARRAY['live_unsigned_contract'::text, 'missing_birthday'::text, 'missing_current_contract'::text, 'current_contract_pdf_pending'::text, 'receipt_recovery_not_proven'::text])) THEN ((branch_id IS NOT NULL) AND (client_id IS NOT NULL) AND (recipient_type = 'CLIENT'::text) AND (template_key = 'SERVICE_END_NOTICE'::text) AND
    CASE
        WHEN (original_job_id IS NOT NULL) THEN ((original_job_id <> id) AND (dedupe_key = ('receipt-retry:'::text || original_job_id)) AND (recovery_reason <> 'receipt_recovery_not_proven'::text) AND (recovery_epoch IS NOT NULL) AND (first_blocked_at IS NULL) AND (recovery_state IS NULL) AND (recovery_transition_status IS NULL) AND (next_check_at IS NULL))
        ELSE ((status = 'canceled'::text) AND (canceled_at IS NOT NULL) AND (first_blocked_at IS NOT NULL) AND (dedupe_key !~~ 'record-retry:%'::text) AND (dedupe_key !~~ 'receipt-retry:%'::text) AND
        CASE recovery_state
            WHEN 'eligible'::text THEN ((recovery_reason <> 'receipt_recovery_not_proven'::text) AND (recovery_epoch IS NOT NULL) AND (next_check_at IS NOT NULL))
            WHEN 'admitted'::text THEN ((recovery_reason <> 'receipt_recovery_not_proven'::text) AND (recovery_epoch IS NOT NULL) AND (next_check_at IS NULL))
            WHEN 'ineligible_terminal'::text THEN (next_check_at IS NULL)
            ELSE false
        END)
    END)
    ELSE ((original_job_id IS NULL) AND (recovery_reason IS NULL) AND (recovery_epoch IS NULL) AND (first_blocked_at IS NULL) AND (recovery_state IS NULL) AND (recovery_transition_status IS NULL) AND (next_check_at IS NULL) AND (dedupe_key !~~ 'record-retry:%'::text) AND (dedupe_key !~~ 'receipt-retry:%'::text))
END IS TRUE))$check$;
BEGIN
    SELECT pg_get_constraintdef(oid, false) INTO definition
    FROM pg_constraint
    WHERE conrelid = 'public.message_trigger_job'::regclass
      AND conname = 'ck_message_trigger_job_record_link_recovery'
      AND contype = 'c' AND convalidated;

    IF definition IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'Receipt recovery CHECK definition mismatch';
    END IF;
END
$$;
