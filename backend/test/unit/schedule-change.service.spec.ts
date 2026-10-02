import {
    BadRequestException,
    ConflictException,
    HttpException,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const SCHEDULE_ID = 11;
const CLIENT_ID = 21;
const BRANCH_ID = "org-1";
const USER_ID = "user-1";

const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The built-in calendar plus the extra dates one branch added as holidays. */
const branchCalendarWith = (...extraHolidays: string[]) => createKrBusinessDayCalendar(
    [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat(), ...extraHolidays],
    { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
);

const createMockPrismaService = () => ({
    schedule_change_request: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
    },
    employee_schedule: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    service_record_day: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
    },
    service_record_case: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: "case-1", formVersion: 1 }),
        update: jest.fn(),
    },
    client: {
        update: jest.fn(),
    },
    $transaction: jest.fn(),
});

const createMockTokenService = () => ({
    extendExpiryForSchedule: jest.fn(),
    extendExpiryForCase: jest.fn(),
});

const createMockLifecycleService = () => ({
    ensureForSchedule: jest.fn().mockResolvedValue({ id: "case-1", formVersion: 1 }),
    ensureForClient: jest.fn().mockResolvedValue({ id: "case-1", formVersion: 1 }),
    recompute: jest.fn().mockResolvedValue(undefined),
});

const createMockTriggerService = () => ({
    syncEmployeeAssignmentRulesForSchedule: jest.fn(() => Promise.resolve()),
    syncClientRulesForClient: jest.fn(() => Promise.resolve()),
});

