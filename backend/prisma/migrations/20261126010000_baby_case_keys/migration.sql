-- Run explicitly on the reviewed target, after draining singleton-key writers.
-- Once sibling rows exist, recovery must retain their case-scoped keys.
BEGIN;

SET LOCAL search_path = pg_catalog, public;
LOCK TABLE public.service_record_case, public.service_record, public.service_record_assignment,
    public.service_record_day IN ACCESS EXCLUSIVE MODE;

DO $stage$
DECLARE
    expected record;
    index_oid oid;
    table_oid oid;
    matches boolean;
    legacy_count integer := 0;
    legacy_drops text[] := ARRAY[]::text[];
    replacement_creates text[] := ARRAY[]::text[];
    statement text;
BEGIN
    FOR expected IN
        SELECT stage_role, table_name, index_name, is_unique, key_columns, predicate, reversed_predicate
        FROM (VALUES
            ('legacy', 'service_record_case', 'service_record_case_client_id_key', true,
                ARRAY['client_id'], NULL, NULL),
            ('legacy', 'service_record', 'service_record_schedule_id_key', true,
                ARRAY['schedule_id'], NULL, NULL),
            ('legacy', 'service_record_assignment', 'service_record_assignment_schedule_id_key', true,
                ARRAY['schedule_id'], NULL, NULL),
            ('legacy', 'service_record_day', 'service_record_day_schedule_id_session_index_key', true,
                ARRAY['schedule_id', 'session_index'], NULL, NULL),
            ('retained', 'service_record_case', 'uniq_service_record_case_branch_client_id', true,
                ARRAY['branch_id', 'client_id', 'id'], NULL, NULL),
            ('retained', 'service_record_case', 'uniq_service_record_case_branch_id', true,
                ARRAY['branch_id', 'id'], NULL, NULL),
            ('retained', 'service_record_case', 'uq_record_case_baby_scope', true,
                ARRAY['branch_id', 'client_id', 'baby_id'], NULL, NULL),
            ('retained', 'service_record_case', 'uq_record_case_member_scope', true,
                ARRAY['branch_id', 'client_id', 'baby_id', 'id'], NULL, NULL),
            ('retained', 'service_record_case', 'uq_service_record_case_baby', true,
                ARRAY['baby_id'], NULL, NULL),
            ('retained', 'client_baby', 'uq_client_baby_ordinal', true,
                ARRAY['branch_id', 'client_id', 'ordinal'], NULL, NULL),
            ('retained', 'service_record_day', 'uniq_service_record_day_case_session', true,
                ARRAY['service_record_case_id', 'case_session_index'], NULL, NULL),
            ('replacement', 'service_record', 'uq_record_hdr_sched_case', true,
                ARRAY['schedule_id', 'service_record_case_id'], NULL, NULL),
            ('replacement', 'service_record_assignment', 'uq_record_asn_sched_case', true,
                ARRAY['schedule_id', 'service_record_case_id'], NULL, NULL),
            ('replacement', 'service_record_day', 'uq_record_day_sched_case_session', true,
                ARRAY['schedule_id', 'service_record_case_id', 'session_index'], NULL, NULL),
            ('replacement', 'service_record', 'uq_record_hdr_sched_unbound', true,
                ARRAY['schedule_id'], '(service_record_case_id IS NULL)', NULL),
            ('replacement', 'service_record_day', 'uq_record_day_sched_session_unbound', true,
                ARRAY['schedule_id', 'session_index'],
                '((service_record_case_id IS NULL) AND (schedule_id IS NOT NULL))',
                '((schedule_id IS NOT NULL) AND (service_record_case_id IS NULL))'),
            ('replacement', 'service_record_case', 'uq_record_case_unbound_client', true,
                ARRAY['client_id'],
                '((baby_id IS NULL) AND (client_id IS NOT NULL))',
                '((client_id IS NOT NULL) AND (baby_id IS NULL))'),
            ('replacement', 'service_record_case', 'idx_record_case_client', false,
                ARRAY['client_id'], NULL, NULL)
        ) AS spec(stage_role, table_name, index_name, is_unique, key_columns, predicate, reversed_predicate)
    LOOP
        table_oid := to_regclass(format('public.%I', expected.table_name));
        index_oid := to_regclass(format('public.%I', expected.index_name));

        IF expected.stage_role = 'legacy' AND EXISTS (
            SELECT 1
            FROM pg_index other
            WHERE other.indrelid = table_oid
              AND other.indexrelid IS DISTINCT FROM index_oid
              AND other.indisunique AND other.indpred IS NULL
              AND other.indnkeyatts = cardinality(expected.key_columns)
              AND ARRAY(
                  SELECT pg_get_indexdef(other.indexrelid, key.position, false)
                  FROM generate_series(1, other.indnkeyatts) AS key(position)
              ) @> expected.key_columns
        ) THEN
            RAISE EXCEPTION 'Unexpected duplicate global key for public.%', expected.index_name;
        END IF;

        IF index_oid IS NULL THEN
            CASE expected.stage_role
                WHEN 'retained' THEN
                    RAISE EXCEPTION 'Missing retained index public.%', expected.index_name;
                WHEN 'replacement' THEN
                    replacement_creates := array_append(replacement_creates, format(
                        'CREATE %sINDEX %I ON public.%I USING btree (%s)%s',
                        CASE WHEN expected.is_unique THEN 'UNIQUE ' ELSE '' END,
                        expected.index_name, expected.table_name,
                        array_to_string(expected.key_columns, ', '),
                        coalesce(' WHERE ' || expected.predicate, '')
                    ));
                ELSE NULL;
            END CASE;
            CONTINUE;
        END IF;

        SELECT i.indrelid = table_oid
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
        INTO matches
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_am am ON am.oid = c.relam
        WHERE i.indexrelid = index_oid;

        IF matches IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Unexpected index definition for public.%', expected.index_name;
        END IF;

        IF expected.stage_role = 'legacy' THEN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = index_oid) THEN
                RAISE EXCEPTION 'Constraint depends on legacy index public.%', expected.index_name;
            END IF;
            legacy_count := legacy_count + 1;
            legacy_drops := array_append(legacy_drops, format('DROP INDEX public.%I', expected.index_name));
        END IF;
    END LOOP;

    IF legacy_count = 0 AND cardinality(replacement_creates) = 0 THEN
        RETURN;
    END IF;
    IF legacy_count <> 4 THEN
        RAISE EXCEPTION 'Incomplete case-key stage: expected four legacy indexes or all replacements';
    END IF;

    FOREACH statement IN ARRAY replacement_creates LOOP
        EXECUTE statement;
    END LOOP;
    FOREACH statement IN ARRAY legacy_drops LOOP
        EXECUTE statement;
    END LOOP;
END
$stage$;

COMMIT;
