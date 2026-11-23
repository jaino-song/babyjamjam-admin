-- AlterTable
ALTER TABLE "message_trigger_rule" ADD COLUMN     "canceled_retry_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "canceled_retry_last_enabled_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "message_trigger_rule_branch_override" ADD COLUMN     "canceled_retry_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "canceled_retry_last_enabled_at" TIMESTAMPTZ(3);
