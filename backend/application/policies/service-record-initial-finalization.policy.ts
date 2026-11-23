import { Prisma } from "@prisma/client";

import { EFORMSIGN_COMPLETED_STATUS_CODES, EFORMSIGN_REJECTED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { eformsignStatusStorageValues, normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

export const INITIAL_FINALIZATION_REQUEST_PREFIX = "service-record-initial-finalization:";
const INITIAL_FINALIZATION_REQUEST_KEY_MAX_LENGTH = 255;
const INITIAL_FINALIZATION_GENERATION_PATTERN =
    /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

// 완료 이력이 유실된 삭제는 재생성 허용 코드에 포함하지 않는다.
export const SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED = "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED";
export const SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN = "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN";

export function initialFinalizationRequestKey(revisionId: string): string {
    return `${INITIAL_FINALIZATION_REQUEST_PREFIX}${revisionId}`;
}

export function initialFinalizationGenerationRequestKey(revisionId: string, generation: string): string {
    const key = `${initialFinalizationRequestKey(revisionId)}:${generation}`;
    if (!isInitialFinalizationRequestKeyFor(revisionId, key)) {
        throw new RangeError("Invalid INITIAL finalization generation request key");
    }
    return key;
}

export function isInitialFinalizationRequestKeyFor(revisionId: string, key: unknown): key is string {
    if (!revisionId || typeof key !== "string") return false;
    const legacyKey = initialFinalizationRequestKey(revisionId);
    if (key === legacyKey) return true;

    const generationPrefix = `${legacyKey}:`;
    return key.startsWith(generationPrefix)
        && INITIAL_FINALIZATION_GENERATION_PATTERN.test(key.slice(generationPrefix.length))
        && [...key].length <= INITIAL_FINALIZATION_REQUEST_KEY_MAX_LENGTH;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

export function isInitialFinalizationJobIdentity(job: {
    jobType: unknown; source: unknown; documentId: unknown; requestKey: unknown; payload: unknown;
}): boolean {
    const payload = record(job.payload);
    const context = record(payload?.["context"]);
    const revisionId = payload?.["revisionId"];
    return job.jobType === "create_document"
        && job.source === "auto_finalize"
        && job.documentId === null
        && payload?.["kind"] === "service_record_revision"
        && payload["generationKind"] === "INITIAL_FINALIZATION"
        && typeof revisionId === "string" && revisionId.length > 0
        && context?.["revisionId"] === revisionId
        && isInitialFinalizationRequestKeyFor(revisionId, job.requestKey)
        && payload["snapshotReference"] === job.requestKey;
}

export function isInitialFinalizationWorkflowScope(scope: unknown, requestKey: string): boolean {
    const value = record(scope);
    return value?.["generationKind"] === "INITIAL_FINALIZATION" && value["requestKey"] === requestKey;
}

export function isInitialFinalizationWorkflowScopeForRevision(scope: unknown, revisionId: string): boolean {
    const value = record(scope);
    return value?.["generationKind"] === "INITIAL_FINALIZATION"
        && isInitialFinalizationRequestKeyFor(revisionId, value["requestKey"]);
}

export const SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT = "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT";
export const SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH = "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH";

export const INITIAL_ABSENCE_PROOF_CODES: ReadonlySet<string> = new Set([
    SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT, SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH,
]);
export const INITIAL_TERMINAL_PROVIDER_FAILURE_CODES: ReadonlySet<string> = new Set([
    "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED", "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED",
    ...INITIAL_ABSENCE_PROOF_CODES,
]);
export const INITIAL_PROVIDER_FAILURE_CODES: ReadonlySet<string> = new Set([
    ...INITIAL_TERMINAL_PROVIDER_FAILURE_CODES,
    SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED, SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN,
]);

export const EFORMSIGN_TOMBSTONE_STATUS = "049";
export const EFORMSIGN_TOMBSTONE_STATUSES: ReadonlySet<string> = new Set([EFORMSIGN_TOMBSTONE_STATUS]);
export const INITIAL_RUNNING_JOB_STATUSES: readonly string[] = ["queued", "processing", "reconciling"];

/** The whitespace list is the ECMAScript trim set used by normalizeEformsignStatusCode. */
export function eformsignStatusMatchesSql(status: Prisma.Sql, codes: ReadonlySet<string>): Prisma.Sql {
    return Prisma.sql`lower(btrim(${status}, ${" \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"})) IN
        (${Prisma.join(eformsignStatusStorageValues(codes))})`;
}

// The chunk survives a scrubbed document. Bind the evaluator record to this exact tombstone,
// so a write for one chunk (or for an earlier purge of the same chunk) cannot clear another.
export const initialTombstoneEvaluationRecordSql =
    Prisma.sql`'INITIAL_TOMBSTONE_EVALUATED:' || EXTRACT(EPOCH FROM doc.updated_date)::text`;
export const initialTombstoneEvaluatedSql =
    Prisma.sql`COALESCE(chunk.last_error = ${initialTombstoneEvaluationRecordSql}, false)`;

export function initialJobForCaseSql(caseId: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`job.job_type = 'create_document' AND job.source = 'auto_finalize'
        AND ((job.payload->>'generationKind' = 'INITIAL_FINALIZATION'
            AND job.payload->'context'->>'serviceRecordCaseId' = ${caseId})
            OR job.active_key = ${INITIAL_FINALIZATION_REQUEST_PREFIX} || ${caseId})`;
}

/** Source-owned aliases only. History is ordered by creation, with a stable tie-breaker. */
export function initialFinalizationStateSql(alias: string): Prisma.Sql {
    return Prisma.raw(`COALESCE((${alias}.operation = 'record_snapshot'
        AND ${alias}.workflow_scope->>'generationKind' = 'INITIAL_FINALIZATION'), false)`);
}

export function newestInitialFinalizationStateSql(alias: string): Prisma.Sql {
    return Prisma.sql`NOT EXISTS (
        SELECT 1 FROM service_record_revision_document_state AS newer_initial
        WHERE newer_initial.branch_id = ${Prisma.raw(`${alias}.branch_id`)}
          AND newer_initial.client_id = ${Prisma.raw(`${alias}.client_id`)}
          AND newer_initial.service_record_case_id = ${Prisma.raw(`${alias}.service_record_case_id`)}
          AND newer_initial.revision_id = ${Prisma.raw(`${alias}.revision_id`)}
          AND ${initialFinalizationStateSql("newer_initial")}
          AND (newer_initial.created_at, newer_initial.id) > (${Prisma.raw(`${alias}.created_at`)}, ${Prisma.raw(`${alias}.id`)})
    )`;
}

export type InitialRegenerationState = {
    id: string; branchId: string; clientId: number; revisionId: string; generation: string;
    documentVersion: number | null; status: string; lastErrorCode: string | null;
};
export type InitialRegenerationReadiness =
    | { ready: true; state: InitialRegenerationState }
    | { ready: false; reason: string; state: InitialRegenerationState | null };

export type InitialRegenerationChunk = { documentId: string | null; chunkIndex: number; chunkCount: number };
export type InitialRegenerationDocument = {
    documentId: string; statusType: string; voided: boolean; purgePending: boolean; tombstoneEvaluated: boolean;
};

export function initialRegenerationStateBlocker(state: InitialRegenerationState): string | null {
    if (state.lastErrorCode === SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED) {
        return "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED";
    }
    if (state.status !== "failed" || !INITIAL_TERMINAL_PROVIDER_FAILURE_CODES.has(state.lastErrorCode ?? "")) {
        return state.lastErrorCode ?? "SERVICE_RECORD_INITIAL_STATE_NOT_READY";
    }
    return state.documentVersion === null ? "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS" : null;
}

export function initialRegenerationChunkBlocker(
    state: InitialRegenerationState,
    chunks: InitialRegenerationChunk[],
    documents: InitialRegenerationDocument[],
): string | null {
    const byId = new Map(documents.map(doc => [doc.documentId, {
        ...doc, statusType: normalizeEformsignStatusCode(doc.statusType),
    }]));
    const normalized = [...byId.values()];
    if (normalized.some(doc => EFORMSIGN_COMPLETED_STATUS_CODES.has(doc.statusType))) {
        return "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED";
    }
    if (normalized.some(doc => doc.statusType === EFORMSIGN_TOMBSTONE_STATUS && !doc.tombstoneEvaluated)) {
        return SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN;
    }
    if ((chunks.length === 0 && state.lastErrorCode !== SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT)
        || chunks.some((chunk, index) => chunk.chunkCount !== chunks.length || chunk.chunkIndex !== index + 1)) {
        return "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS";
    }
    const absentProved = INITIAL_ABSENCE_PROOF_CODES.has(state.lastErrorCode ?? "");
    if (chunks.some(chunk => {
        if (chunk.documentId === null) return !absentProved;
        const doc = byId.get(chunk.documentId);
        return !doc || doc.purgePending || (!doc.voided && !EFORMSIGN_REJECTED_STATUS_CODES.has(doc.statusType));
    })) return "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS";
    return null;
}

/** Writers own common client/case locks. Display projections may opt into advisory reads without locks. */
export async function initialRegenerationReadiness(
    tx: Prisma.TransactionClient, caseId: string, revisionId: string,
    options: { lock?: boolean } = {},
): Promise<InitialRegenerationReadiness> {
    const [owner] = await tx.$queryRaw<Array<{ id: string; branchId: string; clientId: number }>>(Prisma.sql`
        SELECT id, branch_id AS "branchId", client_id AS "clientId"
        FROM "service_record_case"
        WHERE id = ${caseId}::uuid AND current_revision_id = ${revisionId}::uuid
        ${options.lock === false ? Prisma.empty : Prisma.sql`FOR UPDATE`}
    `);
    if (!owner) return { ready: false, reason: "SERVICE_RECORD_INITIAL_REVISION_CHANGED", state: null };
    const [state] = await tx.$queryRaw<InitialRegenerationState[]>(Prisma.sql`
        SELECT state.id, state.branch_id AS "branchId", state.client_id AS "clientId",
            state.revision_id AS "revisionId", state.generation, state.document_version AS "documentVersion",
            state.status, state.last_error_code AS "lastErrorCode"
        FROM "service_record_revision_document_state" AS state
        WHERE state.branch_id = ${owner.branchId}::uuid AND state.client_id = ${owner.clientId}
          AND state.service_record_case_id = ${caseId}::uuid AND state.revision_id = ${revisionId}::uuid
          AND ${initialFinalizationStateSql("state")}
        ORDER BY state.created_at DESC, state.id DESC LIMIT 1 ${options.lock === false ? Prisma.empty : Prisma.sql`FOR UPDATE`}
    `);
    const blocked = (reason: string): InitialRegenerationReadiness => ({ ready: false, reason, state: state ?? null });
    if (!state) return blocked("SERVICE_RECORD_INITIAL_STATE_NOT_FOUND");
    const stateBlocker = initialRegenerationStateBlocker(state);
    if (stateBlocker) return blocked(stateBlocker);
    const chunks = await tx.$queryRaw<InitialRegenerationChunk[]>(Prisma.sql`
        SELECT document_id AS "documentId", chunk_index AS "chunkIndex", chunk_count AS "chunkCount"
        FROM "service_record_snapshot_chunk"
        WHERE branch_id = ${owner.branchId}::uuid AND service_record_case_id = ${caseId}::uuid
          AND revision_id = ${revisionId}::uuid AND snapshot_version = ${state.documentVersion}
        ORDER BY chunk_index, id ${options.lock === false ? Prisma.empty : Prisma.sql`FOR UPDATE`}
    `);
    const documents = await tx.$queryRaw<InitialRegenerationDocument[]>(Prisma.sql`
        SELECT doc.document_id AS "documentId", doc.status_type AS "statusType", doc.voided_at IS NOT NULL AS "voided",
            doc.permanent_purge_requested_at IS NOT NULL AS "purgePending", ${initialTombstoneEvaluatedSql} AS "tombstoneEvaluated"
        FROM "eformsign_doc" AS doc
        JOIN service_record_snapshot_chunk AS chunk ON chunk.document_id = doc.document_id AND chunk.branch_id = doc.branch_id
        WHERE chunk.branch_id = ${owner.branchId}::uuid AND chunk.service_record_case_id = ${caseId}::uuid
          AND chunk.revision_id = ${revisionId}::uuid AND chunk.snapshot_version = ${state.documentVersion}
        ORDER BY doc.id ${options.lock === false ? Prisma.empty : Prisma.sql`FOR UPDATE OF doc`}
    `);
    const chunkBlocker = initialRegenerationChunkBlocker(state, chunks, documents);
    if (chunkBlocker) return blocked(chunkBlocker);
    const jobs = await tx.$queryRaw<Array<{ status: string; leaseToken: string | null }>>(Prisma.sql`
        SELECT status, lease_token AS "leaseToken" FROM "eformsign_document_job" AS job
        WHERE branch_id = ${owner.branchId}::uuid AND client_id = ${owner.clientId}
          AND ${initialJobForCaseSql(Prisma.sql`${caseId}::text`)}
        ORDER BY id ${options.lock === false ? Prisma.empty : Prisma.sql`FOR UPDATE`}
    `);
    if (jobs.some(job => INITIAL_RUNNING_JOB_STATUSES.includes(job.status) || job.leaseToken !== null)) {
        return blocked("SERVICE_RECORD_INITIAL_JOB_IN_PROGRESS");
    }
    return { ready: true, state };
}

/** Lazy pre-deploy repair. A completed job and a failed job's failure evidence stay unchanged. */
export async function releaseTerminalInitialFinalizationKey(
    tx: Prisma.TransactionClient, caseId: string, revisionId: string,
): Promise<InitialRegenerationReadiness> {
    const readiness = await initialRegenerationReadiness(tx, caseId, revisionId);
    if (!readiness.ready) return readiness;
    const state = readiness.state;
    await tx.$executeRaw(Prisma.sql`
        UPDATE "eformsign_document_job"
        SET active_key = NULL, status = 'failed', completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE branch_id = ${state.branchId}::uuid AND client_id = ${state.clientId}
          AND job_type = 'create_document' AND source = 'auto_finalize'
          AND payload->'context'->>'serviceRecordCaseId' = ${caseId}
          AND payload->>'revisionId' = ${revisionId} AND payload->>'generation' = ${state.generation}
          AND payload->>'generationKind' = 'INITIAL_FINALIZATION'
          AND status IN ('failed', 'requires_attention') AND lease_token IS NULL
          AND (active_key IS NOT NULL OR status = 'requires_attention')
    `);
    return readiness;
}
