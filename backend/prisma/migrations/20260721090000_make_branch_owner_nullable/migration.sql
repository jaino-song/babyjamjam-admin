-- Make branch.owner_id (지점장) optional and clear existing assignments.
-- One-shot: the UPDATE only runs on the first application, keyed on the
-- column still being NOT NULL. Re-runs are no-ops.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'branch'
      AND column_name = 'owner_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "branch" ALTER COLUMN "owner_id" DROP NOT NULL;
    UPDATE "branch" SET "owner_id" = NULL;
  END IF;
END $$;

COMMIT;
