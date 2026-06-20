import { ClientDueDateSchedulerService } from "application/services/client-due-date-scheduler.service";
import { AlimtalkTriggerService } from "application/services/alimtalk-trigger.service";
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
            triggerService as unknown as AlimtalkTriggerService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("copies dueDate into startDate seven days before the dueDate for clients without a startDate", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111" },
            { id: 8, branchId: "22222222-2222-2222-2222-222222222222" },
        ]);

        const count = await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T00:00:00.000Z"),
        );

        expect(count).toBe(2);
        expect(prismaService.client.findMany).toHaveBeenCalledWith({
            where: {
                dueDate: new Date("2026-06-19T00:00:00.000Z"),
                startDate: null,
            },
            select: { id: true, branchId: true },
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

    it("uses the current calendar date in Korea when calculating the seven-day lead date", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111" },
        ]);

        await service.copyUpcomingDueDatesToStartDates(
            new Date("2026-06-12T15:30:00.000Z"),
        );

        expect(prismaService.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 7,
                dueDate: new Date("2026-06-20T00:00:00.000Z"),
                startDate: null,
            },
            data: { startDate: new Date("2026-06-20T00:00:00.000Z") },
        });
    });

    it("syncs client trigger rules after a startDate is copied", async () => {
        prismaService.client.findMany.mockResolvedValue([
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111" },
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
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111" },
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
            { id: 7, branchId: "11111111-1111-1111-1111-111111111111" },
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
