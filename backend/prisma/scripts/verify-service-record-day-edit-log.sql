DO $$
BEGIN
    IF to_regclass('public.service_record_day_edit_log') IS NULL THEN
        RAISE EXCEPTION 'service_record_day_edit_log must exist';
    END IF;
    IF to_regclass('public.idx_service_record_day_edit_log_branch_case_edited') IS NULL THEN
        RAISE EXCEPTION 'idx_service_record_day_edit_log_branch_case_edited must exist';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_day_edit_log_case_branch_fkey'
          AND conrelid = 'public.service_record_day_edit_log'::regclass
          AND contype = 'f'
    ) THEN
        RAISE EXCEPTION 'service_record_day_edit_log_case_branch_fkey must exist';
    END IF;
END $$;
