-- Release preflight. Existing databases must have been staged by the operator.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $verify$
DECLARE
    expected record;
BEGIN
    -- A fresh database can replay the entire migration history. Prisma's
    -- bookkeeping table alone does not make it an application database.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'f')
          AND c.relname <> '_prisma_migrations'
    ) THEN
        RETURN;
    END IF;

    FOR expected IN
        SELECT * FROM (VALUES
            ('service_record_case', 'service_record_case_client_id_key', ARRAY['client_id']),
            ('service_record', 'service_record_schedule_id_key', ARRAY['schedule_id']),
            ('service_record_assignment', 'service_record_assignment_schedule_id_key', ARRAY['schedule_id']),
            ('service_record_day', 'service_record_day_schedule_id_session_index_key', ARRAY['schedule_id', 'session_index'])
        ) AS legacy(table_name, index_name, key_columns)
    LOOP
        IF to_regclass(format('public.%I', expected.index_name)) IS NOT NULL OR EXISTS (
            SELECT 1
            FROM pg_index i
            WHERE i.indrelid = to_regclass(format('public.%I', expected.table_name))
              AND i.indisunique AND i.indpred IS NULL
              AND i.indnkeyatts = cardinality(expected.key_columns)
              AND ARRAY(
                  SELECT pg_get_indexdef(i.indexrelid, key.position, false)
                  FROM generate_series(1, i.indnkeyatts) AS key(position)
              ) @> expected.key_columns
        ) THEN
            RAISE EXCEPTION 'Legacy baby case key still present for public.%', expected.table_name;
        END IF;
    END LOOP;

    -- Match the retained and replacement definitions in the canonical migration.
    FOR expected IN
        SELECT * FROM (VALUES
            ('service_record_case', 'uniq_service_record_case_branch_client_id', true,
                ARRAY['branch_id', 'client_id', 'id'], NULL, NULL),
            ('service_record_case', 'uniq_service_record_case_branch_id', true,
                ARRAY['branch_id', 'id'], NULL, NULL),
            ('service_record_case', 'uq_record_case_baby_scope', true,
                ARRAY['branch_id', 'client_id', 'baby_id'], NULL, NULL),
            ('service_record_case', 'uq_record_case_member_scope', true,
                ARRAY['branch_id', 'client_id', 'baby_id', 'id'], NULL, NULL),
            ('service_record_case', 'uq_service_record_case_baby', true,
                ARRAY['baby_id'], NULL, NULL),
            ('client_baby', 'uq_client_baby_ordinal', true,
                ARRAY['branch_id', 'client_id', 'ordinal'], NULL, NULL),
            ('service_record_day', 'uniq_service_record_day_case_session', true,
                ARRAY['service_record_case_id', 'case_session_index'], NULL, NULL),
            ('service_record', 'uq_record_hdr_sched_case', true,
                ARRAY['schedule_id', 'service_record_case_id'], NULL, NULL),
            ('service_record_assignment', 'uq_record_asn_sched_case', true,
                ARRAY['schedule_id', 'service_record_case_id'], NULL, NULL),
            ('service_record_day', 'uq_record_day_sched_case_session', true,
                ARRAY['schedule_id', 'service_record_case_id', 'session_index'], NULL, NULL),
            ('service_record', 'uq_record_hdr_sched_unbound', true,
                ARRAY['schedule_id'], '(service_record_case_id IS NULL)', NULL),
            ('service_record_day', 'uq_record_day_sched_session_unbound', true,
                ARRAY['schedule_id', 'session_index'],
                '((service_record_case_id IS NULL) AND (schedule_id IS NOT NULL))',
                '((schedule_id IS NOT NULL) AND (service_record_case_id IS NULL))'),
            ('service_record_case', 'uq_record_case_unbound_client', true,
                ARRAY['client_id'],
                '((baby_id IS NULL) AND (client_id IS NOT NULL))',
                '((client_id IS NOT NULL) AND (baby_id IS NULL))'),
            ('service_record_case', 'idx_record_case_client', false,
                ARRAY['client_id'], NULL, NULL)
        ) AS scoped(table_name, index_name, is_unique, key_columns, predicate, reversed_predicate)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_am am ON am.oid = c.relam
            WHERE i.indexrelid = to_regclass(format('public.%I', expected.index_name))
              AND i.indrelid = to_regclass(format('public.%I', expected.table_name))
              AND c.relkind = 'i' AND am.amname = 'btree'
              AND i.indisunique = expected.is_unique
              AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
              AND NOT (i.indisprimary OR i.indisexclusion OR i.indnullsnotdistinct)
              AND i.indexprs IS NULL AND i.indnatts = i.indnkeyatts
              AND 0 = ALL(i.indoption::smallint[]) AND 0 = ALL(i.indcollation::oid[])
              AND NOT EXISTS (
                  SELECT 1 FROM pg_opclass op
                  WHERE op.oid = ANY(i.indclass::oid[]) AND NOT op.opcdefault
              )
              AND ARRAY(
                  SELECT a.attname::text
                  FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
                  ORDER BY key.position
              ) = expected.key_columns
              AND CASE WHEN expected.predicate IS NULL THEN i.indpred IS NULL
                  ELSE pg_get_expr(i.indpred, i.indrelid) IN (expected.predicate, expected.reversed_predicate)
              END
        ) THEN
            RAISE EXCEPTION 'Missing or incorrect staged baby case index public.%', expected.index_name;
        END IF;
    END LOOP;
END
$verify$;

COMMIT;
