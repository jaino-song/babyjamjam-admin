import type {
    ServiceRecordEditDocumentScope,
    ServiceRecordEditSignatureMetadata,
    ServiceRecordEditConfirmDocumentStatus,
    ServiceRecordEditConfirmResponse,
    ServiceRecordRevisionDispatchContext,
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentState as SharedServiceRecordRevisionDocumentState,
    ServiceRecordRevisionHistoryResponse,
} from "@babyjamjam/shared/types/service-record";
import type { Prisma } from "@prisma/client";

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

/** Storage-facing state is shared with adapter workers without importing Prisma. */
export type ServiceRecordRevisionDocumentState = SharedServiceRecordRevisionDocumentState;

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

/**
 * Case lifecycle values observed while the confirm transaction owns the
 * aggregate.  These timestamps are evidence for dispatch/finalization policy;
 * they are never derived from submitted day counts or client status.
 */
export interface ServiceRecordEditCaseLifecycle {
    status: string;
    completedAt: string | null;
    finalizationDueAt: string | null;
    finalizationStartedAt: string | null;
    finalizedAt: string | null;
    documentsCompletedAt: string | null;
}

export interface ServiceRecordEditSource {
    caseId: string;
    caseVersion: number;
    formVersion: number;
    /** Server-observed branch name frozen with revision document inputs. */
    branchName?: string | null;
    caseLifecycle: ServiceRecordEditCaseLifecycle;
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
    /** Server-observed signature timestamps/treatment; signature bytes stay in source day rows. */
    signatureMetadata?: ServiceRecordEditSignatureMetadata;
    /** Branch-scoped local document/revision scope captured with the source snapshot. */
    documentScope?: ServiceRecordEditDocumentScope;
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

/**
 * Source rows passed only to the confirm planner's fact-capture policy.  This
 * is deliberately separate from ServiceRecordEditSource so provider detail
 * JSON never becomes part of the editor GET/draft DTO.  Every field is an
 * observed database value; nullable metadata remains nullable evidence.
 */
export interface ServiceRecordEditRevisionFactsDocument {
    documentId: string | null;
    branchId?: string | null;
    clientId?: number | null;
    documentVersion?: number | null;
    templateId?: string | null;
    templateVersion?: string | null;
    mirrorGeneration?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    receivedDate?: string | null;
    receivedAmount?: string | number | null;
    statusType?: string | number | null;
    stepType?: string | number | null;
    stepIndex?: string | number | null;
    stepName?: string | null;
    stepRecipientType?: string | number | null;
    stepRecipientName?: string | null;
    stepRecipientSms?: string | null;
    detailPayload: ServiceRecordEditJsonValue | null;
    stage?: "provider_review" | "provider_participant" | "signature_pending" | "completed" | "unsupported" | null;
    workflowScope?: Record<string, string | number | boolean | null> | null;
    participant?: {
        id?: string | null;
        name?: string | null;
        phone?: string | null;
    } | null;
    allowedFieldIds?: readonly string[] | null;
    fields?: ServiceRecordEditJsonValue;
}

export interface ServiceRecordEditRevisionFactsReceiptToken {
    id: string;
    eformsignDocId: number;
    branchId: string | null;
    clientId: number | null;
    active: boolean;
    revokedAt: Date | string | null;
}

export interface ServiceRecordEditRevisionFactsSource {
    document: ServiceRecordEditRevisionFactsDocument | null;
    /** Undefined means the token observation failed; [] is an observed empty set. */
    receiptTokens?: readonly ServiceRecordEditRevisionFactsReceiptToken[];
}

export type ServiceRecordEditDraftStatus = "ACTIVE" | "DISCARDED" | "CONFIRMED";

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
    confirmedByUserId: string | null;
    confirmedAt: Date | null;
    confirmationIdempotencyKey: string | null;
    confirmationFingerprint: string | null;
    confirmationResponse: ServiceRecordEditJsonValue | null;
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

/** Server-owned immutable operation input captured for one revision. */
export interface CreateServiceRecordRevisionDocumentStateInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    operation: ServiceRecordRevisionDocumentOperation;
    generation: string;
    immutableInput: ServiceRecordEditJsonValue;
    inputFingerprint: string;
    documentVersion?: number | null;
    sourceDocumentId?: string | null;
    targetDocumentId?: string | null;
    templateId?: string | null;
    templateVersion?: string | null;
    workflowScope?: ServiceRecordEditJsonValue | null;
    mirrorGeneration?: string | null;
    outputProof?: ServiceRecordEditJsonValue | null;
    step?: string;
    status?: ServiceRecordRevisionDocumentStatus;
    attempts?: number;
    nextAttemptAt?: Date | null;
    lastErrorCode?: string | null;
}

