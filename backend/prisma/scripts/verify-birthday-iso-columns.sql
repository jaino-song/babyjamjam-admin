DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('client', 'employee')
      AND column_name = 'birthday'
      AND data_type = 'character varying'
      AND character_maximum_length = 10
  ) <> 2 THEN
    RAISE EXCEPTION 'client and employee birthday columns must both be VARCHAR(10)';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('service_record', 'service_record_case')
      AND column_name IN ('mom_birth', 'baby_birth')
      AND data_type = 'character varying'
      AND (character_maximum_length >= 10 OR character_maximum_length IS NULL)
  ) <> 4 THEN
    RAISE EXCEPTION 'All four service-record birthday columns must support YYYY-MM-DD storage';
  END IF;
END $$;
