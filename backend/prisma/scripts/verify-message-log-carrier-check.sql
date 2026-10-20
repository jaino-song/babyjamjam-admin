DO $$
DECLARE
    expected_column RECORD;
BEGIN
    FOR expected_column IN
        SELECT * FROM (VALUES
            ('carrier_check_due_at', 'timestamp with time zone'),
            ('carrier_checked_at', 'timestamp with time zone'),
            ('carrier_result_state', 'character varying'),
            ('carrier_results', 'jsonb')
        ) AS t(column_name, data_type)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'message_log'
              AND column_name = expected_column.column_name
              AND data_type = expected_column.data_type
              AND is_nullable = 'YES'
        ) THEN
            RAISE EXCEPTION 'message_log.% is missing or incompatible', expected_column.column_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'message_log'
          AND indexname = 'idx_message_log_carrier_check_due'
    ) THEN
        RAISE EXCEPTION 'idx_message_log_carrier_check_due index is missing';
    END IF;
END $$;
