DO $$
DECLARE
    claims regclass := 'public.message_occurrence_claim'::regclass;
    attempts regclass := 'public.message_occurrence_manual_attempt'::regclass;
    missing text;
BEGIN
    IF (SELECT count(*) FROM pg_class
        WHERE oid IN (claims, attempts) AND relkind = 'r' AND relrowsecurity) <> 2
        OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN (claims, attempts))
    THEN
        RAISE EXCEPTION 'Expected both message occurrence ledger tables to use default-deny RLS';
    END IF;

    SELECT expected.name INTO missing
    FROM (VALUES
        (claims, 'message_occurrence_claim_pkey', 'branch_id, occurrence_key', true, false),
        (attempts, 'message_occurrence_manual_attempt_pkey', 'branch_id, occurrence_key, log_id', true, false),
        (claims, 'message_occurrence_claim_holder_idx', 'holder_log_id', false, false),
        (claims, 'message_occurrence_claim_accepted_idx', 'accepted_log_id', false, false),
        (attempts, 'message_occurrence_manual_attempt_log_idx', 'log_id', false, false),
        ('public.message_log'::regclass, 'message_log_occurrence_history_idx', 'branch_id, client_id, template_key', false, true)
    ) AS expected(relation, name, columns, primary_key, partial)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_index AS idx
        WHERE idx.indexrelid = to_regclass('public.' || expected.name)
          AND idx.indrelid = expected.relation AND idx.indisvalid AND idx.indisready
          AND idx.indisprimary = expected.primary_key
          AND (idx.indpred IS NOT NULL) = expected.partial
          AND expected.columns = (
              SELECT string_agg(pg_get_indexdef(idx.indexrelid, n, false), ', ' ORDER BY n)
              FROM generate_series(1, idx.indnkeyatts) AS keys(n)
          )
    )
    LIMIT 1;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Missing or incompatible message occurrence index %', missing;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = attempts AND confrelid = claims AND contype = 'f' AND convalidated
          AND pg_get_constraintdef(oid) = 'FOREIGN KEY (branch_id, occurrence_key) REFERENCES message_occurrence_claim(branch_id, occurrence_key) ON DELETE RESTRICT'
    ) THEN
        RAISE EXCEPTION 'Missing message occurrence manual attempt foreign key';
    END IF;
END
$$;
