import { Prisma } from "@prisma/client";

import type { InitialDocumentRegenerationProjection } from "domain/repositories/eformsign-document-job.repository.interface";

import {
    INITIAL_RUNNING_JOB_STATUSES,
    INITIAL_TERMINAL_PROVIDER_FAILURE_CODES,
    initialFinalizationStateSql,
    initialJobForCaseSql,
    initialRegenerationChunkBlocker,
    initialRegenerationStateBlocker,
    initialTombstoneEvaluatedSql,
    newestInitialFinalizationStateSql,
    type InitialRegenerationChunk,
    type InitialRegenerationDocument,
    type InitialRegenerationState,
} from "./service-record-initial-finalization.policy";

type ProjectedChunk = InitialRegenerationChunk & { document: InitialRegenerationDocument | null };

/** 완료된 job의 document_id와 무관하게 현재 revision의 실패 상태를 표시한다. */
export async function initialRegenerationProjections(
    tx: Prisma.TransactionClient, branchId: string,
): Promise<InitialDocumentRegenerationProjection[]> {
    // One advisory snapshot for all current candidates. The locked writer rechecks readiness.
    const candidates = await tx.$queryRaw<Array<InitialRegenerationState & {
        chunks: ProjectedChunk[]; jobInProgress: boolean;
    }>>(Prisma.sql`
        WITH candidates AS (
            SELECT state.id, state.branch_id, state.client_id, state.service_record_case_id,
                state.revision_id, state.generation, state.document_version, state.status, state.last_error_code
            FROM service_record_revision_document_state AS state
            JOIN service_record_case AS record ON record.id = state.service_record_case_id
                AND record.branch_id = state.branch_id AND record.client_id = state.client_id
                AND record.current_revision_id = state.revision_id
            WHERE state.branch_id = ${branchId}::uuid AND state.status = 'failed'
              AND ${initialFinalizationStateSql("state")} AND ${newestInitialFinalizationStateSql("state")}
        ), eligible AS (
            SELECT * FROM candidates
            WHERE last_error_code IN (${Prisma.join([...INITIAL_TERMINAL_PROVIDER_FAILURE_CODES])})
              AND document_version IS NOT NULL
        ), chunk_inputs AS (
            SELECT state.id, jsonb_agg(jsonb_build_object(
                'documentId', chunk.document_id, 'chunkIndex', chunk.chunk_index, 'chunkCount', chunk.chunk_count,
                'document', CASE WHEN doc.id IS NOT NULL THEN jsonb_build_object(
                    'documentId', doc.document_id, 'statusType', doc.status_type, 'voided', doc.voided_at IS NOT NULL,
                    'purgePending', doc.permanent_purge_requested_at IS NOT NULL,
                    'tombstoneEvaluated', ${initialTombstoneEvaluatedSql}
                ) END
            ) ORDER BY chunk.chunk_index, chunk.id) AS chunks
            FROM eligible AS state
            JOIN service_record_snapshot_chunk AS chunk ON chunk.branch_id = state.branch_id
                AND chunk.service_record_case_id = state.service_record_case_id
                AND chunk.revision_id = state.revision_id AND chunk.snapshot_version = state.document_version
            LEFT JOIN eformsign_doc AS doc ON doc.document_id = chunk.document_id AND doc.branch_id = chunk.branch_id
            GROUP BY state.id
        ), busy AS (
            SELECT state.id FROM eligible AS state
            WHERE EXISTS (
                SELECT 1 FROM eformsign_document_job AS job
                WHERE job.branch_id = state.branch_id AND job.client_id = state.client_id
                  AND ${initialJobForCaseSql(Prisma.sql`state.service_record_case_id::text`)}
                  AND (job.status IN (${Prisma.join(INITIAL_RUNNING_JOB_STATUSES)}) OR job.lease_token IS NOT NULL)
            )
        )
        SELECT state.id, state.branch_id AS "branchId", state.client_id AS "clientId",
            state.revision_id AS "revisionId", state.generation, state.document_version AS "documentVersion",
            state.status, state.last_error_code AS "lastErrorCode",
            COALESCE(chunk_inputs.chunks, '[]'::jsonb) AS chunks, busy.id IS NOT NULL AS "jobInProgress"
        FROM candidates AS state
        LEFT JOIN chunk_inputs ON chunk_inputs.id = state.id
        LEFT JOIN busy ON busy.id = state.id
        ORDER BY state.client_id, state.id
    `);
    return candidates.map(state => {
        const reasonCode = initialRegenerationStateBlocker(state)
            ?? initialRegenerationChunkBlocker(state, state.chunks, state.chunks.flatMap(chunk => chunk.document ? [chunk.document] : []))
            ?? (state.jobInProgress ? "SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS" : null);
        return { stateId: state.id, revisionId: state.revisionId, generation: state.generation,
            clientId: state.clientId, ready: reasonCode === null, reasonCode };
    });
}
