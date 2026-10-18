-- Generated with Prisma migrate diff; idempotent for the database-patches workflow.
-- Per-entity "automatic SMS allowed" flag (client / employee / user). Additive default true
-- keeps every existing recipient receiving automatic SMS exactly as today.
-- AlterTable
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "sms_automation_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "employee" ADD COLUMN IF NOT EXISTS "sms_automation_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "sms_automation_enabled" BOOLEAN NOT NULL DEFAULT true;
