-- Manual rollback script (not executed by Prisma Migrate).
DROP INDEX IF EXISTS "idx_message_log_carrier_check_due";

ALTER TABLE "message_log"
    DROP COLUMN IF EXISTS "carrier_results",
    DROP COLUMN IF EXISTS "carrier_result_state",
    DROP COLUMN IF EXISTS "carrier_checked_at",
    DROP COLUMN IF EXISTS "carrier_check_due_at";
