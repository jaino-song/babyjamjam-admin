-- Repair the promotion gap where application code expects message_* tables but
-- the live database still has the historical alimtalk_* names.
--
-- This block is atomic and rerunnable:
-- - old name only: rename it
-- - new name only: leave it unchanged
-- - both or neither: fail closed instead of guessing which data is authoritative
--
-- Rollback note: the structural renames can be reversed before any new-version
-- writes occur. Provider normalization is intentionally forward-only because
-- the legacy values are no longer supported by the application.

DO $repair$
DECLARE
  pair RECORD;
  invalid_value_exists BOOLEAN;
BEGIN
  FOR pair IN
    SELECT *
    FROM (VALUES
      ('alimtalk_log', 'message_log'),
      ('alimtalk_trigger_rule', 'message_trigger_rule'),
      ('alimtalk_trigger_job', 'message_trigger_job')
    ) AS pairs(old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', pair.old_name)) IS NOT NULL THEN
      IF to_regclass(format('public.%I', pair.new_name)) IS NOT NULL THEN
        RAISE EXCEPTION 'both public.% and public.% exist; refusing an ambiguous rename',
          pair.old_name, pair.new_name;
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I RENAME TO %I',
        pair.old_name,
        pair.new_name
      );
    ELSIF to_regclass(format('public.%I', pair.new_name)) IS NULL THEN
      RAISE EXCEPTION 'neither public.% nor public.% exists', pair.old_name, pair.new_name;
    END IF;
  END LOOP;

  IF to_regclass('public.alimtalk_log_id_seq') IS NOT NULL THEN
    IF to_regclass('public.message_log_id_seq') IS NOT NULL THEN
      RAISE EXCEPTION 'both alimtalk_log_id_seq and message_log_id_seq exist';
    END IF;

    ALTER SEQUENCE public.alimtalk_log_id_seq RENAME TO message_log_id_seq;
  ELSIF to_regclass('public.message_log_id_seq') IS NULL THEN
    RAISE EXCEPTION 'message_log id sequence is missing';
  END IF;

  FOR pair IN
    SELECT *
    FROM (VALUES
      ('message_log', 'alimtalk_log_pkey', 'message_log_pkey'),
      ('message_trigger_rule', 'alimtalk_trigger_rule_pkey', 'message_trigger_rule_pkey'),
      ('message_trigger_job', 'alimtalk_trigger_job_pkey', 'message_trigger_job_pkey')
    ) AS pairs(table_name, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('public.%I', pair.table_name))
        AND conname = pair.old_name
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = to_regclass(format('public.%I', pair.table_name))
          AND conname = pair.new_name
      ) THEN
        RAISE EXCEPTION 'both constraints % and % exist on public.%',
          pair.old_name, pair.new_name, pair.table_name;
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
        pair.table_name,
        pair.old_name,
        pair.new_name
      );
    ELSIF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('public.%I', pair.table_name))
        AND conname = pair.new_name
    ) THEN
      RAISE EXCEPTION 'expected constraint % is missing on public.%',
        pair.new_name, pair.table_name;
    END IF;
  END LOOP;

  FOR pair IN
    SELECT *
    FROM (VALUES
      ('idx_alimtalk_log_branch', 'idx_message_log_branch'),
      ('idx_alimtalk_log_trigger_job_id', 'idx_message_log_trigger_job_id'),
      ('idx_alimtalk_log_status', 'idx_message_log_status'),
      ('idx_alimtalk_log_receiver', 'idx_message_log_receiver'),
      ('idx_alimtalk_log_created_at', 'idx_message_log_created_at'),
      ('idx_alimtalk_log_next_retry_at', 'idx_message_log_next_retry_at'),
      ('idx_alimtalk_trigger_rule_branch', 'idx_message_trigger_rule_branch'),
      ('idx_alimtalk_trigger_rule_active', 'idx_message_trigger_rule_active'),
      ('idx_alimtalk_trigger_rule_event_type', 'idx_message_trigger_rule_event_type'),
      ('alimtalk_trigger_job_dedupe_key_key', 'message_trigger_job_dedupe_key_key'),
      ('idx_alimtalk_trigger_job_branch', 'idx_message_trigger_job_branch'),
      ('idx_alimtalk_trigger_job_rule_id', 'idx_message_trigger_job_rule_id'),
      ('idx_alimtalk_trigger_job_status_scheduled_for', 'idx_message_trigger_job_status_scheduled_for'),
      ('idx_alimtalk_trigger_job_client_id', 'idx_message_trigger_job_client_id'),
      ('idx_alimtalk_trigger_job_employee_schedule_id', 'idx_message_trigger_job_employee_schedule_id')
    ) AS pairs(old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', pair.old_name)) IS NOT NULL THEN
      IF to_regclass(format('public.%I', pair.new_name)) IS NOT NULL THEN
        RAISE EXCEPTION 'both indexes % and % exist', pair.old_name, pair.new_name;
      END IF;

      EXECUTE format(
        'ALTER INDEX public.%I RENAME TO %I',
        pair.old_name,
        pair.new_name
      );
    ELSIF to_regclass(format('public.%I', pair.new_name)) IS NULL THEN
      RAISE EXCEPTION 'expected index % is missing', pair.new_name;
    END IF;
  END LOOP;

  EXECUTE $sql$
    UPDATE public.message_log
    SET provider = 'aligo_alimtalk'
    WHERE provider IN ('aligo', 'channeltalk')
  $sql$;

  EXECUTE $sql$
    UPDATE public.system_setting
    SET value = 'aligo_alimtalk'
    WHERE key = 'alimtalk_provider'
      AND value IN ('aligo', 'channeltalk')
  $sql$;

  EXECUTE $sql$
    SELECT EXISTS (
      SELECT 1
      FROM public.message_log
      WHERE provider NOT IN ('aligo_sms', 'aligo_alimtalk')
    )
  $sql$ INTO invalid_value_exists;

  IF invalid_value_exists THEN
    RAISE EXCEPTION 'message_log contains unsupported provider values after normalization';
  END IF;

  EXECUTE $sql$
    SELECT EXISTS (
      SELECT 1
      FROM public.system_setting
      WHERE key = 'alimtalk_provider'
        AND value NOT IN ('aligo_alimtalk', 'none')
    )
  $sql$ INTO invalid_value_exists;

  IF invalid_value_exists THEN
    RAISE EXCEPTION 'system_setting.alimtalk_provider contains unsupported values after normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('message_log', 'message_trigger_rule', 'message_trigger_job')
      AND indexname LIKE '%alimtalk%'
  ) THEN
    RAISE EXCEPTION 'alimtalk index name remains on renamed message tables';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('message_log', 'message_trigger_rule', 'message_trigger_job')
      AND c.conname LIKE '%alimtalk%'
  ) THEN
    RAISE EXCEPTION 'alimtalk constraint name remains on renamed message tables';
  END IF;
END;
$repair$;
