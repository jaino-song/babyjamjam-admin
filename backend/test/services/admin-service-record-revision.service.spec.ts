import { ConflictException, NotFoundException } from "@nestjs/common";

import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

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
        createHolidayCalendarStub(), undefined,
        repository as never,
    );
}

describe("AdminServiceRecordService revision status", () => {
    const revisionId = "55555555-5555-4555-8555-555555555555";
    it("reads a scoped revision and returns only its safe diff", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const findRevisionForChanges = jest.fn().mockResolvedValue({
            id: revisionId, revisionNumber: 2, confirmedAt: new Date("2026-10-16T00:00:00Z"), formVersionAtConfirm: 3,
            beforeSnapshot: { header: { momName: "A" } }, payload: { header: { momName: "B" } }, plannedSessions: [],
        });
        const result = await createService(prisma, { findRevisionForChanges }).getRevisionChanges("branch-1", 42, revisionId);
        expect(findRevisionForChanges).toHaveBeenCalledWith("branch-1", 42, revisionId);
        expect(result.basicInfo).toEqual([{ path: "header.momName", before: "A", after: "B" }]);
    });

    it.each(["not-a-uuid", "", "x".repeat(256)])("returns 404 for malformed revision ID %s without querying", async (id) => {
        const prisma = createPrisma();
        const findRevisionForChanges = jest.fn();
        await expect(createService(prisma, { findRevisionForChanges }).getRevisionChanges("branch-1", 42, id)).rejects.toBeInstanceOf(NotFoundException);
        expect(findRevisionForChanges).not.toHaveBeenCalled();
    });

    it("returns 404 for a foreign client before reading changes", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue(null);
        const findRevisionForChanges = jest.fn();
        await expect(createService(prisma, { findRevisionForChanges }).getRevisionChanges("branch-1", 99, revisionId)).rejects.toBeInstanceOf(NotFoundException);
        expect(findRevisionForChanges).not.toHaveBeenCalled();
    });

    it("returns the same 404 when a branch/client-scoped revision is absent", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const findRevisionForChanges = jest.fn().mockResolvedValue(null);
        await expect(createService(prisma, { findRevisionForChanges }).getRevisionChanges("branch-1", 42, revisionId)).rejects.toBeInstanceOf(NotFoundException);
    });

    describe("caregiver edit changes", () => {
        const editId = "66666666-6666-4666-8666-666666666666";
        const edit = {
            id: editId,
            editedAt: new Date("2026-10-28T01:02:03Z"),
            employeeNameSnapshot: "김제공",
            caseSessionIndex: 3,
            before: { serviceDate: "2026-10-20", answers: { a: ["yes"] }, etcService: null, notes: "old", paymentConfirmed: false },
            after: { serviceDate: "2026-10-20", answers: { a: ["no"] }, etcService: null, notes: "new", paymentConfirmed: false },
        };

        it("reads a branch/client-scoped edit and returns its diff", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 42 });
            const findCaregiverEditForChanges = jest.fn().mockResolvedValue(edit);
            const result = await createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges("branch-1", 42, editId);
            expect(findCaregiverEditForChanges).toHaveBeenCalledWith("branch-1", 42, editId);
            expect(result).toEqual({
                editId,
                editedAt: "2026-10-28T01:02:03.000Z",
                employeeName: "김제공",
                session: {
                    sessionIndex: 3,
                    kind: "changed",
                    serviceDateBefore: "2026-10-20",
                    serviceDateAfter: "2026-10-20",
                    changes: [
                        { path: "session.answers.a", before: ["yes"], after: ["no"] },
                        { path: "session.notes", before: "old", after: "new" },
                    ],
                },
            });
        });

        it.each(["not-a-uuid", "", "x".repeat(256)])("returns 404 for malformed edit ID %s without querying", async (id) => {
            const prisma = createPrisma();
            const findCaregiverEditForChanges = jest.fn();
            await expect(createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges("branch-1", 42, id)).rejects.toBeInstanceOf(NotFoundException);
            expect(findCaregiverEditForChanges).not.toHaveBeenCalled();
        });

        it("returns 404 for a client outside the branch before reading the edit", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue(null);
            const findCaregiverEditForChanges = jest.fn();
            await expect(createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges("branch-1", 99, editId)).rejects.toBeInstanceOf(NotFoundException);
            expect(findCaregiverEditForChanges).not.toHaveBeenCalled();
        });

        it("returns the same 404 when the scoped repository finds no edit (other branch or other client)", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 42 });
            const findCaregiverEditForChanges = jest.fn().mockResolvedValue(null);
            await expect(createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges("branch-1", 42, editId)).rejects.toBeInstanceOf(NotFoundException);
            expect(findCaregiverEditForChanges).toHaveBeenCalledWith("branch-1", 42, editId);
        });
    });

    describe("caregiver edits in history", () => {
        const base = { caseId: "case-1", caseVersion: 8, currentRevisionId: null, currentUsableRevisionId: null, revisions: [] };
        async function history(caregiverEdits?: unknown) {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 42 });
            const listRevisionHistory = jest.fn().mockResolvedValue(caregiverEdits === undefined ? base : { ...base, caregiverEdits });
            return createService(prisma, { listRevisionHistory }).getRevisionHistory("branch-1", 42);
        }

        it("passes caregiverEdits through in the repository's order and drops any before/after payload", async () => {
            const result = await history([
                { id: "e2", editedAt: "2026-10-28T02:00:00.000Z", sessionIndex: 2, employeeName: "B", before: { notes: "secret" }, after: { notes: "secret" } },
                { id: "e1", editedAt: new Date("2026-10-28T01:00:00Z"), sessionIndex: 1, employeeName: "A" },
            ]);
            expect(result.caregiverEdits).toEqual([
                { id: "e2", editedAt: "2026-10-28T02:00:00.000Z", sessionIndex: 2, employeeName: "B" },
                { id: "e1", editedAt: "2026-10-28T01:00:00.000Z", sessionIndex: 1, employeeName: "A" },
            ]);
            expect(JSON.stringify(result)).not.toContain("secret");
        });

        it("normalizes a missing caregiverEdits field to an empty list", async () => {
            expect((await history()).caregiverEdits).toEqual([]);
        });

        it.each([
            ["a non-array value", "nope"],
            ["a row without an id", [{ editedAt: "2026-10-28T01:00:00.000Z", sessionIndex: 1, employeeName: "A" }]],
            ["a row with a non-positive session index", [{ id: "e1", editedAt: "2026-10-28T01:00:00.000Z", sessionIndex: 0, employeeName: "A" }]],
            ["a row with an invalid date", [{ id: "e1", editedAt: "nope", sessionIndex: 1, employeeName: "A" }]],
        ])("rejects %s", async (_label, value) => {
            await expect(history(value)).rejects.toThrow();
        });
    });

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
