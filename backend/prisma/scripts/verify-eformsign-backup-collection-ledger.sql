DO $$
DECLARE
    api_role text;
    ledger_table text;
BEGIN
    IF to_regclass('public.eformsign_backup_collection_run') IS NULL THEN
        RAISE EXCEPTION 'eformsign_backup_collection_run table must exist';
    END IF;

    IF to_regclass('public.eformsign_backup_collection_page') IS NULL THEN
        RAISE EXCEPTION 'eformsign_backup_collection_page table must exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'eformsign_backup_collection_page'
          AND indexname = 'uq_eformsign_backup_collection_page_run_scan_ordinal'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    ) THEN
        RAISE EXCEPTION 'uq_eformsign_backup_collection_page_run_scan_ordinal unique index must exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_backup_collection_page_run_id_fkey'
          AND contype = 'f'
          AND conrelid = 'public.eformsign_backup_collection_page'::regclass
          AND confrelid = 'public.eformsign_backup_collection_run'::regclass
    ) THEN
        RAISE EXCEPTION 'eformsign_backup_collection_page_run_id_fkey foreign key must exist';
    END IF;

    -- General API roles must hold no privilege on the ledger. A role that does not
    -- exist in this database is skipped, not an error.
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            FOREACH ledger_table IN ARRAY ARRAY[
                'public.eformsign_backup_collection_run',
                'public.eformsign_backup_collection_page'
            ] LOOP
                IF has_table_privilege(api_role, ledger_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
                    RAISE EXCEPTION 'role % must hold no privilege on %', api_role, ledger_table;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END $$;
