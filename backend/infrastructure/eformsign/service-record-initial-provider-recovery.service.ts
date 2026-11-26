import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { cancelledInitialSuffix } from "domain/constants/service-record-initial-no-provider-document";
import type { IInitialProviderRecovery } from "domain/repositories/service-record-initial-provider-recovery.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EFORMSIGN_CLIENT_REPOSITORY, type IEformsignClientRepository, type EformsignApiDocumentResponse, type EformsignApiListResponse } from "domain/repositories/eformsign.client.interface";
import { SERVICE_RECORD_EDIT_REPOSITORY, type IServiceRecordEditRepository } from "domain/repositories/service-record-edit.repository.interface";
import type { ServiceRecordRevisionGenerationInput } from "domain/entities/eformsign-document-job.entity";
import { isInitialFinalizationWorkflowScope } from "application/policies/service-record-initial-finalization.policy";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { EformsignCredentialBoundary, createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import {
    cancelledInitialCandidateSql, cancelledInitialCandidatesSettledSql, cancelledInitialSuffixScopeSql,
    INITIAL_DISPATCH_CANCELLED as CANCELLED, INITIAL_PROVIDER_SETTLE_MS,
} from "infrastructure/database/utils/service-record-initial-recovery-sql";

export { INITIAL_PROVIDER_SETTLE_MS };
const JOB_BATCH_SIZE = 100;
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
class RecoveryPreconditionMiss extends Error {}
type RecoveryJob = Pick<Prisma.eformsign_document_jobGetPayload<Prisma.eformsign_document_jobDefaultArgs>,
    "id" | "branchId" | "clientId" | "requestKey" | "activeKey" | "payload" | "payloadFingerprint"
    | "progressStep" | "progressDetail" | "attempts" | "updatedAt">;
type CancelledInitialJob = RecoveryJob & {
    status: string; lastErrorCode: string; leaseToken: string | null; documentId: string | null;
    stateVersion: number; settled: boolean;
};
type Candidate = RecoveryJob & { cursorUpdatedAt: string };
type CandidateCursor = Pick<Candidate, "id" | "cursorUpdatedAt">;
type RecoveryChunk = Prisma.service_record_snapshot_chunkGetPayload<Prisma.service_record_snapshot_chunkDefaultArgs>;

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recoveryInput(job: RecoveryJob): ServiceRecordRevisionGenerationInput | null {
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

export function cancelledInitialChunkWhere(input: ServiceRecordRevisionGenerationInput) {
    return { branchId: input.branchId, serviceRecordCaseId: input.serviceRecordCaseId,
        revisionId: input.revisionId!, snapshotVersion: input.documentVersion };
}

type CandidateTarget = { stateId: string; now: Date };
type SweepCandidate = { state: { version: number; updatedAt: Date }; chunks: RecoveryChunk[]; settled: true };
export type CancelledInitialCandidate = { job: CancelledInitialJob; input: ServiceRecordRevisionGenerationInput; settled: boolean };
export function loadCancelledInitialCandidate(
    db: Prisma.TransactionClient, options: CandidateTarget & { selectedJob: RecoveryJob },
): Promise<SweepCandidate | null>;
export function loadCancelledInitialCandidate(
    db: Prisma.TransactionClient, options: CandidateTarget & { branchId: string; revisionId: string; lockJob?: boolean },
): Promise<CancelledInitialCandidate | null>;
export async function loadCancelledInitialCandidate(
    db: Prisma.TransactionClient,
    options: CandidateTarget & { branchId?: string; revisionId?: string; selectedJob?: RecoveryJob; lockJob?: boolean },
): Promise<SweepCandidate | CancelledInitialCandidate | null> {
    const { stateId, branchId, revisionId, now, selectedJob } = options;
    const settledAt = new Date(now.getTime() - INITIAL_PROVIDER_SETTLE_MS);
    // U4 has already selected eligible jobs in its bounded keyset query.
    if (selectedJob) {
        const input = recoveryInput(selectedJob);
        if (!input) return null;
        const state = await db.service_record_revision_document_state.findUnique({ where: { id: stateId } });
        if (!state || state.status !== "manual_review" || state.lastErrorCode !== CANCELLED
            || state.updatedAt.getTime() > settledAt.getTime()) return null;
        const chunks = await db.service_record_snapshot_chunk.findMany({
            where: cancelledInitialChunkWhere(input), orderBy: { chunkIndex: "asc" },
        });
        return { state, chunks, settled: true as const };
    }

    const [job] = await db.$queryRaw<CancelledInitialJob[]>(Prisma.sql`
        SELECT j.id, j.branch_id AS "branchId", j.client_id AS "clientId", j.request_key AS "requestKey",
            j.active_key AS "activeKey", j.payload, j.payload_fingerprint AS "payloadFingerprint",
            j.progress_step AS "progressStep", j.progress_detail AS "progressDetail", j.attempts,
            j.updated_at AS "updatedAt", j.status, j.last_error_code AS "lastErrorCode",
            j.lease_token AS "leaseToken", j.document_id AS "documentId", s.version AS "stateVersion",
            (${cancelledInitialCandidatesSettledSql(settledAt)}) AS settled
        ${cancelledInitialCandidateSql()}
            AND s.id = ${stateId}::uuid AND s.branch_id = ${branchId}::uuid AND s.revision_id = ${revisionId}::uuid
            AND ${cancelledInitialSuffixScopeSql()}
        ${options.lockJob ? Prisma.sql`FOR UPDATE OF j` : Prisma.empty}
    `);
    const input = job && recoveryInput(job);
    if (!job || !input) return null;
    return { job, input, settled: job.settled };
}

type VendorDeadline = { expiresAt: number; shouldContinue?: () => boolean };
export const INITIAL_PROVIDER_LIST_TYPES = ["01", "03", "04"] as const;
type ProviderListType = (typeof INITIAL_PROVIDER_LIST_TYPES)[number];
type ProviderListing = Record<ProviderListType, Map<string, string>>;
type ProviderListingCache = Map<string, Promise<ProviderListing>>;
type SuffixScanCandidate = {
    suffix: string; listing: () => Promise<ProviderListing>; requireCompleteTitles?: boolean;
};
type RecoveryChunkOrdinal = Pick<RecoveryChunk, "chunkIndex" | "chunkCount" | "eformsignDocumentId">;

function vendorWorkAllowed(deadline: VendorDeadline): boolean {
    return Date.now() < deadline.expiresAt && (deadline.shouldContinue?.() ?? true);
}

async function readProviderList(
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
            if (!id || typeof title !== "string" || titles.has(id)) throw new RecoveryPreconditionMiss();
            titles.set(id, title);
        }
        if (titles.size === total) return titles;
    }
}

