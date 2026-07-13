ALTER TABLE "alimtalk_log" RENAME TO "message_log";

ALTER SEQUENCE IF EXISTS "alimtalk_log_id_seq" RENAME TO "message_log_id_seq";

ALTER TABLE "message_log" RENAME CONSTRAINT "alimtalk_log_pkey" TO "message_log_pkey";

ALTER INDEX "idx_alimtalk_log_branch" RENAME TO "idx_message_log_branch";
ALTER INDEX "idx_alimtalk_log_trigger_job_id" RENAME TO "idx_message_log_trigger_job_id";
ALTER INDEX "idx_alimtalk_log_status" RENAME TO "idx_message_log_status";
ALTER INDEX "idx_alimtalk_log_receiver" RENAME TO "idx_message_log_receiver";
ALTER INDEX "idx_alimtalk_log_created_at" RENAME TO "idx_message_log_created_at";
ALTER INDEX "idx_alimtalk_log_next_retry_at" RENAME TO "idx_message_log_next_retry_at";

UPDATE "message_log"
SET "provider" = 'aligo_alimtalk'
WHERE "provider" IN ('aligo', 'channeltalk');

UPDATE "system_setting"
SET "value" = 'aligo_alimtalk'
WHERE "key" = 'alimtalk_provider'
  AND "value" IN ('aligo', 'channeltalk');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "message_log"
    WHERE "provider" NOT IN ('aligo_sms', 'aligo_alimtalk')
  ) THEN
    RAISE EXCEPTION 'message_log contains unsupported provider values after provider normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "system_setting"
    WHERE "key" = 'alimtalk_provider'
      AND "value" NOT IN ('aligo_alimtalk', 'none')
  ) THEN
    RAISE EXCEPTION 'system_setting.alimtalk_provider contains unsupported values after provider normalization';
  END IF;
END;
$$;
