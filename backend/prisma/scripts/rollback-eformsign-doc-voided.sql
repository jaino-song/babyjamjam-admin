-- Rollback for 20261014000000_add_eformsign_doc_voided (BJJ-439).
--
-- Rule: once any contract has been voided, the application must NOT be rolled back to a
-- release that does not read eformsign_doc.voided_at, with or without these columns. That
-- older release treats voided contracts as active again (receipt links resume, voided signed
-- contracts auto-finalize). After the first void, fix problems by rolling forward.
--
-- Run preflight-app-rollback-voided.sql first. This script is only for a database where no
-- void has ever happened: the application is rolled back first, then the unused columns are
-- dropped. It refuses to drop while voided rows exist, and the check and the DROP live in
-- one DO block so a failed check cannot be followed by a top-level DROP under psql's default
-- ON_ERROR_STOP=0. Idempotent: it is a no-op notice when the table or columns are absent.
DO $$
DECLARE
  voided_count bigint;
BEGIN
  IF to_regclass(format('%I.eformsign_doc', current_schema())) IS NULL THEN
    RAISE NOTICE 'eformsign_doc does not exist in schema %; nothing to roll back.', current_schema();
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'eformsign_doc'
      AND column_name = 'voided_at'
  ) THEN
    RAISE NOTICE 'eformsign_doc.voided_at does not exist; dropping any leftover voided_by only.';
    EXECUTE 'ALTER TABLE eformsign_doc DROP COLUMN IF EXISTS voided_by';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM eformsign_doc WHERE voided_at IS NOT NULL' INTO voided_count;

  IF voided_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop voided_at/voided_by: % voided contract(s) exist and dropping would erase the void history and make them active again. Roll forward instead; do not roll the application back below BJJ-439.',
      voided_count;
  END IF;

  EXECUTE 'ALTER TABLE eformsign_doc DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS voided_by';
END
$$;