export async function readCancelledInitialLists(client: IEformsignClientRepository, accessToken: string, deadline: VendorDeadline): Promise<ProviderListing> {
    const lists = {
        "01": client.getInProgressDocumentsPage,
        "03": client.getCompletedDocumentsPage,
        "04": client.getRejectedDocumentsPage,
    };
    const coverage: ProviderListing = { "01": new Map(), "03": new Map(), "04": new Map() };
    for (const type of INITIAL_PROVIDER_LIST_TYPES) {
        const fetchPage = lists[type].bind(client, accessToken);
        const keepGoing = () => vendorWorkAllowed(deadline);
        const titles = await readProviderList(fetchPage, keepGoing);
        // Offset pagination can drift even when its reported total is stable.
        if (titles.size > PAGE_SIZE) {
            const verified = await readProviderList(fetchPage, keepGoing);
            if (titles.size !== verified.size || [...titles].some(([id, title]) => verified.get(id) !== title)) {
                throw new RecoveryPreconditionMiss();
            }
        }
        coverage[type] = titles;
    }
    return coverage;
}

/** Scan unfiltered pages. The suffix survives a rename and needs no vendor title-search semantics. */
export async function scanCancelledInitialSuffix(candidate: SuffixScanCandidate, deadline: VendorDeadline) {
    let lists: ProviderListing;
    try {
        if (!vendorWorkAllowed(deadline)) return "INCOMPLETE" as const;
        lists = await candidate.listing();
    } catch {
        return "INCOMPLETE" as const;
    }
    if (!vendorWorkAllowed(deadline)) return "INCOMPLETE" as const;
    const hits = new Map<string, string>();
    const totals = { "01": 0, "03": 0, "04": 0 };
    for (const type of INITIAL_PROVIDER_LIST_TYPES) {
        totals[type] = lists[type].size;
        for (const [id, title] of lists[type]) {
            if (candidate.requireCompleteTitles && !title) return "INCOMPLETE" as const;
            if (!title.includes(candidate.suffix)) continue;
            const observed = hits.get(id);
            if (observed !== undefined && observed !== title) return "INCOMPLETE" as const;
            hits.set(id, title);
        }
    }
    // Conflicting titles matter even if only one observation carries this suffix.
    if (candidate.requireCompleteTitles && [...hits].some(([id, title]) =>
        INITIAL_PROVIDER_LIST_TYPES.some(type => lists[type].has(id) && lists[type].get(id) !== title))) {
        return "INCOMPLETE" as const;
    }
    return { hits, totals };
}

