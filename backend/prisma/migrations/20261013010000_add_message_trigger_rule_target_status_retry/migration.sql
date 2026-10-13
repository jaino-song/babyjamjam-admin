-- Generated with Prisma migrate diff; idempotent for the database-patches workflow.
-- Additive defaults keep every existing routine at 전체 / 실패 시 재전송 켬 (today's behaviour).
-- AlterTable
ALTER TABLE "message_trigger_rule" ADD COLUMN IF NOT EXISTS "retry_on_failure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "target_client_status" VARCHAR(20) NOT NULL DEFAULT 'all';
