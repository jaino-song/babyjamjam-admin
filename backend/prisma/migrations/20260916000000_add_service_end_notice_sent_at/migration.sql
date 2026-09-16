-- Permanent client-level suppression fact for automatic service-end notices.
-- The nullable additive column is safe for rolling application deploys, and
-- the backfill preserves the earliest known successful send for existing rows.

ALTER TABLE "client"
    ADD COLUMN IF NOT EXISTS "service_end_notice_sent_at" TIMESTAMPTZ(6);

UPDATE "client" AS client
SET "service_end_notice_sent_at" = sent.first_sent_at
FROM (
    SELECT
        "client_id",
        "branch_id",
        MIN(COALESCE("provider_accepted_at", "last_attempt_at", "updated_at", "created_at")) AS first_sent_at
    FROM "message_log"
    WHERE "template_key" = 'service_end_notice_sms'
      AND "status" = 'sent'
      AND "client_id" IS NOT NULL
      AND "branch_id" IS NOT NULL
    GROUP BY "client_id", "branch_id"
) AS sent
WHERE client."id" = sent."client_id"
  AND client."branch_id" = sent."branch_id"
  AND client."service_end_notice_sent_at" IS NULL;
