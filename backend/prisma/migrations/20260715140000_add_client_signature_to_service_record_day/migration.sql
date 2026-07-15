ALTER TABLE "service_record_day" ADD COLUMN IF NOT EXISTS "client_signature" text;
ALTER TABLE "service_record_day" ADD COLUMN IF NOT EXISTS "client_signed_at" timestamptz;

-- Heal dev: drop the short-lived mom_* columns from the pre-rename patch run (no-op on preview/prod — they never existed there).
ALTER TABLE "service_record_day" DROP COLUMN IF EXISTS "mom_signature";
ALTER TABLE "service_record_day" DROP COLUMN IF EXISTS "mom_signed_at";
