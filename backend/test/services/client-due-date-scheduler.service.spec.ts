import { ClientDueDateSchedulerService } from "application/services/client-due-date-scheduler.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ClientDueDateSchedulerService", () => {
    const createMockPrismaService = () => ({
        client: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    });
    const createMockTriggerService = () => ({
        syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
    });

    let service: ClientDueDateSchedulerService;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let triggerService: ReturnType<typeof createMockTriggerService>;

    beforeEach(() => {
        prismaService = createMockPrismaService();
        triggerService = createMockTriggerService();
        service = new ClientDueDateSchedulerService(
            prismaService as unknown as PrismaService,
            triggerService as unknown as MessageTriggerService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("copies dueDate into startDate for clients within the catch-up window and without a startDate", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111", dueDate: new Date("2026-06-19T00:00:00.000Z") },
            { id: 8, branchId: "22222222-2222-2222-2222-222222222222", dueDate: new Date("2026-06-19T00:00:00.000Z") },
        ]);

        const count = await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(count).toBe(2);
        expect(prismaService.client.findMany).toHaveBeenCalledWith({
            where: {
                dueDate: {
                    gte: new Date("2026-06-12T00:00:00.000Z"),
                    lte: new Date("2026-06-19T00:00:00.000Z"),
                },
                startDate: null,
            },
            select: { id: true, branchId: true, dueDate: true },
        });
        expect(prismaService.client.updateMany).toHaveBeenCalledTimes(2);
        expect(prismaService.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 7,
                dueDate: new Date("2026-06-19T00:00:00.000Z"),
                startDate: null,
            },
            data: { startDate: new Date("2026-06-19T00:00:00.000Z") },
        });
    });

    it("uses the current calendar date in Korea when calculating the catch-up window", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111", dueDate: new Date("2026-06-20T00:00:00.000Z") },
        ]);

        await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T15:30:00.000Z"),
        );

        expect(prismaService.client.findMany).toHaveBeenCalledWith({
            where: {
                dueDate: {
                    gte: new Date("2026-06-13T00:00:00.000Z"),
                    lte: new Date("2026-06-20T00:00:00.000Z"),
                },
                startDate: null,
            },
            select: { id: true, branchId: true, dueDate: true },
        });
        expect(prismaService.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 7,
                dueDate: new Date("2026-06-20T00:00:00.000Z"),
                startDate: null,
            },
            data: { startDate: new Date("2026-06-20T00:00:00.000Z") },
        });
    });

    it("copies a dueDate that was missed on a previous day (catch-up)", async () => {
        // dueDate = kstToday + 3 days, startDate null: previously never matched because
        // it wasn't exactly kstToday + 7, but the catch-up window now covers it.
        prismaService.client.findMany.mockResolvedValue([
            { id: 9, branchId: "33333333-3333-3333-3333-333333333333", dueDate: new Date("2026-06-15T00:00:00.000Z") },
        ]);

        const count = await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(count).toBe(1);
        expect(prismaService.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 9,
                dueDate: new Date("2026-06-15T00:00:00.000Z"),
                startDate: null,
            },
            data: { startDate: new Date("2026-06-15T00:00:00.000Z") },
        });
        expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
            "33333333-3333-3333-3333-333333333333",
            9,
            false,
        );
    });

    it("does not touch clients whose dueDate is before today", async () => {
        // findMany's `gte: kstToday` filter is expected to exclude these rows at the
        // database layer; assert the query excludes them and no client is processed
        // when the mock (correctly) returns none for an out-of-range dueDate.
        prismaService.client.findMany.mockResolvedValue([]);

        const count = await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(count).toBe(0);
        expect(prismaService.client.findMany).toHaveBeenCalledWith({
            where: {
                dueDate: {
                    gte: new Date("2026-06-12T00:00:00.000Z"),
                    lte: new Date("2026-06-19T00:00:00.000Z"),
                },
                startDate: null,
            },
            select: { id: true, branchId: true, dueDate: true },
        });
        expect(prismaService.client.updateMany).not.toHaveBeenCalled();
        expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
    });

    it("does not touch clients that already have a startDate", async () => {
        // findMany's `startDate: null` filter excludes these rows at the database
        // layer; assert the query still requires startDate: null.
        prismaService.client.findMany.mockResolvedValue([]);

        const count = await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(count).toBe(0);
        expect(prismaService.client.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ startDate: null }),
            }),
        );
        expect(prismaService.client.updateMany).not.toHaveBeenCalled();
    });

    it("syncs client trigger rules after a startDate is copied", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111", dueDate: new Date("2026-06-19T00:00:00.000Z") },
        ]);

        await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
            "11111111-1111-1111-1111-111111111111",
            7,
            false,
        );
    });

    it("does not sync trigger rules when the startDate was not updated", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111", dueDate: new Date("2026-06-19T00:00:00.000Z") },
        ]);
        prismaService.client.updateMany.mockResolvedValue({ count: 0 });

        await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
    });

    it("does not require the trigger service for the date copy", async () => {
        const serviceWithoutTriggers = new ClientDueDateSchedulerService(
            prismaService as unknown as PrismaService,
        );
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111", dueDate: new Date("2026-06-19T00:00:00.000Z") },
        ]);

        await expect(
            serviceWithoutTriggers.copyUpcomingDueDatesToStartDates(
                new Date("2026-06-12T00:00:00.000Z"),
            ),
        ).resolves.toBe(1);

        expect(prismaService.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 7,
                dueDate: new Date("2026-06-19T00:00:00.000Z"),
                startDate: null,
            },
            data: { startDate: new Date("2026-06-19T00:00:00.000Z") },
        });
    });
});
