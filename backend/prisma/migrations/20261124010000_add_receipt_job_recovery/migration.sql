BEGIN;

ALTER TABLE message_trigger_job DROP CONSTRAINT IF EXISTS ck_message_trigger_job_record_link_recovery;
ALTER TABLE message_trigger_job ADD CONSTRAINT ck_message_trigger_job_record_link_recovery CHECK ((
            CASE
                WHEN original_job_id IS NOT NULL AND recovery_reason = 'record_link_pre_booking' THEN
                    original_job_id <> id AND dedupe_key = 'record-retry:' || original_job_id
                    AND branch_id IS NOT NULL AND rule_id = 'system:service_record_link'
                    AND template_key = 'SERVICE_RECORD_LINK' AND recipient_type = 'PRIMARY_EMPLOYEE'
                    AND recovery_reason = 'record_link_pre_booking' AND recovery_epoch IS NOT NULL
                    AND first_blocked_at IS NULL AND recovery_state IS NULL
                    AND recovery_transition_status IS NULL AND next_check_at IS NULL
                WHEN original_job_id IS NULL AND recovery_reason = 'record_link_pre_booking' THEN
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
                WHEN recovery_reason IN ('live_unsigned_contract', 'missing_birthday',
                    'missing_current_contract', 'current_contract_pdf_pending', 'receipt_recovery_not_proven') THEN
                    branch_id IS NOT NULL AND client_id IS NOT NULL
                    AND recipient_type = 'CLIENT' AND template_key = 'SERVICE_END_NOTICE'
                    AND CASE WHEN original_job_id IS NOT NULL THEN
                        original_job_id <> id AND dedupe_key = 'receipt-retry:' || original_job_id
                        AND recovery_reason <> 'receipt_recovery_not_proven' AND recovery_epoch IS NOT NULL
                        AND first_blocked_at IS NULL AND recovery_state IS NULL
                        AND recovery_transition_status IS NULL AND next_check_at IS NULL
                    ELSE
                        status = 'canceled' AND canceled_at IS NOT NULL AND first_blocked_at IS NOT NULL
                        AND dedupe_key NOT LIKE 'record-retry:%' AND dedupe_key NOT LIKE 'receipt-retry:%'
                        AND CASE recovery_state
                            WHEN 'eligible' THEN recovery_reason <> 'receipt_recovery_not_proven'
                                AND recovery_epoch IS NOT NULL AND next_check_at IS NOT NULL
                            WHEN 'admitted' THEN recovery_reason <> 'receipt_recovery_not_proven'
                                AND recovery_epoch IS NOT NULL AND next_check_at IS NULL
                            WHEN 'ineligible_terminal' THEN next_check_at IS NULL
                            ELSE false
                        END
                    END
                ELSE original_job_id IS NULL AND recovery_reason IS NULL AND recovery_epoch IS NULL AND first_blocked_at IS NULL AND recovery_state IS NULL
                    AND recovery_transition_status IS NULL AND next_check_at IS NULL
                    AND dedupe_key NOT LIKE 'record-retry:%' AND dedupe_key NOT LIKE 'receipt-retry:%'
            END
) IS TRUE);

COMMIT;