const createSchedule = (overrides: Record<string, unknown> = {}) => ({
    id: SCHEDULE_ID,
    branchId: BRANCH_ID,
    clientId: CLIENT_ID,
    primaryEmployeeId: 5,
    startDate: toDbDate("2026-07-01"),
    endDate: toDbDate("2026-07-14"),
    client: {
        id: CLIENT_ID,
        duration: 10,
    },
    primaryEmployee: { id: 5, name: "제공인력" },
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
    serviceRecordCaseId: "case-1",
    caseSessionIndex: sessionIndex,
    employeeId: 5,
    employeeNameSnapshot: "제공인력",
    formVersion: 1,
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

const createPlannedSessions = (dates: string[]) => dates.map((serviceDate, offset) => ({
    sessionIndex: offset + 1,
    serviceDate,
    originalDate: serviceDate,
    assignmentId: `assignment-${offset + 1}`,
    scheduleId: SCHEDULE_ID,
    employeeId: 5,
    provenanceVersion: "revision-1",
}));

const expectProblemResponse = (
    error: unknown,
    exceptionClass: new (...args: never[]) => HttpException,
    status: number,
    code: string,
): void => {
    expect(error).toBeInstanceOf(exceptionClass);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toEqual(
        expect.objectContaining({
            code,
            params: {},
            outcome: "NOT_APPLIED",
        }),
    );
};

const expectConflictCode = async (
    action: () => Promise<unknown>,
    code: string,
): Promise<void> => {
    try {
        await action();
        throw new Error("Expected ConflictException");
    } catch (error) {
        expectProblemResponse(error, ConflictException, 409, code);
    }
};

const expectNotFoundCode = async (
    action: () => Promise<unknown>,
    code: string,
): Promise<void> => {
    try {
        await action();
        throw new Error("Expected NotFoundException");
    } catch (error) {
        expectProblemResponse(error, NotFoundException, 404, code);
    }
};

const expectBadRequestCode = async (
    action: () => Promise<unknown>,
    code: string,
): Promise<void> => {
    try {
        await action();
        throw new Error("Expected BadRequestException");
    } catch (error) {
        expectProblemResponse(error, BadRequestException, 400, code);
    }
};

describe("ScheduleChangeService", () => {
    const ctx = {
        tokenId: "token-1",
        branchId: BRANCH_ID,
        scheduleId: SCHEDULE_ID,
        employeeId: 5,
        serviceRecordCaseId: "case-1",
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
    let lifecycleService: ReturnType<typeof createMockLifecycleService>;
    let events: string[];
    let holidayCalendar: HolidayCalendarService;

    beforeEach(() => {
        holidayCalendar = createHolidayCalendarStub();
        prismaService = createMockPrismaService();
        txPrismaService = createMockPrismaService();
        tokenService = createMockTokenService();
        triggerService = createMockTriggerService();
        lifecycleService = createMockLifecycleService();
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
            tokenService as unknown as ServiceRecordTokenService,
            holidayCalendar, triggerService as unknown as MessageTriggerService,
            lifecycleService as unknown as ServiceRecordLifecycleService,
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

        it("uses the case N and canonical planned date for an irregular future vector", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule({
                client: { id: CLIENT_ID, duration: 15 },
            }));
            prismaService.service_record_case.findUnique.mockResolvedValue({
                id: "case-1",
                requiredSessionCount: 3,
                plannedSessions: createPlannedSessions([
                    "2026-07-01",
                    "2026-07-03",
                    "2026-07-07",
                ]),
            });
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
            ]);

            await expect(service.preview(ctx)).resolves.toEqual({
                sessionIndex: 2,
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

            await expectConflictCode(
                () => service.preview(ctx),
                "SCHEDULE_CHANGE_UNCOMPUTABLE",
            );
        });

        it("should reject when the assignment has no start date to compute from", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(
                createSchedule({ startDate: null }),
            );
            prismaService.service_record_day.findMany.mockResolvedValue([]);

            await expectConflictCode(
                () => service.preview(ctx),
                "SCHEDULE_CHANGE_UNCOMPUTABLE",
            );
        });

        it("should reject with SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE when the persisted plan is malformed", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_case.findUnique.mockResolvedValue({
                id: "case-1",
                requiredSessionCount: 3,
                plannedSessions: [{ broken: true }],
            });
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
            ]);

            await expectConflictCode(
                () => service.preview(ctx),
                "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE",
            );
        });

        it("should reject with RESOURCE_NOT_FOUND when the assignment is missing", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(null);

            await expectNotFoundCode(() => service.preview(ctx), "RESOURCE_NOT_FOUND");
        });

        it("should reject with RESOURCE_NOT_FOUND when the service record is missing", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_case.findUnique.mockResolvedValue(null);

            await expectNotFoundCode(() => service.preview(ctx), "RESOURCE_NOT_FOUND");
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

        it("should reject with SCHEDULE_CHANGE_UNCOMPUTABLE when the assignment has no end date", async () => {
            prismaService.employee_schedule.findUnique.mockResolvedValue(
                createSchedule({ endDate: null }),
            );
            prismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
            ]);

            await expectConflictCode(
                () => service.createRequest(ctx),
                "SCHEDULE_CHANGE_UNCOMPUTABLE",
            );
            expect(prismaService.schedule_change_request.create).not.toHaveBeenCalled();
        });
    });

    describe("admin schedule change", () => {
        it("should preview the next unlocked session within the current tenant", async () => {
            prismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule());
            prismaService.service_record_case.findFirst.mockResolvedValue({ id: "case-1" });
            prismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-15", true),
                createDay(2, "2026-07-16", true),
                createDay(3, "2026-07-20", false),
            ]);

            await expect(service.previewAdminChange(BRANCH_ID, SCHEDULE_ID)).resolves.toEqual({
                sessionIndex: 3,
                fromDate: "2026-07-20",
                minimumDate: "2026-07-17",
            });
            expect(prismaService.employee_schedule.findFirst).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID, branchId: BRANCH_ID },
                include: { client: true },
            });
        });

        it("should apply the selected date and cascade later unlocked sessions", async () => {
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                endDate: toDbDate("2026-07-29"),
            }));
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([
                    createDay(1, "2026-07-15", true),
                    createDay(2, "2026-07-16", true),
                    createDay(3, "2026-07-20", false),
                    createDay(4, "2026-07-21", false),
                ])
                .mockResolvedValueOnce([createDay(4, "2026-07-21", false)]);
            txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({
                status: "approved",
                fromDate: toDbDate("2026-07-20"),
                toDate: toDbDate("2026-07-23"),
                oldEndDate: toDbDate("2026-07-29"),
                newEndDate: toDbDate("2026-08-03"),
                decidedBy: USER_ID,
                decidedAt: toDbDate("2026-07-17"),
            }));

            await expect(
                service.applyAdminChange(SCHEDULE_ID, "2026-07-23", tenant),
            ).resolves.toMatchObject({
                status: "approved",
                sessionIndex: 3,
                fromDate: "2026-07-20",
                toDate: "2026-07-23",
                newEndDate: "2026-08-03",
            });
            expect(txPrismaService.service_record_day.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: { serviceDate: toDbDate("2026-07-23") },
                }),
            );
            expect(txPrismaService.service_record_day.update).toHaveBeenCalledWith({
                where: { id: "day-4" },
                data: { serviceDate: toDbDate("2026-07-24") },
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { endDate: toDbDate("2026-08-03") },
            });
            expect(txPrismaService.client.update).toHaveBeenCalledWith({
                where: { id: CLIENT_ID },
                data: { endDate: toDbDate("2026-08-03") },
            });
            expect(lifecycleService.ensureForClient).toHaveBeenCalledWith(
                CLIENT_ID,
                txPrismaService,
            );
            expect(tokenService.extendExpiryForCase).toHaveBeenCalledWith(
                "case-1",
                new Date("2026-08-10T11:00:00.000Z"),
                txPrismaService,
                { onlyRaise: true },
            );
            expect(txPrismaService.schedule_change_request.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    branchId: BRANCH_ID,
                    scheduleId: SCHEDULE_ID,
                    sessionIndex: 3,
                    fromDate: toDbDate("2026-07-20"),
                    toDate: toDbDate("2026-07-23"),
                    status: "approved",
                    decidedBy: USER_ID,
                    decidedAt: expect.any(Date),
                }),
            });
        });

        it("shifts the canonical vector without inventing day rows and keeps N separate from duration", async () => {
            const plannedSessions = createPlannedSessions([
                "2026-07-01",
                "2026-07-03",
                "2026-07-07",
            ]);
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                endDate: toDbDate("2026-07-07"),
                client: { id: CLIENT_ID, duration: 15 },
            }));
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                branchId: BRANCH_ID,
                clientId: CLIENT_ID,
                formVersion: 1,
                requiredSessionCount: 3,
                plannedSessions,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([createDay(1, "2026-07-01", true)])
                .mockResolvedValueOnce([]);
            txPrismaService.service_record_case.update.mockResolvedValue({
                id: "case-1",
                requiredSessionCount: 3,
                plannedSessions,
            });
            txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({
                status: "approved",
                sessionIndex: 2,
                fromDate: toDbDate("2026-07-03"),
                toDate: toDbDate("2026-07-06"),
                oldEndDate: toDbDate("2026-07-07"),
                newEndDate: toDbDate("2026-07-08"),
                decidedBy: USER_ID,
                decidedAt: toDbDate("2026-07-02"),
            }));

            await expect(
                service.applyAdminChange(SCHEDULE_ID, "2026-07-06", tenant),
            ).resolves.toMatchObject({
                status: "approved",
                sessionIndex: 2,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
                newEndDate: "2026-07-08",
            });

            expect(txPrismaService.service_record_day.upsert).not.toHaveBeenCalled();
            expect(txPrismaService.service_record_case.update).toHaveBeenCalledWith({
                where: { id: "case-1", branchId: BRANCH_ID },
                data: expect.objectContaining({
                    version: { increment: 1 },
                    plannedSessions: [
                        expect.objectContaining({ sessionIndex: 1, serviceDate: "2026-07-01" }),
                        expect.objectContaining({ sessionIndex: 2, serviceDate: "2026-07-06" }),
                        expect.objectContaining({ sessionIndex: 3, serviceDate: "2026-07-08" }),
                    ],
                }),
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { endDate: toDbDate("2026-07-08") },
            });
            expect(txPrismaService.client.update).toHaveBeenCalledWith({
                where: { id: CLIENT_ID },
                data: { endDate: toDbDate("2026-07-08") },
            });
        });

        it("should supersede a pending request when an admin applies a schedule change directly", async () => {
            const pendingRequest = createRequest({
                fromDate: toDbDate("2026-07-20"),
                toDate: toDbDate("2026-07-21"),
                oldEndDate: toDbDate("2026-07-29"),
                newEndDate: toDbDate("2026-07-30"),
            });
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                endDate: toDbDate("2026-07-29"),
            }));
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(pendingRequest);
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([
                    createDay(1, "2026-07-15", true),
                    createDay(2, "2026-07-16", true),
                    createDay(3, "2026-07-20", false),
                ])
                .mockResolvedValueOnce([]);
            txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({
                id: "admin-change-1",
                status: "approved",
                fromDate: toDbDate("2026-07-20"),
                toDate: toDbDate("2026-07-21"),
                oldEndDate: toDbDate("2026-07-29"),
                newEndDate: toDbDate("2026-07-30"),
                decidedBy: USER_ID,
                decidedAt: toDbDate("2026-07-17"),
            }));

            await expect(
                service.applyAdminChange(SCHEDULE_ID, "2026-07-21", tenant),
            ).resolves.toMatchObject({
                status: "approved",
                fromDate: "2026-07-20",
                toDate: "2026-07-21",
            });
            expect(txPrismaService.schedule_change_request.update).toHaveBeenCalledWith({
                where: { id: pendingRequest.id },
                data: {
                    status: "stale",
                    decidedBy: USER_ID,
                    decidedAt: expect.any(Date),
                },
            });
        });

        it("should reject a selected date equal to the current session date", async () => {
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule());
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-15", true),
                createDay(2, "2026-07-16", true),
                createDay(3, "2026-07-20", false),
            ]);

            await expectConflictCode(
                () => service.applyAdminChange(SCHEDULE_ID, "2026-07-20", tenant),
                "SCHEDULE_DATE_NOT_POSTPONED",
            );
            expect(txPrismaService.service_record_day.upsert).not.toHaveBeenCalled();
        });

        it("previews the birth date as the floor for the first session", async () => {
            prismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                client: { id: CLIENT_ID, duration: 10, birthDate: toDbDate("2026-06-20") },
            }));
            prismaService.service_record_case.findFirst.mockResolvedValue({ id: "case-1" });
            prismaService.service_record_day.findMany.mockResolvedValue([]);

            await expect(service.previewAdminChange(BRANCH_ID, SCHEDULE_ID)).resolves.toEqual({
                sessionIndex: 1,
                fromDate: "2026-07-01",
                minimumDate: "2026-06-20",
            });
        });

        it("moves the first session earlier and pulls the service start date with it", async () => {
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                client: { id: CLIENT_ID, duration: 10, birthDate: toDbDate("2026-06-20") },
            }));
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([
                    createDay(1, "2026-07-01", false),
                    createDay(2, "2026-07-02", false),
                ])
                .mockResolvedValueOnce([createDay(2, "2026-07-02", false)]);
            txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({
                status: "approved",
                sessionIndex: 1,
                fromDate: toDbDate("2026-07-01"),
                toDate: toDbDate("2026-06-29"),
                newEndDate: toDbDate("2026-07-10"),
            }));

            await service.applyAdminChange(SCHEDULE_ID, "2026-06-29", tenant);

            expect(txPrismaService.service_record_day.update).toHaveBeenCalledWith({
                where: { id: "day-2" },
                data: { serviceDate: toDbDate("2026-06-30") },
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { startDate: toDbDate("2026-06-29"), endDate: toDbDate("2026-07-10") },
            });
            expect(txPrismaService.client.update).toHaveBeenCalledWith({
                where: { id: CLIENT_ID },
                data: { startDate: toDbDate("2026-06-29"), endDate: toDbDate("2026-07-10") },
            });
        });

        it("rejects a date before the client's birth date", async () => {
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                client: { id: CLIENT_ID, duration: 10, birthDate: toDbDate("2026-06-24") },
            }));
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", false),
            ]);

            await expectBadRequestCode(
                () => service.applyAdminChange(SCHEDULE_ID, "2026-06-23", tenant),
                "INVALID_SCHEDULE_DATE",
            );
            expect(txPrismaService.client.update).not.toHaveBeenCalled();
        });

        it("ignores the due date when there is no birth date", async () => {
            prismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                client: { id: CLIENT_ID, duration: 10, dueDate: toDbDate("2026-06-20") },
            }));
            prismaService.service_record_case.findFirst.mockResolvedValue({ id: "case-1" });
            prismaService.service_record_day.findMany.mockResolvedValue([]);

            await expect(service.previewAdminChange(BRANCH_ID, SCHEDULE_ID)).resolves.toMatchObject({
                minimumDate: null,
            });
        });

        it("moves the service start date when the first session is postponed", async () => {
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule());
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([createDay(1, "2026-07-01", false)])
                .mockResolvedValueOnce([]);
            txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({
                status: "approved",
                sessionIndex: 1,
                fromDate: toDbDate("2026-07-01"),
                toDate: toDbDate("2026-07-06"),
                newEndDate: toDbDate("2026-07-20"),
            }));

            await service.applyAdminChange(SCHEDULE_ID, "2026-07-06", tenant);

            expect(txPrismaService.client.update).toHaveBeenCalledWith({
                where: { id: CLIENT_ID },
                data: expect.objectContaining({ startDate: toDbDate("2026-07-06") }),
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: expect.objectContaining({ startDate: toDbDate("2026-07-06") }),
            });
        });

        describe("weekend/holiday exception and session order", () => {
            const arrange = (overrides: { requiredSessionCount?: number } = {}) => {
                txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                    endDate: toDbDate("2026-07-29"),
                }));
                txPrismaService.service_record_case.findFirst.mockResolvedValue({
                    id: "case-1",
                    formVersion: 1,
                    ...overrides,
                });
                txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
                txPrismaService.service_record_day.findMany
                    .mockResolvedValueOnce([
                        createDay(1, "2026-07-15", true),
                        createDay(2, "2026-07-16", true),
                        createDay(3, "2026-07-20", false),
                        createDay(4, "2026-07-21", false),
                    ])
                    .mockResolvedValueOnce([createDay(4, "2026-07-21", false)]);
                txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({
                    status: "approved",
                    sessionIndex: 3,
                    fromDate: toDbDate("2026-07-20"),
                    toDate: toDbDate("2026-07-19"),
                    newEndDate: toDbDate("2026-07-28"),
                }));
            };

            it("rejects a weekend date that was not confirmed", async () => {
                await expectBadRequestCode(
                    () => service.applyAdminChange(SCHEDULE_ID, "2026-07-19", tenant),
                    "INVALID_SCHEDULE_DATE",
                );
                expect(prismaService.$transaction).not.toHaveBeenCalled();
            });

            it("moves Monday's session to a confirmed Sunday and pulls later sessions one business day earlier", async () => {
                arrange();

                await service.applyAdminChange(SCHEDULE_ID, "2026-07-19", tenant, { allowNonBusinessDay: true });

                expect(txPrismaService.service_record_day.upsert).toHaveBeenCalledWith(
                    expect.objectContaining({ update: { serviceDate: toDbDate("2026-07-19") } }),
                );
                // Session 4 moves from Tuesday 07-21 to Monday 07-20.
                expect(txPrismaService.service_record_day.update).toHaveBeenCalledWith({
                    where: { id: "day-4" },
                    data: { serviceDate: toDbDate("2026-07-20") },
                });
                // Ten sessions: 3 on Sunday, 4..10 on the seven business days from Monday 07-20.
                expect(txPrismaService.client.update).toHaveBeenCalledWith({
                    where: { id: CLIENT_ID },
                    data: { endDate: toDbDate("2026-07-28") },
                });
            });

            it("rejects a date on or before the previous session even when confirmed", async () => {
                arrange();

                await expectBadRequestCode(
                    () => service.applyAdminChange(SCHEDULE_ID, "2026-07-16", tenant, { allowNonBusinessDay: true }),
                    "INVALID_SCHEDULE_DATE",
                );
                expect(txPrismaService.service_record_day.upsert).not.toHaveBeenCalled();
            });

            it("keeps the case's session count when the lifecycle sync re-caps it", async () => {
                arrange({ requiredSessionCount: 10 });
                lifecycleService.ensureForClient.mockResolvedValueOnce({ id: "case-1", formVersion: 1, requiredSessionCount: 8 });

                await service.applyAdminChange(SCHEDULE_ID, "2026-07-19", tenant, { allowNonBusinessDay: true });

                expect(txPrismaService.service_record_case.update).toHaveBeenCalledWith({
                    where: { id: "case-1" },
                    data: { requiredSessionCount: 10 },
                });
                // Status must be derived from the restored N, not the capped one.
                expect(lifecycleService.recompute).toHaveBeenCalledWith("case-1", txPrismaService, expect.anything());
            });

            it("returns the client's start date after the change", async () => {
                arrange();

                await expect(
                    service.applyAdminChange(SCHEDULE_ID, "2026-07-19", tenant, { allowNonBusinessDay: true }),
                ).resolves.toMatchObject({ startDate: null });
            });
        });

        it("should reject a calendar date that does not exist", async () => {
            await expectBadRequestCode(
                () => service.applyAdminChange(SCHEDULE_ID, "2026-02-30", tenant),
                "INVALID_SCHEDULE_DATE",
            );
            expect(prismaService.$transaction).not.toHaveBeenCalled();
        });

        it("should reject with SCHEDULE_CHANGE_UNCOMPUTABLE when the assignment has no end date", async () => {
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(
                createSchedule({ endDate: null }),
            );

            await expectConflictCode(
                () => service.applyAdminChange(SCHEDULE_ID, "2026-07-23", tenant),
                "SCHEDULE_CHANGE_UNCOMPUTABLE",
            );
        });

        it("should map a changed admin write-lock target to SERVICE_RECORD_WRITE_TARGET_CHANGED", async () => {
            txPrismaService.employee_schedule.findFirst
                .mockResolvedValueOnce(createSchedule())
                .mockResolvedValueOnce(null);
            txPrismaService.service_record_case.findFirst.mockResolvedValue({
                id: "case-1",
                formVersion: 1,
            });
            txPrismaService.service_record_case.findUnique.mockResolvedValue({
                id: "case-1",
                branchId: BRANCH_ID,
                clientId: CLIENT_ID,
            });

            await expectConflictCode(
                () => service.applyAdminChange(SCHEDULE_ID, "2026-07-23", tenant),
                "SERVICE_RECORD_WRITE_TARGET_CHANGED",
            );
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
                    serviceRecordCaseId_caseSessionIndex: {
                        serviceRecordCaseId: "case-1",
                        caseSessionIndex: 3,
                    },
                },
                update: { serviceDate: toDbDate("2026-07-06") },
                create: {
                    branchId: BRANCH_ID,
                    scheduleId: SCHEDULE_ID,
                    serviceRecordCaseId: "case-1",
                    caseSessionIndex: 3,
                    employeeId: 5,
                    employeeNameSnapshot: "제공인력",
                    formVersion: 1,
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
            expect(tokenService.extendExpiryForCase).toHaveBeenCalledWith(
                "case-1",
                new Date("2026-07-22T11:00:00.000Z"),
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

        it("approves against the canonical vector and does not create an unwritten target row", async () => {
            const plannedSessions = createPlannedSessions([
                "2026-07-01",
                "2026-07-03",
                "2026-07-07",
            ]);
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest({
                sessionIndex: 2,
                fromDate: toDbDate("2026-07-03"),
                toDate: toDbDate("2026-07-06"),
            }));
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule({
                endDate: toDbDate("2026-07-07"),
                client: { id: CLIENT_ID, duration: 15 },
            }));
            txPrismaService.service_record_case.findUnique.mockResolvedValue({
                id: "case-1",
                branchId: BRANCH_ID,
                clientId: CLIENT_ID,
                formVersion: 1,
                requiredSessionCount: 3,
                plannedSessions,
            });
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([createDay(1, "2026-07-01", true)])
                .mockResolvedValueOnce([]);
            txPrismaService.service_record_case.update.mockResolvedValue({
                id: "case-1",
                requiredSessionCount: 3,
                plannedSessions,
            });
            txPrismaService.schedule_change_request.update.mockResolvedValue(createRequest({
                status: "approved",
                sessionIndex: 2,
                fromDate: toDbDate("2026-07-03"),
                toDate: toDbDate("2026-07-06"),
                newEndDate: toDbDate("2026-07-08"),
                decidedBy: USER_ID,
                decidedAt: toDbDate("2026-07-02"),
            }));

            await expect(service.approve("request-1", tenant)).resolves.toMatchObject({
                status: "approved",
                sessionIndex: 2,
                fromDate: "2026-07-03",
                toDate: "2026-07-06",
                newEndDate: "2026-07-08",
            });

            expect(txPrismaService.service_record_day.upsert).not.toHaveBeenCalled();
            expect(txPrismaService.service_record_case.update).toHaveBeenCalledWith({
                where: { id: "case-1", branchId: BRANCH_ID },
                data: expect.objectContaining({
                    version: { increment: 1 },
                    plannedSessions: [
                        expect.objectContaining({ sessionIndex: 1, serviceDate: "2026-07-01" }),
                        expect.objectContaining({ sessionIndex: 2, serviceDate: "2026-07-06" }),
                        expect.objectContaining({ sessionIndex: 3, serviceDate: "2026-07-08" }),
                    ],
                }),
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { endDate: toDbDate("2026-07-08") },
            });
        });

        it("approval resyncs client trigger rules after the transaction commits", async () => {
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
            triggerService.syncClientRulesForClient.mockImplementation(() => {
                events.push("client-sync");
                return Promise.resolve();
            });

            await service.approve("request-1", tenant);

            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                BRANCH_ID,
                CLIENT_ID,
                false,
            );
            expect(events).toEqual(["transaction:start", "transaction:commit", "sync", "client-sync"]);
        });

        it("approval still succeeds when the client resync throws", async () => {
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
            triggerService.syncClientRulesForClient.mockRejectedValueOnce(new Error("sync failed"));

            await expect(service.approve("request-1", tenant)).resolves.toMatchObject({
                id: "request-1",
                status: "approved",
                decidedBy: USER_ID,
            });
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
                        serviceRecordCaseId: "case-1",
                        caseSessionIndex: 3,
                        employeeId: 5,
                        employeeNameSnapshot: "제공인력",
                        formVersion: 1,
                        sessionIndex: 3,
                        serviceDate: toDbDate("2026-07-06"),
                    },
                }),
            );
        });

        it("should mark the request stale with a pending-state compare when current state drifted", async () => {
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
            expect(prismaService.schedule_change_request.updateMany).toHaveBeenCalledWith({
                where: { id: "request-1", branchId: BRANCH_ID, status: "pending" },
                data: { status: "stale", decidedAt: expect.any(Date) },
            });
            expect(txPrismaService.schedule_change_request.update).not.toHaveBeenCalled();
            expect(txPrismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(txPrismaService.client.update).not.toHaveBeenCalled();
            expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
        });

        it("does not overwrite an already-approved request when the stale transition races", async () => {
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            txPrismaService.service_record_day.findMany.mockResolvedValue([
                createDay(1, "2026-07-01", true),
                createDay(2, "2026-07-02", true),
                createDay(3, "2026-07-03", true),
                createDay(4, "2026-07-06", false),
            ]);
            prismaService.schedule_change_request.updateMany.mockResolvedValue({ count: 0 });

            await expectConflictCode(() => service.approve("request-1", tenant), "REQUEST_STALE");

            expect(prismaService.schedule_change_request.updateMany).toHaveBeenCalledWith({
                where: { id: "request-1", branchId: BRANCH_ID, status: "pending" },
                data: { status: "stale", decidedAt: expect.any(Date) },
            });
            expect(prismaService.schedule_change_request.update).not.toHaveBeenCalled();
        });

        it("should map a changed write-lock target to SERVICE_RECORD_WRITE_TARGET_CHANGED", async () => {
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.employee_schedule.findUnique
                .mockResolvedValueOnce(createSchedule())
                .mockResolvedValueOnce(null);
            txPrismaService.service_record_case.findUnique.mockResolvedValue({
                id: "case-1",
                branchId: BRANCH_ID,
                clientId: CLIENT_ID,
            });

            await expectConflictCode(
                () => service.approve("request-1", tenant),
                "SERVICE_RECORD_WRITE_TARGET_CHANGED",
            );
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
        it("rechecks the request under the owning lock and does not reject an approval that won the race", async () => {
            const pendingRequest = createRequest();
            prismaService.schedule_change_request.findFirst.mockResolvedValue(pendingRequest);
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(
                createRequest({ status: "approved" }),
            );
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
        txPrismaService.service_record_case.findUnique.mockResolvedValue({
            id: "case-1",
            branchId: BRANCH_ID,
            clientId: CLIENT_ID,
        });
        prismaService.schedule_change_request.update.mockResolvedValue(
            createRequest({ status: "rejected" }),
        );

        await expectConflictCode(
                () => service.reject("request-1", tenant, "provider unavailable"),
                "REQUEST_NOT_PENDING",
            );

            expect(prismaService.schedule_change_request.update).not.toHaveBeenCalled();
        });

        it("should reject a pending request with decided metadata and reason", async () => {
            prismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.schedule_change_request.update.mockResolvedValue(
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
            expect(txPrismaService.schedule_change_request.update).toHaveBeenCalledWith({
                where: { id: "request-1" },
                data: {
                    status: "rejected",
                    decidedBy: USER_ID,
                    decidedAt: expect.any(Date),
                    reason: "provider unavailable",
                },
            });
            expect(prismaService.schedule_change_request.update).not.toHaveBeenCalled();
            expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
            expect(prismaService.client.update).not.toHaveBeenCalled();
        });
    });

    describe("branch calendar", () => {
        // 2026-07-06 (Mon) is a normal business day in the built-in calendar.
        const useBranchHoliday = (...dates: string[]) => {
            (holidayCalendar.forBranch as jest.Mock).mockImplementation(async () => {
                events.push("calendar");
                return branchCalendarWith(...dates);
            });
        };
        const postponableDays = () => [
            createDay(1, "2026-07-01", true),
            createDay(2, "2026-07-02", true),
            createDay(3, "2026-07-03", false),
        ];

        it("preview skips a branch holiday and reads the cached calendar of the token's branch", async () => {
            useBranchHoliday("2026-07-06");
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.service_record_day.findMany.mockResolvedValue(postponableDays());

            await expect(service.preview(ctx)).resolves.toEqual({
                sessionIndex: 3,
                fromDate: "2026-07-03",
                toDate: "2026-07-07",
            });
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID);
        });

        it("createRequest persists dates computed from a fresh branch calendar", async () => {
            useBranchHoliday("2026-07-06");
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            prismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            prismaService.service_record_day.findMany.mockResolvedValue(postponableDays());
            prismaService.schedule_change_request.create.mockResolvedValue(
                createRequest({ id: "request-created", toDate: toDbDate("2026-07-07") }),
            );

            await service.createRequest(ctx);

            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
            expect(prismaService.schedule_change_request.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    toDate: toDbDate("2026-07-07"),
                    newEndDate: toDbDate("2026-07-16"),
                }),
            });
        });

        it("previewAdminChange chains the next date over a branch holiday using the cached calendar", async () => {
            useBranchHoliday("2026-07-02");
            prismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule());
            prismaService.service_record_case.findFirst.mockResolvedValue({ id: "case-1" });
            prismaService.service_record_day.findMany.mockResolvedValue([createDay(1, "2026-07-01", true)]);

            await expect(service.previewAdminChange(BRANCH_ID, SCHEDULE_ID)).resolves.toMatchObject({
                sessionIndex: 2,
                fromDate: "2026-07-03",
            });
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID);
        });

        it("approve answers 404 before loading any calendar when the caller has no branch", async () => {
            await expectNotFoundCode(
                () => service.approve("request-1", { userId: tenant.userId }),
                "RESOURCE_NOT_FOUND",
            );
            expect(holidayCalendar.forBranch).not.toHaveBeenCalled();
            expect(prismaService.$transaction).not.toHaveBeenCalled();
        });

        it("applyAdminChange rejects a branch holiday as the new date, reading the calendar fresh first", async () => {
            useBranchHoliday("2026-07-23");

            await expectBadRequestCode(
                () => service.applyAdminChange(SCHEDULE_ID, "2026-07-23", tenant),
                "INVALID_SCHEDULE_DATE",
            );
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
            expect(prismaService.$transaction).not.toHaveBeenCalled();
        });

        it("applyAdminChange cascades later sessions over a branch holiday", async () => {
            useBranchHoliday("2026-07-24");
            txPrismaService.employee_schedule.findFirst.mockResolvedValue(createSchedule({
                endDate: toDbDate("2026-07-29"),
            }));
            txPrismaService.service_record_case.findFirst.mockResolvedValue({ id: "case-1", formVersion: 1 });
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(null);
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce([
                    createDay(1, "2026-07-15", true),
                    createDay(2, "2026-07-16", true),
                    createDay(3, "2026-07-20", false),
                    createDay(4, "2026-07-21", false),
                ])
                .mockResolvedValueOnce([createDay(4, "2026-07-21", false)]);
            txPrismaService.schedule_change_request.create.mockResolvedValue(createRequest({ status: "approved" }));

            await service.applyAdminChange(SCHEDULE_ID, "2026-07-23", tenant);

            expect(txPrismaService.service_record_day.update).toHaveBeenCalledWith({
                where: { id: "day-4" },
                data: { serviceDate: toDbDate("2026-07-27") },
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { endDate: toDbDate("2026-08-04") },
            });
        });

        it("approve reads the branch calendar fresh before its transaction and applies it", async () => {
            useBranchHoliday("2026-07-06");
            txPrismaService.schedule_change_request.findFirst.mockResolvedValue(createRequest());
            txPrismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule());
            txPrismaService.service_record_day.findMany
                .mockResolvedValueOnce(postponableDays())
                .mockResolvedValueOnce([createDay(4, "2026-07-04", false)]);
            txPrismaService.schedule_change_request.update.mockResolvedValue(
                createRequest({ status: "approved", decidedBy: USER_ID, decidedAt: toDbDate("2026-07-02") }),
            );

            await service.approve("request-1", tenant);

            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
            expect(events.slice(0, 2)).toEqual(["calendar", "transaction:start"]);
            expect(txPrismaService.service_record_day.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ update: { serviceDate: toDbDate("2026-07-07") } }),
            );
            expect(txPrismaService.service_record_day.update).toHaveBeenCalledWith({
                where: { id: "day-4" },
                data: { serviceDate: toDbDate("2026-07-08") },
            });
            expect(txPrismaService.employee_schedule.update).toHaveBeenCalledWith({
                where: { id: SCHEDULE_ID },
                data: { endDate: toDbDate("2026-07-16") },
            });
        });

        it("validates the persisted planned vector against the branch calendar", async () => {
            // The vector holds 2026-07-06; the branch has since made that day a holiday,
            // so the vector is no longer authoritative and the preview must refuse it.
            useBranchHoliday("2026-07-06");
            prismaService.employee_schedule.findUnique.mockResolvedValue(createSchedule({
                client: { id: CLIENT_ID, duration: 3 },
            }));
            prismaService.service_record_case.findUnique.mockResolvedValue({
                id: "case-1",
                requiredSessionCount: 3,
                plannedSessions: createPlannedSessions(["2026-07-01", "2026-07-03", "2026-07-06"]),
            });
            prismaService.service_record_day.findMany.mockResolvedValue([createDay(1, "2026-07-01", true)]);

            await expectConflictCode(() => service.preview(ctx), "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE");
        });
    });
});
