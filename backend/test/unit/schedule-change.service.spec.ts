import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { EmployeeFeedbackTokenService } from "application/services/employee-feedback-token.service";
import { AlimtalkTriggerService } from "application/services/alimtalk-trigger.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const SCHEDULE_ID = 11;
const CLIENT_ID = 21;
const BRANCH_ID = "org-1";
const USER_ID = "user-1";

const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const createMockPrismaService = () => ({
    schedule_change_request: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    employee_schedule: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    service_record_day: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
    },
    client: {
        update: jest.fn(),
    },
    $transaction: jest.fn(),
});

const createMockTokenService = () => ({
    extendExpiryForSchedule: jest.fn(),
});

const createMockTriggerService = () => ({
    syncEmployeeAssignmentRulesForSchedule: jest.fn(() => Promise.resolve()),
});

const createSchedule = (overrides: Record<string, unknown> = {}) => ({
    id: SCHEDULE_ID,
    branchId: BRANCH_ID,
    clientId: CLIENT_ID,
    startDate: toDbDate("2026-07-01"),
    endDate: toDbDate("2026-07-14"),
    client: {
        id: CLIENT_ID,
        duration: 10,
    },
    ...overrides,
});

const createDay = (
    sessionIndex: number,
    iso: string,
    locked: boolean,
    overrides: Record<string, unknown> = {},
) => ({
    id: `day-${sessionIndex}`,
    branchId: BRANCH_ID,
    scheduleId: SCHEDULE_ID,
    sessionIndex,
    serviceDate: toDbDate(iso),
    locked,
    ...overrides,
});

const createRequest = (overrides: Record<string, unknown> = {}) => ({
    id: "request-1",
    branchId: BRANCH_ID,
    scheduleId: SCHEDULE_ID,
    clientId: CLIENT_ID,
    sessionIndex: 3,
    fromDate: toDbDate("2026-07-03"),
    toDate: toDbDate("2026-07-06"),
    oldEndDate: toDbDate("2026-07-14"),
    newEndDate: toDbDate("2026-07-15"),
    status: "pending",
    reason: null,
    decidedBy: null,
    requestedAt: toDbDate("2026-07-02"),
    decidedAt: null,
    ...overrides,
});

const expectConflictCode = async (
    action: () => Promise<unknown>,
    code: string,
): Promise<void> => {
    try {
        await action();
        throw new Error("Expected ConflictException");
    } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({ code });
    }
};

