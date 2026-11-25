import { ConflictException, NotFoundException } from "@nestjs/common";

import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const branchId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";

function createPrisma() {
    const tx = { $queryRaw: jest.fn() };
    return {
        client: { findFirst: jest.fn() },
        client_baby: { findMany: jest.fn().mockResolvedValue([]) },
        service_record_case: { findMany: jest.fn().mockResolvedValue([{ id: caseId, babyId: null }]) },
        tx,
        $transaction: jest.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
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
        const result = await createService(prisma, { findRevisionForChanges }).getRevisionChanges(branchId, 42, revisionId);
        expect(findRevisionForChanges).toHaveBeenCalledWith(branchId, 42, revisionId, caseId);
        expect(result.basicInfo).toEqual([{ path: "header.momName", before: "A", after: "B" }]);
    });

    it.each(["not-a-uuid", "", "x".repeat(256)])("returns 404 for malformed revision ID %s without querying", async (id) => {
        const prisma = createPrisma();
        const findRevisionForChanges = jest.fn();
        await expect(createService(prisma, { findRevisionForChanges }).getRevisionChanges(branchId, 42, id)).rejects.toBeInstanceOf(NotFoundException);
        expect(findRevisionForChanges).not.toHaveBeenCalled();
    });

    it("returns 404 for a foreign client before reading changes", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue(null);
        const findRevisionForChanges = jest.fn();
        await expect(createService(prisma, { findRevisionForChanges }).getRevisionChanges(branchId, 99, revisionId)).rejects.toBeInstanceOf(NotFoundException);
        expect(findRevisionForChanges).not.toHaveBeenCalled();
    });

    it("returns the same 404 when a branch/client-scoped revision is absent", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const findRevisionForChanges = jest.fn().mockResolvedValue(null);
        await expect(createService(prisma, { findRevisionForChanges }).getRevisionChanges(branchId, 42, revisionId)).rejects.toBeInstanceOf(NotFoundException);
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
            const result = await createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges(branchId, 42, editId);
            expect(findCaregiverEditForChanges).toHaveBeenCalledWith(branchId, 42, editId, caseId);
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
            await expect(createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges(branchId, 42, id)).rejects.toBeInstanceOf(NotFoundException);
            expect(findCaregiverEditForChanges).not.toHaveBeenCalled();
        });

        it("returns 404 for a client outside the branch before reading the edit", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue(null);
            const findCaregiverEditForChanges = jest.fn();
            await expect(createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges(branchId, 99, editId)).rejects.toBeInstanceOf(NotFoundException);
            expect(findCaregiverEditForChanges).not.toHaveBeenCalled();
        });

        it("returns the same 404 when the scoped repository finds no edit (other branch or other client)", async () => {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 42 });
            const findCaregiverEditForChanges = jest.fn().mockResolvedValue(null);
            await expect(createService(prisma, { findCaregiverEditForChanges }).getCaregiverEditChanges(branchId, 42, editId)).rejects.toBeInstanceOf(NotFoundException);
            expect(findCaregiverEditForChanges).toHaveBeenCalledWith(branchId, 42, editId, caseId);
        });
    });

    describe("caregiver edits in history", () => {
        const base = { caseId: "case-1", caseVersion: 8, currentRevisionId: null, currentUsableRevisionId: null, revisions: [] };
        async function history(caregiverEdits?: unknown) {
            const prisma = createPrisma();
            prisma.client.findFirst.mockResolvedValue({ id: 42 });
            const listRevisionHistory = jest.fn().mockResolvedValue(caregiverEdits === undefined ? base : { ...base, caregiverEdits });
            return createService(prisma, { listRevisionHistory }).getRevisionHistory(branchId, 42);
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
        const noProviderDocumentConfirmable = { stateId: "state-2", revisionId: "revision-2",
            generation: "generation-2", suffix: "[SR-12345678-r2-v3]", unlinkedChunkOrdinals: ["(1/2)"] };
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
                    status: "manual_review",
                    documentVersion: 3,
                    canRetry: false,
                    reasonCode: "JOB_CANCELLED_AFTER_DISPATCH",
                    noProviderDocumentConfirmable,
                }],
            }],
        });

        const result = await createService(prisma, { listRevisionHistory }).getRevisionHistory(branchId, 42);

        expect(result).toEqual(expect.objectContaining({
            caseId: "case-1",
            caseVersion: 8,
            currentRevisionId: "revision-2",
        }));
        expect(result.revisions[0]?.documents[0]?.noProviderDocumentConfirmable).toEqual(noProviderDocumentConfirmable);
        expect(listRevisionHistory).toHaveBeenCalledWith(branchId, 42, caseId);
    });

    it("preserves the computed regeneration blocker in a partial-dispatch history response", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const document = {
            id: "state-2", operation: "record_snapshot", generation: "generation-2", status: "failed",
            documentVersion: 3, canRetry: false, reasonCode: "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH",
            regenerationBlockedReason: "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED",
        };
        const listRevisionHistory = jest.fn().mockResolvedValue({
            caseId: "case-1", caseVersion: 8, currentRevisionId: "revision-2", currentUsableRevisionId: null,
            revisions: [{
                id: "revision-2", revisionNumber: 2, confirmedAt: "2026-09-08T01:02:03.000Z", isCurrent: true,
                documents: [document],
            }],
        });
        const result = await createService(prisma, { listRevisionHistory }).getRevisionHistory(branchId, 42);
        expect(result.revisions[0]?.documents).toEqual([document]);
    });

    it("rejects a foreign client before consulting revision state", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue(null);
        const listRevisionHistory = jest.fn();

        await expect(
            createService(prisma, { listRevisionHistory }).getRevisionHistory(branchId, 99),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(listRevisionHistory).not.toHaveBeenCalled();
    });

    it("fails closed when the core history seam has no case", async () => {
        const prisma = createPrisma();
        prisma.client.findFirst.mockResolvedValue({ id: 42 });
        const listRevisionHistory = jest.fn().mockResolvedValue(null);

        await expect(
            createService(prisma, { listRevisionHistory }).getRevisionHistory(branchId, 42),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(listRevisionHistory).toHaveBeenCalledWith(branchId, 42, caseId);
    });

    it("resolves client scope through the core branch lookup before retry CAS", async () => {
        const prisma = createPrisma();
        const findRevisionDocumentStateForBranch = jest.fn().mockResolvedValue({
            id: "state-1",
            clientId: 42,
            serviceRecordCaseId: "case-1",
            generation: "generation-1",
        });
        prisma.tx.$queryRaw.mockResolvedValueOnce([{ id: "case-1" }])
            .mockResolvedValueOnce([{ status: "failed", version: 3 }]);
        const retryRevisionDocumentStateInTransaction = jest.fn().mockResolvedValue({
            id: "state-1",
            operation: "record_snapshot",
            generation: "generation-1",
            status: "pending",
            documentVersion: 3,
            lastErrorCode: null,
        });

        const result = await createService(prisma, {
            findRevisionDocumentStateForBranch,
            retryRevisionDocumentStateInTransaction,
        }).retryRevisionDocument(
            branchId,
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
            branchId,
            "revision-1",
            "state-1",
        );
        expect(retryRevisionDocumentStateInTransaction).toHaveBeenCalledWith({ tx: prisma.tx }, {
            branchId,
            clientId: 42,
            revisionId: "revision-1",
            stateId: "state-1",
            expectedGeneration: "generation-1",
        });
    });

    it.each(["completed", "processing", "failed", "manual_review"])("refuses an unchanged %s row with REQUEST_CONFLICT", async (status) => {
        const prisma = createPrisma();
        const state = { id: "state-1", clientId: 42, generation: "generation-1", status, version: 3 };
        prisma.tx.$queryRaw.mockResolvedValueOnce([{ id: "case-1" }]).mockResolvedValueOnce([state]);
        const retryRevisionDocumentStateInTransaction = jest.fn().mockResolvedValue({ ...state });
        await expect(createService(prisma, {
            findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue(state),
            retryRevisionDocumentStateInTransaction,
        }).retryRevisionDocument(branchId, "revision-1", "state-1", "generation-1", "admin-1"))
            .rejects.toMatchObject({ status: 409, response: { code: "REQUEST_CONFLICT" } });
    });

    it.each(["completed", "processing", "failed", "manual_review"])(
        "returns 409 when a concurrent version bump leaves a %s retry unexecuted",
        async (status) => {
            const prisma = createPrisma();
            const state = {
                id: "state-1", clientId: 42, serviceRecordCaseId: "case-1", generation: "generation-1",
                operation: "record_snapshot", status, version: 3,
            };
            const concurrentState = { ...state, version: 4 };
            prisma.tx.$queryRaw.mockResolvedValueOnce([{ id: state.serviceRecordCaseId }])
                .mockResolvedValueOnce([concurrentState]);
            const noOpRetry = jest.fn().mockResolvedValue(concurrentState);

            await expect(createService(prisma, {
                findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue(state),
                retryRevisionDocumentStateInTransaction: noOpRetry,
            }).retryRevisionDocument(branchId, "revision-1", "state-1", "generation-1", "admin-1"))
                .rejects.toMatchObject({ status: 409, response: { code: "REQUEST_CONFLICT" } });
            expect(noOpRetry).toHaveBeenCalledWith({ tx: prisma.tx }, expect.objectContaining({
                branchId, clientId: 42, revisionId: "revision-1", stateId: "state-1",
                expectedGeneration: "generation-1",
            }));
            const [caseQuery, stateQuery] = prisma.tx.$queryRaw.mock.calls.map(([query]) => query);
            expect(caseQuery.sql).toContain('FROM "service_record_case"');
            expect(stateQuery.sql).toContain('FROM "service_record_revision_document_state"');
            expect(caseQuery.sql).toContain("FOR UPDATE");
            expect(stateQuery.sql).toContain("FOR UPDATE");
            expect(caseQuery.values).toEqual(["case-1", branchId, 42]);
            expect(stateQuery.values).toEqual(["state-1", branchId, 42, "case-1", "revision-1", "generation-1"]);
        },
    );

    it("accepts a retry whose version advanced while the status stayed the same", async () => {
        const prisma = createPrisma();
        const state = {
            id: "state-1", clientId: 42, generation: "generation-1", status: "pending", version: 3,
            operation: "record_snapshot", documentVersion: 3,
        };
        prisma.tx.$queryRaw.mockResolvedValueOnce([{ id: "case-1" }]).mockResolvedValueOnce([state]);
        await expect(createService(prisma, {
            findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue(state),
            retryRevisionDocumentStateInTransaction: jest.fn().mockResolvedValue({ ...state, version: 4 }),
        }).retryRevisionDocument(branchId, "revision-1", "state-1", "generation-1", "admin-1"))
            .resolves.toMatchObject({ id: "state-1", status: "pending" });
    });

    it("accepts an executed retry after a concurrent version bump", async () => {
        const prisma = createPrisma();
        const state = {
            id: "state-1", clientId: 42, serviceRecordCaseId: "case-1", generation: "generation-1",
            status: "failed", version: 3, operation: "record_snapshot", documentVersion: 3,
        };
        prisma.tx.$queryRaw.mockResolvedValueOnce([{ id: "case-1" }])
            .mockResolvedValueOnce([{ ...state, version: 4 }]);
        await expect(createService(prisma, {
            findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue(state),
            retryRevisionDocumentStateInTransaction: jest.fn().mockResolvedValue({ ...state, status: "pending", version: 5 }),
        }).retryRevisionDocument(branchId, "revision-1", "state-1", "generation-1", "admin-1"))
            .resolves.toMatchObject({ id: "state-1", status: "pending" });
    });

    it.each(["case", "state"])("returns 409 when the %s disappears before the transaction locks it", async (missing) => {
        const prisma = createPrisma();
        prisma.tx.$queryRaw.mockResolvedValueOnce(missing === "case" ? [] : [{ id: "case-1" }])
            .mockResolvedValueOnce([]);
        const retryRevisionDocumentStateInTransaction = jest.fn();
        await expect(createService(prisma, {
            findRevisionDocumentStateForBranch: jest.fn().mockResolvedValue({
                clientId: 42, serviceRecordCaseId: "case-1", generation: "generation-1",
            }),
            retryRevisionDocumentStateInTransaction,
        }).retryRevisionDocument(branchId, "revision-1", "state-1", "generation-1", "admin-1"))
            .rejects.toMatchObject({ status: 409, response: { code: "REQUEST_CONFLICT" } });
        expect(retryRevisionDocumentStateInTransaction).not.toHaveBeenCalled();
    });

    it("returns not found when the branch-scoped document state is absent", async () => {
        const prisma = createPrisma();
        const findRevisionDocumentStateForBranch = jest.fn().mockResolvedValue(null);
        const retryRevisionDocumentStateInTransaction = jest.fn();

        await expect(
            createService(prisma, {
                findRevisionDocumentStateForBranch,
                retryRevisionDocumentStateInTransaction,
            }).retryRevisionDocument(
                branchId,
                "revision-1",
                "state-1",
                "generation-1",
                "admin-1",
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(retryRevisionDocumentStateInTransaction).not.toHaveBeenCalled();
    });

    it("returns a conflict for a stale generation before retry CAS", async () => {
        const prisma = createPrisma();
        const findRevisionDocumentStateForBranch = jest.fn().mockResolvedValue({
            id: "state-1",
            clientId: 42,
            generation: "generation-current",
        });
        const retryRevisionDocumentStateInTransaction = jest.fn();

        await expect(
            createService(prisma, {
                findRevisionDocumentStateForBranch,
                retryRevisionDocumentStateInTransaction,
            }).retryRevisionDocument(
                branchId,
                "revision-1",
                "state-1",
                "generation-stale",
                "admin-1",
            ),
        ).rejects.toEqual(expect.any(ConflictException));
        expect(retryRevisionDocumentStateInTransaction).not.toHaveBeenCalled();
    });
});
