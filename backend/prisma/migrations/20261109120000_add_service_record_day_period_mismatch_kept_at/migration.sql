-- Additive and safe to reapply. Retain confirmations on application rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "service_record_day" ADD COLUMN IF NOT EXISTS "period_mismatch_kept_at" TIMESTAMPTZ(6);

COMMIT;
