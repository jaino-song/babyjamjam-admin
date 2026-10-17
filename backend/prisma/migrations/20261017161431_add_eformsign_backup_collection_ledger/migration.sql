-- This migration is also replayed by the database patch workflow.
-- The database-patches workflow re-executes this whole file on every push, so
-- every statement below must be safe to run again: a bare CREATE would fail every
-- run after the first and block the later patches from ever applying.
--
-- Inactive Phase 1B collection ledger: one row per backup collection run and one
-- row per observed vendor page. Global evidence, independent of mutable documents.

-- CreateTable
CREATE TABLE IF NOT EXISTS "eformsign_backup_collection_run" (
    "id" UUID NOT NULL,
    "configured_company_id" VARCHAR(256),
    "trigger" VARCHAR(24) NOT NULL,
    "lock_mode" VARCHAR(24) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "receipt_version" INTEGER NOT NULL DEFAULT 1,
    "scan_summary" JSONB NOT NULL,
    "failure_code" VARCHAR(40),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "eformsign_backup_collection_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eformsign_backup_collection_page" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "document_type" VARCHAR(2) NOT NULL,
    "pass" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "start_offset" INTEGER NOT NULL,
    "requested_limit" INTEGER NOT NULL,
    "returned_count" INTEGER,
    "total_count" INTEGER,
    "terminal" BOOLEAN,
    "outcome" VARCHAR(16) NOT NULL,
    "failure_code" VARCHAR(40),
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eformsign_backup_collection_page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_eformsign_backup_collection_run_outcome_started" ON "eformsign_backup_collection_run"("outcome", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_eformsign_backup_collection_page_run_scan_ordinal" ON "eformsign_backup_collection_page"("run_id", "document_type", "pass", "ordinal");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_backup_collection_page_run_id_fkey'
          AND conrelid = '"eformsign_backup_collection_page"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_collection_page" ADD CONSTRAINT "eformsign_backup_collection_page_run_id_fkey"
            FOREIGN KEY ("run_id") REFERENCES "eformsign_backup_collection_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- General API roles get no access to the ledger (design v0.3 section 14.1 D-08).
-- Supabase default privileges may otherwise grant them; a no-op where a role does
-- not exist, and harmless to replay.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE public.eformsign_backup_collection_run, public.eformsign_backup_collection_page FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END $$;
