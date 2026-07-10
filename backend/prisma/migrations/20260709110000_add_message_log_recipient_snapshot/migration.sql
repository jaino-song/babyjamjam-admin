ALTER TABLE "message_log" ADD COLUMN IF NOT EXISTS "recipient_name" TEXT;
ALTER TABLE "message_log" ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT;

UPDATE "message_log" AS l
SET
  "recipient_phone" = COALESCE(l."recipient_phone", NULLIF(l."receiver", '')),
  "recipient_name" = COALESCE(
    l."recipient_name",
    NULLIF(l."variables" ->> 'recipientName', ''),
    NULLIF(j."payload" ->> 'recipientName', '')
  )
FROM "message_trigger_job" AS j
WHERE l."trigger_job_id" = j."id"
  AND (l."recipient_phone" IS NULL OR l."recipient_name" IS NULL);

UPDATE "message_log" AS l
SET
  "recipient_phone" = COALESCE(l."recipient_phone", NULLIF(l."receiver", '')),
  "recipient_name" = COALESCE(l."recipient_name", NULLIF(l."variables" ->> 'recipientName', ''))
WHERE l."trigger_job_id" IS NULL
  AND (l."recipient_phone" IS NULL OR l."recipient_name" IS NULL);

CREATE INDEX IF NOT EXISTS "idx_message_log_recipient_phone" ON "message_log"("recipient_phone");
