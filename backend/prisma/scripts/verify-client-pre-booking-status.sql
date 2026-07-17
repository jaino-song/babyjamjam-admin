DO $$
DECLARE
  constraint_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'client'::regclass
    AND conname = 'client_service_status_allowed';

  IF constraint_definition IS NULL OR position('pre_booking' IN constraint_definition) = 0 THEN
    RAISE EXCEPTION 'client_service_status_allowed does not allow pre_booking';
  END IF;
END
$$;
