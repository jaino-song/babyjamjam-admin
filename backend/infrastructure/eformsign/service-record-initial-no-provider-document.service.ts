import { isDeepStrictEqual } from "node:util";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    releaseTerminalInitialFinalizationKey,
    SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN,
    SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT,
    SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH,
} from "application/policies/service-record-initial-finalization.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import { EformsignCredentialBoundary, createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { codeOnlyProblemException, isConflictException } from "application/utils/problem-bodies";
import { EFORMSIGN_COMPLETED_STATUS_CODES, EFORMSIGN_REJECTED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import {
    cancelledInitialSuffix, SERVICE_RECORD_INITIAL_NO_DOC_REASONS as REASON,
    type InitialNoProviderDocumentReason,
} from "domain/constants/service-record-initial-no-provider-document";
import { EFORMSIGN_CLIENT_REPOSITORY, type IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    cancelledInitialChunkWhere, classifyCancelledInitialChunks, INITIAL_PROVIDER_LIST_TYPES,
    loadCancelledInitialCandidate, readCancelledInitialLists, scanCancelledInitialSuffix,
    type CancelledInitialCandidate as Candidate,
} from "./service-record-initial-provider-recovery.service";

const ATTESTATION = "INITIAL_NO_PROVIDER_DOCUMENT_ATTESTATION";
const VENDOR_DEADLINE_MS = 150_000;

interface ConfirmInput {
    branchId: string;
    revisionId: string;
    documentStateId: string;
    expectedGeneration: string;
    actorUserId: string;
}

const stateSelect = {
    id: true, branchId: true, clientId: true, serviceRecordCaseId: true, operation: true,
    revisionId: true, documentVersion: true, generation: true, status: true, lastErrorCode: true, version: true, outputProof: true,
} satisfies Prisma.service_record_revision_document_stateSelect;

type State = Prisma.service_record_revision_document_stateGetPayload<{ select: typeof stateSelect }>;
type Scope = ReturnType<typeof cancelledInitialChunkWhere>;
type Outcome = typeof SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT | typeof SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH
    | typeof SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN;
type RowSnapshot<Data> = { id: string | number; rowVersion: string; data: Data };
type ChunkData = {
    document_id: string | null; chunk_index: number; chunk_count: number; status: string; create_attempted_at: string | null;
};
type DocumentData = { document_id: string; status_type: string; voided_at: string | null };
type ChunkSnapshot = RowSnapshot<ChunkData>;
type DocumentSnapshot = RowSnapshot<DocumentData>;
type VendorCheck = { listTypes: readonly string[]; totals: Record<string, number>; checkedAt: string };

function conflict(reason: InitialNoProviderDocumentReason) {
    return codeOnlyProblemException("REQUEST_CONFLICT", { reason });
}

function stateResponse(state: State) {
    const { id, revisionId, operation, generation, documentVersion, status, lastErrorCode, outputProof } = state;
    return { id, revisionId, operation, generation, documentVersion, status, reasonCode: lastErrorCode, outputProof };
}

function isReplay(state: State, expectedGeneration: string): boolean {
    const { outputProof } = state;
    return state.generation === expectedGeneration && outputProof !== null && typeof outputProof === "object"
        && !Array.isArray(outputProof) && outputProof["kind"] === ATTESTATION;
}

function stableJob(job: Candidate["job"]) {
    const { id, status, lastErrorCode, leaseToken, activeKey, documentId, attempts, requestKey } = job;
    return { id, status, lastErrorCode, leaseToken, activeKey, documentId, attempts, requestKey };
}

function sameRows<T>(before: RowSnapshot<T>[], after: RowSnapshot<T>[]): boolean {
    // PostgreSQL tuple versions detect writes within the same millisecond (and ABA changes).
    return before.length === after.length && before.every((row, index) => {
        const current = after[index]!;
        return row.id === current.id && row.rowVersion === current.rowVersion;
    });
}

function localChunkKind(chunk: ChunkData, byId: Map<string, DocumentData>) {
    if (chunk.document_id !== null) {
        const doc = byId.get(chunk.document_id);
        if (!doc) return "unknown";
        const status = normalizeEformsignStatusCode(doc.status_type);
        if (status === "049") return "tombstone";
        if (EFORMSIGN_COMPLETED_STATUS_CODES.has(status)) return "completed";
        if (doc.voided_at !== null || EFORMSIGN_REJECTED_STATUS_CODES.has(status)) return "terminal";
        return "live";
    }
    if (chunk.create_attempted_at !== null || ["CREATE_REQUESTED", "RECONCILING"].includes(chunk.status)) return "attempted";
    if (["PENDING", "CLAIMED"].includes(chunk.status)) return "never-attempted";
    return "unknown";
}

@Injectable()
export class ServiceRecordInitialNoProviderDocumentService {
    private readonly logger = new Logger(ServiceRecordInitialNoProviderDocumentService.name);
    private readonly pending = new Map<string, Promise<ReturnType<typeof stateResponse>>>();

    constructor(
        private readonly prisma: PrismaService,
        @Inject(EFORMSIGN_CLIENT_REPOSITORY) private readonly client: IEformsignClientRepository,
        private readonly credentials: EformsignCredentialBoundary,
    ) {}

    async confirmInitialNoProviderDocument(request: ConfirmInput): Promise<ReturnType<typeof stateResponse>> {
        const state = await this.readState(this.prisma, request);
        if (!state) throw codeOnlyProblemException("RESOURCE_NOT_FOUND");
        if (isReplay(state, request.expectedGeneration)) return stateResponse(state);
        if (state.generation !== request.expectedGeneration) throw conflict(REASON.GENERATION_CHANGED);
        const candidate = await loadCancelledInitialCandidate(this.prisma, {
            stateId: state.id, branchId: state.branchId, revisionId: state.revisionId, now: new Date(),
        });
        if (!candidate) {
            // An attestation may commit between the replay read and this eligibility query.
            const current = await this.readState(this.prisma, request);
            if (current && isReplay(current, request.expectedGeneration)) return stateResponse(current);
            throw conflict(REASON.NOT_ELIGIBLE);
        }
        if (!candidate.settled) throw conflict(REASON.SETTLING);
        if (this.pending.has(candidate.job.id)) throw conflict(REASON.VENDOR_CHECK_IN_PROGRESS);
        const operation = this.confirmCandidate(request, state, candidate);
        this.pending.set(candidate.job.id, operation);
        try {
            return await operation;
        } finally {
            this.pending.delete(candidate.job.id);
        }
    }

    private readState(db: Prisma.TransactionClient, request: ConfirmInput): Promise<State | null> {
        return db.service_record_revision_document_state.findFirst({
            where: { id: request.documentStateId, branchId: request.branchId, revisionId: request.revisionId },
            select: stateSelect,
        });
    }

    private readChunks(db: Prisma.TransactionClient, scope: Scope, lock = false): Promise<ChunkSnapshot[]> {
        return db.$queryRaw<ChunkSnapshot[]>(Prisma.sql`
            SELECT chunk.id, chunk.xmin::text AS "rowVersion", to_jsonb(chunk) AS data
            FROM service_record_snapshot_chunk chunk
            WHERE chunk.branch_id = ${scope.branchId}::uuid AND chunk.service_record_case_id = ${scope.serviceRecordCaseId}::uuid
              AND chunk.revision_id = ${scope.revisionId}::uuid AND chunk.snapshot_version = ${scope.snapshotVersion}
            ORDER BY chunk.chunk_index, chunk.id ${lock ? Prisma.sql`FOR UPDATE OF chunk` : Prisma.empty}
        `);
    }

    private readDocuments(
        db: Prisma.TransactionClient, branchId: string, chunks: ChunkSnapshot[], lock = false,
    ): Promise<DocumentSnapshot[]> {
        const ids = chunks.flatMap(chunk => chunk.data.document_id === null ? [] : [chunk.data.document_id]);
        if (!ids.length) return Promise.resolve([]);
        return db.$queryRaw<DocumentSnapshot[]>(Prisma.sql`
            SELECT doc.id, doc.xmin::text AS "rowVersion", to_jsonb(doc) AS data
            FROM eformsign_doc doc
            WHERE doc.branch_id = ${branchId}::uuid AND doc.document_id IN (${Prisma.join(ids)})
            ORDER BY doc.id ${lock ? Prisma.sql`FOR UPDATE OF doc` : Prisma.empty}
        `);
    }

    private async hasMirrorMatch(db: Prisma.TransactionClient, branchId: string, suffix: string, chunks: ChunkSnapshot[]) {
        const linked = chunks.flatMap(chunk => chunk.data.document_id === null ? [] : [chunk.data.document_id]);
        const rows = await db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT id FROM eformsign_doc
            WHERE (branch_id = ${branchId}::uuid OR branch_id IS NULL)
              AND status_type <> '049' AND document_name LIKE ${`%${suffix}%`}
              ${linked.length ? Prisma.sql`AND document_id NOT IN (${Prisma.join(linked)})` : Prisma.empty}
            LIMIT 1
        `);
        return rows.length > 0;
    }

    private async checkVendor(branchId: string, suffix: string, chunks: ChunkSnapshot[]) {
        let timedOut = false;
        const deadline = { expiresAt: Date.now() + VENDOR_DEADLINE_MS, shouldContinue: () => !timedOut };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<"INCOMPLETE">(resolve => {
                timer = setTimeout(() => {
                    timedOut = true;
                    resolve("INCOMPLETE");
                }, VENDOR_DEADLINE_MS);
            });
            const scan = this.credentials.withCredentials(createEformsignWorkerPrincipal(branchId), "document.read", async ({ accessToken }) => {
                const args = { suffix, requireCompleteTitles: true,
                    listing: () => readCancelledInitialLists(this.client, accessToken, deadline) };
                if (chunks.length === 0) {
                    const result = await scanCancelledInitialSuffix(args, deadline);
                    if (result === "INCOMPLETE") return result;
                    return { found: result.hits.size > 0, ambiguous: false, totals: result.totals };
                }
                const result = await classifyCancelledInitialChunks({ ...args, chunks: chunks.map(({ data }) => ({
                    chunkIndex: data.chunk_index, chunkCount: data.chunk_count, eformsignDocumentId: data.document_id,
                })) }, deadline);
                if (result === "INCOMPLETE") return result;
                // Keep linked rows in the scan so conflicting titles and ordinals still block attestation.
                const linkedIds = new Set(chunks.map(({ data }) => data.document_id).filter(id => id !== null));
                const found = result.chunks.some(({ matchId }) => matchId !== undefined && !linkedIds.has(matchId));
                return { found, ambiguous: result.ambiguous, totals: result.totals };
            });
            const result = await Promise.race([scan, timeout]);
            return Date.now() < deadline.expiresAt ? result : "INCOMPLETE";
        } catch {
            return "INCOMPLETE";
        } finally {
            clearTimeout(timer);
        }
    }

    private async confirmCandidate(request: ConfirmInput, state: State, candidate: Candidate) {
        const { input, job } = candidate;
        if (state.version !== job.stateVersion) throw conflict(REASON.STATE_CHANGED);
        const scope = cancelledInitialChunkWhere(input);
        const suffix = cancelledInitialSuffix(input.serviceRecordCaseId, input.revisionNumber!, input.documentVersion);
        const chunks = await this.readChunks(this.prisma, scope);
        const documents = await this.readDocuments(this.prisma, state.branchId, chunks);
        const byId = new Map(documents.map(({ data }) => [data.document_id, data]));
        const kinds = chunks.map(({ data }) => localChunkKind(data, byId));
        if (await this.hasMirrorMatch(this.prisma, state.branchId, suffix, chunks)) throw conflict(REASON.PROVIDER_DOCUMENT_FOUND);
        const vendor = await this.checkVendor(state.branchId, suffix, chunks);
        if (vendor !== "INCOMPLETE" && vendor.found) throw conflict(REASON.PROVIDER_DOCUMENT_FOUND);
        if (vendor === "INCOMPLETE" || vendor.ambiguous || kinds.includes("unknown")) throw conflict(REASON.VENDOR_CHECK_INCOMPLETE);
        const unlinkedChunkIndexes = chunks.filter(chunk => chunk.data.document_id === null).map(chunk => chunk.data.chunk_index);
        let outcome: Outcome;
        if (!chunks.length) outcome = SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT;
        else if (!unlinkedChunkIndexes.length) throw conflict(REASON.LEFT_TO_PROVIDER_RECOVERY);
        else if (kinds.includes("tombstone")) outcome = SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN;
        else if (unlinkedChunkIndexes.length === chunks.length) outcome = SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT;
        else outcome = SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH;

        const vendorCheck: VendorCheck = {
            listTypes: INITIAL_PROVIDER_LIST_TYPES, totals: vendor.totals, checkedAt: new Date().toISOString(),
        };
        return this.commit(request, { state, candidate, scope, suffix, chunks, documents }, { outcome, vendorCheck, unlinkedChunkIndexes });
    }

    private async commit(
        request: ConfirmInput,
        snapshot: { state: State; candidate: Candidate; scope: Scope; suffix: string; chunks: ChunkSnapshot[]; documents: DocumentSnapshot[] },
        evidence: { outcome: Outcome; vendorCheck: VendorCheck; unlinkedChunkIndexes: number[] },
    ) {
        const { state, candidate, scope, suffix, chunks, documents } = snapshot;
        const { branchId, clientId, serviceRecordCaseId: caseId, revisionId } = state;
        const updated = await this.prisma.$transaction(async tx => {
            try {
                await lockServiceRecordWriteSet(tx, { branchId, clientId, caseId });
            } catch (error) {
                if (!isConflictException(error)) throw error;
                throw conflict(REASON.STATE_CHANGED);
            }
            await tx.$queryRaw`SELECT id FROM service_record_revision_document_state
                WHERE id = ${state.id}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE`;
            const current = await this.readState(tx, request);
            if (current && isReplay(current, request.expectedGeneration)) return { state: current, replayed: true };
            if (!current || !isDeepStrictEqual(state, current)) throw conflict(REASON.STATE_CHANGED);
            const lockedChunks = await this.readChunks(tx, scope, true);
            const lockedDocuments = await this.readDocuments(tx, branchId, lockedChunks, true);
            const currentCandidate = await loadCancelledInitialCandidate(tx, {
                stateId: state.id, branchId, revisionId, now: new Date(), lockJob: true,
            });
            if (!currentCandidate?.settled || !isDeepStrictEqual(stableJob(candidate.job), stableJob(currentCandidate.job))
                || !sameRows(chunks, lockedChunks) || !sameRows(documents, lockedDocuments)) throw conflict(REASON.STATE_CHANGED);
            if (await this.hasMirrorMatch(tx, branchId, suffix, lockedChunks)) throw conflict(REASON.PROVIDER_DOCUMENT_FOUND);
            const owner = await tx.service_record_case.findUnique({ where: { id: caseId }, select: { version: true } });
            if (!owner) throw conflict(REASON.STATE_CHANGED);

            const { outcome, vendorCheck, unlinkedChunkIndexes } = evidence;
            const outputProof = {
                kind: ATTESTATION, actorUserId: request.actorUserId, attestedAt: new Date().toISOString(),
                outcome, vendorCheck: { ...vendorCheck, listTypes: [...vendorCheck.listTypes] }, unlinkedChunkIndexes,
            };
            const changed = await tx.service_record_revision_document_state.updateMany({
                where: { id: state.id, branchId, revisionId, generation: state.generation, version: state.version,
                    status: state.status, lastErrorCode: state.lastErrorCode, outputProof: { equals: Prisma.DbNull } },
                data: { status: "failed", step: "failed", lastErrorCode: outcome, nextAttemptAt: null,
                    version: { increment: 1 }, outputProof },
            });
            if (changed.count !== 1) {
                const replay = await this.readState(tx, request);
                if (replay && isReplay(replay, request.expectedGeneration)) return { state: replay, replayed: true };
                throw conflict(REASON.STATE_CHANGED);
            }
            const caseChanged = await tx.service_record_case.updateMany({
                where: { id: caseId, branchId, currentRevisionId: revisionId, version: owner.version,
                    status: { in: ["READY_TO_FINALIZE", "FINALIZATION_FAILED"] } },
                data: { status: "FINALIZATION_FAILED", lastError: outcome, documentsCompletedAt: null,
                    currentUsableRevisionId: null, currentUsableDocumentVersion: null, nextAttemptAt: null, version: { increment: 1 } },
            });
            if (caseChanged.count !== 1) throw conflict(REASON.STATE_CHANGED);
            const readiness = await releaseTerminalInitialFinalizationKey(tx, caseId, revisionId);
            if (outcome === SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT && !readiness.ready) throw conflict(REASON.NOT_READY_AFTER_OUTCOME);
            return { state: { ...current, status: "failed", lastErrorCode: outcome, outputProof }, replayed: false };
        });
        if (!updated.replayed) this.logger.log({ stateId: state.id, jobId: candidate.job.id, caseId, actorUserId: request.actorUserId });
        return stateResponse(updated.state);
    }
}
