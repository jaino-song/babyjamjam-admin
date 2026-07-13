DO $$
BEGIN
    -- approval_status must exist, be NOT NULL (defaulted 'pending')
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user'
          AND column_name = 'approval_status' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'user.approval_status is missing or nullable';
    END IF;

    -- token_version must exist and be NOT NULL
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user'
          AND column_name = 'token_version' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'user.token_version is missing or nullable';
    END IF;

    -- approval metadata + requested_role columns must exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user' AND column_name='approved_at') THEN
        RAISE EXCEPTION 'user.approved_at is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user' AND column_name='approved_by') THEN
        RAISE EXCEPTION 'user.approved_by is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user' AND column_name='requested_role') THEN
        RAISE EXCEPTION 'user.requested_role is missing';
    END IF;

    -- allowed-status CHECK constraint must be present
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_approval_status_check') THEN
        RAISE EXCEPTION 'user_approval_status_check constraint is missing';
    END IF;

    -- no invalid/legacy status values may linger
    IF EXISTS (SELECT 1 FROM "user" WHERE "approval_status" NOT IN ('pending', 'approved', 'rejected')) THEN
        RAISE EXCEPTION 'user.approval_status contains invalid values';
    END IF;

    -- shared rate-limit store must exist
    IF to_regclass('public.auth_rate_limit') IS NULL THEN
        RAISE EXCEPTION 'auth_rate_limit table is missing';
    END IF;
END $$;
