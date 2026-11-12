BEGIN;

ALTER TABLE "eformsign_document_job" ADD COLUMN IF NOT EXISTS "progress_detail" VARCHAR(24);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_progress_detail_check'
          AND conrelid = '"eformsign_document_job"'::regclass
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_progress_detail_check"
            CHECK ("progress_detail" IN ('client-started', 'info-inserted', 'creating', 'sent'));
    END IF;
END
$$;

COMMIT;
