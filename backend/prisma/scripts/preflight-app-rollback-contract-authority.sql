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
    IF unexpected_jobs + unexpected_intents + unexpected_authorities > 0 THEN
        RAISE EXCEPTION 'CONTRACT_AUTHORITY_PREFLIGHT_REFUSED: unexpected persisted state';
    END IF;
    -- Closed rows still pin job/intent history through NO ACTION foreign keys.
    IF authority_total > 0 OR bound_nonterminal > 0 OR unbound_effects > 0 OR bound_effects > 0 THEN
        RAISE EXCEPTION 'OLD_APP_ROLLBACK_REFUSED: authority history or unresolved work remains';
    END IF;
    RAISE NOTICE 'VERDICT: OLD_APP_ROLLBACK_PREFLIGHT_CLEAR';
END
$report$;
COMMIT;
