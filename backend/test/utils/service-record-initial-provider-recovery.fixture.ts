import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import type { ServiceRecordRevisionGenerationInput } from "domain/entities/eformsign-document-job.entity";
import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

export function providerDocumentPage(documents: EformsignApiDocumentResponse[], limit: number, skip: number) {
    return { documents: documents.slice(skip, skip + limit), total_rows: documents.length };
}

/** Synthetic frozen input, also usable by the CI-owned PG harness. */
export function initialProviderRecoveryInput(scope: {
    branchId: string; clientId: number; caseId: string; revisionId: string; stateId: string; generation: string;
}, count = 2): ServiceRecordRevisionGenerationInput {
    const immutablePayload = {
        branchId: scope.branchId, clientId: scope.clientId, caseId: scope.caseId,
        revisionId: scope.revisionId, revisionNumber: 1, generation: scope.generation,
        requiredSessionCount: count, providerName: "QA-provider", client: { name: "QA-frozen-customer" },
        header: { momName: "QA-mom", momBirth: "900101", babyName: "QA-baby", babyBirth: "260101", deliveryType: "synthetic", babyWeight: "3.2" },
        plannedSessions: Array.from({ length: count }, (_, i) => ({ sessionIndex: i + 1, serviceDate: `2026-09-0${i + 1}` })),
        sessions: Array.from({ length: count }, (_, i) => ({ sessionIndex: i + 1, serviceDate: `2026-09-0${i + 1}`,
            scheduleId: 1, employeeId: 1, employeeNameSnapshot: "QA-provider", answers: {}, etcService: null, notes: null,
            paymentConfirmed: true, momApproval: "approved", clientSignature: "synthetic", clientSignedAt: "2026-09-01T01:00:00Z",
            submittedAt: "2026-09-01T01:00:00Z", locked: true })),
        completeness: "complete",
    };
    const fingerprint = sha256CanonicalJson(immutablePayload);
    return { branchId: scope.branchId, clientId: scope.clientId, serviceRecordCaseId: scope.caseId,
        revisionId: scope.revisionId, revisionNumber: 1, documentStateId: scope.stateId, generation: scope.generation,
        documentVersion: 3, snapshotReference: `service-record-initial-finalization:${scope.revisionId}`,
        documentSyncStatus: "pending", generationKind: "INITIAL_FINALIZATION", completeness: "complete",
        businessFingerprint: fingerprint, payloadFingerprint: fingerprint, immutablePayload,
        plannedSessionCount: count, plannedSessionDates: immutablePayload.plannedSessions, formVersion: 3, lifecycleStatus: "READY_TO_FINALIZE" };
}
