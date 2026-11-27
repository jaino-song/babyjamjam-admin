#!/usr/bin/env bash
set -euo pipefail
set +x

case "${1:-}" in
  apply) finish=COMMIT ;;
  rehearse) finish=ROLLBACK ;;
  *) echo 'Usage: cutover-baby-case-keys.sh {rehearse|apply}' >&2; exit 2 ;;
esac
if [[ $# != 1 || -z "${PGHOST:-}" || "$PGHOST" == *,* ||
      ! "${PGDATABASE:-}" =~ ^[[:alnum:]_-]+$ || -z "${PGUSER:-}" ||
      -n "${PGHOSTADDR:-}" || -n "${PGSERVICE:-}" ]]; then
  echo 'Specify one approved target with PGHOST, PGDATABASE and PGUSER (libpq settings).' >&2
  exit 2
fi
if [[ "$PGHOST" != /* && "${PGSSLMODE:-}" != verify-full ]]; then
  echo 'Use PGSSLMODE=verify-full for a TCP target.' >&2
  exit 2
fi

cd -- "$(dirname -- "$0")/.."
stage=prisma/scripts/stage-baby-case-keys.sql
verify=prisma/scripts/verify-baby-case-stage-before-release.sql
if ! cmp -s "$stage" prisma/migrations/20261126010000_baby_case_keys/migration.sql; then
  echo 'The canonical stage and migration differ. Review the candidate before cutover.' >&2
  exit 2
fi

# Render the fixed, repository-owned inputs before opening the connection.
# The outer transaction owns the locks, watchdogs, verification and commit.
render_stage_body() {
  printf '    EXECUTE $cutover_sql$\n'
  sed -E '/^BEGIN(;| ISOLATION LEVEL REPEATABLE READ READ ONLY;)$/d; /^COMMIT;$/d' "$1"
  printf '\n$cutover_sql$;\n'
}

sql="$(
  set -e
  cat <<'SQL'
BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '750ms';
SET LOCAL idle_in_transaction_session_timeout = '2s';
SET LOCAL client_connection_check_interval = '500ms';

DO $cutover$
DECLARE
    owner_instance text;
    owner_acquired_at timestamptz;
BEGIN
    -- The replay also takes a lock on service_record_case before deciding
    -- which layout to use. Keep that lock first and refuse active traffic.
    LOCK TABLE public.service_record_case, public.service_record, public.service_record_assignment,
        public.service_record_day IN ACCESS EXCLUSIVE MODE NOWAIT;

    -- Includes both HTTP writers and durable claims made before a vendor
    -- call. SELECTs can continue on these shared tables.
    LOCK TABLE public.client_baby, public.service_record_team_slot,
        public.service_record_baby_assignment, public.service_record_token,
        public.service_record_edit_draft, public.service_record_revision,
        public.service_record_day_edit_log, public.service_record_day_archive,
        public.service_record_revision_document_state, public.service_record_snapshot_chunk,
        public.service_record_job_member, public.message_trigger_job, public.message_log,
        public.message_occurrence_claim, public.message_occurrence_manual_attempt,
        public.eformsign_doc, public.eformsign_document_job IN SHARE ROW EXCLUSIVE MODE NOWAIT;

    -- Production patch replay uses db execute. If a Prisma migration ledger
    -- exists, serialize with writers and reject failed or conflicting rows.
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
        LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
        IF EXISTS (
            SELECT 1 FROM public._prisma_migrations
            WHERE rolled_back_at IS NULL AND (finished_at IS NULL OR
                migration_name = '20261126010000_baby_case_keys')
        ) THEN
            RAISE EXCEPTION 'Active, failed or conflicting Prisma migration ledger entry';
        END IF;
    END IF;

    -- A second run and a partially staged catalog need operator inspection.
    -- A historically present unbound-day index is validated by the stage.
    IF to_regclass('public.service_record_case_client_id_key') IS NULL
        OR to_regclass('public.service_record_schedule_id_key') IS NULL
        OR to_regclass('public.service_record_assignment_schedule_id_key') IS NULL
        OR to_regclass('public.service_record_day_schedule_id_session_index_key') IS NULL
        OR EXISTS (
            SELECT 1 FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relname IN (
                'uq_record_hdr_sched_case', 'uq_record_asn_sched_case', 'uq_record_day_sched_case_session',
                'uq_record_hdr_sched_unbound', 'uq_record_case_unbound_client', 'idx_record_case_client'
            )
        )
    THEN
        RAISE EXCEPTION 'Expected the complete singleton case-key layout';
    END IF;

    SELECT instance_id, acquired_at INTO owner_instance, owner_acquired_at
    FROM public.scheduler_lease
    WHERE name = 'background-owner' AND holder_id = 'lightnode' AND instance_id <> ''
      AND acquired_at <= renewed_at AND renewed_at <= clock_timestamp()
      AND renewed_at > clock_timestamp() - interval '30 seconds'
      AND expires_at > clock_timestamp() + interval '15 seconds';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'A freshly renewed LightNode scheduler owner is required';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.message_trigger_job j
        WHERE (j.rule_id = 'system:service_record_link' OR j.template_key = 'SERVICE_RECORD_LINK'
               OR j.recipient_employee_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.service_record_job_member m WHERE m.job_id = j.id))
          AND (j.status IN ('processing', 'dispatching') OR j.claim_token IS NOT NULL
               OR j.processing_deadline_at IS NOT NULL
               OR (j.cancel_reason = '제공기록지 링크 발송 작업 생성 재시도 대기'
                   AND j.next_attempt_at > clock_timestamp()))
    ) THEN
        RAISE EXCEPTION 'Outstanding service-record link claim';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.message_log l
        LEFT JOIN public.message_trigger_job j ON j.id = l.trigger_job_id
        WHERE (lower(l.template_key) IN ('service_record_link_sms', 'service_record_link', 'service_feedback_link_sms')
               OR j.rule_id = 'system:service_record_link' OR j.template_key = 'SERVICE_RECORD_LINK'
               OR j.recipient_employee_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.service_record_job_member m WHERE m.job_id = j.id))
          AND (l.provider_acceptance_state IN ('prepared', 'started', 'uncertain')
               OR (l.provider_acceptance_state = 'legacy' AND
                   (l.status = 'pending' OR l.provider_call_started_at IS NOT NULL)))
    ) OR EXISTS (
        SELECT 1 FROM public.message_occurrence_claim c
        WHERE lower(c.template_key) IN ('service_record_link_sms', 'service_record_link')
          AND (c.state IN ('in_flight', 'uncertain') OR EXISTS (
              SELECT 1 FROM public.message_occurrence_manual_attempt a
              WHERE a.branch_id = c.branch_id AND a.occurrence_key = c.occurrence_key
                AND a.state IN ('in_flight', 'uncertain')
          ))
    ) THEN
        RAISE EXCEPTION 'Outstanding or uncertain service-record SMS attempt';
    END IF;

    IF EXISTS (SELECT 1 FROM public.service_record_case WHERE status = 'FINALIZING')
        OR EXISTS (
            SELECT 1 FROM public.service_record_snapshot_chunk
            WHERE status IN ('CLAIMED', 'CREATE_REQUESTED', 'RECONCILING', 'MANUAL_REVIEW')
        )
        OR EXISTS (
            SELECT 1 FROM public.eformsign_document_job j
            WHERE (j.payload->>'kind' IN ('service_record_revision', 'service_record_revision_operations')
                   OR EXISTS (SELECT 1 FROM public.eformsign_doc d WHERE d.document_id = j.document_id
                              AND d.document_kind = 'service_record_snapshot'))
              AND (j.status IN ('processing', 'reconciling', 'requires_attention') OR j.lease_token IS NOT NULL)
        )
    THEN
        RAISE EXCEPTION 'Outstanding or uncertain service-record document attempt';
    END IF;

SQL
  render_stage_body "$stage"
  render_stage_body "$verify"
  cat <<'SQL'

    -- Renewals continue during staging. Pin the checked row only for the
    -- handoff to COMMIT, and abort if a renewal is using it at that instant.
    PERFORM 1 FROM public.scheduler_lease
    WHERE name = 'background-owner' AND holder_id = 'lightnode'
      AND instance_id = owner_instance AND acquired_at = owner_acquired_at
      AND renewed_at <= clock_timestamp() AND renewed_at > clock_timestamp() - interval '30 seconds'
      AND expires_at > clock_timestamp() + interval '5 seconds'
    FOR SHARE NOWAIT;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LightNode scheduler ownership changed or became stale during cutover';
    END IF;
END
$cutover$;
SQL
  printf '%s;\n' "$finish"
  printf '\\echo Baby case keys verified (%s).\n' "$finish"
)"

# Use a single controller process. A failed statement stops psql before it
# sends COMMIT. PostgreSQL times out even if it cannot see the client close.
export PGAPPNAME=bjj-baby-case-key-cutover PGCONNECT_TIMEOUT=4
exec psql -Xqw --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse --set=SHOW_CONTEXT=never <<< "$sql"
