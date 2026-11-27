-- Keep the layout decision and the replay in one transaction. The explicit
-- stage locks service_record_case first, in ACCESS EXCLUSIVE mode.
DO $layout$
DECLARE
    has_case boolean := to_regclass('public.service_record_case') IS NOT NULL;
    expected record;
    legacy_keys integer := 0;
BEGIN
    IF has_case THEN
        LOCK TABLE public.service_record_case IN ACCESS SHARE MODE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN (
            'uq_record_hdr_sched_case', 'uq_record_asn_sched_case', 'uq_record_day_sched_case_session',
            'uq_record_hdr_sched_unbound', 'uq_record_day_sched_session_unbound',
            'uq_record_case_unbound_client', 'idx_record_case_client'
        )
    ) THEN
        IF NOT has_case THEN
            RAISE EXCEPTION 'Staged service-record indexes exist without public.service_record_case';
        END IF;
        -- Any sign of a stage requires the full release preflight before replay.
        PERFORM set_config('bjj.service_record_replay_layout', 'case', true);
        RETURN;
    END IF;

    FOR expected IN
        SELECT table_name, index_name, key_columns FROM (VALUES
            ('service_record_case', 'service_record_case_client_id_key', ARRAY['client_id']),
            ('service_record', 'service_record_schedule_id_key', ARRAY['schedule_id']),
            ('service_record_assignment', 'service_record_assignment_schedule_id_key', ARRAY['schedule_id']),
            ('service_record_day', 'service_record_day_schedule_id_session_index_key', ARRAY['schedule_id', 'session_index'])
        ) AS legacy(table_name, index_name, key_columns)
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_index i
            WHERE i.indexrelid = to_regclass(format('public.%I', expected.index_name))
              AND i.indrelid = to_regclass(format('public.%I', expected.table_name))
              AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
              AND i.indpred IS NULL AND i.indexprs IS NULL
              AND ARRAY(
                  SELECT pg_get_indexdef(i.indexrelid, key.position, false)
                  FROM generate_series(1, i.indnkeyatts) AS key(position)
              ) = expected.key_columns
        ) THEN
            legacy_keys := legacy_keys + 1;
        END IF;
    END LOOP;

    -- June initialized the two schedule keys. July creates the other two
    -- atomically with the case tables. Any other layout needs operator review.
    IF (has_case AND legacy_keys <> 4) OR (NOT has_case AND (
        legacy_keys <> 2
        OR to_regclass('public.service_record_assignment') IS NOT NULL
        OR to_regclass('public.service_record_snapshot_chunk') IS NOT NULL
        OR to_regclass('public.client_baby') IS NOT NULL
    )) THEN
        RAISE EXCEPTION 'Incomplete service-record replay layout; inspect legacy and staged keys';
    END IF;

    PERFORM set_config('bjj.service_record_replay_layout', 'legacy', true);
END
$layout$;
