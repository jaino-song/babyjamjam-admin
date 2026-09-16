-- Generated with Prisma migrate diff; idempotent for the database-patches workflow.
-- Additive default preserves all existing 09:00 Asia/Seoul schedules.
-- AlterTable
ALTER TABLE "message_trigger_rule" ADD COLUMN IF NOT EXISTS "send_time" VARCHAR(5) NOT NULL DEFAULT '09:00';

