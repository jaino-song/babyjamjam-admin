-- 제공기록지(service record) 용어 통일: feedback → service_record
-- Hardcoded, idempotent DB patch (applied via `prisma db execute`, NOT `prisma migrate deploy`).
-- Safe to re-run: every statement is guarded (IF EXISTS / WHERE old-value / drop-then-add).

-- =========================================================================
-- 1) Table + index + constraint renames: employee_feedback_token → service_record_token
-- =========================================================================
ALTER TABLE IF EXISTS "employee_feedback_token" RENAME TO "service_record_token";

ALTER INDEX IF EXISTS "idx_employee_feedback_token_schedule"
  RENAME TO "idx_service_record_token_schedule";
ALTER INDEX IF EXISTS "idx_employee_feedback_token_branch"
  RENAME TO "idx_service_record_token_branch";
ALTER INDEX IF EXISTS "idx_employee_feedback_token_service_record_case_id"
  RENAME TO "idx_service_record_token_service_record_case_id";

-- Prisma-generated unique indexes (@unique on link_token_hash / access_token_hash)
ALTER INDEX IF EXISTS "employee_feedback_token_link_token_hash_key"
  RENAME TO "service_record_token_link_token_hash_key";
ALTER INDEX IF EXISTS "employee_feedback_token_access_token_hash_key"
  RENAME TO "service_record_token_access_token_hash_key";

-- Primary key + foreign key constraints (RENAME CONSTRAINT has no IF EXISTS — guard with DO blocks).
-- Prisma derives constraint names from the model name, so the drift guard requires these to match.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_feedback_token_pkey') THEN
    ALTER TABLE "service_record_token"
      RENAME CONSTRAINT "employee_feedback_token_pkey" TO "service_record_token_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_feedback_token_branch_id_fkey') THEN
    ALTER TABLE "service_record_token"
      RENAME CONSTRAINT "employee_feedback_token_branch_id_fkey" TO "service_record_token_branch_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_feedback_token_employee_id_fkey') THEN
    ALTER TABLE "service_record_token"
      RENAME CONSTRAINT "employee_feedback_token_employee_id_fkey" TO "service_record_token_employee_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_feedback_token_schedule_id_fkey') THEN
    ALTER TABLE "service_record_token"
      RENAME CONSTRAINT "employee_feedback_token_schedule_id_fkey" TO "service_record_token_schedule_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_feedback_token_service_record_case_id_fkey') THEN
    ALTER TABLE "service_record_token"
      RENAME CONSTRAINT "employee_feedback_token_service_record_case_id_fkey" TO "service_record_token_service_record_case_id_fkey";
  END IF;
END $$;

-- =========================================================================
-- 2) message_trigger_rule.id rename (system rule) + its FK children.
--    FK message_trigger_job.rule_id -> message_trigger_rule.id is ON UPDATE NO ACTION,
--    so drop the FK, repoint parent + children, then re-add it.
-- =========================================================================
ALTER TABLE "message_trigger_job" DROP CONSTRAINT IF EXISTS "message_trigger_job_rule_id_fkey";

UPDATE "message_trigger_rule"
  SET id = 'system:service_record_link'
  WHERE id = 'system:service_feedback_link';

UPDATE "message_trigger_job"
  SET rule_id = 'system:service_record_link'
  WHERE rule_id = 'system:service_feedback_link';

UPDATE "message_trigger_job"
  SET dedupe_key = replace(dedupe_key, 'system:service_feedback_link', 'system:service_record_link')
  WHERE dedupe_key LIKE 'system:service_feedback_link%';

ALTER TABLE "message_trigger_job"
  ADD CONSTRAINT "message_trigger_job_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "message_trigger_rule"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- 3) Persisted template-key enum value: SERVICE_FEEDBACK_LINK → SERVICE_RECORD_LINK
--    (applies to every rule/job carrying that template_key, system + branch-scoped)
-- =========================================================================
UPDATE "message_trigger_rule" SET template_key = 'SERVICE_RECORD_LINK' WHERE template_key = 'SERVICE_FEEDBACK_LINK';
UPDATE "message_trigger_job"  SET template_key = 'SERVICE_RECORD_LINK' WHERE template_key = 'SERVICE_FEEDBACK_LINK';
UPDATE "system_template"      SET template_key = 'SERVICE_RECORD_LINK' WHERE template_key = 'SERVICE_FEEDBACK_LINK';

-- =========================================================================
-- 4) Template body variable: {{feedbackUrl}} → {{serviceRecordUrl}}
--    (system_template.content + every historical system_template_version.content)
-- =========================================================================
UPDATE "system_template"
  SET content = replace(content, '{{feedbackUrl}}', '{{serviceRecordUrl}}')
  WHERE content LIKE '%{{feedbackUrl}}%';
UPDATE "system_template_version"
  SET content = replace(content, '{{feedbackUrl}}', '{{serviceRecordUrl}}')
  WHERE content LIKE '%{{feedbackUrl}}%';

-- =========================================================================
-- 5) eformsign document classification: service_feedback_snapshot → service_record_snapshot
-- =========================================================================
UPDATE "eformsign_doc"
  SET document_kind = 'service_record_snapshot'
  WHERE document_kind = 'service_feedback_snapshot';

-- =========================================================================
-- 6) SMS message-log template key value: service_feedback_link_sms → service_record_link_sms
-- =========================================================================
UPDATE "message_log"
  SET template_key = 'service_record_link_sms'
  WHERE template_key = 'service_feedback_link_sms';