export async function classifyCancelledInitialChunks<Chunk extends RecoveryChunkOrdinal>(
    candidate: SuffixScanCandidate & { chunks: Chunk[] }, deadline: VendorDeadline,
) {
    const scan = await scanCancelledInitialSuffix(candidate, deadline);
    if (scan === "INCOMPLETE") return scan;
    const { hits, totals } = scan;
    const claimed = new Set<string>();
    let ambiguous = false;
    const chunks = candidate.chunks.map(chunk => {
        const chunkSuffix = `(${chunk.chunkIndex}/${chunk.chunkCount}) ${candidate.suffix}`;
        const candidates = [...hits].filter(([id, title]) => id === chunk.eformsignDocumentId || title.endsWith(chunkSuffix));
        const matchId = candidates[0]?.[0];
        if (candidates.length > 1 || (matchId && (claimed.has(matchId)
            || (chunk.eformsignDocumentId !== null && chunk.eformsignDocumentId !== matchId)))) {
            ambiguous = true;
            return { chunk, chunkSuffix, kind: "ambiguous" as const };
        }
        if (matchId) claimed.add(matchId);
        return { chunk, chunkSuffix, matchId,
            kind: chunk.eformsignDocumentId ? "linked" as const : matchId ? "matched" as const : "unmatched" as const };
    });
    // A suffix match which cannot be assigned to a frozen ordinal is inconclusive.
    ambiguous ||= [...hits.keys()].some(id => !claimed.has(id));
    return { chunks, ambiguous, totals };
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
        const listings: ProviderListingCache = new Map();
        let recovered = 0;
        for (const job of jobs) {
            if (shouldContinue && !shouldContinue()) return recovered;
            // Advance even when evidence is inconclusive. Wrap at the end so old
            // unmatched jobs get retried without keeping newer ones out of the batch.
            this.candidateCursors.set(branchId, { id: job.id, cursorUpdatedAt: job.cursorUpdatedAt });
            try {
                if (await this.reconcileJob(job, now, listings, shouldContinue)) recovered++;
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
            ${cancelledInitialCandidateSql()}
                AND ${cancelledInitialCandidatesSettledSql(settledAt)}
                AND EXISTS (SELECT 1 FROM service_record_snapshot_chunk chunk
                    WHERE chunk.branch_id = s.branch_id AND chunk.service_record_case_id = c.id
                        AND chunk.revision_id = s.revision_id AND chunk.snapshot_version = s.document_version)
                ${branchId ? Prisma.sql`AND j.branch_id = ${branchId}::uuid` : Prisma.empty}
                ${cursor ? Prisma.sql`AND (j.updated_at, j.id) > (${cursor.cursorUpdatedAt}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty}
            ORDER BY j.updated_at, j.id
            LIMIT ${JOB_BATCH_SIZE}
        `);
    }

    private async reconcileJob(
        job: RecoveryJob, now: Date, listings: ProviderListingCache, shouldContinue?: () => boolean,
    ): Promise<boolean> {
        const input = recoveryInput(job);
        if (!input) return false;
        const loaded = await loadCancelledInitialCandidate(this.prisma, {
            stateId: input.documentStateId, now, selectedJob: job,
        });
        if (!loaded || !loaded.settled) return false;
        const { state: initialState, chunks } = loaded;
        const prepared = this.snapshots.prepareCancelledInitialRecovery(input, chunks);
        const suffix = cancelledInitialSuffix(input.serviceRecordCaseId, input.revisionNumber!, input.documentVersion);
        const deadline = { expiresAt: Infinity, shouldContinue };
        const matches = await this.credentials.withCredentials(createEformsignWorkerPrincipal(job.branchId), "document.read", async ({ accessToken }) => {
            try {
                const listing = () => {
                    let scan = listings.get(job.branchId);
                    if (!scan) {
                        scan = readCancelledInitialLists(this.client, accessToken, deadline);
                        listings.set(job.branchId, scan);
                    }
                    return scan;
                };
                const result = await classifyCancelledInitialChunks({ chunks, suffix, listing }, deadline);
                if (result === "INCOMPLETE" || result.ambiguous) throw new RecoveryPreconditionMiss();
                if (result.chunks.some(chunk => chunk.kind === "unmatched")) return null;
                const resolved = new Map<number, EformsignApiDocumentResponse>();
                const usedIds = new Set<string>();
                for (const item of result.chunks) {
                    if (item.chunk.eformsignDocumentId) {
                        usedIds.add(item.chunk.eformsignDocumentId);
                        continue;
                    }
                    const id = item.matchId!;
                    const detail = await this.client.getDocument(accessToken, id);
                    if (detail.id !== id || !detail.document_name.endsWith(item.chunkSuffix)
                        || !detail.current_status?.status_type || !detail.template?.id || !Number.isSafeInteger(detail.updated_date)
                        || detail.updated_date <= 0 || usedIds.has(detail.id)) throw new RecoveryPreconditionMiss();
                    resolved.set(item.chunk.chunkIndex, detail);
                    usedIds.add(detail.id);
                }
                return resolved;
            } catch {
                // The credential boundary logs operation errors. Keep vendor response text out of its logs.
                throw new RecoveryPreconditionMiss("INITIAL provider lookup deferred");
            }
        });
        if (!matches || (shouldContinue && !shouldContinue())) return false;
        return this.commitRecovery(job, input, initialState, chunks, prepared, matches, now, shouldContinue);
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
                const currentChunks = await tx.service_record_snapshot_chunk.findMany({ where: cancelledInitialChunkWhere(input), orderBy: { chunkIndex: "asc" } });
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
