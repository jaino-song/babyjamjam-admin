-- Caregiver edit log for already submitted (locked) service-record days.
--
-- This migration is also executed by the database-patches workflow, which does
-- not maintain Prisma's _prisma_migrations ledger. Every DDL operation is
-- therefore idempotent so a retry cannot stop later patches. Existing cases
-- and service-record days are left untouched. The table is append-only audit
-- data and deliberately separate from service_record_revision.

CREATE TABLE IF NOT EXISTS "service_record_day_edit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "case_session_index" INTEGER NOT NULL,
    "service_record_day_id" UUID NOT NULL,
    "employee_id" SMALLINT NOT NULL,
    "employee_name_snapshot" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_record_day_edit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_service_record_day_edit_log_branch_case_edited"
    ON "service_record_day_edit_log" ("branch_id", "service_record_case_id", "edited_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_day_edit_log_branch_id_fkey'
          AND conrelid = 'public.service_record_day_edit_log'::regclass
    ) THEN
        ALTER TABLE "service_record_day_edit_log"
            ADD CONSTRAINT "service_record_day_edit_log_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch" ("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_day_edit_log_case_branch_fkey'
          AND conrelid = 'public.service_record_day_edit_log'::regclass
    ) THEN
        ALTER TABLE "service_record_day_edit_log"
            ADD CONSTRAINT "service_record_day_edit_log_case_branch_fkey"
            FOREIGN KEY ("branch_id", "service_record_case_id")
            REFERENCES "service_record_case" ("branch_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;
