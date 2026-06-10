import { ConflictException, NotFoundException, NotImplementedException } from "@nestjs/common";
import { CallInboxService } from "application/services/call-inbox.service";

describe("CallInboxService", () => {
    const prisma = {
        call_record: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        client_draft: {
            findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(),
            update: jest.fn(), updateMany: jest.fn(),
        },
        client: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    const clientService = { create: jest.fn() };
    let service: CallInboxService;

    const pendingDraft = {
        id: "draft-1", branchId: "branch-1", type: "NEW_CLIENT", status: "PENDING",
        clientId: null, callRecordId: "rec-1",
        proposals: [{ field: "name", value: "김서연", evidence: "e", confidence: "high" }],
        requestSummary: "신규 문의",
        callRecord: { id: "rec-1", callerPhone: "01048217763", callerName: "김서연" },
    };

    beforeEach(() => {
        jest.resetAllMocks();
        prisma.client.findMany.mockResolvedValue([]);
        prisma.client_draft.update.mockResolvedValue({});
        prisma.call_record.update.mockResolvedValue({});
        service = new CallInboxService(prisma as never, clientService as never);
    });

    it("confirmNewClient: creates via ClientService, marks CONFIRMED, links call record", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockResolvedValue({ id: 77 });

        const result = await service.confirmNewClient("branch-1", "user-1", "draft-1", {
            fields: { name: "김서연", careCenter: false, voucherClient: true, breastPump: false },
            suppressGreetingSms: false,
        });

        expect(result).toEqual({ clientId: 77 });
        expect(clientService.create).toHaveBeenCalledWith("branch-1", expect.objectContaining({
            name: "김서연", careCenter: false, voucherClient: true, breastPump: false,
            suppressGreetingSms: false,
        }));
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "draft-1" },
            data: expect.objectContaining({ status: "CONFIRMED", clientId: 77, reviewedById: "user-1" }),
        }));
        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ matchedClientId: 77 }),
        }));
    });

    it("confirmNewClient: 409 when draft loses the PENDING->CONFIRMING race", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });

        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(ConflictException);
        expect(clientService.create).not.toHaveBeenCalled();
    });

    it("confirmNewClient: rolls the lock back to PENDING when client creation throws", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockRejectedValue(new Error("areaId invalid"));

        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow("areaId invalid");
        expect(prisma.client_draft.update).toHaveBeenCalledWith({
            where: { id: "draft-1" },
            data: { status: "PENDING" },
        });
    });

    it("confirmNewClient: never rolls back to PENDING once the client was created (bookkeeping failure)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockResolvedValue({ id: 77 });
        prisma.client_draft.update
            .mockRejectedValueOnce(new Error("db blip"))   // CONFIRMED write fails
            .mockResolvedValueOnce({});                     // re-assert succeeds

        const result = await service.confirmNewClient("branch-1", "user-1", "draft-1", {
            fields: { name: "김서연", careCenter: false, voucherClient: false, breastPump: false },
        });

        expect(result).toEqual({ clientId: 77 });
        const updateCalls = prisma.client_draft.update.mock.calls;
        expect(updateCalls.some(([args]: [{ data: { status?: string } }]) => args.data.status === "PENDING")).toBe(false);
        expect(updateCalls[updateCalls.length - 1]![0].data).toEqual(
            expect.objectContaining({ status: "CONFIRMED", clientId: 77 }),
        );
    });

    it("confirmNewClient: 404 for a draft in another branch", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(null);
        await expect(
            service.confirmNewClient("branch-2", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(NotFoundException);
    });

    it("confirmNewClient: 501 for CLIENT_UPDATE drafts (Phase 2)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue({ ...pendingDraft, type: "CLIENT_UPDATE" });
        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(NotImplementedException);
    });

    it("discard: PENDING → DISCARDED with reason; 409 when already reviewed", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });

        await service.discard("branch-1", "user-1", "draft-1", "오인식");
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "DISCARDED", discardReason: "오인식", reviewedById: "user-1" }),
        }));

        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.discard("branch-1", "user-1", "draft-1", undefined)).rejects.toThrow(ConflictException);
    });

    it("listDrafts: computes hasLowConfidence, possibleDuplicate and phoneMatchesExistingClient", async () => {
        const rowBase = {
            ...pendingDraft,
            client: null,
            createdAt: new Date("2026-06-10T05:10:00Z"),
            callRecord: { id: "rec-1", callerPhone: "01048217763", callerName: "김서연", recordedAt: null },
        };
        prisma.client_draft.findMany.mockResolvedValue([
            { ...rowBase, proposals: [{ field: "address", value: "부평구", evidence: "e", confidence: "low" }] },
            {
                ...rowBase, id: "draft-2", callRecordId: "rec-2",
                callRecord: { id: "rec-2", callerPhone: "01048217763", callerName: "김서연", recordedAt: null },
            },
        ]);
        prisma.client_draft.count.mockResolvedValue(2);
        prisma.client.findMany.mockResolvedValue([{ id: 9, phone: "010-4821-7763" }]);

        const result = await service.listDrafts("branch-1", "PENDING", 1, 20);

        expect(result.data[0]!.hasLowConfidence).toBe(true);
        expect(result.data[0]!.possibleDuplicate).toBe(true);
        expect(result.data[0]!.phoneMatchesExistingClient).toBe(true);
        expect(result.total).toBe(2);
        expect(result.totalPages).toBe(1);
    });
});
