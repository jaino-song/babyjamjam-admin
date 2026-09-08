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
