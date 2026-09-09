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
