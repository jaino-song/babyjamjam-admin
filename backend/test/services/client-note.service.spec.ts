import type { Prisma } from "@prisma/client";
import {
    CLIENT_NOTE_KIND,
    CLIENT_NOTE_RESOLVED_REASON,
    CLIENT_NOTE_STATUS,
    ClientNoteService,
    mergeContractInfoChanges,
    normalizeContractInfoValue,
    type ContractInfoChange,
    type ContractInfoSnapshot,
} from "application/services/client-note.service";
import type { LatestContractSignal } from "application/utils/current-contract-document";

const contract = (overrides: Partial<LatestContractSignal> = {}): LatestContractSignal => ({
    statusType: "003",
    permanentPurgeRequestedAt: null,
    voidedAt: null,
    documentId: "doc-1",
    stepType: null,
    stepName: null,
    detailPayload: null,
    ...overrides,
});

const createTransaction = () => ({
    client_note: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
    },
});

type FakeTransaction = ReturnType<typeof createTransaction>;

const asTransaction = (transaction: FakeTransaction | Record<string, unknown>) =>
    transaction as unknown as Prisma.TransactionClient;

describe("normalizeContractInfoValue", () => {
    it("compares dates by calendar day, whatever the input shape", () => {
        expect(normalizeContractInfoValue("endDate", new Date("2026-11-18T00:00:00.000Z"))).toBe("2026-11-18");
        expect(normalizeContractInfoValue("endDate", "2026-11-18T09:30:00.000Z")).toBe("2026-11-18");
        expect(normalizeContractInfoValue("startDate", "2026-11-18")).toBe("2026-11-18");
    });

    it("compares prices by their digits, so formatting is not a change", () => {
        expect(normalizeContractInfoValue("fullPrice", "1,234,000원")).toBe("1234000");
        expect(normalizeContractInfoValue("grant", 50000)).toBe("50000");
    });

    it("reads empty values as no value", () => {
        expect(normalizeContractInfoValue("address", "   ")).toBeNull();
        expect(normalizeContractInfoValue("address", null)).toBeNull();
        expect(normalizeContractInfoValue("address", undefined)).toBeNull();
        expect(normalizeContractInfoValue("fullPrice", "원")).toBeNull();
        expect(normalizeContractInfoValue("endDate", new Date("invalid"))).toBeNull();
    });

    it("trims text fields", () => {
        expect(normalizeContractInfoValue("name", "  QA-고객 ")).toBe("QA-고객");
    });
});

describe("mergeContractInfoChanges", () => {
    const before: ContractInfoSnapshot = {
        name: "QA-고객",
        address: "서울시 1",
        endDate: new Date("2026-11-17T00:00:00.000Z"),
        fullPrice: "1000000",
    };

    it("lists only the contract fields that changed, in field order", () => {
        const changes = mergeContractInfoChanges([], before, {
            ...before,
            endDate: new Date("2026-11-18T00:00:00.000Z"),
            address: "서울시 2",
        });

        expect(changes).toEqual([
            { field: "address", contractValue: "서울시 1", clientValue: "서울시 2" },
            { field: "endDate", contractValue: "2026-11-17", clientValue: "2026-11-18" },
        ]);
    });

    it("ignores fields the contract does not hold and formatting-only edits", () => {
        const changes = mergeContractInfoChanges([], before, {
            ...before,
            fullPrice: "1,000,000",
            dueDate: "2026-12-01",
        } as ContractInfoSnapshot);

        expect(changes).toEqual([]);
    });

    it("keeps the contract value of the first change when the field changes again", () => {
        const existing: ContractInfoChange[] = [
            { field: "address", contractValue: "서울시 1", clientValue: "서울시 2" },
        ];

        const changes = mergeContractInfoChanges(
            existing,
            { ...before, address: "서울시 2" },
            { ...before, address: "서울시 3" },
        );

        expect(changes).toEqual([
            { field: "address", contractValue: "서울시 1", clientValue: "서울시 3" },
        ]);
    });

    it("drops a field that is set back to its contract value and keeps the others", () => {
        const existing: ContractInfoChange[] = [
            { field: "address", contractValue: "서울시 1", clientValue: "서울시 2" },
            { field: "name", contractValue: "QA-고객", clientValue: "QA-고객2" },
        ];

        const changes = mergeContractInfoChanges(
            existing,
            { ...before, address: "서울시 2", name: "QA-고객2" },
            { ...before, address: "서울시 1", name: "QA-고객2" },
        );

        expect(changes).toEqual([
            { field: "name", contractValue: "QA-고객", clientValue: "QA-고객2" },
        ]);
    });

    it("does not change the stored changes it was given", () => {
        const existing: ContractInfoChange[] = [
            { field: "address", contractValue: "서울시 1", clientValue: "서울시 2" },
        ];

        mergeContractInfoChanges(existing, { address: "서울시 2" }, { address: "서울시 3" });

        expect(existing[0]?.clientValue).toBe("서울시 2");
    });
});

