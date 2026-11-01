-- Release 1 of the branch "owner" -> "admin" rename (expand step of expand/contract).
--
-- The branch-level 지점장 column is renamed owner_id -> admin_id. Production swaps
-- containers only after this migration has run, and the fallback server never runs
-- migrations, so old code (reads/writes owner_id) and new code (reads/writes admin_id)
-- must both work against the migrated database at the same time:
--   * admin_id is added and backfilled from owner_id;
--   * trigger branch_sync_admin_owner mirrors a write to either column into the other
--     and rejects a write that sets the two columns to different values;
--   * the foreign key and index move to admin_id (every owner_id write is mirrored into
--     admin_id, so a bad id still fails the admin_id foreign key).
-- Release 2 (contract) drops the trigger, its function and owner_id. This file is
-- re-executed on every push (database-patches.yml), so every statement is re-runnable,
-- and everything that names owner_id is guarded so the file keeps working after Release 2.
BEGIN;

ALTER TABLE "branch" ADD COLUMN IF NOT EXISTS "admin_id" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'branch'
      AND column_name = 'owner_id'
  ) THEN
    CREATE OR REPLACE FUNCTION branch_sync_admin_owner() RETURNS trigger AS $fn$
    DECLARE
      admin_changed boolean;
      owner_changed boolean;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.admin_id IS NOT NULL AND NEW.owner_id IS NOT NULL
           AND NEW.admin_id IS DISTINCT FROM NEW.owner_id THEN
          RAISE EXCEPTION 'branch.admin_id and branch.owner_id must match (admin_id=%, owner_id=%)',
            NEW.admin_id, NEW.owner_id;
        ELSIF NEW.admin_id IS NULL THEN
          NEW.admin_id := NEW.owner_id;
        ELSE
          NEW.owner_id := NEW.admin_id;
        END IF;
      ELSE
        admin_changed := NEW.admin_id IS DISTINCT FROM OLD.admin_id;
        owner_changed := NEW.owner_id IS DISTINCT FROM OLD.owner_id;
        IF admin_changed AND owner_changed
           AND NEW.admin_id IS DISTINCT FROM NEW.owner_id THEN
          RAISE EXCEPTION 'branch.admin_id and branch.owner_id must match (admin_id=%, owner_id=%)',
            NEW.admin_id, NEW.owner_id;
        ELSIF admin_changed THEN
          NEW.owner_id := NEW.admin_id;
        ELSIF owner_changed THEN
          NEW.admin_id := NEW.owner_id;
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS branch_sync_admin_owner ON "branch";
    CREATE TRIGGER branch_sync_admin_owner
      BEFORE INSERT OR UPDATE ON "branch"
      FOR EACH ROW EXECUTE FUNCTION branch_sync_admin_owner();

    UPDATE "branch" SET "admin_id" = "owner_id" WHERE "admin_id" IS DISTINCT FROM "owner_id";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branch_admin_id_fkey'
  ) THEN
    ALTER TABLE "branch"
      ADD CONSTRAINT "branch_admin_id_fkey"
      FOREIGN KEY ("admin_id") REFERENCES "user"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_branch_admin" ON "branch"("admin_id");

ALTER TABLE "branch" DROP CONSTRAINT IF EXISTS "branch_owner_id_fkey";
DROP INDEX IF EXISTS "idx_branch_owner";

COMMIT;
