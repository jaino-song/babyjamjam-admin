-- Employee/client schema hardening for soft deletion, safer schedule FKs,
-- branch-scoped phone uniqueness, sequence-backed IDs, and greeting SMS suppression.
-- employee.id remains SMALLINT, whose maximum value is 32767. Monitor capacity
-- and migrate the key type before the sequence reaches that ceiling.

BEGIN;

-- Fail before changing uniqueness if any branch already has duplicate phones.
DO $$
DECLARE
    _offending_rows jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(duplicate_group))
    INTO _offending_rows
    FROM (
        SELECT
            "branch_id",
            "phone",
            array_agg("id" ORDER BY "id") AS employee_ids,
            COUNT(*) AS duplicate_count
        FROM "public"."employee"
        WHERE "branch_id" IS NOT NULL
        GROUP BY "branch_id", "phone"
        HAVING COUNT(*) > 1
        ORDER BY "branch_id", "phone"
    ) AS duplicate_group;

    IF _offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'employee has duplicate (branch_id, phone) groups: %', _offending_rows;
    END IF;
END $$;

ALTER TABLE "public"."employee"
    ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

ALTER TABLE "public"."client"
    ADD COLUMN IF NOT EXISTS "suppress_greeting_sms" BOOLEAN NOT NULL DEFAULT false;

-- secondary_employee_id is optional so its reference can safely be cleared.
ALTER TABLE "public"."employee_schedule"
    ALTER COLUMN "secondary_employee_id" DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'employee_schedule_primary_employee_id_fkey'
          AND conrelid = 'public.employee_schedule'::regclass
          AND confrelid = 'public.employee'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee_schedule'::regclass
                AND attname = 'primary_employee_id'
          )]
          AND confkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee'::regclass
                AND attname = 'id'
          )]
          AND confdeltype = 'r'
          AND confupdtype = 'a'
    ) THEN
        ALTER TABLE "public"."employee_schedule"
            DROP CONSTRAINT IF EXISTS "employee_schedule_primary_employee_id_fkey";
        ALTER TABLE "public"."employee_schedule"
            ADD CONSTRAINT "employee_schedule_primary_employee_id_fkey"
            FOREIGN KEY ("primary_employee_id") REFERENCES "public"."employee"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'employee_schedule_secondary_employee_id_fkey'
          AND conrelid = 'public.employee_schedule'::regclass
          AND confrelid = 'public.employee'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee_schedule'::regclass
                AND attname = 'secondary_employee_id'
          )]
          AND confkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee'::regclass
                AND attname = 'id'
          )]
          AND confdeltype = 'n'
          AND confupdtype = 'a'
    ) THEN
        ALTER TABLE "public"."employee_schedule"
            DROP CONSTRAINT IF EXISTS "employee_schedule_secondary_employee_id_fkey";
        ALTER TABLE "public"."employee_schedule"
            ADD CONSTRAINT "employee_schedule_secondary_employee_id_fkey"
            FOREIGN KEY ("secondary_employee_id") REFERENCES "public"."employee"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

-- Tolerate environments where the original uniqueness was represented as
-- either a table constraint or the baseline's standalone unique index.
ALTER TABLE "public"."employee"
    DROP CONSTRAINT IF EXISTS "employee_phone_key";
DROP INDEX IF EXISTS "public"."employee_phone_key";

CREATE UNIQUE INDEX IF NOT EXISTS "employee_branch_id_phone_key"
    ON "public"."employee"("branch_id", "phone");

CREATE SEQUENCE IF NOT EXISTS "public"."employee_id_seq";
ALTER SEQUENCE "public"."employee_id_seq"
    OWNED BY "public"."employee"."id";
ALTER TABLE "public"."employee"
    ALTER COLUMN "id" SET DEFAULT nextval('public.employee_id_seq'::regclass);
SELECT setval(
    'public.employee_id_seq'::regclass,
    COALESCE((SELECT MAX("id") FROM "public"."employee"), 0) + 1,
    false
);

COMMIT;
