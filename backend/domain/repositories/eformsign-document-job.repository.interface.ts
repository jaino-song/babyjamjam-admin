import {
    EformsignDocumentJobEntity,
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
    EformsignDocumentJobType,
} from "domain/entities/eformsign-document-job.entity";
import type { Prisma } from "@prisma/client";
import type {
    ServiceRecordDispatchAuthorizationResult,
    ServiceRecordRevisionDispatchContext,
} from "@babyjamjam/shared/types/service-record";

export interface EnqueueEformsignDocumentJobInput {
    branchId: string;
    clientId?: number | null;
    documentId?: string | null;
    jobType: EformsignDocumentJobType;
    source: EformsignDocumentJobSource;
    requestKey: string;
    activeKey: string;
    payload: EformsignDocumentJobPayload;
    payloadFingerprint: string;
    createdByUserId?: string | null;
}

export interface EformsignDocumentJobSummary {
    activeCount: number;
    requiresAttentionCount: number;
}

export interface EformsignDocumentJobList {
    active: EformsignDocumentJobEntity[];
    requiresAttention: EformsignDocumentJobEntity[];
    recent: EformsignDocumentJobEntity[];
}

/**
 * Claim a live worker lease for the irreversible provider boundary while the
 * caller's transaction still owns the common service-record lock set.
 * `expectedContext` is omitted only for legacy create/finalize jobs that do
 * not carry a service-record revision intent; those jobs still require the
 * matching live lease and processing status.
 */
export interface AuthorizeEformsignDocumentJobForDispatchInput {
    jobId: string;
    leaseToken: string;
    expectedContext?: ServiceRecordRevisionDispatchContext | null;
}

export interface IEformsignDocumentJobRepository {
    enqueue(input: EnqueueEformsignDocumentJobInput): Promise<{ job: EformsignDocumentJobEntity; existing: boolean }>;
    /** Read one immutable request-key row inside an already-owned transaction. */
    findByRequestKeyInTransaction(
        tx: Prisma.TransactionClient,
        requestKey: string,
    ): Promise<EformsignDocumentJobEntity | null>;
    /** Insert or replay a job using the caller's active transaction. */
    enqueueInTransaction(
        tx: Prisma.TransactionClient,
        input: EnqueueEformsignDocumentJobInput,
    ): Promise<{ job: EformsignDocumentJobEntity; existing: boolean }>;
    /**
     * Authorize a claimed provider job through the repository-owned
     * transaction. The repository discovers the durable job owner, acquires
     * the service-record lock set, rereads authoritative source rows, and
     * commits the irreversible marker through the caller-Tx seam.
     */
    authorizeForDispatch(
        input: AuthorizeEformsignDocumentJobForDispatchInput,
    ): Promise<ServiceRecordDispatchAuthorizationResult>;
    authorizeForDispatchInTransaction(
        tx: Prisma.TransactionClient,
        input: AuthorizeEformsignDocumentJobForDispatchInput,
    ): Promise<ServiceRecordDispatchAuthorizationResult>;
    claimDue(limit?: number): Promise<EformsignDocumentJobEntity[]>;
    updateProgress(id: string, leaseToken: string, progressStep: string, heartbeatAt?: Date): Promise<EformsignDocumentJobEntity | null>;
    scheduleRetry(id: string, leaseToken: string, nextAttemptAt: Date, errorCode: string): Promise<EformsignDocumentJobEntity | null>;
    markReconciling(id: string, leaseToken: string, progressStep?: string): Promise<EformsignDocumentJobEntity | null>;
    markCompleted(id: string, leaseToken: string, documentId?: string): Promise<EformsignDocumentJobEntity | null>;
    markFailed(id: string, leaseToken: string, errorCode: string): Promise<EformsignDocumentJobEntity | null>;
    markRequiresAttention(id: string, leaseToken: string, errorCode: string): Promise<EformsignDocumentJobEntity | null>;
    recoverStale(cutoff: Date): Promise<EformsignDocumentJobEntity[]>;
    getSummary(branchId: string): Promise<EformsignDocumentJobSummary>;
    listForBranch(branchId: string, terminalSince: Date, terminalLimit?: number): Promise<EformsignDocumentJobList>;
    deleteExpiredTerminal(cutoff: Date): Promise<number>;
}

export const EFORMSIGN_DOCUMENT_JOB_REPOSITORY = "EFORMSIGN_DOCUMENT_JOB_REPOSITORY";
