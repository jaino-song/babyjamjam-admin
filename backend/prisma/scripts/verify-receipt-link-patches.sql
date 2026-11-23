-- Guard for the receipt-link token and contract auto-finalize grace-days patches.
--
-- Asserts that the receipt_link_token table exists with its unique hash
-- indexes, foreign keys, and CHECK constraints, and that no
-- branch auto-finalize setting written before 2026-09-04 00:00 KST still
-- carries a graceDays other than 7 (rows the patch rewrote carry a newer
-- updated_at; rows with operator edits made after 2026-09-04 00:00 KST are
-- theirs to keep).
-- Malformed or non-object settings rows are reported, not failed — the
-- service already falls back to the default for them.
DO $$
DECLARE
    _missing text;
    _stale bigint;
    _malformed bigint;
    _row record;
BEGIN
    IF to_regclass('public.receipt_link_token') IS NULL THEN
        RAISE EXCEPTION 'receipt_link_token table is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        JOIN pg_attrdef ON adrelid = attrelid AND adnum = attnum
        WHERE attrelid = 'public.receipt_link_token'::regclass
          AND attname = 'kind' AND NOT attisdropped AND attnotnull
          AND atttypid = 'text'::regtype
          AND pg_get_expr(adbin, adrelid) = '''contract''::text'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.receipt_link_token'::regclass
          AND attname = 'frozen_client_name' AND NOT attisdropped AND NOT attnotnull
          AND atttypid = 'text'::regtype
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.receipt_link_token'::regclass
          AND attname = 'eformsign_doc_id' AND NOT attisdropped AND NOT attnotnull
          AND atttypid = 'integer'::regtype
    ) THEN
        RAISE EXCEPTION 'receipt_link_token standalone columns are missing or invalid';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'receipt_link_token_kind_check'
          AND conrelid = 'public.receipt_link_token'::regclass
          AND contype = 'c' AND convalidated
    ) THEN
        RAISE EXCEPTION 'receipt_link_token kind constraint is missing or unvalidated';
    END IF;

    FOREACH _missing IN ARRAY ARRAY[
        'receipt_link_token_link_token_hash_key',
        'receipt_link_token_access_token_hash_key',
        'idx_receipt_link_token_doc_active',
        'idx_receipt_link_token_job',
        'idx_receipt_link_token_expires',
        'idx_receipt_link_token_branch'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'receipt_link_token'
              AND indexname = _missing
        ) THEN
            RAISE EXCEPTION 'receipt_link_token index % is missing', _missing;
        END IF;
    END LOOP;

    FOREACH _missing IN ARRAY ARRAY[
        'receipt_link_token_branch_id_fkey',
        'receipt_link_token_client_id_fkey',
        'receipt_link_token_eformsign_doc_id_fkey',
        'receipt_link_token_source_check',
        'receipt_link_token_failed_attempts_check'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = _missing
              AND conrelid = 'public.receipt_link_token'::regclass
        ) THEN
            RAISE EXCEPTION 'receipt_link_token constraint % is missing', _missing;
        END IF;
    END LOOP;

    _stale := 0;
    _malformed := 0;
    FOR _row IN
        SELECT "key", "value", "updated_at"
        FROM "system_setting"
        WHERE "key" LIKE 'branch:%:contract_automation:auto_finalize'
          AND "updated_at" < TIMESTAMPTZ '2026-09-04 00:00:00+09'
    LOOP
        BEGIN
            IF jsonb_typeof(_row."value"::jsonb) <> 'object' THEN
                _malformed := _malformed + 1;
            ELSIF (_row."value"::jsonb ->> 'graceDays') IS DISTINCT FROM '7' THEN
                _stale := _stale + 1;
            END IF;
        EXCEPTION WHEN invalid_text_representation THEN
            _malformed := _malformed + 1;
        END;
    END LOOP;

    IF _stale > 0 THEN
        RAISE EXCEPTION
            '% branch auto-finalize setting(s) from before 2026-09-04 still lack graceDays 7', _stale;
    END IF;
    IF _malformed > 0 THEN
        RAISE NOTICE
            '% branch auto-finalize setting(s) are not JSON objects; the service uses the default for them',
            _malformed;
    END IF;
END $$;
