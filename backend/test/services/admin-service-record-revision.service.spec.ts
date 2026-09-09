import { ConflictException, NotFoundException } from "@nestjs/common";

import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { PrismaService } from "infrastructure/database/prisma.service";

function createPrisma() {
    return {
        client: { findFirst: jest.fn() },
    };
}

function createService(
    prisma: ReturnType<typeof createPrisma>,
    repository: Record<string, jest.Mock> = {},
) {
    return new AdminServiceRecordService(
        prisma as unknown as PrismaService,
        {} as ServiceRecordLinkService,
        {} as MessageTriggerService,
        undefined,
        repository as never,
    );
}

describe("AdminServiceRecordService revision status", () => {
    it("uses the core list seam and preserves the safe history shape", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const listRevisionHistory = jest.fn().mockResolvedValue({
            caseId: "case-1",
            caseVersion: 8,
            currentRevisionId: "revision-2",
            currentUsableRevisionId: null,
            revisions: [{
                id: "revision-2",
                revisionNumber: 2,
                confirmedAt: "2026-09-08T01:02:03.000Z",
                isCurrent: true,
                documents: [{
                    id: "state-2",
                    operation: "record_snapshot",
                    generation: "generation-2",
                    status: "waiting_for_completion",
                    documentVersion: null,
                    canRetry: false,
                    reasonCode: null,
                }],
            }],
        });

        const result = await createService(prisma, { listRevisionHistory }).getRevisionHistory("branch-1", 42);

        expect(result).toEqual(expect.objectContaining({
            caseId: "case-1",
            caseVersion: 8,
            currentRevisionId: "revision-2",
        }));
        expect(listRevisionHistory).toHaveBeenCalledWith("branch-1", 42);
    });

    it("rejects a foreign client before consulting revision state", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue(null);
        const listRevisionHistory = jest.fn();

        await expect(
            createService(prisma, { listRevisionHistory }).getRevisionHistory("branch-1", 99),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(listRevisionHistory).not.toHaveBeenCalled();
    });

    it("fails closed when the core history seam has no case", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const listRevisionHistory = jest.fn().mockResolvedValue(null);

        await expect(
            createService(prisma, { listRevisionHistory }).getRevisionHistory("branch-1", 42),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(listRevisionHistory).toHaveBeenCalledWith("branch-1", 42);
    });

    it("resolves client scope through the core branch lookup before retry CAS", async () => {
        const prisma = createPrisma();
        const findRevisionDocumentStateForBranch = jest.fn().mockResolvedValue({
            id: "state-1",
            clientId: 42,
            generation: "generation-1",
        });
        const retryRevisionDocumentState = jest.fn().mockResolvedValue({
            id: "state-1",
            operation: "record_snapshot",
            generation: "generation-1",
            status: "pending",
            documentVersion: 3,
            lastErrorCode: null,
        });

        const result = await createService(prisma, {
            findRevisionDocumentStateForBranch,
            retryRevisionDocumentState,
        }).retryRevisionDocument(
            "branch-1",
            "revision-1",
            "state-1",
            "generation-1",
            "admin-1",
        );

        expect(result).toEqual({
            id: "state-1",
            operation: "record_snapshot",
            generation: "generation-1",
            status: "pending",
            documentVersion: 3,
            canRetry: false,
            reasonCode: null,
        });
        expect(findRevisionDocumentStateForBranch).toHaveBeenCalledWith(
            "branch-1",
            "revision-1",
            "state-1",
        );
        expect(retryRevisionDocumentState).toHaveBeenCalledWith({
            branchId: "branch-1",
            clientId: 42,
            revisionId: "revision-1",
            stateId: "state-1",
            expectedGeneration: "generation-1",
        });
    });

    it("returns not found when the branch-scoped document state is absent", async () => {
        const prisma = createPrisma();
        const findRevisionDocumentStateForBranch = jest.fn().mockResolvedValue(null);
        const retryRevisionDocumentState = jest.fn();

        await expect(
            createService(prisma, {
                findRevisionDocumentStateForBranch,
                retryRevisionDocumentState,
            }).retryRevisionDocument(
                "branch-1",
                "revision-1",
                "state-1",
                "generation-1",
                "admin-1",
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(retryRevisionDocumentState).not.toHaveBeenCalled();
    });

    it("returns a conflict for a stale generation before retry CAS", async () => {
        const prisma = createPrisma();
        const findRevisionDocumentStateForBranch = jest.fn().mockResolvedValue({
            id: "state-1",
            clientId: 42,
            generation: "generation-current",
        });
        const retryRevisionDocumentState = jest.fn();

        await expect(
            createService(prisma, {
                findRevisionDocumentStateForBranch,
                retryRevisionDocumentState,
            }).retryRevisionDocument(
                "branch-1",
                "revision-1",
                "state-1",
                "generation-stale",
                "admin-1",
            ),
        ).rejects.toEqual(expect.any(ConflictException));
        expect(retryRevisionDocumentState).not.toHaveBeenCalled();
    });
});
