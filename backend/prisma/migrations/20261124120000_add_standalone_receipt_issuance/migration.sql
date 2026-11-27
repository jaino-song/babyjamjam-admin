-- Backout: disable new admission and drain or terminally resolve pending preparations.
-- Retain kind-aware readers, request bindings, issued artifacts and contract defaults
-- while standalone links or request replays remain supported.
BEGIN;

ALTER TABLE "message_trigger_job"
    ADD COLUMN IF NOT EXISTS "standalone_request_id" uuid,
    ADD COLUMN IF NOT EXISTS "standalone_issued_token_id" uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'message_trigger_job_standalone_request_check'
          AND conrelid = 'message_trigger_job'::regclass
    ) THEN
        ALTER TABLE "message_trigger_job"
            ADD CONSTRAINT "message_trigger_job_standalone_request_check"
                CHECK ((standalone_request_id IS NULL OR branch_id IS NOT NULL)
                    AND (standalone_issued_token_id IS NULL OR standalone_request_id IS NOT NULL));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_trigger_job_standalone_request
    ON "message_trigger_job" (branch_id, standalone_request_id)
    WHERE standalone_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_link_token_standalone_job
    ON "receipt_link_token" (job_id)
    WHERE kind = 'standalone';

COMMIT;
