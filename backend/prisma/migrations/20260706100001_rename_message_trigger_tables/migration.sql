ALTER TABLE "alimtalk_trigger_rule" RENAME TO "message_trigger_rule";
ALTER TABLE "message_trigger_rule" RENAME CONSTRAINT "alimtalk_trigger_rule_pkey" TO "message_trigger_rule_pkey";

ALTER INDEX "idx_alimtalk_trigger_rule_branch" RENAME TO "idx_message_trigger_rule_branch";
ALTER INDEX "idx_alimtalk_trigger_rule_active" RENAME TO "idx_message_trigger_rule_active";
ALTER INDEX "idx_alimtalk_trigger_rule_event_type" RENAME TO "idx_message_trigger_rule_event_type";

ALTER TABLE "alimtalk_trigger_job" RENAME TO "message_trigger_job";
ALTER TABLE "message_trigger_job" RENAME CONSTRAINT "alimtalk_trigger_job_pkey" TO "message_trigger_job_pkey";

ALTER INDEX "alimtalk_trigger_job_dedupe_key_key" RENAME TO "message_trigger_job_dedupe_key_key";
ALTER INDEX "idx_alimtalk_trigger_job_branch" RENAME TO "idx_message_trigger_job_branch";
ALTER INDEX "idx_alimtalk_trigger_job_rule_id" RENAME TO "idx_message_trigger_job_rule_id";
ALTER INDEX "idx_alimtalk_trigger_job_status_scheduled_for" RENAME TO "idx_message_trigger_job_status_scheduled_for";
ALTER INDEX "idx_alimtalk_trigger_job_client_id" RENAME TO "idx_message_trigger_job_client_id";
ALTER INDEX "idx_alimtalk_trigger_job_employee_schedule_id" RENAME TO "idx_message_trigger_job_employee_schedule_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename IN ('message_log', 'message_trigger_rule', 'message_trigger_job')
      AND indexname LIKE '%alimtalk%'
  ) THEN
    RAISE EXCEPTION 'alimtalk index name remains on renamed message tables';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname IN ('message_log', 'message_trigger_rule', 'message_trigger_job')
      AND c.conname LIKE '%alimtalk%'
  ) THEN
    RAISE EXCEPTION 'alimtalk constraint name remains on renamed message tables';
  END IF;
END;
$$;
