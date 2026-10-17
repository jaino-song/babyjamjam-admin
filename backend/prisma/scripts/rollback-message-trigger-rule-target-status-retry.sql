-- Rollback for 20261013010000_add_message_trigger_rule_target_status_retry.
-- Roll the application back to a version that does not read
-- "message_trigger_rule"."target_client_status" / "retry_on_failure" BEFORE
-- running this; the current version selects both columns on every rule query.
-- Each routine's 대상 고객 상태 and 실패 시 재전송 choice is lost. Re-applying
-- the migration afterwards restores every routine to 전체 / 켬.
ALTER TABLE "message_trigger_rule"
  DROP COLUMN IF EXISTS "target_client_status",
  DROP COLUMN IF EXISTS "retry_on_failure";
