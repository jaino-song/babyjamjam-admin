-- Preflight for any application rollback that crosses BJJ-439 (eformsign_doc void).
-- Manual operator tool. Do NOT wire it into database-patches.yml or any workflow:
-- it raises on purpose once a void exists, which would fail every patch run.
--
-- Rule: after the first contract is voided, the application must not be rolled back to
-- a release that does not read eformsign_doc.voided_at. That older release ignores the
-- columns, so every voided contract (including signed ones) is treated as active again
-- (receipt links resume, voided signed contracts auto-finalize). Fix problems by rolling
-- FORWARD instead.
--
-- Read-only and idempotent. Passes with a notice when the table or column does not exist.
-- Run with: psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f preflight-app-rollback-voided.sql
-- (ON_ERROR_STOP=1 makes psql exit non-zero when the check fails; without it the exit code is 0.)
DO $$
DECLARE
  voided_count bigint;
BEGIN
  IF to_regclass(format('%I.eformsign_doc', current_schema())) IS NULL THEN
    RAISE NOTICE 'eformsign_doc does not exist in schema %; no voided contracts, rollback is safe.', current_schema();
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'eformsign_doc'
      AND column_name = 'voided_at'
  ) THEN
    RAISE NOTICE 'eformsign_doc.voided_at does not exist; no voided contracts, rollback is safe.';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM eformsign_doc WHERE voided_at IS NOT NULL' INTO voided_count;

  IF voided_count > 0 THEN
    RAISE EXCEPTION
      '% voided contract(s) exist. Rolling the application back below BJJ-439 would make them active again. Roll forward instead.',
      voided_count;
  END IF;

  RAISE NOTICE 'No voided contracts; application rollback across BJJ-439 is safe until the first void.';
END
$$;
