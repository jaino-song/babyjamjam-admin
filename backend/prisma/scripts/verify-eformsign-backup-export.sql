DO $$
DECLARE
    api_role text;
    export_table text;
    expected record;
BEGIN
    IF to_regclass('public.eformsign_backup_export_credential') IS NULL THEN
        RAISE EXCEPTION 'eformsign_backup_export_credential table must exist';
    END IF;

    IF to_regclass('public.eformsign_backup_export_snapshot') IS NULL THEN
        RAISE EXCEPTION 'eformsign_backup_export_snapshot table must exist';
    END IF;

    IF to_regclass('public.eformsign_backup_export_candidate') IS NULL THEN
        RAISE EXCEPTION 'eformsign_backup_export_candidate table must exist';
    END IF;

    -- Primary keys (the candidate key is composite; the others are single-column ids).
    FOR expected IN SELECT * FROM (VALUES
        ('eformsign_backup_export_credential', 'eformsign_backup_export_credential_pkey'),
        ('eformsign_backup_export_snapshot', 'eformsign_backup_export_snapshot_pkey'),
        ('eformsign_backup_export_candidate', 'eformsign_backup_export_candidate_pkey')
    ) AS t(table_name, constraint_name) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = expected.constraint_name
              AND contype = 'p'
              AND conrelid = format('public.%I', expected.table_name)::regclass
        ) THEN
            RAISE EXCEPTION '% primary key on % must exist', expected.constraint_name, expected.table_name;
        END IF;
    END LOOP;

    FOR expected IN SELECT * FROM (VALUES
        ('eformsign_backup_export_credential', 'uq_eformsign_backup_export_credential_token_hash'),
        ('eformsign_backup_export_snapshot', 'uq_eformsign_backup_export_snapshot_principal_idempotency'),
        ('eformsign_backup_export_candidate', 'uq_eformsign_backup_export_candidate_snapshot_document')
    ) AS t(table_name, index_name) LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = expected.table_name
              AND indexname = expected.index_name
              AND indexdef LIKE 'CREATE UNIQUE INDEX%'
        ) THEN
            RAISE EXCEPTION '% unique index must exist', expected.index_name;
        END IF;
    END LOOP;

    FOR expected IN SELECT * FROM (VALUES
        ('eformsign_backup_export_credential', 'idx_eformsign_backup_export_credential_principal'),
        ('eformsign_backup_export_candidate', 'idx_eformsign_backup_export_candidate_document_artifact'),
        ('eformsign_backup_export_candidate', 'idx_eformsign_backup_export_candidate_audit_trail_artifact')
    ) AS t(table_name, index_name) LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = expected.table_name
              AND indexname = expected.index_name
        ) THEN
            RAISE EXCEPTION '% index must exist', expected.index_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_backup_export_candidate_snapshot_id_fkey'
          AND contype = 'f'
          AND confdeltype = 'c'
          AND conrelid = 'public.eformsign_backup_export_candidate'::regclass
          AND confrelid = 'public.eformsign_backup_export_snapshot'::regclass
    ) THEN
        RAISE EXCEPTION 'eformsign_backup_export_candidate_snapshot_id_fkey foreign key (ON DELETE CASCADE) must exist';
    END IF;

    -- CHECK constraints Prisma cannot express.
    FOR expected IN SELECT * FROM (VALUES
        ('eformsign_backup_export_credential', 'chk_export_credential_token_hash_hex'),
        ('eformsign_backup_export_credential', 'chk_export_credential_company_ids_nonempty'),
        ('eformsign_backup_export_snapshot', 'chk_export_snapshot_request_hash_hex'),
        ('eformsign_backup_export_snapshot', 'chk_export_snapshot_status'),
        ('eformsign_backup_export_snapshot', 'chk_export_snapshot_ready_fields'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_classification'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_ordinal_positive'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_reasons_present'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_metadata_revision_hex'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_document_all_or_none'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_audit_trail_all_or_none'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_sha256_hex'),
        ('eformsign_backup_export_candidate', 'chk_export_candidate_byte_size_nonneg')
    ) AS t(table_name, constraint_name) LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = expected.constraint_name
              AND contype = 'c'
              AND conrelid = format('public.%I', expected.table_name)::regclass
        ) THEN
            RAISE EXCEPTION '% check constraint on % must exist', expected.constraint_name, expected.table_name;
        END IF;
    END LOOP;

    -- General API roles must hold no privilege on the export tables, at table or
    -- column level. A role that does not exist in this database is skipped.
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            FOREACH export_table IN ARRAY ARRAY[
                'public.eformsign_backup_export_credential',
                'public.eformsign_backup_export_snapshot',
                'public.eformsign_backup_export_candidate'
            ] LOOP
                IF has_table_privilege(api_role, export_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
                    RAISE EXCEPTION 'role % must hold no privilege on %', api_role, export_table;
                END IF;
                IF has_any_column_privilege(api_role, export_table, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
                    RAISE EXCEPTION 'role % must hold no column privilege on %', api_role, export_table;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END $$;
