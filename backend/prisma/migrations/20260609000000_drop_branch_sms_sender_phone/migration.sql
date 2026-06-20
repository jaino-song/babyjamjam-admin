-- Drop the per-branch SMS sender number column.
--
-- All aligo sends now use a single, company-pre-registered sending number
-- (010-9641-1878, env-overridable via ALIGO_SENDER_PHONE) instead of a per-tenant
-- number. The messaging-permission approval flow no longer collects a number,
-- so branch.sms_sender_phone is orphaned. The approval-status columns are kept
-- (the approval gate stays).
ALTER TABLE "branch" DROP COLUMN IF EXISTS "sms_sender_phone";
