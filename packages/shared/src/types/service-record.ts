import type { MessageTriggerJobStatus } from "./message";

export type ServiceRecordLinkStatus = "none" | "scheduled" | "sent" | "failed" | "canceled";
export type ServiceRecordTokenState = "active" | "expired" | "revoked" | null;

export interface ServiceRecordToken {
    issuedAt: string;
    verifiedAt: string | null;
    expiresAt: string;
    state: ServiceRecordTokenState;
}

export interface ServiceRecordLink {
    status: ServiceRecordLinkStatus;
    scheduledFor: string | null;
    sentCount: number;
    lastSentAt: string | null;
    token: ServiceRecordToken | null;
}

export interface ServiceRecordHeader {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ServiceRecordSession {
    sessionIndex: number;
    serviceDate: string;
    locked: boolean;
    submittedAt: string | null;
    updatedAt: string;
    answers: Record<string, unknown>;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    hasMomApproval: boolean;
    employeeId?: number | null;
    employeeName?: string | null;
    formVersion?: number;
}

/** Assignment provenance for one authoritative planned service session. */
export interface ServiceRecordPlannedSessionProvenance {
    assignmentId: string;
    scheduleId: number;
    employeeId: number;
    provenanceVersion: string;
}

/** Complete planned-session entry shared by the editor and later confirm flow. */
export interface ServiceRecordPlannedSession extends ServiceRecordPlannedSessionProvenance {
    sessionIndex: number;
    serviceDate: string;
    originalDate: string;
}

export interface ServiceRecordEditPreviewBlockingReason {
    code: string;
    message: string;
    sessionIndex?: number;
    assignmentId?: string;
}

export type ServiceRecordEditEvidence = "observed" | "unverified";

/**
 * Metadata-only treatment for signatures already captured on a service day.
 * The signature payload itself never crosses the preview contract; later
 * confirmation preserves the stored signature and submission timestamps while
 * allowing the displayed service date to change.
 */
export type ServiceRecordEditSignatureTreatment = "preserve_existing" | "manual_review";

export interface ServiceRecordEditSignatureSessionMetadata {
    sessionIndex: number;
    hasSignature: boolean;
    signedAt: string | null;
    submittedAt: string | null;
}

export interface ServiceRecordEditSignatureMetadata {
    treatment: ServiceRecordEditSignatureTreatment;
    evidence: ServiceRecordEditEvidence;
    sessions: ServiceRecordEditSignatureSessionMetadata[];
}

export interface ServiceRecordEditDocumentChunk {
    documentId: string;
    snapshotVersion: number | null;
    snapshotChunkIndex: number | null;
}

export interface ServiceRecordEditDocumentScope {
    evidence: ServiceRecordEditEvidence;
    serviceRecordSnapshot: {
        documentIds: string[];
        snapshotVersion: number | null;
        chunks: ServiceRecordEditDocumentChunk[];
    };
    currentRevision: {
        id: string | null;
        revisionNumber: number | null;
        formVersion: number | null;
    };
    form: {
        version: number | null;
    };
    contract: {
        currentDocumentId: string | null;
        stage: ServiceRecordEditContractStage;
    };
}

export type ServiceRecordEditContractStage = "completed" | "rejected" | "in_progress" | "unknown" | null;

/** Full planned vector exposed by the read-only editor endpoint. */
export interface ServiceRecordScheduleProjection {
    entries: ServiceRecordPlannedSession[];
    blockingReasons: ServiceRecordEditPreviewBlockingReason[];
}

export interface ServiceRecordEditPreviewAssignmentRange {
    assignmentId: string;
    scheduleId: number;
    employeeId: number;
    startDate: string;
    endDate: string;
    provenanceVersion: string;
}

export interface ServiceRecordEditPreviewContentChanges {
    headerChanged: boolean;
    changedSessionIndexes: number[];
}

export interface ServiceRecordEditPreviewVector {
    startDate: string | null;
    endDate: string | null;
    sessions: ServiceRecordPlannedSession[];
}

/**
 * Server-owned preview contract. The identifier is bound to every value that
 * a later atomic confirm will recheck; clients cannot supply provenance or
 * authority fields as part of a preview request.
 */
export interface ServiceRecordEditPreviewResponse {
    previewId: string;
    draftId: string;
    draftVersion: number;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    requiredSessionCount: number | null;
    calendarVersion: string;
    before: ServiceRecordEditPreviewVector;
    after: ServiceRecordEditPreviewVector;
    provenance: ServiceRecordEditPreviewAssignmentRange[];
    contentChanges: ServiceRecordEditPreviewContentChanges;
    impactedAssignments: string[];
    blockingReasons: ServiceRecordEditPreviewBlockingReason[];
    signatureMetadata: ServiceRecordEditSignatureMetadata;
    documentScope: ServiceRecordEditDocumentScope;
}

/**
 * The durable result returned by the administrator's atomic confirm action.
 * Every field is server-owned and is persisted with the draft's idempotency
 * record so a retry can replay the exact same response.
 */
export type ServiceRecordEditConfirmStatus = "confirmed" | "no_changes";

export type ServiceRecordEditConfirmDocumentStatus =
    | "not_required"
    | "waiting_for_completion"
    | "capability_unverified"
    | "pending";

export interface ServiceRecordEditConfirmResponse {
    status: ServiceRecordEditConfirmStatus;
    caseId: string;
    clientId: number;
    draftId: string;
    draftVersion: number;
    caseVersion: number;
    revisionId: string | null;
    revisionNumber: number | null;
    documentStatus: ServiceRecordEditConfirmDocumentStatus;
    confirmedAt: string;
}

/**
 * Revision identity and business snapshot consumed by provider adapters.
 * This context contains no credentials or provider response data. A worker
 * must authorize the context again under its owning transaction before any
 * irreversible dispatch.
 */
export interface ServiceRecordRevisionDispatchContext {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string | null;
    revisionNumber: number | null;
    businessFingerprint: string;
    plannedSessionCount: number | null;
    plannedSessionDates: Array<{ sessionIndex: number; serviceDate: string }>;
    documentSyncStatus: ServiceRecordRevisionDocumentSyncStatus;
    lifecycleStatus: string;
    formVersion: number;
}

/** Durable document-generation states understood by dispatch adapters. */
export type ServiceRecordRevisionDocumentSyncStatus =
    | "not_required"
    | "pending"
    | "waiting_for_completion"
    | "capability_unverified"
    | "completed"
    | "failed"
    | "unknown";

export type ServiceRecordDispatchAuthorizationKind = "allow" | "stale" | "lost";

export interface ServiceRecordDispatchAuthorizationResult {
    kind: ServiceRecordDispatchAuthorizationKind;
    reason?: string;
}

/** Immutable generation input captured by a later finalization boundary. */
export interface ServiceRecordRevisionGenerationInput extends ServiceRecordRevisionDispatchContext {
    generationKind: "REVISION_SNAPSHOT" | "INITIAL_FINALIZATION";
    /** Mutable operation-state row that owns this generation's CAS. */
    documentStateId: string;
    /** Null until the renderer allocates the next case document version. */
    documentVersion: number | null;
    snapshotReference: string;
    generation: string;
    /** Immutable complete input captured under the finalization lock. */
    immutablePayload: Record<string, unknown>;
    payloadFingerprint: string;
    completeness: "complete";
}

/** The three independently progressing document operations for a revision. */
export const SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS = [
    "record_snapshot",
    "contract_period",
    "receipt_refresh",
] as const;

export type ServiceRecordRevisionDocumentOperation =
    (typeof SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS)[number];

/** Public state vocabulary shared by history, retry, and worker consumers. */
export const SERVICE_RECORD_REVISION_DOCUMENT_STATUSES = [
    "not_required",
    "waiting_for_completion",
    "waiting_for_signature",
    "capability_unverified",
    "manual_review",
    "pending",
    "processing",
    "unknown",
    "failed",
    "completed",
] as const;

export type ServiceRecordRevisionDocumentStatus =
    (typeof SERVICE_RECORD_REVISION_DOCUMENT_STATUSES)[number];

/**
 * Safe document state presented by the revision history endpoint. Immutable
 * input, fingerprints, provider responses, and credentials stay behind the
 * server repository boundary.
 */
export interface ServiceRecordRevisionDocumentSummary {
    id: string;
    operation: ServiceRecordRevisionDocumentOperation;
    generation: string;
    status: ServiceRecordRevisionDocumentStatus;
    documentVersion: number | null;
    canRetry: boolean;
    reasonCode: string | null;
}

export interface ServiceRecordRevisionHistoryEntry {
    id: string;
    revisionNumber: number;
    confirmedAt: string;
    isCurrent: boolean;
    documents: ServiceRecordRevisionDocumentSummary[];
}

export interface ServiceRecordRevisionHistoryResponse {
    caseId: string;
    caseVersion: number;
    currentRevisionId: string | null;
    currentUsableRevisionId: string | null;
    revisions: ServiceRecordRevisionHistoryEntry[];
}

export interface ServiceRecordRevisionDocumentRetryRequest {
    expectedGeneration: string;
}

/**
 * Branch-scoped durable operation state. This is a storage-facing shape used
 * by backend adapters as well as a serializable reference for focused tests;
 * `immutableInput` is never returned by the public history DTO.
 */
export interface ServiceRecordRevisionDocumentState {
    id: string;
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    operation: ServiceRecordRevisionDocumentOperation;
    generation: string;
    immutableInput: Record<string, unknown>;
    inputFingerprint: string;
    documentVersion: number | null;
    sourceDocumentId: string | null;
    targetDocumentId: string | null;
    templateId: string | null;
    templateVersion: string | null;
    workflowScope: Record<string, unknown> | null;
    mirrorGeneration: string | null;
    /** Server-produced semantic proof metadata; never provider credentials or raw bytes. */
    outputProof: Record<string, unknown> | null;
    step: string;
    status: ServiceRecordRevisionDocumentStatus;
    attempts: number;
    nextAttemptAt: string | null;
    lastErrorCode: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

export interface SignatureDocStatus {
    documentId: string;
    statusDetail: string;
    stepName: string;
    createdDate: string;
    updatedDate: string;
    snapshotVersion?: number | null;
    snapshotChunkIndex?: number | null;
    employeeScheduleId?: number | null;
}

export interface ServiceRecordCase {
    id: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    totalSessions: number;
    completedAt: string | null;
    finalizationDueAt: string | null;
    finalizedAt: string | null;
    documentsCompletedAt: string | null;
    lastError: string | null;
    header: ServiceRecordHeader | null;
    sessions: ServiceRecordSession[];
    signatureDocs: SignatureDocStatus[];
}

export interface ServiceRecordAssignment {
    scheduleId: number;
    startDate: string;
    endDate: string;
    replaced: boolean;
    employee: {
        id: number;
        name: string;
        phone: string;
    };
    link: ServiceRecordLink;
    header: ServiceRecordHeader | null;
    totalSessions: number;
    sessions: ServiceRecordSession[];
    signatureDoc: SignatureDocStatus | null;
}

export interface ServiceRecordOverview {
    record?: ServiceRecordCase | null;
    assignments: ServiceRecordAssignment[];
    scheduleProjection?: ServiceRecordScheduleProjection;
}

export interface SendServiceRecordLinkResponse {
    ok: boolean;
    jobId: string;
    status: MessageTriggerJobStatus;
    scheduledFor: string;
}

export interface PrepareServiceRecordLinkResponse {
    serviceRecordUrl: string;
    preparedLinkToken: string;
    expiresAt: string;
}

export interface ResetServiceRecordLinkResponse {
    serviceRecordUrl: string;
    expiresAt: string;
}

export interface ServiceScheduleChangePreviewResponse {
    sessionIndex: number;
    fromDate: string;
    minimumDate: string;
}

export interface ApplyServiceScheduleChangeRequest {
    toDate: string;
}

export interface ApplyServiceScheduleChangeResponse {
    id: string;
    scheduleId: number;
    clientId: number;
    sessionIndex: number;
    fromDate: string;
    toDate: string;
    oldEndDate: string;
    newEndDate: string;
    status: "approved";
}

export interface PrepareServiceRecordLinkRequest {
    recipientPhone?: string;
}

export interface SendServiceRecordLinkRequest {
    preparedLinkToken?: string;
    recipientPhone?: string;
}
