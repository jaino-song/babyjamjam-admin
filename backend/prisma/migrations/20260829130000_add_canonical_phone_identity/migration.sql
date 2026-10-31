-- Persist a formatting-independent phone identity while retaining the
-- user-entered display value in phone. Existing duplicates are rejected before
-- replacing the legacy raw-phone indexes; no row is selected as a winner.

BEGIN;

ALTER TABLE "public"."client"
    ADD COLUMN IF NOT EXISTS "phone_normalized" TEXT;

ALTER TABLE "public"."employee"
    ADD COLUMN IF NOT EXISTS "phone_normalized" TEXT;

-- The backfill below must tell live clients from tombstones. deleted_at is
-- created by the later 20261019000000_add_client_deleted_at migration, so a
-- fresh `prisma migrate deploy` replay reaches this file before the column
-- exists. The identical ADD COLUMN IF NOT EXISTS keeps both orderings valid.
ALTER TABLE "public"."client"
    ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- Backfill clients using the same digit extraction and +82 conversion as the
-- application canonicalizer. Invalid values are left NULL so the migration
-- does not invent an identity for an unparseable legacy display value.
-- Tombstoned clients (deleted_at IS NOT NULL) are skipped: deleting a client
-- deliberately clears phone_normalized so the phone drops out of identity
-- matching and can be reused, and this file is re-run on every push, so
-- recomputing a key here would resurrect a tombstone and collide with its
-- twin or with a live re-registration on the unique index.
WITH stripped AS (
    SELECT
        "id",
        CASE
            WHEN "phone" IS NULL THEN NULL
            ELSE regexp_replace("phone", '\D', '', 'g')
        END AS "digits"
    FROM "public"."client"
    WHERE "deleted_at" IS NULL
), canonical AS (
    SELECT
        "id",
        CASE
            WHEN "digits" LIKE '82%' THEN '0' || substring("digits" FROM 3)
            ELSE "digits"
        END AS "candidate"
    FROM stripped
), normalized AS (
    SELECT
        "id",
        CASE
            WHEN "candidate" IS NOT NULL
                AND length("candidate") BETWEEN 9 AND 11
                AND left("candidate", 1) = '0'
            THEN "candidate"
            ELSE NULL
        END AS "phone_normalized"
    FROM canonical
)
UPDATE "public"."client" AS target
SET "phone_normalized" = normalized."phone_normalized"
FROM normalized
WHERE target."id" = normalized."id";

-- Backfill employees with the same deterministic rule. Employee.phone remains
-- required for display compatibility, so an unparseable legacy value receives
-- a NULL identity key and is surfaced for remediation instead of being guessed.
WITH stripped AS (
    SELECT
        "id",
        regexp_replace("phone", '\D', '', 'g') AS "digits"
    FROM "public"."employee"
), canonical AS (
    SELECT
        "id",
        CASE
            WHEN "digits" LIKE '82%' THEN '0' || substring("digits" FROM 3)
            ELSE "digits"
        END AS "candidate"
    FROM stripped
), normalized AS (
    SELECT
        "id",
        CASE
            WHEN "candidate" IS NOT NULL
                AND length("candidate") BETWEEN 9 AND 11
                AND left("candidate", 1) = '0'
            THEN "candidate"
            ELSE NULL
        END AS "phone_normalized"
    FROM canonical
)
UPDATE "public"."employee" AS target
SET "phone_normalized" = normalized."phone_normalized"
FROM normalized
WHERE target."id" = normalized."id";

-- A formatting-equivalent collision is a data error, not a deduplication
-- opportunity. Abort the transaction with stable, row-identifying evidence.
-- The client scope here deliberately matches the unique index scope (all rows,
-- no deleted_at filter): tombstones hold a NULL key, NULL keys never collide
-- in the index, so they are inert in this check without being excluded.
DO $$
DECLARE
    _client_offending_rows jsonb;
    _employee_offending_rows jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(duplicate_group) ORDER BY duplicate_group."branch_id", duplicate_group."phone_normalized")
    INTO _client_offending_rows
    FROM (
        SELECT
            "branch_id",
            "phone_normalized",
            array_agg("id" ORDER BY "id") AS "client_ids",
            COUNT(*) AS "duplicate_count"
        FROM "public"."client"
        WHERE "branch_id" IS NOT NULL
          AND "phone_normalized" IS NOT NULL
        GROUP BY "branch_id", "phone_normalized"
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _client_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'client has duplicate (branch_id, phone_normalized) groups: %', _client_offending_rows;
    END IF;

    SELECT jsonb_agg(to_jsonb(duplicate_group) ORDER BY duplicate_group."branch_id", duplicate_group."phone_normalized")
    INTO _employee_offending_rows
    FROM (
        SELECT
            "branch_id",
            "phone_normalized",
            array_agg("id" ORDER BY "id") AS "employee_ids",
            COUNT(*) AS "duplicate_count"
        FROM "public"."employee"
        WHERE "branch_id" IS NOT NULL
          AND "phone_normalized" IS NOT NULL
        GROUP BY "branch_id", "phone_normalized"
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _employee_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'employee has duplicate (branch_id, phone_normalized) groups: %', _employee_offending_rows;
    END IF;
END $$;

-- Replace the raw display-phone indexes with canonical branch-scoped indexes.
ALTER TABLE "public"."client"
    DROP CONSTRAINT IF EXISTS "client_branch_phone_key";
DROP INDEX IF EXISTS "public"."client_branch_phone_key";
ALTER TABLE "public"."employee"
    DROP CONSTRAINT IF EXISTS "employee_branch_id_phone_key";
DROP INDEX IF EXISTS "public"."employee_branch_id_phone_key";

DROP INDEX IF EXISTS "public"."client_branch_phone_normalized_key";
CREATE UNIQUE INDEX "client_branch_phone_normalized_key"
    ON "public"."client"("branch_id", "phone_normalized");

DROP INDEX IF EXISTS "public"."employee_branch_id_phone_normalized_key";
CREATE UNIQUE INDEX "employee_branch_id_phone_normalized_key"
    ON "public"."employee"("branch_id", "phone_normalized");

COMMIT;
