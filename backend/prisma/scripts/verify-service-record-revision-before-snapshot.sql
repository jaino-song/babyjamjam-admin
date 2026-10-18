DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_record_revision'
          AND column_name = 'before_snapshot'
          AND data_type = 'jsonb'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'service_record_revision.before_snapshot must exist as nullable jsonb';
    END IF;
END $$;
