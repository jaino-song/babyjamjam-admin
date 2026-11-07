-- Archive original service-record days before an admin start-date change.
-- Additive rollout: retain archive data on application rollback for manual recovery.
-- The database-patches workflow reapplies this file on every push; all DDL is idempotent.
-- No foreign keys: archived copies must survive deletion of the original rows.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "service_record_day_archive" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "batch_id" UUID NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "original_day_id" UUID NOT NULL,
    "case_session_index" INTEGER,
    "service_date" DATE NOT NULL,
    "previous_start_date" DATE,
    "new_start_date" DATE NOT NULL,
    "archived_by_user_id" UUID,
    "payload" JSONB NOT NULL,
    "archived_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_record_day_archive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_service_record_day_archive_branch_case_archived" ON "service_record_day_archive"("branch_id", "service_record_case_id", "archived_at");

CREATE INDEX IF NOT EXISTS "idx_service_record_day_archive_batch" ON "service_record_day_archive"("batch_id");

COMMIT;
