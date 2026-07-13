DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'eformsign_doc'
      AND column_name = 'document_kind'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'eformsign_doc.document_kind is missing or has the wrong shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'eformsign_doc'
      AND column_name = 'employee_schedule_id'
      AND data_type = 'integer'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'eformsign_doc.employee_schedule_id is missing or has the wrong shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'eformsign_doc'
      AND column_name = 'template_id'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'eformsign_doc.template_id is missing or has the wrong shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'message_log'
      AND column_name = 'recipient_name'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'message_log.recipient_name is missing or has the wrong shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'message_log'
      AND column_name = 'recipient_phone'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'message_log.recipient_phone is missing or has the wrong shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_eformsign_doc_document_kind'
  ) THEN
    RAISE EXCEPTION 'idx_eformsign_doc_document_kind is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_eformsign_doc_employee_schedule_id'
  ) THEN
    RAISE EXCEPTION 'idx_eformsign_doc_employee_schedule_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_eformsign_doc_template_id'
  ) THEN
    RAISE EXCEPTION 'idx_eformsign_doc_template_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_message_log_recipient_phone'
  ) THEN
    RAISE EXCEPTION 'idx_message_log_recipient_phone is missing';
  END IF;
END $$;
