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
    -- These relation locks are the admission barrier for both routes, even
    -- on already-open connections. An existing writer makes NOWAIT fail.
    -- New writers queue behind us until COMMIT or ROLLBACK. Keep the replay's
    -- first lock first so an already-running replay also makes us fail.
    LOCK TABLE public.service_record_case, public.service_record, public.service_record_assignment,
        public.service_record_day IN ACCESS EXCLUSIVE MODE NOWAIT;

    -- READ COMMITTED checks below see durable admissions that committed
    -- before the last lock. No new admission can commit past this point.
    -- The shared queues can still serve reads, including unrelated jobs.
    LOCK TABLE public.client_baby, public.service_record_team_slot,
        public.service_record_baby_assignment, public.service_record_token,
        public.service_record_edit_draft, public.service_record_revision,
        public.service_record_day_edit_log, public.service_record_day_archive,
        public.service_record_revision_document_state, public.service_record_snapshot_chunk,
        public.service_record_job_member, public.message_trigger_job, public.message_log,
        public.message_occurrence_claim, public.message_occurrence_manual_attempt,
        public.eformsign_doc, public.eformsign_document_job,
        public.eformsign_dispatch_intent IN SHARE ROW EXCLUSIVE MODE NOWAIT;

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
          -- Terminal jobs keep their last claim token and deadline. They are
          -- settled, so only a non-terminal job with claim state is in flight.
          AND (j.status IN ('processing', 'dispatching')
               OR (j.status NOT IN ('sent', 'canceled', 'failed')
                   AND (j.claim_token IS NOT NULL OR j.processing_deadline_at IS NOT NULL))
               OR (j.cancel_reason = '제공기록지 링크 발송 작업 생성 재시도 대기'
                   AND j.next_attempt_at > clock_timestamp())
               -- Reclaim drops the claim token and persists no log id or
               -- attempt generation. A job-scoped key and either timestamp
               -- can also describe an earlier attempt. This cutover requires
               -- zero such ambiguous record-link jobs, even after log reconciliation.
               OR (j.status = 'failed'
                   AND j.cancel_reason = '문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.'))
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
          AND (l.provider_acceptance_state IN ('started', 'uncertain')
               OR (l.provider_acceptance_state = 'prepared' AND (
                   l.provider = 'aligo_sms' AND l.status = 'failed' AND l.next_retry_at IS NULL
                   AND l.provider_call_started_at IS NULL AND l.provider_accepted_at IS NULL
                   AND l.provider_reconciled_at IS NULL AND l.aligo_mid IS NULL
                   AND (
                       -- The provider gate canceled the current job and failed
                       -- its draft in the same transaction, before starting.
                       (j.branch_id = l.branch_id AND j.status = 'canceled' AND j.canceled_at IS NOT NULL
                        AND j.claim_token IS NULL AND j.processing_deadline_at IS NULL
                        AND j.cancel_reason = l.error_message AND (
                            (l.error_message = 'message_quiet_hours:CANCEL'
                             AND l.variables->>'quietHoursDisposition' = 'CANCEL')
                            OR ((j.recipient_employee_id IS NOT NULL OR j.payload ? 'recordLinkGroup'
                                 OR j.dedupe_key LIKE 'system:service_record_link:group:%')
                                AND l.error_message IN ('제공기록지 링크의 담당자 또는 발송 대상이 변경되었습니다',
                                    '메시지 발송 승인 필요', 'sms_automation_safeguard:branch',
                                    'sms_automation_safeguard:rule'))
                        ))
                       -- Rescheduling keeps the job id but retires the old
                       -- draft by removing its live job and acceptance identity.
                       OR (l.error_message = 'Service record link rescheduled' AND l.attempts = 0
                           AND l.trigger_job_id IS NULL AND l.provider_acceptance_key IS NULL
                           AND l.provider_acceptance_fingerprint IS NULL
                           AND l.variables->>'quietHoursDisposition' = 'DEFER'
                           AND l.variables->>'quietHoursReason' = 'message_quiet_hours:DEFER'
                           AND nullif(l.variables->>'supersededTriggerJobId', '') IS NOT NULL
                           AND l.variables->>'supersededProviderAcceptanceKey' ~ '^sms:[0-9a-f]{64}$'
                           AND l.variables->>'supersededProviderAcceptanceFingerprint' ~ '^[0-9a-f]{64}$')
                   )
               ) IS NOT TRUE)
               OR (l.provider_acceptance_state = 'legacy' AND
                   (l.status = 'pending' OR l.provider_call_started_at IS NOT NULL)))
    ) OR EXISTS (
        SELECT 1 FROM public.message_occurrence_claim c
        WHERE lower(c.template_key) IN ('service_record_link_sms', 'service_record_link', 'service_feedback_link_sms')
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
                              AND (d.document_kind = 'service_record_snapshot' OR d.service_record_case_id IS NOT NULL
                                   OR EXISTS (SELECT 1 FROM public.service_record_snapshot_chunk c
                                              WHERE c.document_id = d.document_id))))
              AND (j.status IN ('processing', 'reconciling', 'requires_attention') OR j.lease_token IS NOT NULL)
        )
    THEN
        RAISE EXCEPTION 'Outstanding or uncertain service-record document attempt';
    END IF;

    -- Staff finalization can run directly (without a document job), and
    -- deleting a snapshot records its cancellation intent on the document.
    IF EXISTS (
        SELECT 1 FROM public.eformsign_doc d
        WHERE (d.document_kind = 'service_record_snapshot' OR d.service_record_case_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.service_record_snapshot_chunk c
                          WHERE c.document_id = d.document_id))
          AND (d.permanent_purge_requested_at IS NOT NULL OR EXISTS (
              SELECT 1 FROM public.eformsign_dispatch_intent i
              WHERE i.branch_id = d.branch_id AND i.status IN ('started', 'uncertain')
                AND (i.local_document_id = d.id OR i.provider_document_id = d.document_id)
          ))
    ) THEN
        RAISE EXCEPTION 'Outstanding or uncertain service-record document attempt';
    END IF;

    -- Re-request uses an existing provider id. Check both stored views for
    -- any eligible record snapshot while writes to these rows are fenced.
    -- Mirror normalizeEformsignStepType / normalizeEformsignStatusCode:
    -- JS trims Unicode whitespace and pads short codes without truncation.
    IF EXISTS (
        SELECT 1 FROM public.eformsign_doc d
        WHERE d.voided_at IS NULL
          AND (d.document_kind = 'service_record_snapshot' OR d.service_record_case_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.service_record_snapshot_chunk c
                          WHERE c.document_id = d.document_id))
          AND EXISTS (
              SELECT 1
              FROM (VALUES (d.step_type, d.status_type),
                  (d.detail_payload#>>'{current_status,step_type}',
                   d.detail_payload#>>'{current_status,status_type}')) AS stored(step_type, status_type)
              CROSS JOIN (VALUES (
                  U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
              )) AS js(whitespace)
              CROSS JOIN LATERAL (VALUES (
                  lower(btrim(stored.status_type, js.whitespace) COLLATE "C")
              )) AS normalized(status_type)
              WHERE btrim(stored.step_type, js.whitespace) IN ('5', '05')
                AND (lpad(normalized.status_type, greatest(3, length(normalized.status_type)), '0')
                         IN ('001', '002', '010', '020', '030', '041', '043', '060', '063', '064', '070', '071')
                     OR normalized.status_type IN ('doc_tempsave', 'doc_create', 'doc_request_approval',
                         'doc_request_reception', 'doc_request_outsider', 'doc_refuse_revoke', 'doc_update',
                         'doc_request_participant', 'doc_rerequest_participant', 'doc_open_participant',
                         'doc_request_reviewer', 'doc_reject_reviewer'))
          )
    ) THEN
        RAISE EXCEPTION 'Service-record document allows an unfenced outsider re-request';
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
