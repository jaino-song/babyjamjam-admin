-- Additive and idempotent for the database-patches workflow. Null means not voided.
-- AlterTable
ALTER TABLE "eformsign_doc" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "voided_by" UUID;