describe("ScheduleChangeService", () => {
    const ctx = {
        tokenId: "token-1",
        branchId: BRANCH_ID,
        scheduleId: SCHEDULE_ID,
        employeeId: 5,
    };
    const tenant = {
        branchId: BRANCH_ID,
        userId: USER_ID,
    };

    let service: ScheduleChangeService;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let txPrismaService: ReturnType<typeof createMockPrismaService>;
    let tokenService: ReturnType<typeof createMockTokenService>;
    let triggerService: ReturnType<typeof createMockTriggerService>;
    let events: string[];

    beforeEach(() => {
        prismaService = createMockPrismaService();
        txPrismaService = createMockPrismaService();
        tokenService = createMockTokenService();
        triggerService = createMockTriggerService();
        events = [];

        prismaService.$transaction.mockImplementation(async (fn) => {
            events.push("transaction:start");
            const result = await fn(txPrismaService);
            events.push("transaction:commit");
            return result;
        });
        triggerService.syncEmployeeAssignmentRulesForSchedule.mockImplementation(() => {
            events.push("sync");
            return Promise.resolve();
        });

        service = new ScheduleChangeService(
            prismaService as unknown as PrismaService,
            tokenService as unknown as EmployeeFeedbackTokenService,
            triggerService as unknown as AlimtalkTriggerService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("preview", () => {
        it("should postpone the first unlocked existing target row", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
                createDay(2, "2026-07-02", true),
                createDay(3, "2026-07-03", false),
            ]);

            await expect(service.preview(ctx)).resolves.toEqual({
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });
        });

        it("should derive fromDate from the previous row when the target row is missing", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
                createDay(2, "2026-07-02", true),
            ]);

            await expect(service.preview(ctx)).resolves.toEqual({
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });
        });

        it("should use the schedule start date when no service rows exist", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_day.findMany.mockResolvedValue([]);

            await expect(service.preview(ctx)).resolves.toEqual({
                sessionIndex: 1,
                fromDate: "2026-07-01",
                toDate: "2026-07-02",
            });
        });

        it("should reject when all sessions are locked", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_day.findMany.mockResolvedValue(
                Array.from({ length: 10 }, (_, index) =>
                    createDay(index + 1, `2026-07-${String(index + 1).padStart(2, "0")}`, true),
                ),
            );

            await expectConflictCode(() => service.preview(ctx), "ALL_SESSIONS_SUBMITTED");
        });

        it("should reject when the client duration is missing", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(
                createSchedule({ client: { id: CLIENT_ID, duration: null } }),
            );
            prismaService.service_record_day.findMany.mockResolvedValue([]);

            await expect(service.preview(ctx)).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe("createRequest", () => {
        it("should create a pending request with the computed target dates", async () => {
            const schedule = createSchedule();
            prismaService.employee_schedule.findUnique.mockResolvedValue(schedule);
            prismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
                createDay(2, "2026-07-02", true),
                createDay(3, "2026-07-03", false),
            ]);
            prismaService.schedule_change_request.create.mockResolvedValue(
                createRequest({ id: "request-created" }),
            );

            await expect(service.createRequest(ctx)).resolves.toEqual({
                id: "request-created",
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
            });
            expect(prismaService.schedule_change_request.create).toHaveBeenCalledWith({
                data: {
                    branchId: BRANCH_ID,
                    scheduleId: SCHEDULE_ID,
                    clientId: CLIENT_ID,
                    sessionIndex: 3,
                    fromDate: toDbDate("2026-07-03"),
                    toDate: toDbDate("2026-07-06"),
                    oldEndDate: schedule.endDate,
                    newEndDate: toDbDate("2026-07-15"),
                    status: "pending",
                },
            });
        });

        it("should reject when a pending request already exists", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());

            await expectConflictCode(() => service.createRequest(ctx), "REQUEST_ALREADY_PENDING");
            expect(prismaService.schedule_change_request.create).not.toHaveBeenCalled();
        });

        it("should map a unique constraint race to REQUEST_ALREADY_PENDING", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
                createDay(2, "2026-07-02", true),
                createDay(3, "2026-07-03", false),
            ]);
            prismaService.schedule_change_request.create.mockRejectedValue(
                new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                    code: "P2002",
                    clientVersion: "test",
                }),
            );

            await expectConflictCode(() => service.createRequest(ctx), "REQUEST_ALREADY_PENDING");
        });
    });

    describe("approve", () => {
        it("should apply the target date, cascade unlocked rows, extend expiry, and sync after commit", async () => {
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([
                    createDay(1, "2026-07-01", true),
                    createDay(2, "2026-07-02", true),
                    createDay(3, "2026-07-03", false),
                ])
                .mockResolvedValueOnce([createDay(4, "2026-07-04", false)]);
            txPrismaService.service_record_day.upsert.mockResolvedValue(createDay(3, "2026-07-06", false));
            txPrismaService.service_record_day.update.mockResolvedValue(createDay(4, "2026-07-07", false));
            txPrismaService.employee_schedule.update.mockResolvedValue(createSchedule({ endDate: toDbDate("2026-07-15") }));
            txPrismaService.client.update.mockResolvedValue({ id: CLIENT_ID, endDate: toDbDate("2026-07-15") });
            txPrismaService.schedule_change_request.update.mockResolvedValue(
                createRequest({
                    status: "approved",
                    decidedBy: USER_ID,
                    decidedAt: toDbDate("2026-07-02"),
                }),
            );

            await expect(service.approve("request-1", tenant)).resolves.toMatchObject({
                id: "request-1",
                status: "approved",
                decidedBy: USER_ID,
                newEndDate: "2026-07-15",
            });
            expect(txPrismaService.service_record_day.upsert).toHaveBeenCalledWith({
                where: {
                    scheduleId_sessionIndex: {
                        scheduleId: SCHEDULE_ID,
                        sessionIndex: 3,
                    },
                },
                update: { serviceDate: toDbDate("2026-07-06") },
                create: {
                    branchId: BRANCH_ID,
                    scheduleId: SCHEDULE_ID,
                    sessionIndex: 3,
                    serviceDate: toDbDate("2026-07-06"),
                },
            });
            expect(txPrismaService.service_record_day.update).toHaveBeenCalledWith({
                where: { id: "day-4" },
                data: { serviceDate: toDbDate("2026-07-07") },
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { endDate: toDbDate("2026-07-15") },
            });
            expect(txPrismaService.client.update).toHaveBeenCalledWith({
                where: { id: CLIENT_ID },
                data: { endDate: toDbDate("2026-07-15") },
            });
            expect(tokenService.extendExpiryForSchedule).toHaveBeenCalledWith(
                SCHEDULE_ID,
                new Date("2026-07-15T20:00:00+09:00"),
                txPrismaService,
            );
            expect(txPrismaService.schedule_change_request.update).toHaveBeenCalledWith({
                where: { id: "request-1" },
                data: {
                    status: "approved",
                    decidedBy: USER_ID,
                    decidedAt: expect.any(Date),
                },
            });
            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).toHaveBeenCalledWith(
                BRANCH_ID,
                SCHEDULE_ID,
                true,
            );
            expect(events).toEqual(["transaction:start", "transaction:commit", "sync"]);
        });

        it("should create the target draft row when it is missing", async () => {
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([
                    createDay(1, "2026-07-01", true),
                    createDay(2, "2026-07-02", true),
                ])
                .mockResolvedValueOnce([]);
            txPrismaService.schedule_change_request.update.mockResolvedValue(
                createRequest({ status: "approved", decidedBy: USER_ID, decidedAt: toDbDate("2026-07-02") }),
            );

            await service.approve("request-1", tenant);

            expect(txPrismaService.service_record_day.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: {
                        branchId: BRANCH_ID,
                        scheduleId: SCHEDULE_ID,
                        sessionIndex: 3,
                        serviceDate: toDbDate("2026-07-06"),
                    },
                }),
            );
        });

        it("should mark the request stale outside the transaction when current state drifted", async () => {
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            txPrismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
                createDay(2, "2026-07-02", true),
                createDay(3, "2026-07-03", true),
                createDay(4, "2026-07-06", false),
            ]);
            prismaService.schedule_change_request.update.mockResolvedValue(
                createRequest({ status: "stale", decidedAt: toDbDate("2026-07-02") }),
            );

            await expectConflictCode(() => service.approve("request-1", tenant), "REQUEST_STALE");
            expect(prismaService.schedule_change_request.update).toHaveBeenCalledWith({
                where: { id: "request-1" },
                data: { status: "stale", decidedAt: expect.any(Date) },
            });
            expect(txPrismaService.schedule_change_request.update).not.toHaveBeenCalled();
            expect(txPrismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(txPrismaService.client.update).not.toHaveBeenCalled();
            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
        });

        it("should reject non-pending requests", async () => {
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(
                createRequest({ status: "approved" }),
            );

            await expectConflictCode(() => service.approve("request-1", tenant), "REQUEST_NOT_PENDING");
            expect(txPrismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
        });
    });

    describe("reject", () => {
        it("should reject a pending request with decided metadata and reason", async () => {
            prismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            prismaService.schedule_change_request.update.mockResolvedValue(
                createRequest({
                    status: "rejected",
                    decidedBy: USER_ID,
                    decidedAt: toDbDate("2026-07-02"),
                    reason: "provider unavailable",
                }),
            );

            await expect(service.reject("request-1", tenant, "provider unavailable")).resolves.toMatchObject({
                id: "request-1",
                status: "rejected",
                decidedBy: USER_ID,
                reason: "provider unavailable",
            });
            expect(prismaService.schedule_change_request.update).toHaveBeenCalledWith({
                where: { id: "request-1" },
                data: {
                    status: "rejected",
                    decidedBy: USER_ID,
                    decidedAt: expect.any(Date),
                    reason: "provider unavailable",
                },
            });
            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.client.update).not.toHaveBeenCalled();
        });
    });
});
