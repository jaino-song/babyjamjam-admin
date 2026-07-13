-- Emergency rollback for BJJ-253 message-domain rename.
-- Use only if deploy step 3 fails after both message rename migrations were applied
-- and before application code is rolled forward. Run manually; do not add to Prisma migrations.

BEGIN;

UPDATE "message_log"
SET "provider" = 'aligo'
WHERE "provider" = 'aligo_alimtalk';

UPDATE "system_setting"
SET "value" = 'aligo'
WHERE "key" = 'alimtalk_provider'
  AND "value" = 'aligo_alimtalk';

ALTER TABLE "message_trigger_rule" RENAME CONSTRAINT "message_trigger_rule_pkey" TO "alimtalk_trigger_rule_pkey";
ALTER INDEX "idx_message_trigger_rule_branch" RENAME TO "idx_alimtalk_trigger_rule_branch";
ALTER INDEX "idx_message_trigger_rule_active" RENAME TO "idx_alimtalk_trigger_rule_active";
ALTER INDEX "idx_message_trigger_rule_event_type" RENAME TO "idx_alimtalk_trigger_rule_event_type";
ALTER TABLE "message_trigger_rule" RENAME TO "alimtalk_trigger_rule";

ALTER TABLE "message_trigger_job" RENAME CONSTRAINT "message_trigger_job_pkey" TO "alimtalk_trigger_job_pkey";
ALTER INDEX "message_trigger_job_dedupe_key_key" RENAME TO "alimtalk_trigger_job_dedupe_key_key";
ALTER INDEX "idx_message_trigger_job_branch" RENAME TO "idx_alimtalk_trigger_job_branch";
ALTER INDEX "idx_message_trigger_job_rule_id" RENAME TO "idx_alimtalk_trigger_job_rule_id";
ALTER INDEX "idx_message_trigger_job_status_scheduled_for" RENAME TO "idx_alimtalk_trigger_job_status_scheduled_for";
ALTER INDEX "idx_message_trigger_job_client_id" RENAME TO "idx_alimtalk_trigger_job_client_id";
ALTER INDEX "idx_message_trigger_job_employee_schedule_id" RENAME TO "idx_alimtalk_trigger_job_employee_schedule_id";
ALTER TABLE "message_trigger_job" RENAME TO "alimtalk_trigger_job";

ALTER TABLE "message_log" RENAME CONSTRAINT "message_log_pkey" TO "alimtalk_log_pkey";
ALTER INDEX "idx_message_log_branch" RENAME TO "idx_alimtalk_log_branch";
ALTER INDEX "idx_message_log_trigger_job_id" RENAME TO "idx_alimtalk_log_trigger_job_id";
ALTER INDEX "idx_message_log_status" RENAME TO "idx_alimtalk_log_status";
ALTER INDEX "idx_message_log_receiver" RENAME TO "idx_alimtalk_log_receiver";
ALTER INDEX "idx_message_log_created_at" RENAME TO "idx_alimtalk_log_created_at";
ALTER INDEX "idx_message_log_next_retry_at" RENAME TO "idx_alimtalk_log_next_retry_at";
ALTER SEQUENCE IF EXISTS "message_log_id_seq" RENAME TO "alimtalk_log_id_seq";
ALTER TABLE "message_log" RENAME TO "alimtalk_log";

COMMIT;
