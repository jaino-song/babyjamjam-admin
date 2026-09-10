-- AlterTable
ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS     "system_template_snapshot" JSONB;
