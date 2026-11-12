-- Manual aggregate-only report; never wire into database-patches.yml.
-- Run with psql --no-psqlrc --set ON_ERROR_STOP=1 and an approved explicit DIRECT_URL.
-- This snapshot does not fence writers or authorize deployment/rollback.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL row_security = off;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $report$
DECLARE
    unexpected_jobs bigint;
    unexpected_intents bigint;
    unexpected_authorities bigint;
    authority_total bigint;
    authority_phases jsonb;
    bound_nonterminal bigint;
    unbound_effects bigint;
    bound_effects bigint;
    legacy_recoverable bigint;
    legacy_purged_effects bigint;
    revision_key_jobs bigint;
    revision_payload_jobs bigint;
    unexpected_payload_kinds bigint;
BEGIN
    -- Unknown states must not disappear behind a known-state filter.
    SELECT count(*) INTO unexpected_jobs FROM public.eformsign_document_job
    WHERE status IS NULL OR status NOT IN ('queued','processing','reconciling','requires_attention','failed','completed')
       OR source IS NULL OR source NOT IN ('staff','auto_finalize')
       OR job_type IS NULL OR job_type NOT IN ('create_document','finalize_document');
    SELECT count(*) INTO unexpected_intents FROM public.eformsign_dispatch_intent
    WHERE status IS NULL OR status NOT IN ('prepared','started','uncertain','accepted','reconciled_not_delivered','reconciled_delivered')
       OR action IS NULL OR action NOT IN ('create','create_draft','finalize','manual_process');
    SELECT count(*), count(*) FILTER (WHERE phase IS NULL OR phase NOT IN
        ('reserved','creation_pending','creation_uncertain','document_ready','human_exposed','verified','blocked','closed')),
        jsonb_build_object(
            'reserved', count(*) FILTER (WHERE phase='reserved'),
            'creation_pending', count(*) FILTER (WHERE phase='creation_pending'),
            'creation_uncertain', count(*) FILTER (WHERE phase='creation_uncertain'),
            'document_ready', count(*) FILTER (WHERE phase='document_ready'),
            'human_exposed', count(*) FILTER (WHERE phase='human_exposed'),
            'verified', count(*) FILTER (WHERE phase='verified'),
            'blocked', count(*) FILTER (WHERE phase='blocked'),
            'closed', count(*) FILTER (WHERE phase='closed'))
    INTO authority_total, unexpected_authorities, authority_phases
    FROM public.eformsign_contract_authority;

    -- Include every generation-bound nonterminal job, even one whose payload was purged.
    SELECT count(*) INTO bound_nonterminal FROM public.eformsign_document_job
    WHERE contract_generation IS NOT NULL AND status NOT IN ('completed','failed');
    -- Automatic create business generations differ from the authority UUID.
    -- Only durable scoped intent references prove binding; no generation-string guess.
    SELECT count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM public.eformsign_contract_authority a
               WHERE a.branch_id=i.branch_id AND a.client_id=i.client_id
                 AND ((i.action='create' AND a.creation_intent_id=i.id)
                   OR (i.action='create_draft' AND a.draft_intent_id=i.id)))),
           count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM public.eformsign_contract_authority a
               WHERE a.branch_id=i.branch_id AND a.client_id=i.client_id
                 AND ((i.action='create' AND a.creation_intent_id=i.id)
                   OR (i.action='create_draft' AND a.draft_intent_id=i.id))))
    INTO unbound_effects, bound_effects
    FROM public.eformsign_dispatch_intent i
    WHERE i.action IN ('create','create_draft') AND i.status IN ('started','uncertain');

    RAISE NOTICE 'unexpected_jobs=% unexpected_intents=% unexpected_authorities=%',
        unexpected_jobs, unexpected_intents, unexpected_authorities;
    RAISE NOTICE 'authority_total=% authority_by_phase=%', authority_total, authority_phases;
    RAISE NOTICE 'generation_bound_nonterminal_jobs=% unresolved_unbound_create_or_draft=% unresolved_bound_create_or_draft=%',
        bound_nonterminal, unbound_effects, bound_effects;
    -- Contract-create semantics match the persisted staff/request-key/payload-kind boundary.
    -- No TTL filter: failed payload-present or active-key work stays recoverable;
    -- a same-scope unresolved effect also keeps payload-purged/expired work visible.
    WITH classified AS (
        SELECT j.contract_generation, j.status, j.payload, j.active_key,
            EXISTS (SELECT 1 FROM public.eformsign_dispatch_intent i
                WHERE i.branch_id=j.branch_id AND i.client_id=j.client_id
                  AND i.action IN ('create','create_draft') AND i.status IN ('started','uncertain')) AS has_effect
        FROM public.eformsign_document_job j
        WHERE j.source='staff' AND j.job_type='create_document'
          AND j.request_key NOT LIKE 'service-record-%'
          AND (j.payload IS NULL OR NOT (j.payload ? 'kind'))
    )
    SELECT count(*) FILTER (WHERE contract_generation IS NULL AND
            (status IN ('queued','processing','reconciling','requires_attention')
             OR (status='failed' AND (payload IS NOT NULL OR active_key IS NOT NULL OR has_effect)))),
        count(*) FILTER (WHERE contract_generation IS NULL AND status='failed'
            AND payload IS NULL AND has_effect)
    INTO legacy_recoverable, legacy_purged_effects FROM classified;
    SELECT count(*) FILTER (WHERE request_key LIKE 'service-record-%'),
        count(*) FILTER (WHERE jsonb_typeof(payload)='object' AND payload->>'kind'='service_record_revision'),
        count(*) FILTER (WHERE request_key NOT LIKE 'service-record-%' AND payload ? 'kind'
            AND (payload->>'kind' IS DISTINCT FROM 'service_record_revision'))
    INTO revision_key_jobs, revision_payload_jobs, unexpected_payload_kinds
    FROM public.eformsign_document_job WHERE source='staff' AND job_type='create_document';
    RAISE NOTICE 'legacy_unbound_recoverable_staff_create_jobs=% legacy_payload_purged_with_unresolved_effect=%',
        legacy_recoverable, legacy_purged_effects;
    RAISE NOTICE 'service_record_request_key_jobs=% service_record_revision_payload_jobs=% unexpected_staff_create_payload_kinds=%',
        revision_key_jobs, revision_payload_jobs, unexpected_payload_kinds;

    IF unexpected_jobs + unexpected_intents + unexpected_authorities + unexpected_payload_kinds > 0 THEN
        RAISE EXCEPTION 'CONTRACT_AUTHORITY_PREFLIGHT_REFUSED: unexpected persisted state';
    END IF;
    IF legacy_recoverable > 0 OR unbound_effects > 0 THEN
        RAISE EXCEPTION 'CONTRACT_AUTHORITY_CUTOVER_REFUSED: legacy work requires compatible operator resolution';
    END IF;
    IF authority_total > 0 OR bound_nonterminal > 0 OR bound_effects > 0 THEN
        RAISE NOTICE 'VERDICT: COMPATIBLE_FORWARD_ONLY_OLD_ROLLBACK_UNSUPPORTED';
    ELSE
        RAISE NOTICE 'VERDICT: LEGACY_CUTOVER_CLEAR';
    END IF;
END
$report$;
COMMIT;
