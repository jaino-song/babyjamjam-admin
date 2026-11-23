DO $$
DECLARE
    definition text;
    marker text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO STRICT definition
    FROM pg_constraint
    WHERE conrelid = 'message_trigger_job'::regclass
      AND conname = 'ck_message_trigger_job_record_link_recovery'
      AND contype = 'c' AND convalidated;

    FOREACH marker IN ARRAY ARRAY[
        'receipt-retry:', 'record-retry:', 'record_link_pre_booking',
        'live_unsigned_contract', 'missing_birthday', 'missing_current_contract',
        'current_contract_pdf_pending', 'receipt_recovery_not_proven', 'IS TRUE'
    ] LOOP
        IF strpos(definition, marker) = 0 THEN
            RAISE EXCEPTION 'Missing receipt recovery constraint marker %', marker;
        END IF;
    END LOOP;
END
$$;
