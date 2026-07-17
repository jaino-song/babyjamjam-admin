DO $$
BEGIN
    IF to_regclass('public.auth_session') IS NULL THEN
        RAISE EXCEPTION 'auth_session table is missing';
    END IF;
    IF to_regclass('public.auth_refresh_token') IS NULL THEN
        RAISE EXCEPTION 'auth_refresh_token table is missing';
    END IF;
    IF to_regclass('public.auth_email_outbox') IS NULL THEN
        RAISE EXCEPTION 'auth_email_outbox table is missing';
    END IF;
    IF to_regclass('public.user_branch_user_id_branch_id_key') IS NULL THEN
        RAISE EXCEPTION 'user_branch membership unique index is missing';
    END IF;
    IF to_regclass('public.auth_refresh_token_session_active_key') IS NULL THEN
        RAISE EXCEPTION 'single active refresh credential index is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'auth_flow_state'
          AND column_name = 'session_id'
          AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION 'auth_flow_state.session_id is missing';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'auth_flow_state'
          AND column_name IN ('access_token', 'refresh_token')
    ) THEN
        RAISE EXCEPTION 'auth_flow_state still contains raw token columns';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_email_outbox_auth_token_id_fkey'
    ) THEN
        RAISE EXCEPTION 'auth_email_outbox auth token foreign key is missing';
    END IF;
END $$;
