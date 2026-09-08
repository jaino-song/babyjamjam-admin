/** JSON value shape kept in the domain boundary so this port does not import Prisma. */
export type ServiceRecordEditJsonValue =
    | string
    | number
    | boolean
    | null
    | ServiceRecordEditJsonValue[]
    | { [key: string]: ServiceRecordEditJsonValue };

export type ServiceRecordEditJsonObject = {
    [key: string]: ServiceRecordEditJsonValue;
};

export type ServiceRecordEditDraftStatus = "ACTIVE" | "DISCARDED";

export interface ServiceRecordEditDraft {
    id: string;
    branchId: string;
    serviceRecordCaseId: string;
    createdByUserId: string;
    updatedByUserId: string;
    discardedByUserId: string | null;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    sourceSnapshot: ServiceRecordEditJsonValue;
    changes: ServiceRecordEditJsonValue;
    draftVersion: number;
    status: ServiceRecordEditDraftStatus;
    createdAt: Date;
    updatedAt: Date;
    discardedAt: Date | null;
}

export interface ServiceRecordRevision {
    id: string;
    branchId: string;
    serviceRecordCaseId: string;
    revisionNumber: number;
    confirmedByUserId: string;
    confirmedAt: Date;
    payload: ServiceRecordEditJsonValue;
    plannedSessions: ServiceRecordEditJsonValue;
    provenance: ServiceRecordEditJsonValue;
    formVersionAtConfirm: number;
    snapshotReference: string | null;
}

export interface CreateServiceRecordEditDraftInput {
    branchId: string;
    serviceRecordCaseId: string;
    actorUserId: string;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    sourceSnapshot: ServiceRecordEditJsonValue;
    changes?: ServiceRecordEditJsonValue;
}

export interface UpdateServiceRecordEditDraftInput {
    branchId: string;
    serviceRecordCaseId: string;
    draftId: string;
    expectedDraftVersion: number;
    actorUserId: string;
    changes: ServiceRecordEditJsonValue;
}

export interface DiscardServiceRecordEditDraftInput {
    branchId: string;
    serviceRecordCaseId: string;
    draftId: string;
    expectedDraftVersion: number;
    actorUserId: string;
}

export interface AppendServiceRecordRevisionInput {
    branchId: string;
    serviceRecordCaseId: string;
    actorUserId: string;
    payload: ServiceRecordEditJsonValue;
    plannedSessions: ServiceRecordEditJsonValue;
    provenance: ServiceRecordEditJsonValue;
    formVersionAtConfirm: number;
    snapshotReference?: string | null;
    /** Internal replay/import seam; normal callers let the repository allocate the next number. */
    revisionNumber?: number;
}

/**
 * Optional transaction handle supplied by a future confirmation use case. It
 * remains opaque at the domain boundary; the Prisma adapter validates and
 * consumes the handle without making this port depend on Prisma.
 */
export type ServiceRecordEditTransaction = unknown;

export interface IServiceRecordEditRepository {
    /** Return the one active draft, creating it atomically when absent. */
    createOrResumeDraft(input: CreateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    findActiveDraft(branchId: string, serviceRecordCaseId: string): Promise<ServiceRecordEditDraft | null>;
    findDraft(branchId: string, serviceRecordCaseId: string, draftId: string): Promise<ServiceRecordEditDraft | null>;
    /** Compare-and-swap a draft's changes and increment its version. */
    updateDraft(input: UpdateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    /** Compare-and-swap the active draft to a terminal discarded state. */
    discardDraft(input: DiscardServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    /** Append an immutable revision, allocating the next case-local number under a row lock. */
    appendRevision(
        input: AppendServiceRecordRevisionInput,
        transaction?: ServiceRecordEditTransaction,
    ): Promise<ServiceRecordRevision>;
}

export const SERVICE_RECORD_EDIT_REPOSITORY = "SERVICE_RECORD_EDIT_REPOSITORY";
