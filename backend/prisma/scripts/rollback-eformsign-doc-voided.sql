-- Rollback for 20261014000000_add_eformsign_doc_voided.
-- Roll the application back first, BEFORE dropping columns the current version reads.
-- Dropping the columns erases all void history. Voided contracts become live again:
-- receipt links resume, and voided signed contracts auto-finalize.
ALTER TABLE "eformsign_doc"
  DROP COLUMN IF EXISTS "voided_at",
  DROP COLUMN IF EXISTS "voided_by";
