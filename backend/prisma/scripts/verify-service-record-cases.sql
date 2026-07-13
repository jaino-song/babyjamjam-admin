DO $$
BEGIN
    IF to_regclass('public.service_record_case') IS NULL THEN
        RAISE EXCEPTION 'service_record_case table is missing';
    END IF;
    IF to_regclass('public.service_record_assignment') IS NULL THEN
        RAISE EXCEPTION 'service_record_assignment table is missing';
    END IF;
    IF to_regclass('public.service_record_snapshot_chunk') IS NULL THEN
        RAISE EXCEPTION 'service_record_snapshot_chunk table is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'service_record_day'
          AND column_name = 'service_record_case_id'
    ) THEN
        RAISE EXCEPTION 'service_record_day.service_record_case_id is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uniq_service_record_day_case_session'
    ) THEN
        RAISE EXCEPTION 'global service-record session unique index is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uniq_employee_feedback_token_active_case'
    ) THEN
        RAISE EXCEPTION 'active feedback token unique index is missing';
    END IF;
    IF EXISTS (
        SELECT "client_id" FROM "service_record_case" GROUP BY "client_id" HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate service_record_case rows exist for a client';
    END IF;
    IF EXISTS (
        SELECT "service_record_case_id"
        FROM "employee_feedback_token"
        WHERE "active" = true AND "service_record_case_id" IS NOT NULL
        GROUP BY "service_record_case_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'multiple active feedback tokens exist for a service record case';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM "service_record_day" d
        WHERE d."service_record_case_id" IS NULL OR d."case_session_index" IS NULL
    ) THEN
        RAISE EXCEPTION 'service_record_day rows are missing aggregate linkage';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM "client" c
        WHERE (
            c."start_date" IS NOT NULL
            OR EXISTS (SELECT 1 FROM "employee_schedule" s WHERE s."client_id" = c."id")
            OR EXISTS (
                SELECT 1 FROM "eformsign_doc" d
                WHERE d."client_id" = c."id" AND d."document_kind" = 'service_feedback_snapshot'
            )
        )
          AND NOT EXISTS (SELECT 1 FROM "service_record_case" rc WHERE rc."client_id" = c."id")
    ) THEN
        RAISE EXCEPTION 'eligible clients remain without a service_record_case; branch ownership could not be resolved';
    END IF;
END $$;
