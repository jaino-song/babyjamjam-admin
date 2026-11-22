import { Prisma } from "@prisma/client";

/** INITIAL starts capability_unverified/pending and dispatch authorization advances it to processing. */
export const INITIAL_FINALIZATION_CANCELLABLE_STATE_STATUSES: readonly string[] = [
    "capability_unverified", "pending", "processing",
];

/** SQL twin of isInitialFinalizationJobIdentity. Aliases are source-owned, never request input. */
export function initialFinalizationJobSql(alias = ""): Prisma.Sql {
    const c = (name: string) => alias ? `${alias}.${name}` : name;
    const p = c("payload");
    return Prisma.raw(`COALESCE((${c("job_type")} = 'create_document'
        AND ${c("source")} = 'auto_finalize' AND ${c("document_id")} IS NULL
        AND jsonb_typeof(${p}) = 'object'
        AND ${p}->>'kind' = 'service_record_revision'
        AND ${p}->>'generationKind' = 'INITIAL_FINALIZATION'
        AND jsonb_typeof(${p}->'revisionId') = 'string' AND length(${p}->>'revisionId') > 0
        AND jsonb_typeof(${p}->'context') = 'object'
        AND ${p}->'context'->'revisionId' = ${p}->'revisionId'
        AND ${c("request_key")} = 'service-record-initial-finalization:' || (${p}->>'revisionId')
        AND ${p}->'snapshotReference' = to_jsonb(${c("request_key")})), false)`);
}

/** Contract cancellation uses the step; INITIAL cancellation also preserves post-send step evidence. */
export function cancelledDocumentJobSql(alias = ""): Prisma.Sql {
    const c = (name: string) => Prisma.raw(alias ? `${alias}.${name}` : name);
    return Prisma.sql`(${c("progress_step")} IS NOT DISTINCT FROM 'cancelled'
        OR (${initialFinalizationJobSql(alias)} AND ${c("last_error_code")} IS NOT DISTINCT FROM 'JOB_CANCELLED_AFTER_DISPATCH'))`;
}

/** Row eligibility only. Retry additionally verifies the frozen state, fingerprint and current owner. */
export function initialFinalizationRetryCandidateSql(alias = ""): Prisma.Sql {
    const c = (name: string) => Prisma.raw(alias ? `${alias}.${name}` : name);
    return Prisma.sql`(${initialFinalizationJobSql(alias)}
        AND ${c("status")} IN ('failed', 'requires_attention') AND ${c("lease_token")} IS NULL
        AND COALESCE(${c("progress_step")}, '') IN ('', 'queued', 'validating', 'preparing')
        AND COALESCE(${c("progress_detail")}, '') NOT IN ('dispatch_authorized', 'creating', 'sent', 'reconciling')
        AND ${c("last_error_code")} IN ('SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED', 'PRE_SEND_RETRY_EXHAUSTED'))`;
}

/** SQL display binding for INITIAL cancel; POST repeats this under the common owning locks.
 * documentStateId is looked up as a UUID by POST; normalize its text without casting untrusted JSON.
 * Case/revision/generation remain exact text bindings, matching their TS comparisons.
 */
export function initialFinalizationCancellableSql(): Prisma.Sql {
    return Prisma.sql`(${initialFinalizationJobSql("j")}
        AND j.status IN ('failed', 'requires_attention') AND j.lease_token IS NULL
        AND NOT ${cancelledDocumentJobSql("j")}
        AND EXISTS (SELECT 1 FROM service_record_revision_document_state s
            WHERE lower(j.payload->>'documentStateId') = s.id::text
              AND s.branch_id = j.branch_id AND s.client_id = j.client_id
              AND s.status IN ('capability_unverified', 'pending', 'processing')
              AND to_jsonb(s.service_record_case_id::text) = j.payload->'context'->'serviceRecordCaseId'
              AND to_jsonb(s.revision_id::text) = j.payload->'revisionId'
              AND to_jsonb(s.generation) = j.payload->'generation'
              AND COALESCE(to_jsonb(s.document_version), 'null'::jsonb) = j.payload->'documentVersion'
              AND s.input_fingerprint = j.payload_fingerprint AND s.operation = 'record_snapshot'
              AND s.workflow_scope->>'generationKind' = 'INITIAL_FINALIZATION'
              AND s.workflow_scope->'requestKey' = to_jsonb(j.request_key)))`;
}
