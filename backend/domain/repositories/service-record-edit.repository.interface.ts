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

/** Immutable source rows captured for a draft in one repeatable-read snapshot. */
export interface ServiceRecordEditSourceDay {
    id: string;
    branchId: string;
    sourceRowId: string;
    scheduleId: number | null;
    sessionIndex: number;
    rawCaseSessionIndex: number | null;
    rawSessionIndex: number;
    ambiguous: boolean;
    serviceDate: string;
    answers: ServiceRecordEditJsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    momApproval: string | null;
    clientSignature: string | null;
    clientSignedAt: string | null;
    locked: boolean;
    submittedAt: string | null;
    employeeId: number | null;
    employeeNameSnapshot: string | null;
    formVersion: number;
}

export interface ServiceRecordEditSourceAssignment {
    id: string | null;
    branchId: string | null;
    serviceRecordCaseId: string | null;
    scheduleId: number | null;
    employeeId: number | null;
    startDate: string;
    endDate: string;
    replaced: boolean;
    employeeName: string | null;
    scheduleStartDate: string;
    scheduleEndDate: string;
    scheduleTerminatedAt: string | null;
    primaryEmployeeId: number | null;
    secondaryEmployeeId: number | null;
    primaryEmployeeName: string | null;
}

export interface ServiceRecordEditSource {
    caseId: string;
    caseVersion: number;
    formVersion: number;
    requiredSessionCount: number | null;
    startDate: string | null;
    endDate: string | null;
    header: {
        momName: string | null;
        momBirth: string | null;
        babyName: string | null;
        babyBirth: string | null;
        deliveryType: string | null;
        babyWeight: string | null;
    };
    sessions: ServiceRecordEditSourceDay[];
    assignments: ServiceRecordEditSourceAssignment[];
    plannedSessions: ServiceRecordEditJsonValue | null;
    client: {
        id: number;
        branchId: string | null;
        name: string;
        duration: number | null;
        startDate: string | null;
        endDate: string | null;
        serviceStatus: string | null;
    };
}

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
}

export interface IServiceRecordEditRepository {
    /** Return the one active draft, creating it atomically when absent. */
    createOrResumeDraft(input: CreateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    findActiveDraft(branchId: string, serviceRecordCaseId: string): Promise<ServiceRecordEditDraft | null>;
    findDraft(branchId: string, serviceRecordCaseId: string, draftId: string): Promise<ServiceRecordEditDraft | null>;
    /** Find a draft by id without exposing whether another branch owns it. */
    findDraftById(branchId: string, draftId: string): Promise<ServiceRecordEditDraft | null>;
    /** Capture the branch-owned case, client, sessions, and assignments atomically. */
    loadSource(
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<ServiceRecordEditSource | null>;
    /** Compare-and-swap a draft's changes and increment its version. */
    updateDraft(input: UpdateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    /** Compare-and-swap the active draft to a terminal discarded state. */
    discardDraft(input: DiscardServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    /** Append an immutable revision, allocating the next case-local number under a row lock. */
    appendRevision(input: AppendServiceRecordRevisionInput): Promise<ServiceRecordRevision>;
}

export const SERVICE_RECORD_EDIT_REPOSITORY = "SERVICE_RECORD_EDIT_REPOSITORY";
