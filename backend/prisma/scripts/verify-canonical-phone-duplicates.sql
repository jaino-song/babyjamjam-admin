-- Read-only pre-flight for the canonical phone identity migration
-- (20260829130000_add_canonical_phone_identity).
--
-- The migration itself fails closed: it RAISEs on duplicate
-- (branch_id, phone_normalized) groups before touching the old unique
-- constraints. Running this file BEFORE the patches in the production job
-- surfaces the same duplicates as an early, dedicated failure with the
-- offending groups listed, so they can be merged away before deploy instead
-- of aborting mid-workflow. It never writes.
--
-- Two client checks run: stored keys (what the unique index already enforces)
-- and the keys the migration's backfill WOULD compute for live clients, using
-- the migration's exact normalization. The second one is what catches
-- formatting-equivalent phones whose stored key is still NULL; tombstoned
-- clients (deleted_at IS NOT NULL) are excluded from it because the backfill
-- leaves them NULL by design. The employee check is unchanged.

DO $$
DECLARE
    _client_offending_rows   text;
    _employee_offending_rows text;
    _client_computed_rows    text;
    _live_filter             text := '';
BEGIN
    -- First run: the post-lease patches have not added phone_normalized yet,
    -- so there is nothing to scan. The migration's own fail-closed duplicate
    -- check covers that case when it creates the columns.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client'
          AND column_name = 'phone_normalized'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employee'
          AND column_name = 'phone_normalized'
    ) THEN
        RAISE NOTICE 'phone_normalized columns not present yet — canonical phone duplicate pre-check skipped';
        RETURN;
    END IF;

    SELECT string_agg(
        format('%s (branch=%s, phone_normalized=%s, rows=%s)',
               group_id, branch_id, phone_normalized, row_count),
        E'\n')
    INTO _client_offending_rows
    FROM (
        SELECT row_number() OVER () AS group_id,
               branch_id,
               phone_normalized,
               COUNT(*) AS row_count
        FROM "public"."client"
        WHERE phone_normalized IS NOT NULL AND branch_id IS NOT NULL
        GROUP BY branch_id, phone_normalized
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _client_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'client has duplicate (branch_id, phone_normalized) groups: %', _client_offending_rows;
    END IF;

    -- Keys the migration backfill would assign to live clients. client.deleted_at
    -- is created by the migration itself (and by 20261019000000_add_client_deleted_at);
    -- a database that ran an older copy of the migration may not have it yet, and
    -- then no client is a tombstone, so every row counts as live. Dynamic SQL keeps
    -- the possibly missing column from failing this block at plan time.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client'
          AND column_name = 'deleted_at'
    ) THEN
        _live_filter := 'WHERE "deleted_at" IS NULL';
    END IF;

    EXECUTE $q$
        WITH stripped AS (
            SELECT "id", "branch_id",
                   CASE WHEN "phone" IS NULL THEN NULL
                        ELSE regexp_replace("phone", '\D', '', 'g') END AS "digits"
            FROM "public"."client"
            $q$ || _live_filter || $q$
        ), canonical AS (
            SELECT "id", "branch_id",
                   CASE WHEN "digits" LIKE '82%' THEN '0' || substring("digits" FROM 3)
                        ELSE "digits" END AS "candidate"
            FROM stripped
        ), normalized AS (
            SELECT "id", "branch_id",
                   CASE WHEN "candidate" IS NOT NULL
                             AND length("candidate") BETWEEN 9 AND 11
                             AND left("candidate", 1) = '0'
                        THEN "candidate" ELSE NULL END AS "phone_normalized"
            FROM canonical
        )
        SELECT string_agg(
            format('%s (branch=%s, phone_normalized=%s, rows=%s, computed from phone)',
                   group_id, branch_id, phone_normalized, row_count),
            E'\n')
        FROM (
            SELECT row_number() OVER () AS group_id,
                   branch_id,
                   phone_normalized,
                   COUNT(*) AS row_count
            FROM normalized
            WHERE phone_normalized IS NOT NULL AND branch_id IS NOT NULL
            GROUP BY branch_id, phone_normalized
            HAVING COUNT(*) > 1
        ) AS duplicate_group
    $q$ INTO _client_computed_rows;

    IF _client_computed_rows IS NOT NULL THEN
        RAISE EXCEPTION 'client has duplicate (branch_id, phone_normalized) groups: %', _client_computed_rows;
    END IF;

    SELECT string_agg(
        format('%s (branch=%s, phone_normalized=%s, rows=%s)',
               group_id, branch_id, phone_normalized, row_count),
        E'\n')
    INTO _employee_offending_rows
    FROM (
        SELECT row_number() OVER () AS group_id,
               branch_id,
               phone_normalized,
               COUNT(*) AS row_count
        FROM "public"."employee"
        WHERE phone_normalized IS NOT NULL AND branch_id IS NOT NULL
        GROUP BY branch_id, phone_normalized
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _employee_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'employee has duplicate (branch_id, phone_normalized) groups: %', _employee_offending_rows;
    END IF;

    RAISE NOTICE 'canonical phone duplicates: none';
END $$;
