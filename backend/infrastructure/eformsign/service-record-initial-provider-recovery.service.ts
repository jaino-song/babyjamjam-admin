import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { IInitialProviderRecovery } from "domain/repositories/service-record-initial-provider-recovery.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EFORMSIGN_CLIENT_REPOSITORY, type IEformsignClientRepository, type EformsignApiDocumentResponse, type EformsignApiListResponse } from "domain/repositories/eformsign.client.interface";
import { SERVICE_RECORD_EDIT_REPOSITORY, type IServiceRecordEditRepository } from "domain/repositories/service-record-edit.repository.interface";
import type { ServiceRecordRevisionGenerationInput } from "domain/entities/eformsign-document-job.entity";
import { INITIAL_FINALIZATION_REQUEST_PREFIX, initialFinalizationStateSql, isInitialFinalizationWorkflowScope, newestInitialFinalizationStateSql } from "application/policies/service-record-initial-finalization.policy";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { EformsignCredentialBoundary, createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { initialFinalizationJobSql } from "infrastructure/database/utils/service-record-initial-recovery-sql";

const CANCELLED = "JOB_CANCELLED_AFTER_DISPATCH";
export const INITIAL_PROVIDER_SETTLE_MS = 10 * 60 * 1000;
const JOB_BATCH_SIZE = 100;
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
class RecoveryPreconditionMiss extends Error {}
type RecoveryJob = Pick<Prisma.eformsign_document_jobGetPayload<Prisma.eformsign_document_jobDefaultArgs>,
    "id" | "branchId" | "clientId" | "requestKey" | "activeKey" | "payload" | "payloadFingerprint"
    | "progressStep" | "progressDetail" | "attempts" | "updatedAt">;
type Candidate = RecoveryJob & { cursorUpdatedAt: string };
type CandidateCursor = Pick<Candidate, "id" | "cursorUpdatedAt">;
type RecoveryChunk = Prisma.service_record_snapshot_chunkGetPayload<Prisma.service_record_snapshot_chunkDefaultArgs>;

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Presence-only recovery. Official POST /api/list_document documents 01/03/04 as
 * in-progress/completed/document list, but does not promise exhaustive visibility
 * of rejected, voided or expired documents, or exact/prefix/substring title search:
 * https://api.swaggerhub.com/apis/eformsign_api.en/eformsign_API_2.0/2.0
 * Consequently a missing match is UNKNOWN, never proof of absence. This service
 * cannot write either absence-proof code or release a possibly-live INITIAL key.
 */
@Injectable()
export class ServiceRecordInitialProviderRecoveryService implements IInitialProviderRecovery {
    private readonly logger = new Logger(ServiceRecordInitialProviderRecoveryService.name);
    private readonly candidateCursors = new Map<string | undefined, CandidateCursor>();

    constructor(
        private readonly prisma: PrismaService,
        @Inject(EFORMSIGN_CLIENT_REPOSITORY) private readonly client: IEformsignClientRepository,
        private readonly credentials: EformsignCredentialBoundary,
        private readonly snapshots: CreateAndSendServiceRecordSnapshotUsecase,
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY) private readonly edits: IServiceRecordEditRepository,
    ) {}

    async reconcile(options: { branchId?: string; shouldContinue?: () => boolean } = {}, now = new Date()): Promise<number> {
        const { branchId, shouldContinue } = options;
        if (shouldContinue && !shouldContinue()) return 0;
        const settledAt = new Date(now.getTime() - INITIAL_PROVIDER_SETTLE_MS);
        const jobs = await this.readCandidates(settledAt, branchId, this.candidateCursors.get(branchId));
        let recovered = 0;
        for (const job of jobs) {
            if (shouldContinue && !shouldContinue()) return recovered;
            // Advance even when evidence is inconclusive. Wrap at the end so old
            // unmatched jobs get retried without keeping newer ones out of the batch.
            this.candidateCursors.set(branchId, { id: job.id, cursorUpdatedAt: job.cursorUpdatedAt });
            try {
                if (await this.reconcileJob(job, now, shouldContinue)) recovered++;
            } catch {
                // Vendor errors can contain titles/payloads. Never log exception text here.
                this.logger.warn({ message: "INITIAL provider recovery deferred", jobId: job.id, branchId: job.branchId });
            }
        }
        if (jobs.length < JOB_BATCH_SIZE) this.candidateCursors.delete(branchId);
        return recovered;
    }

    private readCandidates(settledAt: Date, branchId?: string, cursor?: CandidateCursor): Promise<Candidate[]> {
        // Keep the timestamp's microseconds for the keyset boundary. The JS Date
        // returned for the job has millisecond precision and cannot order ties here.
        return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
            SELECT j.id, j.branch_id AS "branchId", j.client_id AS "clientId", j.request_key AS "requestKey",
                j.active_key AS "activeKey", j.payload, j.payload_fingerprint AS "payloadFingerprint",
                j.progress_step AS "progressStep", j.progress_detail AS "progressDetail", j.attempts,
                j.updated_at AS "updatedAt", j.updated_at::text AS "cursorUpdatedAt"
            FROM eformsign_document_job j
            JOIN service_record_revision_document_state s ON s.id::text = lower(j.payload->>'documentStateId')
                AND s.branch_id = j.branch_id AND s.client_id = j.client_id
            JOIN service_record_case c ON c.id = s.service_record_case_id
                AND c.branch_id = s.branch_id AND c.client_id = s.client_id
            WHERE ${initialFinalizationJobSql("j")}
                AND j.status = 'failed' AND j.last_error_code = ${CANCELLED} AND j.lease_token IS NULL
                AND j.updated_at <= ${settledAt}
                AND j.active_key = ${INITIAL_FINALIZATION_REQUEST_PREFIX} || c.id::text
                AND c.current_revision_id = s.revision_id AND c.status IN ('READY_TO_FINALIZE', 'FINALIZATION_FAILED')
                AND s.status = 'manual_review' AND s.last_error_code = ${CANCELLED} AND s.updated_at <= ${settledAt}
                AND ${initialFinalizationStateSql("s")} AND ${newestInitialFinalizationStateSql("s")}
                AND s.workflow_scope->'requestKey' = to_jsonb(j.request_key)
                AND j.payload->'context'->'branchId' = to_jsonb(j.branch_id::text)
                AND j.payload->'context'->'clientId' = to_jsonb(j.client_id)
                AND j.payload->'context'->'serviceRecordCaseId' = to_jsonb(c.id::text)
                AND j.payload->'revisionId' = to_jsonb(s.revision_id::text)
                AND j.payload->'context'->'revisionNumber' = j.payload->'revisionNumber'
                AND j.payload->'generation' = to_jsonb(s.generation)
                AND j.payload->'documentVersion' = to_jsonb(s.document_version)
                AND j.payload->'payloadFingerprint' = to_jsonb(j.payload_fingerprint::text)
                AND s.input_fingerprint = j.payload_fingerprint
                AND s.immutable_input = j.payload->'immutablePayload'
                AND EXISTS (SELECT 1 FROM service_record_snapshot_chunk chunk
                    WHERE chunk.branch_id = s.branch_id AND chunk.service_record_case_id = c.id
                        AND chunk.revision_id = s.revision_id AND chunk.snapshot_version = s.document_version)
                ${branchId ? Prisma.sql`AND j.branch_id = ${branchId}::uuid` : Prisma.empty}
                ${cursor ? Prisma.sql`AND (j.updated_at, j.id) > (${cursor.cursorUpdatedAt}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty}
            ORDER BY j.updated_at, j.id
            LIMIT ${JOB_BATCH_SIZE}
        `);
    }

    private async readProviderList(
        fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>,
        shouldContinue?: () => boolean,
    ): Promise<Map<string, string>> {
        const titles = new Map<string, string>();
        let total: number | undefined;
        for (let skip = 0; ; skip += PAGE_SIZE) {
            if (shouldContinue && !shouldContinue()) throw new RecoveryPreconditionMiss();
            const { documents, total_rows: reportedTotal } = await fetchPage(PAGE_SIZE, skip);
            total ??= reportedTotal;
            if (!Number.isSafeInteger(total) || total < 0 || reportedTotal !== total
                || Math.ceil(total / PAGE_SIZE) >= MAX_PAGES || documents.length !== Math.min(PAGE_SIZE, total - skip)) {
                throw new RecoveryPreconditionMiss();
            }
            for (const { id, document_name: title } of documents) {
                if (!id || titles.has(id)) throw new RecoveryPreconditionMiss();
                titles.set(id, title);
            }
            if (titles.size === total) return titles;
        }
    }

    private input(job: RecoveryJob): ServiceRecordRevisionGenerationInput | null {
        const payload = object(job.payload), context = object(payload?.["context"]);
        if (!payload || !context || payload["kind"] !== "service_record_revision"
            || payload["generationKind"] !== "INITIAL_FINALIZATION"
            || context["branchId"] !== job.branchId || context["clientId"] !== job.clientId
            || context["revisionId"] !== payload["revisionId"]
            || context["revisionNumber"] !== payload["revisionNumber"]
            || payload["snapshotReference"] !== job.requestKey
            || payload["payloadFingerprint"] !== job.payloadFingerprint) return null;
        return { ...context, documentSyncStatus: "pending", generationKind: "INITIAL_FINALIZATION",
            documentStateId: payload["documentStateId"], documentVersion: payload["documentVersion"],
            snapshotReference: payload["snapshotReference"], generation: payload["generation"],
            immutablePayload: payload["immutablePayload"], payloadFingerprint: payload["payloadFingerprint"],
            completeness: payload["completeness"],
        } as ServiceRecordRevisionGenerationInput;
    }

    private chunkWhere(input: ServiceRecordRevisionGenerationInput) {
        return { branchId: input.branchId, serviceRecordCaseId: input.serviceRecordCaseId,
            revisionId: input.revisionId!, snapshotVersion: input.documentVersion };
    }

    private async reconcileJob(job: RecoveryJob, now: Date, shouldContinue?: () => boolean): Promise<boolean> {
        const input = this.input(job);
        if (!input) return false;
        const initialState = await this.prisma.service_record_revision_document_state.findUnique({ where: { id: input.documentStateId } });
        if (!initialState || initialState.status !== "manual_review" || initialState.lastErrorCode !== CANCELLED
            || initialState.updatedAt.getTime() > now.getTime() - INITIAL_PROVIDER_SETTLE_MS) return false;
        const chunks = await this.prisma.service_record_snapshot_chunk.findMany({ where: this.chunkWhere(input), orderBy: { chunkIndex: "asc" } });
        const prepared = this.snapshots.prepareCancelledInitialRecovery(input, chunks);
        // Scan unfiltered pages and apply suffix matching locally. This avoids relying
        // on undocumented title search semantics and survives a customer rename.
        const suffix = `[SR-${input.serviceRecordCaseId.slice(0, 8)}-r${input.revisionNumber}-v${input.documentVersion}]`;
        const matches = await this.credentials.withCredentials(createEformsignWorkerPrincipal(job.branchId), "document.read", async ({ accessToken }) => {
            try {
                return await this.findMatches(accessToken, suffix, chunks, shouldContinue);
            } catch {
                // The credential boundary logs operation errors. Keep vendor response text out of its logs.
                throw new RecoveryPreconditionMiss("INITIAL provider lookup deferred");
            }
        });
        if (!matches || (shouldContinue && !shouldContinue())) return false;
        return this.commitRecovery(job, input, initialState, chunks, prepared, matches, now, shouldContinue);
    }

    private async findMatches(accessToken: string, suffix: string, chunks: RecoveryChunk[], shouldContinue?: () => boolean) {
        const byId = new Map<string, string>();
        for (const list of [this.client.getInProgressDocumentsPage, this.client.getCompletedDocumentsPage, this.client.getRejectedDocumentsPage]) {
            const fetchPage = list.bind(this.client, accessToken);
            const titles = await this.readProviderList(fetchPage, shouldContinue);
            // Rows can move across offsets even if the total is unchanged.
            // Require the same IDs and titles in a second multi-page scan.
            if (titles.size > PAGE_SIZE) {
                const verified = await this.readProviderList(fetchPage, shouldContinue);
                if (titles.size !== verified.size || [...titles].some(([id, title]) => verified.get(id) !== title)) {
                    throw new RecoveryPreconditionMiss();
                }
            }
            for (const [id, title] of titles) {
                if (!title.includes(suffix)) continue;
                const observed = byId.get(id);
                if (observed !== undefined && observed !== title) throw new RecoveryPreconditionMiss();
                byId.set(id, title);
            }
        }
        const resolved = new Map<number, EformsignApiDocumentResponse>();
        const usedIds = new Set<string>();
        for (const chunk of chunks) {
            // The stable suffix identifies a version; the frozen chunk ordinal
            // disambiguates its members. Unassignable suffix matches are ambiguous.
            const chunkSuffix = `(${chunk.chunkIndex}/${chunk.chunkCount}) ${suffix}`;
            const candidates = [...byId].filter(([id, title]) => id === chunk.eformsignDocumentId || title.endsWith(chunkSuffix));
            if (candidates.length > 1) throw new RecoveryPreconditionMiss();
            const foundId = candidates[0]?.[0];
            if (chunk.eformsignDocumentId) {
                if (foundId && foundId !== chunk.eformsignDocumentId) throw new RecoveryPreconditionMiss();
                usedIds.add(chunk.eformsignDocumentId);
                continue;
            }
            // CREATED with no id remains an unknown outcome, as does no match.
            if (!foundId) return null;
            const detail = await this.client.getDocument(accessToken, foundId);
            if (detail.id !== foundId || !detail.document_name.endsWith(chunkSuffix)
                || !detail.current_status?.status_type || !detail.template?.id || !Number.isSafeInteger(detail.updated_date)
                || detail.updated_date <= 0 || usedIds.has(detail.id)) throw new RecoveryPreconditionMiss();
            resolved.set(chunk.chunkIndex, detail);
            usedIds.add(detail.id);
        }
        if ([...byId.keys()].some(id => !usedIds.has(id))) throw new RecoveryPreconditionMiss();
        return resolved;
    }

    private async commitRecovery(
        job: RecoveryJob,
        input: ServiceRecordRevisionGenerationInput,
        initialState: { version: number; updatedAt: Date },
        chunks: RecoveryChunk[],
        prepared: ReturnType<CreateAndSendServiceRecordSnapshotUsecase["prepareCancelledInitialRecovery"]>,
        matches: Map<number, EformsignApiDocumentResponse>,
        now: Date,
        shouldContinue?: () => boolean,
    ): Promise<boolean> {
        try {
            return await this.prisma.$transaction(async tx => {
                // Lifecycle's canonical order: case -> state -> chunks/documents -> job.
                await tx.$queryRaw`SELECT id FROM service_record_case WHERE id = ${input.serviceRecordCaseId}::uuid FOR UPDATE`;
                await tx.$queryRaw`SELECT id FROM service_record_revision_document_state WHERE id = ${input.documentStateId}::uuid FOR UPDATE`;
                const record = await tx.service_record_case.findUnique({ where: { id: input.serviceRecordCaseId },
                    select: { id: true, branchId: true, clientId: true, currentRevisionId: true, status: true } });
                const state = await tx.service_record_revision_document_state.findUnique({ where: { id: input.documentStateId } });
                const newest = await tx.service_record_revision_document_state.findFirst({ where: {
                    ...this.chunkWhereState(input), operation: "record_snapshot",
                    workflowScope: { path: ["generationKind"], equals: "INITIAL_FINALIZATION" },
                }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
                if (!record || record.branchId !== input.branchId || record.clientId !== input.clientId
                    || record.currentRevisionId !== input.revisionId || !["READY_TO_FINALIZE", "FINALIZATION_FAILED"].includes(record.status)
                    || !state || newest?.id !== state.id || state.status !== "manual_review" || state.lastErrorCode !== CANCELLED
                    // Both timestamps are JS reads; version is the lossless state CAS.
                    || state.version !== initialState.version || state.updatedAt.getTime() !== initialState.updatedAt.getTime()
                    || state.generation !== input.generation
                    || state.documentVersion !== input.documentVersion || state.inputFingerprint !== input.payloadFingerprint
                    || sha256CanonicalJson(state.immutableInput) !== input.payloadFingerprint
                    || !isInitialFinalizationWorkflowScope(state.workflowScope, job.requestKey)) return false;
                await tx.$queryRaw`SELECT id FROM service_record_snapshot_chunk WHERE service_record_case_id = ${input.serviceRecordCaseId}::uuid
                    AND revision_id = ${input.revisionId}::uuid AND snapshot_version = ${input.documentVersion} ORDER BY chunk_index FOR UPDATE`;
                const currentChunks = await tx.service_record_snapshot_chunk.findMany({ where: this.chunkWhere(input), orderBy: { chunkIndex: "asc" } });
                if (currentChunks.length !== chunks.length || currentChunks.some((chunk, index) => !this.sameChunk(chunk, chunks[index]!))) return false;
                const ids = currentChunks.map(chunk => chunk.eformsignDocumentId ?? matches.get(chunk.chunkIndex)?.id);
                if (ids.some(id => !id) || new Set(ids).size !== ids.length) return false;
                const documentIds = ids as string[];
                await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_doc WHERE document_id IN (${Prisma.join(documentIds)}) ORDER BY document_id FOR UPDATE`);
                const docs = await tx.eformsign_doc.findMany({ where: { documentId: { in: documentIds } } });
                for (const chunk of currentChunks) {
                    const id = chunk.eformsignDocumentId ?? matches.get(chunk.chunkIndex)!.id;
                    const doc = docs.find(item => item.documentId === id);
                    if (chunk.eformsignDocumentId) {
                        // Promotion checks full ownership, including preserved 049 chunk links.
                        if (!doc || doc.permanentPurgeRequestedAt || chunk.status !== "CREATED") return false;
                    } else if (doc && ((doc.branchId !== null && doc.branchId !== input.branchId)
                        || (doc.branchId === null && (doc.clientId !== null || doc.employeeScheduleId !== null
                            || doc.serviceRecordCaseId !== null || doc.revisionId !== null || doc.snapshotVersion !== null
                            || doc.snapshotChunkIndex !== null || doc.documentKind !== null)) || doc.permanentPurgeRequestedAt
                        || doc.statusType === "049" || (doc.clientId !== null && doc.clientId !== input.clientId)
                        || (doc.serviceRecordCaseId !== null && doc.serviceRecordCaseId !== input.serviceRecordCaseId)
                        || (doc.revisionId !== null && doc.revisionId !== input.revisionId)
                        || (doc.snapshotVersion !== null && doc.snapshotVersion !== input.documentVersion)
                        || (doc.snapshotChunkIndex !== null && doc.snapshotChunkIndex !== chunk.chunkIndex)
                        || (doc.documentKind !== null && doc.documentKind !== "service_record_snapshot"))) return false;
                    const match = matches.get(chunk.chunkIndex);
                    if (doc && match && (doc.updatedDate.getTime() > match.updated_date
                        || (doc.updatedDate.getTime() === match.updated_date && doc.statusType !== match.current_status.status_type))) return false;
                }
                if (shouldContinue && !shouldContinue()) return false;
                // Raw cancellation writes timestamptz(6), while Prisma reads JS Dates
                // at millisecond precision. Compare the observed millisecond bucket,
                // not equality with its truncated lower bound. State version above and
                // the job's eligibility/payload/progress predicates fence concurrent work.
                const completed = await tx.eformsign_document_job.updateMany({ where: { id: job.id, branchId: input.branchId,
                    clientId: input.clientId, source: "auto_finalize", jobType: "create_document", status: "failed",
                    lastErrorCode: CANCELLED, leaseToken: null, documentId: null,
                    updatedAt: { gte: job.updatedAt, lt: new Date(job.updatedAt.getTime() + 1) },
                    payload: { equals: job.payload as Prisma.InputJsonValue },
                    progressStep: job.progressStep, progressDetail: job.progressDetail, attempts: job.attempts,
                    payloadFingerprint: input.payloadFingerprint, requestKey: job.requestKey, activeKey: job.activeKey },
                data: { status: "completed", activeKey: null, heartbeatAt: null, documentId: documentIds[0]!, completedAt: now,
                    lastErrorCode: null, progressStep: "sent", progressDetail: "sent" } });
                if (completed.count !== 1) throw new RecoveryPreconditionMiss();
                for (const chunk of currentChunks) {
                    const match = matches.get(chunk.chunkIndex);
                    if (match) await this.snapshots.persistCancelledInitialRemoteDocument(tx, prepared, chunk.id, chunk.chunkIndex, match);
                }
                const promoted = await this.edits.recordInitialFinalizationDocumentsCreatedInTransaction({ tx }, {
                    branchId: input.branchId, clientId: input.clientId, serviceRecordCaseId: input.serviceRecordCaseId,
                    revisionId: input.revisionId!, revisionNumber: input.revisionNumber!, documentStateId: input.documentStateId,
                    generation: input.generation, documentVersion: input.documentVersion, chunkCount: chunks.length, documentIds,
                }, "cancelled_after_dispatch");
                if (!promoted || (shouldContinue && !shouldContinue())) throw new RecoveryPreconditionMiss();
                return true;
            });
        } catch (error) {
            if (error instanceof RecoveryPreconditionMiss) return false;
            throw error;
        }
    }

    private chunkWhereState(input: ServiceRecordRevisionGenerationInput) {
        return { branchId: input.branchId, clientId: input.clientId, serviceRecordCaseId: input.serviceRecordCaseId, revisionId: input.revisionId! };
    }

    private sameChunk(a: RecoveryChunk, b: RecoveryChunk): boolean {
        // Compare two JS observations only, never bind a truncated Date as SQL
        // equality. Every frozen descriptor/link below must still match under lock.
        return a.id === b.id && a.updatedAt.getTime() === b.updatedAt.getTime()
            && a.eformsignDocumentId === b.eformsignDocumentId && a.status === b.status
            && a.branchId === b.branchId && a.serviceRecordCaseId === b.serviceRecordCaseId
            && a.revisionId === b.revisionId && a.snapshotVersion === b.snapshotVersion
            && a.sourceHash === b.sourceHash && a.assignmentId === b.assignmentId
            && a.chunkIndex === b.chunkIndex && a.chunkCount === b.chunkCount
            && a.firstSessionIndex === b.firstSessionIndex && a.lastSessionIndex === b.lastSessionIndex
            && a.employeeNameSnapshot === b.employeeNameSnapshot;
    }
}
