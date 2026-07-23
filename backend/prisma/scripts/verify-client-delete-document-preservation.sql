DO $$
DECLARE
    relation_name TEXT;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY['eformsign_doc', 'service_record_case']
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = relation_name
              AND column_name = 'client_id'
              AND is_nullable = 'YES'
        ) THEN
            RAISE EXCEPTION '%.client_id must be nullable', relation_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_client_id_fkey'
          AND confdeltype = 'n'
          AND convalidated
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.client_id FK must be validated ON DELETE SET NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'service_record_case_client_id_fkey'
          AND confdeltype = 'n'
          AND convalidated
    ) THEN
        RAISE EXCEPTION 'service_record_case.client_id FK must be validated ON DELETE SET NULL';
    END IF;
END $$;