/** Compare-and-swap transition for mutable operation progress. */
export interface AdvanceServiceRecordRevisionDocumentStateInput {
    branchId: string;
    clientId: number;
    stateId: string;
    expectedGeneration: string;
    expectedVersion: number;
    step: string;
    status: ServiceRecordRevisionDocumentStatus;
    attempts?: number;
    nextAttemptAt?: Date | null;
    lastErrorCode?: string | null;
    documentVersion?: number | null;
    expectedDocumentVersion?: number | null;
    sourceDocumentId?: string | null;
    targetDocumentId?: string | null;
    expectedTargetDocumentId?: string | null;
    templateId?: string | null;
    templateVersion?: string | null;
    workflowScope?: ServiceRecordEditJsonValue | null;
    mirrorGeneration?: string | null;
    expectedMirrorGeneration?: string | null;
    outputProof?: ServiceRecordEditJsonValue | null;
}

/** A retry only reopens the existing generation; it never allocates a revision. */
export interface RetryServiceRecordRevisionDocumentInput {
    branchId: string;
    clientId: number;
    revisionId: string;
    stateId: string;
    expectedGeneration: string;
    /**
     * Public administrator retries enqueue the existing operation job. The
     * contract/receipt services use the same CAS as an internal resume step;
     * they must not require the editor dispatch context or create a second
     * job while continuing from their persisted immutable snapshot.
     */
    enqueueJob?: boolean;
}

/**
 * Allocate the immutable snapshot version for one revision generation. The
 * caller supplies the state generation and the version it observed; the
 * repository allocates under the common case lock and returns the persisted
 * value so renderer retries never recompute it from live rows.
 */
export interface AllocateServiceRecordRevisionDocumentVersionInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    documentStateId: string;
    generation: string;
    expectedDocumentVersion: number | null;
}

/**
 * Promote a fully rendered revision snapshot in one owning transaction. The
 * repository verifies the persisted chunk/document set instead of trusting
 * the renderer's supplied identifiers before advancing current usable
 * pointers and operation state.
 */
export interface PromoteServiceRecordRevisionSnapshotInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    revisionNumber: number;
    documentStateId: string;
    generation: string;
    documentVersion: number;
    chunkCount: number;
    documentIds: string[];
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

export interface ServiceRecordEditConfirmSnapshot {
    draft: ServiceRecordEditDraft;
    source: ServiceRecordEditSource;
    /** Private locked document/token evidence for revision operation planning. */
    revisionFactsSource?: ServiceRecordEditRevisionFactsSource;
}

export interface ServiceRecordEditConfirmSessionUpdate {
    sourceRowId: string;
    serviceDate: string;
    answers: ServiceRecordEditJsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
}

/**
 * An administrator-authored row for a planned slot that has no provider
 * submission yet.  The id is generated by the server while the locked source
 * is being turned into a confirmation plan; provider-owned fields stay empty
 * until the public entry flow writes a real submission.
 */
export interface ServiceRecordEditConfirmNewSession {
    sourceRowId: string;
    sessionIndex: number;
    serviceDate: string;
    originalDate: string;
    assignmentId: string;
    provenanceVersion: string;
    answers: ServiceRecordEditJsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    momApproval: null;
    clientSignature: null;
    clientSignedAt: null;
    locked: false;
    submittedAt: null;
    scheduleId: number;
    employeeId: number;
    employeeNameSnapshot: string;
    formVersion: number;
}

export interface ServiceRecordEditConfirmAssignmentUpdate {
    assignmentId: string | null;
    scheduleId: number | null;
    startDate: string;
    endDate: string;
}

export interface ServiceRecordEditConfirmDocumentJobPlan {
    requestKey: string;
    activeKey: string;
    payload: Record<string, unknown>;
    payloadFingerprint: string;
    documentId?: string | null;
}

/**
 * A confirmation may need to leave an independent contract or receipt
 * operation marker alongside the service-record revision.  The marker is
 * immutable input plus a safe readiness state; provider work is owned by the
 * operation service and is never started from this plan.
 */
export interface ServiceRecordEditConfirmOperationPlan {
    operation: Exclude<ServiceRecordRevisionDocumentOperation, "record_snapshot">;
    immutableInput: ServiceRecordEditJsonValue;
    status: ServiceRecordRevisionDocumentStatus;
    step: string;
    lastErrorCode?: string | null;
    documentVersion?: number | null;
    sourceDocumentId?: string | null;
    targetDocumentId?: string | null;
    templateId?: string | null;
    templateVersion?: string | null;
    workflowScope?: ServiceRecordEditJsonValue | null;
    mirrorGeneration?: string | null;
}

/**
 * A fully server-derived write plan. The repository computes no business
 * values from user input; it only applies this plan after taking the common
 * ownership locks and rereading the draft/source.
 */
