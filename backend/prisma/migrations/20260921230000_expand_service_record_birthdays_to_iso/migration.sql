-- Expand storage before deploying the YYYY-MM-DD service-record input contract.
-- Preserve existing values, including legacy YYMMDD values and NULLs.
-- Replayed deployments must not shrink columns that were widened further.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  target RECORD;
  storage_type TEXT;
  storage_limit INTEGER;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('service_record', 'mom_birth'),
      ('service_record', 'baby_birth'),
      ('service_record_case', 'mom_birth'),
      ('service_record_case', 'baby_birth')
    ) AS fields(table_name, column_name)
  LOOP
    SELECT c.data_type, c.character_maximum_length
      INTO storage_type, storage_limit
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = target.table_name
        AND c.column_name = target.column_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing birthday column: public.%.%', target.table_name, target.column_name;
    END IF;
    IF storage_type IS DISTINCT FROM 'character varying' THEN
      RAISE EXCEPTION 'Unexpected birthday column type: public.%.% (%)', target.table_name, target.column_name, storage_type;
    END IF;

    IF storage_limit IS NOT NULL AND storage_limit < 10 THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE VARCHAR(10)',
        target.table_name, target.column_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
