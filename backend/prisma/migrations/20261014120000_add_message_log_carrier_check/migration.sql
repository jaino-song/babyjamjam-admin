-- One-shot carrier delivery check for aligo_sms rows (checked ~30 min after
-- Aligo accepts the send). All columns are nullable with no defaults.
ALTER TABLE "message_log"
    ADD COLUMN "carrier_check_due_at" TIMESTAMPTZ(6),
    ADD COLUMN "carrier_checked_at" TIMESTAMPTZ(6),
    ADD COLUMN "carrier_result_state" VARCHAR(32),
    ADD COLUMN "carrier_results" JSONB;

-- Partial index: only rows still waiting for their check are indexed.
CREATE INDEX "idx_message_log_carrier_check_due"
    ON "message_log" ("carrier_check_due_at")
    WHERE "carrier_check_due_at" IS NOT NULL;

-- Backfill: recently accepted aligo_sms rows get checked once.
UPDATE "message_log"
SET "carrier_check_due_at" = now()
WHERE "provider" = 'aligo_sms'
  AND "aligo_mid" IS NOT NULL
  AND "created_at" >= now() - interval '7 days'
  AND (
        "status" = 'sent'
        OR ("status" = 'pending' AND "provider_acceptance_state" = 'accepted')
      );