export interface ServiceRecordEditConfirmPlan {
    status: "confirmed" | "no_changes";
    sourceFingerprint: string;
    caseId: string;
    clientId: number;
    formVersion: number;
    requiredSessionCount: number | null;
    startDate: string | null;
    endDate: string | null;
    header: ServiceRecordEditSource["header"];
    plannedSessions: ServiceRecordEditJsonValue | null;
    sessions: ServiceRecordEditConfirmSessionUpdate[];
    newSessions: ServiceRecordEditConfirmNewSession[];
    assignments: ServiceRecordEditConfirmAssignmentUpdate[];
    revision: AppendServiceRecordRevisionInput | null;
    dispatchContext: ServiceRecordRevisionDispatchContext | null;
    documentStatus: ServiceRecordEditConfirmDocumentStatus;
    documentJob: ServiceRecordEditConfirmDocumentJobPlan | null;
    /** Independent period/token operations; omitted only for legacy plans. */
    contractOperation?: ServiceRecordEditConfirmOperationPlan | null;
    receiptOperation?: ServiceRecordEditConfirmOperationPlan | null;
}

export interface ServiceRecordEditConfirmInput {
    branchId: string;
    draftId: string;
    expectedDraftVersion: number;
    previewId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    actorUserId: string;
    prepare: (snapshot: ServiceRecordEditConfirmSnapshot) =>
        | ServiceRecordEditConfirmPlan
        | Promise<ServiceRecordEditConfirmPlan>;
}

export interface ServiceRecordEditTransactionContext {
    readonly tx: Prisma.TransactionClient;
}

export interface IServiceRecordEditRepository {
    /** Return the one active draft, creating it atomically when absent. */
    createOrResumeDraft(input: CreateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft>;
    findActiveDraft(branchId: string, serviceRecordCaseId: string): Promise<ServiceRecordEditDraft | null>;
    findDraft(branchId: string, serviceRecordCaseId: string, draftId: string): Promise<ServiceRecordEditDraft | null>;
    /** Find a draft by id without exposing whether another branch owns it. */
    findDraftById(branchId: string, draftId: string): Promise<ServiceRecordEditDraft | null>;
    /** Capture a draft and its branch-owned source in one repeatable-read operation. */
    loadDraftWithSource(
        branchId: string,
        draftId: string,
    ): Promise<{ draft: ServiceRecordEditDraft; source: ServiceRecordEditSource } | null>;
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
    /** Read branch/client-scoped revision history and safe operation summaries. */
    listRevisionHistory(branchId: string, clientId: number): Promise<ServiceRecordRevisionHistoryResponse | null>;
    /** Read one mutable operation row by all server-owned scope keys. */
    findRevisionDocumentState(
        branchId: string,
        clientId: number,
        revisionId: string,
        stateId: string,
    ): Promise<ServiceRecordRevisionDocumentState | null>;
    /**
     * Read one operation state by branch/revision/state identity.  The
     * repository resolves the owning client from the locked case/revision
     * joins; callers never supply a client value that could widen tenant
     * scope.
     */
    findRevisionDocumentStateForBranch(
        branchId: string,
        revisionId: string,
        stateId: string,
    ): Promise<ServiceRecordRevisionDocumentState | null>;
    /** Create a generation-bound operation state. The unique operation/generation constraints are authoritative. */
    createRevisionDocumentState(
        input: CreateServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState>;
    /** Same insert boundary for callers that already own the confirm transaction. */
    createRevisionDocumentStateInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: CreateServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState>;
    /** Advance mutable progress only when generation and version still match. */
    advanceRevisionDocumentState(
        input: AdvanceServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState | null>;
    /** Same CAS boundary on an existing caller-owned transaction. */
    advanceRevisionDocumentStateInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: AdvanceServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState | null>;
    /** Reopen a failed/manual operation without changing revision or generation identity. */
    retryRevisionDocumentState(
        input: RetryServiceRecordRevisionDocumentInput,
    ): Promise<ServiceRecordRevisionDocumentState | null>;
    /** Same retry CAS boundary on an existing caller-owned transaction. */
    retryRevisionDocumentStateInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: RetryServiceRecordRevisionDocumentInput,
    ): Promise<ServiceRecordRevisionDocumentState | null>;
    /** Allocate/replay one case-local snapshot version under the common lock. */
    allocateServiceRecordRevisionDocumentVersion(
        input: AllocateServiceRecordRevisionDocumentVersionInput,
    ): Promise<number>;
    /** Same allocator boundary for a caller-owned transaction. */
    allocateServiceRecordRevisionDocumentVersionInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: AllocateServiceRecordRevisionDocumentVersionInput,
    ): Promise<number>;
    /** Promote a complete chunk/document set and advance usable pointers atomically. */
    promoteServiceRecordRevisionSnapshot(
        input: PromoteServiceRecordRevisionSnapshotInput,
    ): Promise<boolean>;
    /** Same promotion boundary for a caller-owned transaction. */
    promoteServiceRecordRevisionSnapshotInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: PromoteServiceRecordRevisionSnapshotInput,
    ): Promise<boolean>;
    /**
     * Confirm one active draft atomically. The repository owns the typed
     * Prisma transaction and invokes `prepare` only after the common lock
     * order and fresh source reread have completed.
     */
    confirmDraft(input: ServiceRecordEditConfirmInput): Promise<ServiceRecordEditConfirmResponse>;
}

export const SERVICE_RECORD_EDIT_REPOSITORY = "SERVICE_RECORD_EDIT_REPOSITORY";
