BEGIN;

CREATE TABLE IF NOT EXISTS "eformsign_backup_daily_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "limited" BOOLEAN NOT NULL DEFAULT false,
    "total_docs" INTEGER NOT NULL,
    "saved_files" INTEGER NOT NULL,
    "skipped_files" INTEGER NOT NULL,
    "failed_files" INTEGER NOT NULL,
    "drive_status" TEXT NOT NULL,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eformsign_backup_daily_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_eformsign_backup_daily_run_started_at"
    ON "eformsign_backup_daily_run" ("started_at" DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_backup_daily_run_status_check'
          AND conrelid = 'public.eformsign_backup_daily_run'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_daily_run"
            ADD CONSTRAINT "eformsign_backup_daily_run_status_check"
            CHECK ("status" IN ('success', 'partial', 'failed'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_backup_daily_run_drive_status_check'
          AND conrelid = 'public.eformsign_backup_daily_run'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_daily_run"
            ADD CONSTRAINT "eformsign_backup_daily_run_drive_status_check"
            CHECK ("drive_status" IN ('ok', 'failed', 'skipped'));
    END IF;
END
$$;

COMMIT;
