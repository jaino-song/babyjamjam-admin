-- This migration is also replayed by the database patch workflow.
-- One-shot carrier delivery check for aligo_sms rows (checked ~30 min after
-- Aligo accepts the send). All columns are nullable with no defaults.
ALTER TABLE "message_log"
    ADD COLUMN IF NOT EXISTS "carrier_check_due_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "carrier_checked_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "carrier_result_state" VARCHAR(32),
    ADD COLUMN IF NOT EXISTS "carrier_results" JSONB;

-- Partial index: only rows still waiting for their check are indexed.
CREATE INDEX IF NOT EXISTS "idx_message_log_carrier_check_due"
    ON "message_log" ("carrier_check_due_at")
    WHERE "carrier_check_due_at" IS NOT NULL;

-- Backfill: recently accepted aligo_sms rows get checked once. Re-runs are
-- harmless: rows already scheduled or already checked are excluded by the
-- three IS NULL guards. Accepted-but-pending reserved sends are deliberately
-- not backfilled (their reserved time cannot be known cheaply here); new sends
-- schedule their check in application code.
UPDATE "message_log"
SET "carrier_check_due_at" = now()
WHERE "provider" = 'aligo_sms'
  AND "aligo_mid" IS NOT NULL
  AND "status" = 'sent'
  AND "created_at" >= now() - interval '7 days'
  AND "carrier_checked_at" IS NULL
  AND "carrier_check_due_at" IS NULL
  AND "carrier_result_state" IS NULL;