describe("ClientNoteService", () => {
    const service = new ClientNoteService();
    const params = (overrides: Partial<Parameters<ClientNoteService["recordContractInfoChangeInTransaction"]>[1]> = {}) => ({
        branchId: "branch-1",
        clientId: 7,
        latestContract: contract(),
        before: { address: "서울시 1", endDate: "2026-11-17" } as ContractInfoSnapshot,
        after: { address: "서울시 2", endDate: "2026-11-17" } as ContractInfoSnapshot,
        actorUserId: "user-1",
        ...overrides,
    });

    describe("recordContractInfoChangeInTransaction", () => {
        it("opens a note on the completed contract for the first change", async () => {
            const transaction = createTransaction();

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params());

            expect(transaction.client_note.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: {
                    clientId: 7,
                    kind: CLIENT_NOTE_KIND.CONTRACT_INFO_MISMATCH,
                    status: CLIENT_NOTE_STATUS.OPEN,
                },
            }));
            expect(transaction.client_note.create).toHaveBeenCalledWith({
                data: {
                    branchId: "branch-1",
                    clientId: 7,
                    kind: CLIENT_NOTE_KIND.CONTRACT_INFO_MISMATCH,
                    status: CLIENT_NOTE_STATUS.OPEN,
                    contractDocumentId: "doc-1",
                    changes: [{ field: "address", contractValue: "서울시 1", clientValue: "서울시 2" }],
                    createdBy: "user-1",
                },
            });
            expect(transaction.client_note.update).not.toHaveBeenCalled();
        });

        it("folds a later change into the open note of the same contract", async () => {
            const transaction = createTransaction();
            transaction.client_note.findFirst.mockResolvedValue({
                id: "note-1",
                contractDocumentId: "doc-1",
                changes: [{ field: "address", contractValue: "서울시 1", clientValue: "서울시 2" }],
            });

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params({
                before: { address: "서울시 2", endDate: "2026-11-17" },
                after: { address: "서울시 2", endDate: "2026-11-18" },
            }));

            expect(transaction.client_note.update).toHaveBeenCalledWith({
                where: { id: "note-1" },
                data: {
                    changes: [
                        { field: "address", contractValue: "서울시 1", clientValue: "서울시 2" },
                        { field: "endDate", contractValue: "2026-11-17", clientValue: "2026-11-18" },
                    ],
                },
            });
            expect(transaction.client_note.create).not.toHaveBeenCalled();
        });

        it("resolves the note when every changed field is set back", async () => {
            const transaction = createTransaction();
            transaction.client_note.findFirst.mockResolvedValue({
                id: "note-1",
                contractDocumentId: "doc-1",
                changes: [{ field: "address", contractValue: "서울시 1", clientValue: "서울시 2" }],
            });

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params({
                before: { address: "서울시 2" },
                after: { address: "서울시 1" },
            }));

            expect(transaction.client_note.update).toHaveBeenCalledTimes(1);
            expect(transaction.client_note.update).toHaveBeenCalledWith({
                where: { id: "note-1" },
                data: {
                    status: CLIENT_NOTE_STATUS.RESOLVED,
                    resolvedAt: expect.any(Date),
                    resolvedBy: "user-1",
                    resolvedReason: CLIENT_NOTE_RESOLVED_REASON.VALUES_RESTORED,
                },
            });
            expect(transaction.client_note.create).not.toHaveBeenCalled();
        });

        it("closes a note about an older contract and opens one for the current contract", async () => {
            const transaction = createTransaction();
            transaction.client_note.findFirst.mockResolvedValue({
                id: "note-old",
                contractDocumentId: "doc-old",
                changes: [{ field: "name", contractValue: "QA-고객", clientValue: "QA-고객2" }],
            });

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params());

            expect(transaction.client_note.update).toHaveBeenCalledWith({
                where: { id: "note-old" },
                data: expect.objectContaining({
                    status: CLIENT_NOTE_STATUS.RESOLVED,
                    resolvedReason: CLIENT_NOTE_RESOLVED_REASON.CONTRACT_REPLACED,
                }),
            });
            // The old note's changes are about another contract and do not carry over.
            expect(transaction.client_note.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    contractDocumentId: "doc-1",
                    changes: [{ field: "address", contractValue: "서울시 1", clientValue: "서울시 2" }],
                }),
            });
        });

        it("ignores stored changes it cannot read", async () => {
            const transaction = createTransaction();
            transaction.client_note.findFirst.mockResolvedValue({
                id: "note-1",
                contractDocumentId: "doc-1",
                changes: [null, "x", { field: "dueDate", contractValue: "a", clientValue: "b" }, { field: "name", contractValue: 1 }],
            });

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params());

            expect(transaction.client_note.update).toHaveBeenCalledWith({
                where: { id: "note-1" },
                data: {
                    // The unreadable "name" entry reads as no change and leaves the list.
                    changes: [{ field: "address", contractValue: "서울시 1", clientValue: "서울시 2" }],
                },
            });
        });

        it.each([
            ["the contract is not completed yet", contract({ statusType: "060" })],
            ["the contract was voided", contract({ voidedAt: new Date("2026-11-01T00:00:00.000Z") })],
            ["the contract is being purged", contract({ permanentPurgeRequestedAt: new Date("2026-11-01T00:00:00.000Z") })],
            ["there is no contract", undefined],
        ])("writes nothing when %s", async (_case, latestContract) => {
            const transaction = createTransaction();

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params({ latestContract }));

            expect(transaction.client_note.findFirst).not.toHaveBeenCalled();
            expect(transaction.client_note.create).not.toHaveBeenCalled();
            expect(transaction.client_note.update).not.toHaveBeenCalled();
        });

        it("writes nothing when no contract field changed", async () => {
            const transaction = createTransaction();

            await service.recordContractInfoChangeInTransaction(asTransaction(transaction), params({
                before: { address: "서울시 1" },
                after: { address: "서울시 1" },
            }));

            expect(transaction.client_note.findFirst).not.toHaveBeenCalled();
            expect(transaction.client_note.create).not.toHaveBeenCalled();
        });

        it("does nothing on a transaction without the client_note table", async () => {
            await expect(service.recordContractInfoChangeInTransaction(asTransaction({}), params()))
                .resolves.toBeUndefined();
        });
    });

    describe("findContractInfoMismatchClientIds", () => {
        it("flags only clients whose open note is about their current completed contract", async () => {
            const prisma = createTransaction();
            prisma.client_note.findMany.mockResolvedValue([
                { clientId: 1, contractDocumentId: "doc-1" },
                { clientId: 2, contractDocumentId: "doc-old" },
                { clientId: 3, contractDocumentId: "doc-3" },
                { clientId: 4, contractDocumentId: "doc-4" },
            ]);
            const latest = new Map<number, LatestContractSignal>([
                [1, contract({ documentId: "doc-1" })],
                [2, contract({ documentId: "doc-2" })],
                [3, contract({ documentId: "doc-3", statusType: "060" })],
            ]);

            const flagged = await service.findContractInfoMismatchClientIds(prisma, latest);

            expect([...flagged]).toEqual([1]);
            expect(prisma.client_note.findMany).toHaveBeenCalledWith({
                where: {
                    clientId: { in: [1, 2, 3] },
                    kind: CLIENT_NOTE_KIND.CONTRACT_INFO_MISMATCH,
                    status: CLIENT_NOTE_STATUS.OPEN,
                },
                select: { clientId: true, contractDocumentId: true },
            });
        });

        it("reads nothing when no client has a contract", async () => {
            const prisma = createTransaction();

            const flagged = await service.findContractInfoMismatchClientIds(prisma, new Map());

            expect(flagged.size).toBe(0);
            expect(prisma.client_note.findMany).not.toHaveBeenCalled();
        });

        it("flags nobody on a client without the client_note table", async () => {
            const flagged = await service.findContractInfoMismatchClientIds({}, new Map([[1, contract()]]));

            expect(flagged.size).toBe(0);
        });
    });
});
