-- Rollback for 20261013000000_add_client_booking_confirmed_at.
-- Roll the application back to a version that does not read
-- "client"."booking_confirmed_at" BEFORE running this; the current version
-- selects the column on every client query.
-- The confirmation timestamps are lost. Re-applying the migration afterwards
-- backfills again from the rule in the migration file.
ALTER TABLE "client"
  DROP COLUMN IF EXISTS "booking_confirmed_at";
