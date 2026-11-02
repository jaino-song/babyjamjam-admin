-- Generated with Prisma migrate diff; idempotent for the database-patches workflow.
-- Per-client "service allowed on Saturday / Sunday / Korean public holidays" flags.
-- Additive default false keeps every existing client on the weekday-only service calendar.
-- AlterTable
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "allow_saturday_service" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "allow_sunday_service" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "allow_holiday_service" BOOLEAN NOT NULL DEFAULT false;
