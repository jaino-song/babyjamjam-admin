-- AlterTable
ALTER TABLE "message_trigger_rule"
    ADD COLUMN IF NOT EXISTS "canceled_retry_enabled_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "canceled_retry_last_enabled_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "message_trigger_rule_branch_override"
    ADD COLUMN IF NOT EXISTS "canceled_retry_enabled_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "canceled_retry_last_enabled_at" TIMESTAMPTZ(3);
