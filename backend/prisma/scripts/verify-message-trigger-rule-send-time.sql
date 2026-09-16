DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'message_trigger_rule'
          AND column_name = 'send_time'
          AND data_type = 'character varying'
          AND character_maximum_length = 5
          AND is_nullable = 'NO'
          AND column_default = '''09:00''::character varying'
    ) THEN
        RAISE EXCEPTION 'message_trigger_rule.send_time schema is missing or incompatible';
    END IF;
    IF EXISTS (SELECT 1 FROM message_trigger_rule WHERE send_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
        RAISE EXCEPTION 'message_trigger_rule.send_time contains invalid times';
    END IF;
END $$;
