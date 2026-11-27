import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";

const branchId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const stateId = "33333333-3333-4333-8333-333333333333";

function stateRow() {
    const immutableInput = { plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-08" }] };
    const fingerprint = sha256CanonicalJson(immutableInput);
    return {
        id: stateId,
        branchId,
        clientId: 17,
        serviceRecordCaseId: "44444444-4444-4444-8444-444444444444",
        revisionId,
        operation: "record_snapshot",
        generation: "generation-1",
        immutableInput,
        inputFingerprint: fingerprint,
        documentVersion: null,
        sourceDocumentId: null,
        targetDocumentId: null,
        templateId: null,
        templateVersion: null,
        workflowScope: null,
        mirrorGeneration: null,
        outputProof: null,
        step: "pending",
        status: "pending",
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        version: 0,
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    };
}

describe("ServiceRecordEditRepository revision state branch lookup", () => {
    it.each(["failed", "manual_review"])("hides retry for an INITIAL %s state without the staff retry scope", async (status) => {
        const base = { ...stateRow(), status, step: "failed" };
        const initial = { ...base, workflowScope: {
            requestKey: `service-record-initial-finalization:${revisionId}`, generationKind: "INITIAL_FINALIZATION",
        } };
        const staff = { ...base, id: "staff-state", workflowScope: { requestKey: "staff-request", activeKey: "staff-active" } };
        const tx = {
            $queryRaw: jest.fn(async (sql: { text: string }) => {
                if (sql.text.includes('FROM "service_record_case"')) return [{
                    caseId: base.serviceRecordCaseId, caseVersion: 1, currentRevisionId: revisionId, currentUsableRevisionId: null,
                }];
                if (sql.text.includes('FROM "service_record_revision_document_state"')) return [initial, staff];
                if (sql.text.includes('FROM "service_record_revision"')) return [{ id: revisionId, revisionNumber: 1, confirmedAt: base.createdAt }];
                return [];
            }),
        };
        const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
        const history = await new ServiceRecordEditRepository(prisma as never).listRevisionHistory(branchId, base.clientId);
        expect(history?.revisions[0]?.documents).toEqual([
            expect.objectContaining({ id: stateId, canRetry: false }),
            expect.objectContaining({ id: "staff-state", canRetry: true }),
        ]);
    });

    it("returns the current INITIAL readiness blocker alongside a partial-dispatch outcome", async () => {
        const state = { ...stateRow(), documentVersion: 2, status: "failed", step: "failed",
            lastErrorCode: "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH", workflowScope: {
                requestKey: `service-record-initial-finalization:${revisionId}`, generationKind: "INITIAL_FINALIZATION",
            } };
        const owner = { id: state.serviceRecordCaseId, branchId, clientId: state.clientId,
            caseId: state.serviceRecordCaseId, caseVersion: 1, currentRevisionId: revisionId, currentUsableRevisionId: null };
        const tx = { $queryRaw: jest.fn(async (sql: { text: string }) => {
            if (sql.text.includes('FROM "service_record_case"')) return [owner];
            if (sql.text.includes('FROM "service_record_revision_document_state"')) return [state];
            if (sql.text.includes('FROM "service_record_revision"')) return [{ id: revisionId, revisionNumber: 1, confirmedAt: state.createdAt }];
            if (sql.text.includes('FROM "service_record_snapshot_chunk"')) return [
                { documentId: "signed", chunkIndex: 1, chunkCount: 2 }, { documentId: null, chunkIndex: 2, chunkCount: 2 },
            ];
            if (sql.text.includes('FROM "eformsign_doc"')) return [{ documentId: "signed", statusType: "003", voided: false, purgePending: false }];
            return [];
        }) };
        const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
        const result = await new ServiceRecordEditRepository(prisma as never).listRevisionHistory(branchId, state.clientId);
        expect(result?.revisions[0]?.documents[0]).toMatchObject({
            id: stateId, canRetry: false, reasonCode: "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH",
            regenerationBlockedReason: "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED",
        });
    });

    it("resolves the owning client from the branch/revision/state join", async () => {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([stateRow()]),
        };
        const repository = new ServiceRecordEditRepository(prisma as never);

        await expect(repository.findRevisionDocumentStateForBranch(branchId, revisionId, stateId))
            .resolves.toMatchObject({
                id: stateId,
                branchId,
                revisionId,
                clientId: 17,
            });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("returns no state when the server-owned scope has no matching row", async () => {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([]),
        };
        const repository = new ServiceRecordEditRepository(prisma as never);

        await expect(repository.findRevisionDocumentStateForBranch(branchId, revisionId, stateId))
            .resolves.toBeNull();
    });
});
