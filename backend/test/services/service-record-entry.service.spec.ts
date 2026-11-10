import { checkWriteArgs } from "infrastructure/database/tenant-isolation.extension";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { validate } from "class-validator";

import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { UpsertSessionDto } from "interface/dto/service-record-entry.dto";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const CASE_ID = "case-1";
const BRANCH_ID = "11111111-1111-1111-1111-111111111111";
const SERVICE_DATE = new Date("2026-07-01T00:00:00.000Z");
const SIGNATURE = "data:image/png;base64,aGVsbG8=";

const context = {
    tokenId: "token-1",
    branchId: BRANCH_ID,
    scheduleId: 10,
    employeeId: 20,
    serviceRecordCaseId: CASE_ID,
};

function createRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: CASE_ID,
        branchId: BRANCH_ID,
        status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
        requiredSessionCount: 5,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-31T00:00:00.000Z"),
        formVersion: 1,
        momName: "김산모",
        momBirth: "900101",
        babyName: "아기",
        babyBirth: "260701",
        deliveryType: "자연분만",
        babyWeight: "3.2",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        ...overrides,
    };
}

/** The real lock/read method, so specs exercise the production locking path. */
const realTokenService = new ServiceRecordTokenService({} as PrismaService);
const lockAccessTokenForWrite = realTokenService.lockAccessTokenForWrite.bind(realTokenService);

function createToken(overrides: Record<string, unknown> = {}) {
    return {
        id: context.tokenId,
        branchId: BRANCH_ID,
        scheduleId: context.scheduleId,
        employeeId: context.employeeId,
        active: true,
        revokedAt: null,
        verifiedAt: new Date("2026-06-01T00:00:00.000Z"),
        lockedAt: null,
        failedAttempts: 0,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ...overrides,
    };
}

function createDay(overrides: Record<string, unknown> = {}) {
    return {
        id: "day-1",
        branchId: BRANCH_ID,
        scheduleId: 10,
        serviceRecordCaseId: CASE_ID,
        caseSessionIndex: 1,
        sessionIndex: 1,
        employeeId: 20,
        employeeNameSnapshot: "제공자",
        formVersion: 1,
        serviceDate: SERVICE_DATE,
        answers: {},
        etcService: null,
        notes: null,
        paymentConfirmed: true,
        momApproval: "approved",
        locked: true,
        submittedAt: new Date("2026-07-01T01:00:00.000Z"),
        periodMismatchKeptAt: null as Date | null,
        clientSignature: SIGNATURE,
        clientSignedAt: new Date("2026-07-01T01:00:00.000Z"),
        ...overrides,
    };
}

function createDto(overrides: Partial<UpsertSessionDto> = {}): UpsertSessionDto {
    return {
        serviceDate: SERVICE_DATE.toISOString(),
        answers: {},
        paymentConfirmed: true,
        momApproval: "approved",
        clientSignature: SIGNATURE,
        ...overrides,
    };
}

function createHarness(options: {
    existing?: ReturnType<typeof createDay> | null;
    days?: ReturnType<typeof createDay>[];
    transactionRecord?: ReturnType<typeof createRecord>;
    updateSignature?: (args: Record<string, unknown>) => Promise<{ count: number }>;
    schedule?: Record<string, unknown>;
    employeeScheduleFindFirst?: jest.Mock;
    ensureForClient?: jest.Mock;
    extendExpiryForCase?: jest.Mock;
    holidayCalendar?: HolidayCalendarService;
    /** Assert caregiver writes leave an existing review item untouched. */
    openReviewItem?: { id: string; recalculatedEnd: Date } | null;
    /** Overrides for the caregiver token row re-read inside the transaction. */
    token?: Record<string, unknown> | null;
} = {}) {
    const aggregate = createRecord();
    const existing = options.existing === undefined ? null : options.existing;
    const transactionRecord = options.transactionRecord ?? aggregate;
    const days = [...(options.days ?? [])];
    if (existing && !days.some((day) => day.serviceRecordCaseId === existing.serviceRecordCaseId
        && day.caseSessionIndex === existing.caseSessionIndex)) days.push(existing);
    const upsert = jest.fn().mockImplementation((args) => {
        expect(checkWriteArgs("upsert", args, BRANCH_ID)).toBeNull();
        return Promise.resolve({
            ...(existing ?? createDay({ locked: false, submittedAt: null, clientSignature: null, clientSignedAt: null })),
            ...(existing ? args.update : args.create),
        });
    });
    const editLogCreate = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn(options.updateSignature ?? (() => Promise.resolve({
        count: existing?.clientSignature ? 0 : 1,
    })));
    const schedule = options.schedule ?? { primaryEmployee: { name: "제공자" } };
    const scheduleUpdate = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...schedule, ...data }));
    const clientUpdate = jest.fn().mockResolvedValue({});
    const reviewItemFindFirst = jest.fn().mockResolvedValue(options.openReviewItem ?? null);
    const reviewItemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const caseFindUnique = jest.fn().mockResolvedValue(transactionRecord);
    const ensureForClient = options.ensureForClient ?? jest.fn().mockResolvedValue(null);
    const transactionClient = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: CASE_ID }]),
        service_record_token: {
            findUnique: jest.fn().mockResolvedValue(
                options.token === null ? null : createToken(options.token),
            ),
        },
        service_record_case: {
            findUnique: caseFindUnique,
            update: jest.fn().mockResolvedValue(transactionRecord),
        },
        employee_schedule: {
            findUnique: jest.fn().mockResolvedValue(schedule),
            update: scheduleUpdate,
            ...(options.employeeScheduleFindFirst ? { findFirst: options.employeeScheduleFindFirst } : {}),
        },
        client: {
            update: clientUpdate,
        },
        end_date_review_item: {
            findFirst: reviewItemFindFirst,
            updateMany: reviewItemUpdateMany,
        },
        service_record_day: {
            findUnique: jest.fn().mockImplementation(({ where }) => {
                const key = where.serviceRecordCaseId_caseSessionIndex;
                return Promise.resolve(days.find((day) => day.serviceRecordCaseId === key.serviceRecordCaseId
                    && day.caseSessionIndex === key.caseSessionIndex) ?? null);
            }),
            count: jest.fn().mockImplementation(({ where }: { where: {
                serviceRecordCaseId?: string;
                branchId?: string;
                caseSessionIndex?: { lt: number };
                locked?: boolean;
            } }) => Promise.resolve(days.filter((day) =>
                (where.serviceRecordCaseId === undefined || day.serviceRecordCaseId === where.serviceRecordCaseId)
                && (where.branchId === undefined || day.branchId === where.branchId)
                && (where.caseSessionIndex === undefined || (day.caseSessionIndex != null && day.caseSessionIndex < where.caseSessionIndex.lt))
                && (where.locked === undefined || day.locked === where.locked)).length)),
            upsert,
            findMany: jest.fn().mockResolvedValue(days),
            delete: jest.fn().mockResolvedValue(existing),
            updateMany,
        },
        service_record_day_archive: { create: jest.fn().mockResolvedValue({}) },
        service_record_day_edit_log: {
            create: editLogCreate,
        },
    };
    const prisma = {
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(aggregate),
        },
        $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
            callback(transactionClient)),
    };
    const lifecycle = {
        recompute: jest.fn().mockResolvedValue(transactionRecord),
        ensureForClient,
    };
    const tokenService = {
        lockAccessTokenForWrite,
        extendExpiryForCase: options.extendExpiryForCase ?? jest.fn().mockResolvedValue(undefined),
    };
    const service = new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        tokenService as unknown as ServiceRecordTokenService,
        lifecycle as unknown as ServiceRecordLifecycleService, options.holidayCalendar ?? createHolidayCalendarStub(),
    );

    return {
        service,
        prisma,
        transactionClient,
        upsert,
        updateMany,
        editLogCreate,
        lifecycle,
        tokenService,
        scheduleUpdate,
        clientUpdate,
        reviewItemFindFirst,
        reviewItemUpdateMany,
    };
}

/** A calendar service whose branch calendar is the built-in one plus the dates that branch added. */
function branchHolidayCalendar(...extraHolidays: string[]): HolidayCalendarService {
    const stub = createHolidayCalendarStub();
    const calendar = createKrBusinessDayCalendar(
        [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat(), ...extraHolidays],
        { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
    );
    (stub.forBranch as jest.Mock).mockImplementation(async () => calendar);
    return stub;
}

function createContextPrisma(record: ReturnType<typeof createRecord>) {
    return {
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(record),
            findUnique: jest.fn().mockResolvedValue({ ...record, days: [] }),
        },
        employee_schedule: {
            findUnique: jest.fn().mockResolvedValue({
                client: { id: 100, name: "고객" },
                primaryEmployee: { id: 20, name: "제공자" },
            }),
        },
        schedule_change_request: {
            findFirst: jest.fn().mockResolvedValue(null),
        },
    };
}

function createConcurrentHarness() {
    type SessionWrite = Partial<ReturnType<typeof createDay>> & { locked: boolean };

    let persistedDay: ReturnType<typeof createDay> | null = null;
    let dayReadCount = 0;
    let caseLockObserved = false;
    let caseLockHeld = false;
    const lockQueries: unknown[] = [];
    const caseLockWaiters: Array<() => void> = [];
    let releaseSecondDayRead: (() => void) | undefined;
    const secondDayRead = new Promise<void>((resolve) => {
        releaseSecondDayRead = resolve;
    });
    let releaseSubmitWrite: (() => void) | undefined;
    const submitWrite = new Promise<void>((resolve) => {
        releaseSubmitWrite = resolve;
    });

    const acquireCaseLock = async () => {
        if (caseLockHeld) {
            await new Promise<void>((resolve) => caseLockWaiters.push(resolve));
        }
        caseLockHeld = true;
    };
    const releaseCaseLock = () => {
        const next = caseLockWaiters.shift();
        if (next) {
            next();
            return;
        }
        caseLockHeld = false;
    };

    const caseModel = {
        findUnique: jest.fn().mockResolvedValue(createRecord()),
    };
    const scheduleModel = {
        findUnique: jest.fn().mockResolvedValue({ primaryEmployee: { name: "제공자" } }),
    };
    const dayModel = {
        findMany: jest.fn(async () => persistedDay ? [{ ...persistedDay }] : []),
        findUnique: jest.fn(async () => {
            dayReadCount += 1;
            if (dayReadCount === 2) releaseSecondDayRead?.();
            return persistedDay ? { ...persistedDay } : null;
        }),
        upsert: jest.fn(async ({ create, update }: { create: SessionWrite; update: SessionWrite }) => {
            const data = persistedDay ? update : create;
            if (data.locked && !caseLockObserved) {
                await secondDayRead;
            }
            if (data.locked) {
                persistedDay = { ...(persistedDay ?? createDay({ locked: false, clientSignature: null, clientSignedAt: null })), ...data };
                releaseSubmitWrite?.();
            } else {
                await submitWrite;
                persistedDay = { ...(persistedDay ?? createDay({ locked: false, clientSignature: null, clientSignedAt: null })), ...data };
            }
            return persistedDay;
        }),
        updateMany: jest.fn(async ({ data }: { data: Partial<ReturnType<typeof createDay>> }) => {
            if (!persistedDay || persistedDay.clientSignature) return { count: 0 };
            persistedDay = { ...persistedDay, ...data };
            return { count: 1 };
        }),
    };
    const lifecycle = { recompute: jest.fn().mockResolvedValue(createRecord()) };
    const prisma = {
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(createRecord()),
        },
        $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
            let acquired = false;
            const tx = {
                $queryRaw: jest.fn(async (query: unknown) => {
                    lockQueries.push(query);
                    caseLockObserved = true;
                    await acquireCaseLock();
                    acquired = true;
                    return [{ id: CASE_ID }];
                }),
                service_record_case: caseModel,
                employee_schedule: scheduleModel,
                service_record_day: dayModel,
            };
            try {
                return await callback(tx);
            } finally {
                if (acquired) releaseCaseLock();
            }
        }),
    };
    const service = new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        {} as ServiceRecordTokenService,
        lifecycle as unknown as ServiceRecordLifecycleService, createHolidayCalendarStub(),
    );

    return { service, prisma, dayModel, lockQueries, getPersistedDay: () => persistedDay };
}

function exceptionCode(error: unknown): unknown {
    if (error instanceof BadRequestException || error instanceof ConflictException) {
        return error.getResponse();
    }
    return null;
}

async function expectException(
    promise: Promise<unknown>,
    exceptionType: typeof BadRequestException | typeof ConflictException,
    code: string,
): Promise<void> {
    try {
        await promise;
        throw new Error(`Expected ${exceptionType.name}`);
    } catch (error) {
        expect(error).toBeInstanceOf(exceptionType);
        expect(exceptionCode(error)).toMatchObject({ code });
    }
}

describe("ServiceRecordEntryService context dates", () => {
    it.each([null, { invalid: true }, [{ sessionIndex: 1 }]])(
        "omits planned and pending-change fields even without a usable vector: %j", async (plannedSessions) => {
            const record = createRecord({ plannedSessions, currentRevisionId: "revision-1" });
            const prisma = createContextPrisma(record);
            const service = new ServiceRecordEntryService(
                prisma as unknown as PrismaService, {} as ServiceRecordTokenService,
                {} as ServiceRecordLifecycleService, createHolidayCalendarStub(),
            );
            const result = await service.getContext(context);
            expect(result).not.toHaveProperty("plannedSessionDates");
            expect(result).not.toHaveProperty("pendingScheduleChange");
            expect(result.totalSessions).toBe(5);
            expect(result.startDate).toEqual(record.startDate);
            expect(result.endDate).toEqual(record.endDate);
            expect(result.sessions).toEqual([]);
            expect(prisma.schedule_change_request.findFirst).not.toHaveBeenCalled();
        },
    );
});

describe("caregiver context session counts", () => {
    it.each([
        { startDate: new Date("2026-09-03"), endDate: new Date("2026-09-08"), requiredSessionCount: 13, currentRevisionId: "revision-1" },
        { startDate: new Date("2099-01-01"), endDate: new Date("2099-01-05"), requiredSessionCount: 5 },
    ])("preserves stored totals across short periods and unsupported years: %j", async (overrides) => {
        const record = createRecord(overrides);
        const service = new ServiceRecordEntryService(
            createContextPrisma(record) as unknown as PrismaService, {} as ServiceRecordTokenService,
            {} as ServiceRecordLifecycleService, createHolidayCalendarStub(),
        );
        expect(await service.getContext(context)).toMatchObject({
            totalSessions: overrides.requiredSessionCount, startDate: overrides.startDate, endDate: overrides.endDate,
        });
    });
});

describe("ServiceRecordEntryService.upsertSession", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it.each([true, false])("clears the keep timestamp only on an actual date change (locked=%s)", async (locked) => {
        const keptAt = new Date("2026-06-30T01:00:00.000Z");
        const existing = createDay({ locked, periodMismatchKeptAt: keptAt });
        const h = createHarness({ existing });
        const changed = await h.service.upsertSession(context, 1, createDto({ serviceDate: "2026-07-02", notes: "edited" }), locked);
        expect(changed.periodMismatchKeptAt).toBeNull();
        expect(h.upsert.mock.calls[0]![0].update.periodMismatchKeptAt).toBeNull();

        const same = createHarness({ existing });
        const unchanged = await same.service.upsertSession(context, 1, createDto({ notes: "edited" }), locked);
        expect(unchanged.periodMismatchKeptAt).toBe(keptAt);
        expect(same.upsert.mock.calls[0]![0].update).not.toHaveProperty("periodMismatchKeptAt");
    });

    it("does not count a legacy null-index row as a previously submitted session", async () => {
        const h = createHarness({ days: [createDay({ caseSessionIndex: null, sessionIndex: 1, serviceDate: new Date("2026-06-29T00:00:00Z") })] });
        await expect(h.service.upsertSession(context, 2, createDto({ serviceDate: "2026-07-02" }), false))
            .rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
        expect(h.transactionClient.service_record_day.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { serviceRecordCaseId: CASE_ID, branchId: BRANCH_ID, locked: true },
        }));
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it("uses the common client, employee, case, schedule, assignment, day lock order for an owned assignment", async () => {
        const schedule = {
            id: 10,
            clientId: 100,
            branchId: BRANCH_ID,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-31T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const { service, transactionClient } = createHarness({ schedule });

        await service.upsertSession(context, 1, createDto(), false);

        const lockTables = transactionClient.$queryRaw.mock.calls
            .map(([query]) => (query as { strings?: string[] }).strings?.join(" ").toLowerCase() ?? "")
            .filter((query) => query.includes("for update"))
            .map((query) => {
                const match = query.match(/from\s+"?([a-z_]+)"?/);
                return match?.[1] ?? "unknown";
            });
        expect(lockTables.slice(0, 6)).toEqual([
            "client",
            "employee",
            "service_record_case",
            "employee_schedule",
            "service_record_assignment",
            "service_record_day",
        ]);
    });

    describe("current-provider re-check after the write-set lock", () => {
        const currentSchedule = {
            id: 10,
            clientId: 100,
            branchId: BRANCH_ID,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-31T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };

        /** The pre-lock read sees the current schedule; the post-lock reread sees `afterLock`. */
        function harnessWithPostLockSchedule(afterLock: Record<string, unknown>, existing?: ReturnType<typeof createDay>) {
            const harness = createHarness({ schedule: currentSchedule, existing });
            harness.transactionClient.employee_schedule.findUnique
                .mockResolvedValueOnce(currentSchedule)
                .mockResolvedValueOnce({ ...currentSchedule, ...afterLock });
            return harness;
        }

        function expectNoWrites(h: ReturnType<typeof createHarness>) {
            expect(h.upsert).not.toHaveBeenCalled();
            expect(h.updateMany).not.toHaveBeenCalled();
            expect(h.editLogCreate).not.toHaveBeenCalled();
            expect(h.lifecycle.recompute).not.toHaveBeenCalled();
            expect(h.scheduleUpdate).not.toHaveBeenCalled();
            expect(h.clientUpdate).not.toHaveBeenCalled();
        }

        it.each([
            ["replaced schedule", { replaced: true }],
            ["different primary employee", { primaryEmployeeId: 21 }],
        ])("refuses a first submit when the post-lock reread shows a %s", async (_name, afterLock) => {
            const h = harnessWithPostLockSchedule(afterLock);

            await expect(h.service.upsertSession(context, 1, createDto(), true)).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            expectNoWrites(h);
        });

        it.each([
            ["replaced schedule", { replaced: true }],
            ["different primary employee", { primaryEmployeeId: 21 }],
        ])("refuses a locked-session edit when the post-lock reread shows a %s", async (_name, afterLock) => {
            const h = harnessWithPostLockSchedule(afterLock, createDay());

            await expect(h.service.upsertSession(context, 1, createDto({ notes: "수정됨" }), true)).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            expectNoWrites(h);
        });

        it("refuses a draft save when the post-lock reread shows a replaced schedule", async () => {
            const h = harnessWithPostLockSchedule({ replaced: true });

            await expect(h.service.upsertSession(context, 1, createDto(), false)).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            expectNoWrites(h);
        });

        it("still accepts a first submit when the schedule and provider are unchanged", async () => {
            const h = harnessWithPostLockSchedule({});

            await expect(h.service.upsertSession(context, 1, createDto(), true)).resolves.toEqual(
                expect.objectContaining({ sessionIndex: 1, locked: true }),
            );
            expect(h.upsert).toHaveBeenCalledTimes(1);
        });

        it("still accepts a locked-session edit when the schedule and provider are unchanged", async () => {
            const h = harnessWithPostLockSchedule({}, createDay());

            await h.service.upsertSession(context, 1, createDto({ notes: "수정됨" }), true);

            expect(h.upsert).toHaveBeenCalledTimes(1);
            expect(h.editLogCreate).toHaveBeenCalledTimes(1);
        });
    });

    it("returns the four stored provider sessions for a transferred case with a 15-day voucher", async () => {
        const record = createRecord({
            requiredSessionCount: 4, days: [],
            startDate: new Date("2026-09-03"), endDate: new Date("2026-09-08"),
        });
        const prisma = {
            service_record_case: {
                findFirst: jest.fn().mockResolvedValue(record),
                findUnique: jest.fn().mockResolvedValue(record),
            },
            employee_schedule: { findUnique: jest.fn().mockResolvedValue({
                primaryEmployee: { id: 20, name: "제공자" },
                client: { id: 100, name: "산모", duration: 15 },
            }) },
            schedule_change_request: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        const service = new ServiceRecordEntryService(
            prisma as unknown as PrismaService,
            {} as ServiceRecordTokenService,
            {} as ServiceRecordLifecycleService, createHolidayCalendarStub(),
        );
        expect((await service.getContext(context)).totalSessions).toBe(4);
    });

    it("rejects a fifth session for a transferred four-day service period", async () => {
        const { service, upsert } = createHarness({ transactionRecord: createRecord({
            requiredSessionCount: 4,
            startDate: new Date("2026-09-03"), endDate: new Date("2026-09-08"),
        }) });
        await expect(service.upsertSession(context, 5, createDto({ serviceDate: "2026-09-09" }), false)).rejects.toMatchObject({
            response: { code: "VALIDATION_FAILED" },
        });
        expect(upsert).not.toHaveBeenCalled();
    });

    it("allows an unlocked session to be edited and submitted", async () => {
        const existing = createDay({ locked: false, clientSignature: null, clientSignedAt: null });
        const { service, upsert } = createHarness({ existing });

        await expect(service.upsertSession(context, 1, createDto({ notes: "수정" }), true)).resolves.toEqual(
            expect.objectContaining({ notes: "수정", locked: true }),
        );
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ notes: "수정", locked: true }),
        }));
    });

    it("keeps the public flat-form auxiliary fields compatible with the shared answer validator", async () => {
        const { service, upsert } = createHarness();

        await service.upsertSession(context, 1, createDto({
            answers: {
                sitzBath: "실시",
                sleep: "잘 잠",
                stool: "정상변",
                perineum: ["이상없음"],
                meals_meal: "3",
                temperature_temp: "36.7",
                etcService: "flat 기타서비스",
                notes: "flat 특이사항",
                paymentConfirmed: true,
            },
            etcService: "flat 기타서비스",
            notes: "flat 특이사항",
            paymentConfirmed: true,
        }), true);

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                answers: {
                    sitzBath: "실시",
                    sleep: "잘 잠",
                    stool: "정상변",
                    perineum: ["이상없음"],
                    meals_meal: "3",
                    temperature_temp: "36.7",
                },
                etcService: "flat 기타서비스",
                notes: "flat 특이사항",
                paymentConfirmed: true,
            }),
        }));
    });

    it.each([
        ["meals_meal", "1.5"],
        ["temperature_temp", "36.75"],
        ["meals_meal", "NaN"],
    ])("rejects invalid numeric answer %s=%s before opening a write transaction", async (key, value) => {
        const { service, prisma, upsert } = createHarness();

        await expect(service.upsertSession(
            context,
            1,
            createDto({ answers: { [key]: value } }),
            false,
        )).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(upsert).not.toHaveBeenCalled();
    });

    it.each([
        SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
        SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE,
    ])("rejects a draft save (PUT) on a locked session while the case is %s", async (status) => {
        const existing = createDay();
        const { service, prisma, upsert, updateMany, editLogCreate, lifecycle } = createHarness({
            existing,
            transactionRecord: createRecord({ status }),
        });

        await expectException(
            service.upsertSession(context, 1, createDto({ notes: "변조" }), false),
            ConflictException,
            "REQUEST_CONFLICT",
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(upsert).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
        expect(editLogCreate).not.toHaveBeenCalled();
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });

    it.each([
        SERVICE_RECORD_CASE_STATUS.FINALIZING,
        SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
        SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
        SERVICE_RECORD_CASE_STATUS.COMPLETED,
    ])("refuses a caregiver edit of a locked session once the case is %s", async (status) => {
        const { service, upsert, updateMany, editLogCreate, lifecycle } = createHarness({
            existing: createDay(),
            transactionRecord: createRecord({ status }),
        });

        await expectException(
            service.upsertSession(context, 1, createDto({ notes: "변조" }), true),
            ConflictException,
            "REQUEST_CONFLICT",
        );
        expect(upsert).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
        expect(editLogCreate).not.toHaveBeenCalled();
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });

    describe("caregiver edit of a submitted (locked) session", () => {
        const ORIGINAL_SUBMITTED_AT = new Date("2026-07-01T01:00:00.000Z");

        it("writes the changed fields, keeps stored facts, ignores the request signature and logs one edit", async () => {
            jest.useFakeTimers({ now: new Date("2026-07-02T09:00:00.000Z") });
            const existing = createDay({
                answers: { sleep: "잘 잠" },
                notes: "처음",
                etcService: "기존",
                momApproval: "approved",
            });
            const { service, upsert, updateMany, editLogCreate, lifecycle } = createHarness({ existing });

            const result = await service.upsertSession(context, 1, createDto({
                answers: { sleep: "잘 못 잠" },
                notes: "수정됨",
                etcService: "기존",
                clientSignature: "data:image/png;base64,bmV3",
            }), true);

            expect(upsert).toHaveBeenCalledTimes(1);
            const args = upsert.mock.calls[0][0];
            for (const data of [args.create, args.update]) {
                expect(data).toEqual(expect.objectContaining({
                    answers: { sleep: "잘 못 잠" },
                    notes: "수정됨",
                    etcService: "기존",
                    paymentConfirmed: true,
                    locked: true,
                    momApproval: "approved",
                    submittedAt: ORIGINAL_SUBMITTED_AT,
                    employeeId: 20,
                    employeeNameSnapshot: "제공자",
                    scheduleId: 10,
                    formVersion: 1,
                    serviceDate: SERVICE_DATE,
                }));
                expect(data).not.toHaveProperty("clientSignature");
                expect(data).not.toHaveProperty("clientSignedAt");
            }
            expect(updateMany).not.toHaveBeenCalled();
            expect(result).toEqual(expect.objectContaining({
                sessionIndex: 1,
                notes: "수정됨",
                submittedAt: ORIGINAL_SUBMITTED_AT,
                clientSignature: SIGNATURE,
            }));
            expect(editLogCreate).toHaveBeenCalledTimes(1);
            expect(editLogCreate).toHaveBeenCalledWith({
                data: {
                    branchId: BRANCH_ID,
                    serviceRecordCaseId: CASE_ID,
                    caseSessionIndex: 1,
                    serviceRecordDayId: "day-1",
                    employeeId: 20,
                    employeeNameSnapshot: "제공자",
                    before: {
                        serviceDate: "2026-07-01",
                        answers: { sleep: "잘 잠" },
                        etcService: "기존",
                        notes: "처음",
                        paymentConfirmed: true,
                    },
                    after: {
                        serviceDate: "2026-07-01",
                        answers: { sleep: "잘 못 잠" },
                        etcService: "기존",
                        notes: "수정됨",
                        paymentConfirmed: true,
                    },
                },
            });
            expect(JSON.stringify(editLogCreate.mock.calls[0][0])).not.toContain("data:image");
            expect(lifecycle.recompute).toHaveBeenCalledTimes(1);
            expect(editLogCreate.mock.invocationCallOrder[0])
                .toBeLessThan(lifecycle.recompute.mock.invocationCallOrder[0] as number);
        });

        it("does not write or log when the resent draft equals the stored values after normalization", async () => {
            const existing = createDay({
                answers: { sleep: "잘 잠", stool: "정상변" },
                notes: null,
                etcService: null,
            });
            const { service, upsert, updateMany, editLogCreate, lifecycle, scheduleUpdate, clientUpdate } = createHarness({ existing });

            const result = await service.upsertSession(context, 1, createDto({
                // different key order, blank strings that normalize to null
                answers: { stool: "정상변", sleep: "잘 잠" },
                notes: "   ",
                etcService: "",
            }), true);

            expect(result).toEqual(expect.objectContaining({ sessionIndex: 1, notes: null, locked: true }));
            expect(upsert).not.toHaveBeenCalled();
            expect(updateMany).not.toHaveBeenCalled();
            expect(editLogCreate).not.toHaveBeenCalled();
            expect(lifecycle.recompute).not.toHaveBeenCalled();
            expect(scheduleUpdate).not.toHaveBeenCalled();
            expect(clientUpdate).not.toHaveBeenCalled();
        });

        it("treats the default locked+signed fixture resubmitted with the default dto as a no-change edit", async () => {
            const { service, upsert, editLogCreate } = createHarness({ existing: createDay() });

            await expect(service.upsertSession(context, 1, createDto(), true)).resolves.toEqual(
                expect.objectContaining({ locked: true, submittedAt: ORIGINAL_SUBMITTED_AT }),
            );
            expect(upsert).not.toHaveBeenCalled();
            expect(editLogCreate).not.toHaveBeenCalled();
        });

        it("logs a change of payment confirmation alone", async () => {
            const { service, upsert, editLogCreate } = createHarness({ existing: createDay() });

            await service.upsertSession(context, 1, createDto({ paymentConfirmed: false }), true);

            expect(upsert).toHaveBeenCalledTimes(1);
            expect(editLogCreate).toHaveBeenCalledTimes(1);
            expect(editLogCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
                before: expect.objectContaining({ paymentConfirmed: true }),
                after: expect.objectContaining({ paymentConfirmed: false }),
            }));
        });

        it("still requires the mom approval on an edit", async () => {
            const { service, upsert, editLogCreate } = createHarness({ existing: createDay() });

            await expectException(service.upsertSession(
                context,
                1,
                createDto({ notes: "수정", momApproval: "rejected" }),
                true,
            ), BadRequestException, "VALIDATION_FAILED");
            expect(upsert).not.toHaveBeenCalled();
            expect(editLogCreate).not.toHaveBeenCalled();
        });

        it("rejects a draft save (PUT) on a locked session with no writes", async () => {
            const { service, upsert, updateMany, editLogCreate, lifecycle } = createHarness({ existing: createDay() });

            await expectException(
                service.upsertSession(context, 1, createDto({ notes: "수정" }), false),
                ConflictException,
                "REQUEST_CONFLICT",
            );
            expect(upsert).not.toHaveBeenCalled();
            expect(updateMany).not.toHaveBeenCalled();
            expect(editLogCreate).not.toHaveBeenCalled();
            expect(lifecycle.recompute).not.toHaveBeenCalled();
        });

        it("allows the same calendar date sent with a non-midnight time of day and keeps the stored date", async () => {
            const { service, upsert, editLogCreate } = createHarness({ existing: createDay() });

            await service.upsertSession(context, 1, createDto({
                serviceDate: "2026-07-01T09:30:00.000Z",
                notes: "수정",
            }), true);

            expect(upsert).toHaveBeenCalledTimes(1);
            expect(upsert.mock.calls[0][0].update.serviceDate).toEqual(SERVICE_DATE);
            expect(editLogCreate).toHaveBeenCalledTimes(1);
        });

        it("allows a non-midnight time on the case end date without tripping the end-date check", async () => {
            const endDate = new Date("2027-12-31T00:00:00.000Z");
            const { service, upsert, editLogCreate } = createHarness({
                existing: createDay({ serviceDate: endDate }),
                transactionRecord: createRecord({
                    requiredSessionCount: 1,
                    startDate: new Date("2027-12-01T00:00:00.000Z"),
                    endDate,
                }),
            });

            await service.upsertSession(context, 1, createDto({
                serviceDate: "2027-12-31T09:00:00.000Z",
                notes: "수정",
            }), true);

            expect(upsert).toHaveBeenCalledTimes(1);
            expect(upsert.mock.calls[0][0].update.serviceDate).toEqual(endDate);
            expect(editLogCreate).toHaveBeenCalledTimes(1);
        });

        it("accepts an unlocked non-midnight service date on the inclusive end date", async () => {
            const h = createHarness({ transactionRecord: createRecord({
                requiredSessionCount: 1, startDate: new Date("2027-12-01"), endDate: new Date("2027-12-31"),
            }) });
            await h.service.upsertSession(context, 1, createDto({ serviceDate: "2027-12-31T09:00:00.000Z" }), true);
            expect(h.upsert.mock.calls[0][0].update.serviceDate).toEqual(new Date("2027-12-31"));
        });

        it.each([
            ["changed", { notes: "수정" }],
            ["unchanged", {}],
        ])("runs no extension calendar arithmetic for a %s edit (a holiday added at the supported-year boundary must not break it)", async (_label, fields) => {
            // Session 1 of 2 on 2027-12-30, end date 2027-12-31. Once the branch
            // adds 2027-12-31 as a holiday, the required end date would fall in
            // the unsupported year 2028 and the calendar throws. The extension
            // already ran at the first submit, so an edit must never ask.
            const serviceDate = new Date("2027-12-30T00:00:00.000Z");
            const calendarStub = branchHolidayCalendar("2027-12-31");
            const { service, upsert, scheduleUpdate, clientUpdate, editLogCreate } = createHarness({
                existing: createDay({ serviceDate }),
                transactionRecord: createRecord({
                    requiredSessionCount: 2,
                    startDate: new Date("2027-12-01T00:00:00.000Z"),
                    endDate: new Date("2027-12-31T00:00:00.000Z"),
                }),
                holidayCalendar: calendarStub,
            });
            const calendar = await calendarStub.forBranch(BRANCH_ID);
            expect(() => calendar.addBusinessDays("2027-12-30", 1)).toThrow();

            await expect(service.upsertSession(context, 1, createDto({
                serviceDate: serviceDate.toISOString(),
                ...fields,
            }), true)).resolves.toEqual(expect.objectContaining({ locked: true }));

            expect(scheduleUpdate).not.toHaveBeenCalled();
            expect(clientUpdate).not.toHaveBeenCalled();
            expect(upsert).toHaveBeenCalledTimes(Object.keys(fields).length ? 1 : 0);
            expect(editLogCreate).toHaveBeenCalledTimes(Object.keys(fields).length ? 1 : 0);
        });

        it("keeps the stored signature when the request carries a different one", async () => {
            const { service, upsert, updateMany } = createHarness({ existing: createDay() });

            const result = await service.upsertSession(context, 1, createDto({
                notes: "수정",
                clientSignature: "data:image/png;base64,b3RoZXI=",
            }), true);

            expect(updateMany).not.toHaveBeenCalled();
            expect(upsert.mock.calls[0][0].update).not.toHaveProperty("clientSignature");
            expect(result).toEqual(expect.objectContaining({ clientSignature: SIGNATURE }));
        });

        it("allows a different caregiver to resubmit and keeps the original caregiver snapshot", async () => {
            const storedCaregiver = { employeeId: 99, employeeNameSnapshot: "최초 제공자" };
            const { service, upsert, updateMany, editLogCreate, lifecycle } = createHarness({
                existing: createDay(storedCaregiver),
            });

            await expect(service.upsertSession(context, 1, createDto({ notes: "수정" }), true))
                .resolves.toEqual(expect.objectContaining({ ...storedCaregiver, locked: true, notes: "수정" }));
            expect(upsert).toHaveBeenCalledTimes(1);
            expect(upsert.mock.calls[0][0]).toMatchObject({
                create: storedCaregiver,
                update: storedCaregiver,
            });
            expect(updateMany).not.toHaveBeenCalled();
            expect(editLogCreate).toHaveBeenCalledTimes(1);
            expect(editLogCreate.mock.calls[0][0].data).toMatchObject({
                employeeId: context.employeeId,
                employeeNameSnapshot: "제공자",
            });
            expect(lifecycle.recompute).toHaveBeenCalledTimes(1);
        });

        it("allows a content edit by the original caregiver", async () => {
            const { service, upsert, editLogCreate } = createHarness({
                existing: createDay({ employeeId: context.employeeId }),
            });

            await service.upsertSession(context, 1, createDto({ notes: "수정" }), true);

            expect(upsert).toHaveBeenCalledTimes(1);
            expect(editLogCreate).toHaveBeenCalledTimes(1);
        });

        it("does not extend the end date, schedule, client or token on an edit, changed or not", async () => {
            // The planned service days extend past the period. A caregiver
            // content edit must leave the period and review items untouched.
            const transactionRecord = createRecord({
                requiredSessionCount: 5,
                endDate: new Date("2026-07-03T00:00:00.000Z"),
                startDate: new Date("2026-07-01T00:00:00.000Z"),
            });
            const schedule = {
                id: 10,
                clientId: 100,
                primaryEmployeeId: 20,
                secondaryEmployeeId: null,
                startDate: new Date("2026-07-01T00:00:00.000Z"),
                endDate: new Date("2026-07-03T00:00:00.000Z"),
                replaced: false,
                primaryEmployee: { name: "제공자" },
            };
            for (const notes of ["수정", null]) {
                const extendExpiryForCase = jest.fn();
                const harness = createHarness({
                    existing: createDay({ notes: null }),
                    transactionRecord,
                    schedule,
                    extendExpiryForCase,
                    openReviewItem: { id: "review-1", recalculatedEnd: new Date("2026-07-01T00:00:00.000Z") },
                });
                await harness.service.upsertSession(context, 1, createDto({ notes: notes ?? undefined }), true);

                expect(harness.scheduleUpdate).not.toHaveBeenCalled();
                expect(harness.clientUpdate).not.toHaveBeenCalled();
                expect(harness.reviewItemFindFirst).not.toHaveBeenCalled();
                expect(harness.reviewItemUpdateMany).not.toHaveBeenCalled();
                expect(harness.lifecycle.ensureForClient).not.toHaveBeenCalled();
                expect(extendExpiryForCase).not.toHaveBeenCalled();
            }
        });

        it("does not write an edit log for a first submit", async () => {
            const { service, editLogCreate } = createHarness({ existing: null });

            await service.upsertSession(context, 1, createDto(), true);

            expect(editLogCreate).not.toHaveBeenCalled();
        });
    });

    it("accepts 기타서비스 40자와 특이사항 80자를 정확히 입력할 수 있다", async () => {
        const { service, upsert } = createHarness();
        const etcService = "기".repeat(40);
        const notes = "특".repeat(80);

        await service.upsertSession(context, 1, createDto({ etcService, notes }), true);

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ etcService, notes }),
        }));
    });

    it.each([
        ["기타서비스", { etcService: ` ${"기".repeat(40)}` }, 40],
        ["특이사항", { notes: ` ${"특".repeat(80)}` }, 80],
    ])("%s 길이 계산에 앞 공백을 포함한다", async (_label, fields, maxLength) => {
        const { service, upsert } = createHarness();

        await expect(service.upsertSession(
            context,
            1,
            createDto(fields),
            true,
        )).rejects.toThrow(`입력값은 ${maxLength}자를 넘을 수 없습니다.`);
        expect(upsert).not.toHaveBeenCalled();
    });

    it.each([
        SERVICE_RECORD_CASE_STATUS.FINALIZING,
        SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
        SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
        SERVICE_RECORD_CASE_STATUS.COMPLETED,
    ])("rejects %s after rechecking status inside the transaction", async (status) => {
        const { service, prisma, upsert } = createHarness({
            transactionRecord: createRecord({ status }),
        });

        await expectException(
            service.upsertSession(context, 1, createDto(), true),
            ConflictException,
            "REQUEST_CONFLICT",
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(upsert).not.toHaveBeenCalled();
    });

    it("requires a signature for the first submission of a never-locked session", async () => {
        const { service, upsert } = createHarness({ existing: null });

        await expectException(service.upsertSession(
            context,
            1,
            createDto({ clientSignature: undefined }),
            true,
        ), BadRequestException, "VALIDATION_FAILED");
        expect(upsert).not.toHaveBeenCalled();
    });

    it("silently preserves an existing signature and signed timestamp", async () => {
        const signedAt = new Date("2026-07-01T01:00:00.000Z");
        const existing = createDay({ locked: false, clientSignature: SIGNATURE, clientSignedAt: signedAt });
        const { service, upsert, updateMany } = createHarness({
            existing,
            updateSignature: async () => ({ count: 0 }),
        });

        await service.upsertSession(context, 1, createDto({
            clientSignature: "data:image/png;base64,d29ybGQ=",
        }), true);

        const updateData = upsert.mock.calls[0][0].update;
        expect(updateData).not.toHaveProperty("clientSignature");
        expect(updateData).not.toHaveProperty("clientSignedAt");
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                serviceRecordCaseId: CASE_ID,
                branchId: BRANCH_ID,
                caseSessionIndex: 1,
                clientSignature: null,
            },
            data: {
                clientSignature: "data:image/png;base64,d29ybGQ=",
                clientSignedAt: expect.any(Date),
            },
        });
        expect(existing.clientSignature).toBe(SIGNATURE);
        expect(existing.clientSignedAt).toBe(signedAt);
    });

    it("uses a null-signature conditional write so only one concurrent first signature wins", async () => {
        let persistedSignature: string | null = null;
        const writeCounts: number[] = [];
        const updateSignature = async (args: Record<string, unknown>) => {
            const data = args["data"] as { clientSignature: string };
            const count = persistedSignature === null ? 1 : 0;
            if (count === 1) persistedSignature = data.clientSignature;
            writeCounts.push(count);
            return { count };
        };
        const { service, updateMany } = createHarness({ existing: null, updateSignature });

        await Promise.all([
            service.upsertSession(context, 1, createDto({ clientSignature: SIGNATURE }), true),
            service.upsertSession(context, 1, createDto({
                clientSignature: "data:image/png;base64,d29ybGQ=",
            }), true),
        ]);

        expect(writeCounts).toEqual([1, 0]);
        expect(updateMany).toHaveBeenCalledTimes(2);
        expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({ clientSignature: null }),
        }));
        expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ clientSignature: null }),
        }));
    });

    it("refuses a stale draft after a concurrent submission locks the session", async () => {
        const { service, dayModel, lockQueries, getPersistedDay } = createConcurrentHarness();
        const submit = service.upsertSession(context, 1, createDto(), true);
        const draft = service.upsertSession(context, 1, createDto({ notes: "stale draft" }), false);

        await expect(submit).resolves.toEqual(expect.objectContaining({ locked: true }));
        await expect(draft).rejects.toMatchObject({
            response: { code: "REQUEST_CONFLICT" },
        });
        expect(dayModel.upsert).toHaveBeenCalledTimes(1);
        expect(lockQueries).toHaveLength(2);
        for (const query of lockQueries) {
            expect((query as { strings: string[] }).strings.join(" ")).toContain("FOR UPDATE");
        }
        expect(getPersistedDay()).toEqual(expect.objectContaining({ locked: true }));
    });

    it("records clientSignedAt only on the first successful signature write", async () => {
        jest.useFakeTimers({ now: new Date("2026-07-01T02:00:00.000Z") });
        let persistedSignedAt: Date | null = null;
        const updateSignature = async (args: Record<string, unknown>) => {
            const data = args["data"] as { clientSignedAt: Date };
            if (persistedSignedAt) return { count: 0 };
            persistedSignedAt = data.clientSignedAt;
            return { count: 1 };
        };
        const { service } = createHarness({ existing: null, updateSignature });

        await service.upsertSession(context, 1, createDto(), true);
        jest.setSystemTime(new Date("2026-07-01T03:00:00.000Z"));
        await service.upsertSession(context, 1, createDto({
            clientSignature: "data:image/png;base64,d29ybGQ=",
        }), true);

        expect(persistedSignedAt).toEqual(new Date("2026-07-01T02:00:00.000Z"));
    });

    it("does not grandfather a locked legacy session with no signature", async () => {
        const existing = createDay({ clientSignature: null, clientSignedAt: null });
        const { service, updateMany } = createHarness({ existing });

        await expectException(service.upsertSession(
            context,
            1,
            createDto({ clientSignature: undefined }),
            true,
        ), ConflictException, "REQUEST_CONFLICT");
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("ignores a signature on draft save while the session remains unlocked", async () => {
        const existing = createDay({ locked: false, clientSignature: null, clientSignedAt: null });
        const { service, upsert, updateMany } = createHarness({ existing });

        await service.upsertSession(context, 1, createDto(), false);

        expect(updateMany).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ locked: false }),
        }));
    });

    it("does not extend the end date when the service date fits within the current schedule", async () => {
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-31T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const existing = createDay({ locked: false, clientSignature: null, clientSignedAt: null });
        const { service, scheduleUpdate, clientUpdate } = createHarness({
            existing,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });

        await service.upsertSession(context, 1, createDto({ notes: "정상 범위" }), false);

        expect(scheduleUpdate).not.toHaveBeenCalled();
        expect(clientUpdate).not.toHaveBeenCalled();
        expect(ensureForClient).not.toHaveBeenCalled();
        expect(extendExpiryForCase).not.toHaveBeenCalled();
    });

    it("lets the currently assigned caregiver submit a session dated before its own schedule start (backfill)", async () => {
        const handoverSchedule = {
            id: 702,
            clientId: 100,
            branchId: BRANCH_ID,
            primaryEmployeeId: 32,
            secondaryEmployeeId: null,
            startDate: new Date("2026-10-14T00:00:00.000Z"),
            endDate: new Date("2026-10-23T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "임선녀" },
        };
        const { service, transactionClient, upsert, scheduleUpdate } = createHarness({
            schedule: handoverSchedule,
            token: { scheduleId: 702, employeeId: 32 },
            transactionRecord: createRecord({
                startDate: new Date("2026-10-01T00:00:00.000Z"),
                endDate: new Date("2026-10-23T00:00:00.000Z"),
            }),
        });
        // Session 2 has no row yet; session 1 was written and locked by the outgoing caregiver.
        transactionClient.service_record_day.findMany.mockResolvedValue([createDay({
            scheduleId: 701, employeeId: 31, serviceDate: new Date("2026-10-01T00:00:00.000Z"),
        })]);
        transactionClient.service_record_day.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(createDay({
                scheduleId: 701,
                employeeId: 31,
                serviceDate: new Date("2026-10-01T00:00:00.000Z"),
            }));

        await service.upsertSession(
            { ...context, scheduleId: 702, employeeId: 32 },
            2,
            createDto({ serviceDate: "2026-10-02T00:00:00.000Z" }),
            false,
        );

        expect(scheduleUpdate).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                scheduleId: 702,
                employeeId: 32,
                caseSessionIndex: 2,
                serviceDate: new Date("2026-10-02T00:00:00.000Z"),
            }),
        }));
    });

    it("allows a caregiver to save a session while the case is AWAITING_COMPLETION, inside the link grace window", async () => {
        // Regression coverage for the link-expiry grace period: a case that
        // has already reached AWAITING_COMPLETION (end date passed, session
        // still owed) must not block the caregiver's write. AWAITING_COMPLETION
        // is intentionally absent from the blocked-status list in
        // upsertSession -- only FINALIZING/FINALIZATION_FAILED/
        // DOCUMENTS_CREATED/COMPLETED are. The wall-clock "now" (2026-09-05,
        // three days after the end date) is enforced at the link/token layer,
        // not here -- upsertSession itself does no time-based rejection.
        const transactionRecord = createRecord({
            status: SERVICE_RECORD_CASE_STATUS.AWAITING_COMPLETION,
            requiredSessionCount: 15,
            endDate: new Date("2026-09-02T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-08-01T00:00:00.000Z"),
            endDate: new Date("2026-09-02T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const { service, transactionClient } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });
        transactionClient.service_record_day.findMany.mockResolvedValue(Array.from({ length: 13 }, (_, index) => createDay({
            caseSessionIndex: index + 1, sessionIndex: index + 1, serviceDate: new Date("2026-08-28T00:00:00.000Z"),
        })));
        transactionClient.service_record_day.findUnique.mockImplementation(
            ({ where }: { where: { serviceRecordCaseId_caseSessionIndex: { caseSessionIndex: number } } }) => {
                const idx = where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex;
                if (idx === 13) {
                    return Promise.resolve(createDay({
                        caseSessionIndex: 13,
                        sessionIndex: 13,
                        serviceDate: new Date("2026-08-28T00:00:00.000Z"),
                        locked: true,
                    }));
                }
                return Promise.resolve(null);
            },
        );

        await expect(service.upsertSession(
            context,
            14,
            createDto({ serviceDate: "2026-09-02T00:00:00.000Z" }),
            false,
        )).resolves.toEqual(expect.objectContaining({ sessionIndex: 14 }));
    });

});

describe("UpsertSessionDto.clientSignature", () => {
    it("rejects malformed or decoded signatures larger than 192KB", async () => {
        const invalidValues = [
            "aGVsbG8=",
            "data:image/png;base64,not-valid***",
            `data:image/png;base64,${Buffer.alloc(192 * 1024 + 1).toString("base64")}`,
        ];

        for (const clientSignature of invalidValues) {
            const dto = Object.assign(new UpsertSessionDto(), createDto({ clientSignature }));
            const errors = await validate(dto);
            expect(errors.some((error) => error.property === "clientSignature")).toBe(true);
        }
    });

    it("accepts a PNG data URI whose decoded body is exactly 192KB", async () => {
        const dto = Object.assign(new UpsertSessionDto(), createDto({
            clientSignature: `data:image/png;base64,${Buffer.alloc(192 * 1024).toString("base64")}`,
        }));

        await expect(validate(dto)).resolves.toHaveLength(0);
    });
});

describe("UpsertSessionDto service-record text limits", () => {
    it("accepts 기타서비스 40자와 특이사항 80자", async () => {
        const dto = Object.assign(new UpsertSessionDto(), createDto({
            etcService: "기".repeat(40),
            notes: "특".repeat(80),
        }));

        await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it.each([
        ["etcService", { etcService: ` ${"기".repeat(40)}` }],
        ["notes", { notes: ` ${"특".repeat(80)}` }],
    ])("rejects %s when a leading space exceeds its limit", async (property, fields) => {
        const dto = Object.assign(new UpsertSessionDto(), createDto(fields));
        const errors = await validate(dto);

        expect(errors.some((error) => error.property === property)).toBe(true);
    });
});

describe("ServiceRecordEntryService.saveHeader", () => {
    it("revalidates the case status after the owning lock and performs no writes when finalized", async () => {
        const aggregate = createRecord({ status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS });
        const transactionRecord = createRecord({ status: SERVICE_RECORD_CASE_STATUS.FINALIZING });
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: CASE_ID }]),
            employee_schedule: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(transactionRecord),
                update: jest.fn().mockResolvedValue(transactionRecord),
            },
            service_record_day: {
                count: jest.fn().mockResolvedValue(0),
            },
            service_record: {
                upsert: jest.fn().mockResolvedValue({ ...transactionRecord, scheduleId: context.scheduleId }),
            },
        };
        const prisma = {
            service_record_case: {
                findFirst: jest.fn().mockResolvedValue(aggregate),
            },
            service_record_day: {
                count: jest.fn().mockResolvedValue(0),
            },
            $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) =>
                callback(transaction)),
        };
        const lifecycle = {
            recompute: jest.fn().mockResolvedValue(transactionRecord),
        };
        const service = new ServiceRecordEntryService(
            prisma as unknown as PrismaService,
            {} as ServiceRecordTokenService,
            lifecycle as unknown as ServiceRecordLifecycleService, createHolidayCalendarStub(),
        );

        await expect(service.saveHeader(context, {
            momName: "산모",
            momBirth: "900101",
            babyName: "아기",
            babyBirth: "260701",
            deliveryType: "자연분만",
            babyWeight: "3.2",
        })).rejects.toMatchObject({
            response: { code: "REQUEST_CONFLICT" },
        });

        expect(transaction.service_record_case.update).not.toHaveBeenCalled();
        expect(transaction.service_record.upsert).not.toHaveBeenCalled();
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });
});

describe("ServiceRecordEntryService transaction recompute calendar", () => {
    it.each(["saveHeader", "upsertSession"] as const)("%s passes the preloaded calendar for a null legacy count", async (method) => {
        const record = createRecord({
            clientId: 1,
            requiredSessionCount: null,
            currentRevisionId: null,
            assignments: [],
            days: [],
        });
        let transactionOpen = false;
        const readsWhileOpen: boolean[] = [];
        const calendar = createKrBusinessDayCalendar([], { version: "test", supportedYears: [2026] });
        const holidayCalendar = createHolidayCalendarStub();
        (holidayCalendar.forBranch as jest.Mock).mockImplementation(async () => {
            readsWhileOpen.push(transactionOpen);
            return calendar;
        });
        const harness = createHarness({ transactionRecord: record, holidayCalendar });
        harness.prisma.service_record_case.findFirst.mockResolvedValue(record);
        Object.assign(harness.prisma, {
            client: { findUnique: jest.fn().mockResolvedValue({ ...record, employeeSchedules: [] }) },
        });
        Object.assign(harness.prisma.service_record_case, { findUnique: jest.fn().mockResolvedValue(record) });
        Object.assign(harness.transactionClient.service_record_case, {
            update: jest.fn().mockResolvedValue(record),
        });
        Object.assign(harness.transactionClient.service_record_day, { count: jest.fn().mockResolvedValue(0) });
        Object.assign(harness.transactionClient, { service_record: { upsert: jest.fn().mockResolvedValue({}) } });
        Object.assign(harness.prisma, { service_record_day: { count: jest.fn().mockResolvedValue(0) } });
        harness.prisma.$transaction.mockImplementation(async (callback) => {
            transactionOpen = true;
            try {
                return await callback(harness.transactionClient);
            } finally {
                transactionOpen = false;
            }
        });
        const realLifecycle = new ServiceRecordLifecycleService(harness.prisma as unknown as PrismaService, holidayCalendar);
        harness.lifecycle.recompute.mockImplementation(async (id, tx, passedCalendar, options) => {
            if (!tx) return record;
            return realLifecycle.recompute(id, tx, passedCalendar, options);
        });

        if (method === "saveHeader") {
            await harness.service.saveHeader(context, {
                momName: "산모", momBirth: "900101", babyName: "아기", babyBirth: "260701",
                deliveryType: "자연분만", babyWeight: "3.2",
            });
        } else {
            await harness.service.upsertSession(context, 1, createDto(), false);
        }

        expect(readsWhileOpen).toEqual([false]);
        expect(harness.lifecycle.recompute).toHaveBeenCalledWith(CASE_ID, harness.transactionClient, calendar, ...(method === "upsertSession" ? [{ preserveVersion: false }] : []));
    });
});

describe("ServiceRecordEntryService branch calendar", () => {
    const plannedThroughJuly6 = [
        "2026-07-01",
        "2026-07-02",
        "2026-07-03",
        "2026-07-06",
        "2026-07-07",
    ].map((serviceDate, offset) => ({
        sessionIndex: offset + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: `assignment-${offset + 1}`,
        scheduleId: 10,
        employeeId: 20,
        provenanceVersion: "revision-1",
    }));

    function contextService(record: ReturnType<typeof createRecord>, holidayCalendar: HolidayCalendarService) {
        return new ServiceRecordEntryService(
            createContextPrisma(record) as unknown as PrismaService,
            {} as ServiceRecordTokenService,
            {} as ServiceRecordLifecycleService,
            holidayCalendar,
        );
    }

    it("getContext counts a legacy case's sessions against a fresh branch calendar", async () => {
        // No N is stored yet, so it derives from the period: 2026-07-01..07-06
        // holds 4 business days; a branch holiday on 07-06 leaves 3.
        const record = createRecord({
            requiredSessionCount: null,
            endDate: new Date("2026-07-06T00:00:00.000Z"),
            plannedSessions: null,
        });
        const builtin = contextService(record, createHolidayCalendarStub());
        const holidayCalendar = branchHolidayCalendar("2026-07-06");
        const branch = contextService(record, holidayCalendar);

        expect((await builtin.getContext(context)).totalSessions).toBe(4);
        expect((await branch.getContext(context)).totalSessions).toBe(3);
        expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
    });

    // Legacy case 2026-09-07..2026-09-29 stores N = 15 (추석 closes 09-24 and 09-25).
    // A branch holiday added inside the period must not shrink the stored N.
    it("getContext keeps a stored legacy N after the branch adds a holiday inside the period", async () => {
        const record = createRecord({
            requiredSessionCount: 15,
            startDate: new Date("2026-09-07T00:00:00.000Z"),
            endDate: new Date("2026-09-29T00:00:00.000Z"),
            plannedSessions: null,
        });

        expect((await contextService(record, branchHolidayCalendar("2026-09-14")).getContext(context)).totalSessions)
            .toBe(15);
    });

    it("upsertSession still saves session 15 after the branch adds a holiday inside the period", async () => {
        const record = createRecord({
            requiredSessionCount: 15,
            startDate: new Date("2026-09-07T00:00:00.000Z"),
            endDate: new Date("2026-09-29T00:00:00.000Z"),
            plannedSessions: null,
        });
        const harness = createHarness({
            existing: null,
            transactionRecord: record,
            holidayCalendar: branchHolidayCalendar("2026-09-14"),
        });
        // All 14 earlier sessions are submitted; session 15 has no row yet.
        harness.transactionClient.service_record_day.findMany.mockResolvedValue(Array.from({ length: 14 }, (_, index) => createDay({
            caseSessionIndex: index + 1, sessionIndex: index + 1, serviceDate: new Date("2026-09-28T00:00:00.000Z"),
        })));
        harness.transactionClient.service_record_day.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(createDay({ caseSessionIndex: 14, sessionIndex: 14, serviceDate: new Date("2026-09-28T00:00:00.000Z") }));

        await expect(harness.service.upsertSession(
            context,
            15,
            createDto({ serviceDate: "2026-09-29T00:00:00.000Z" }),
            false,
        )).resolves.toEqual(expect.objectContaining({ sessionIndex: 15 }));
        expect(harness.upsert).toHaveBeenCalled();
    });

    it("getContext remains available after a branch holiday is added", async () => {
        const record = createRecord({ plannedSessions: plannedThroughJuly6 });

        await expect(contextService(record, createHolidayCalendarStub()).getContext(context)).resolves.toBeDefined();
        const result = await contextService(record, branchHolidayCalendar("2026-07-06")).getContext(context);
        expect(result).not.toHaveProperty("plannedSessionDates");
    });

    it("upsertSession preserves the existing vector after a branch holiday is added", async () => {
        const record = createRecord({ plannedSessions: plannedThroughJuly6 });
        const harness = createHarness({
            existing: null,
            transactionRecord: record,
            holidayCalendar: branchHolidayCalendar("2026-07-06"),
        });

        await expect(harness.service.upsertSession(context, 1, createDto(), false))
            .resolves.toEqual(expect.objectContaining({ sessionIndex: 1 }));
        expect(harness.upsert).toHaveBeenCalled();
    });
});

describe("ServiceRecordEntryService client service days", () => {
    const saturdayOnly = { allowSaturdayService: true, allowSundayService: false, allowHolidayService: false };
    const weekdayOnly = { allowSaturdayService: false, allowSundayService: false, allowHolidayService: false };

    function contextServiceFor(record: ReturnType<typeof createRecord>, clientFlags: Record<string, unknown>) {
        const prisma = createContextPrisma(record);
        prisma.employee_schedule.findUnique.mockResolvedValue({
            client: { id: 100, name: "고객", ...clientFlags },
            primaryEmployee: { id: 20, name: "제공자" },
        });
        return new ServiceRecordEntryService(
            prisma as unknown as PrismaService,
            {} as ServiceRecordTokenService,
            {} as ServiceRecordLifecycleService,
            createHolidayCalendarStub(),
        );
    }

    // A legacy case with no stored N and no planned vector: 2026-12-14..2026-12-24
    // holds nine weekdays, ten when Saturday 12-19 is a service day.
    const legacyRecord = () => createRecord({
        requiredSessionCount: null,
        startDate: new Date("2026-12-14T00:00:00.000Z"),
        endDate: new Date("2026-12-24T00:00:00.000Z"),
        plannedSessions: null,
    });

    it("getContext derives a legacy N on a Saturday-enabled client's service days and reports serviceDays", async () => {
        const result = await contextServiceFor(legacyRecord(), saturdayOnly).getContext(context);

        expect(result.totalSessions).toBe(10);
        expect(result.serviceDays).toEqual({ saturday: true, sunday: false, holiday: false });
    });

    it("getContext derives the same legacy N on weekdays only for a default client", async () => {
        const result = await contextServiceFor(legacyRecord(), weekdayOnly).getContext(context);

        expect(result.totalSessions).toBe(9);
        expect(result.serviceDays).toEqual({ saturday: false, sunday: false, holiday: false });
    });

    it("getContext reports false for service-day flags the client row does not carry", async () => {
        const result = await contextServiceFor(legacyRecord(), { allowSundayService: null }).getContext(context);

        expect(result.totalSessions).toBe(9);
        expect(result.serviceDays).toEqual({ saturday: false, sunday: false, holiday: false });
    });

});

describe("caregiver access token re-check inside the write transaction", () => {
    const ownedSchedule = {
        id: 10,
        clientId: 100,
        branchId: BRANCH_ID,
        primaryEmployeeId: 20,
        secondaryEmployeeId: null,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-31T00:00:00.000Z"),
        replaced: false,
        primaryEmployee: { name: "제공자" },
    };
    const headerDto = {
        momName: "산모",
        momBirth: "900101",
        babyName: "아기",
        babyBirth: "260701",
        deliveryType: "자연분만",
        babyWeight: "3.2",
    };
    const unusableTokens: Array<[string, Record<string, unknown> | null]> = [
        ["revoked", { revokedAt: new Date("2026-06-02T00:00:00.000Z") }],
        ["inactive (replaced)", { active: false }],
        ["expired", { expiresAt: new Date(Date.now() - 1000) }],
        ["locked", { lockedAt: new Date("2026-06-02T00:00:00.000Z") }],
        ["unverified", { verifiedAt: null }],
        ["over the failed-attempt limit", { failedAttempts: 5 }],
        ["reassigned to another schedule", { scheduleId: 11 }],
        ["reassigned to another employee", { employeeId: 21 }],
        ["deleted", null],
    ];

    function expectGuardRefusal(promise: Promise<unknown>) {
        return expect(promise).rejects.toMatchObject({
            status: 401,
            response: { code: "AUTH_REQUIRED" },
        });
    }

    function expectNoUpsertWrites(h: ReturnType<typeof createHarness>) {
        expect(h.upsert).not.toHaveBeenCalled();
        expect(h.updateMany).not.toHaveBeenCalled();
        expect(h.editLogCreate).not.toHaveBeenCalled();
        expect(h.lifecycle.recompute).not.toHaveBeenCalled();
        expect(h.scheduleUpdate).not.toHaveBeenCalled();
        expect(h.clientUpdate).not.toHaveBeenCalled();
    }

    describe("upsertSession", () => {
        it.each(unusableTokens)("refuses a submit with a %s token and writes nothing", async (_name, token) => {
            const h = createHarness({ schedule: ownedSchedule, token: token === null ? null : token });

            await expectGuardRefusal(h.service.upsertSession(context, 1, createDto(), true));
            expectNoUpsertWrites(h);
        });

        it("refuses a draft save with a revoked token and writes nothing", async () => {
            const h = createHarness({ schedule: ownedSchedule, token: { revokedAt: new Date() } });

            await expectGuardRefusal(h.service.upsertSession(context, 1, createDto(), false));
            expectNoUpsertWrites(h);
        });

        it("refuses an edit of a locked session with a revoked token and writes nothing", async () => {
            const h = createHarness({
                schedule: ownedSchedule,
                existing: createDay(),
                token: { revokedAt: new Date() },
            });

            await expectGuardRefusal(h.service.upsertSession(context, 1, createDto({ notes: "수정됨" }), true));
            expectNoUpsertWrites(h);
        });

        it("locks the token row FOR UPDATE after the write-set locks and before any write", async () => {
            const h = createHarness({ schedule: ownedSchedule });

            await h.service.upsertSession(context, 1, createDto(), true);

            const forUpdateTables = h.transactionClient.$queryRaw.mock.calls
                .map(([query]) => (query as { strings?: string[] }).strings?.join(" ").toLowerCase() ?? "")
                .filter((query) => query.includes("for update"))
                .map((query) => query.match(/from\s+"?([a-z_]+)"?/)?.[1] ?? "unknown");
            expect(forUpdateTables[forUpdateTables.length - 1]).toBe("service_record_token");
            expect(forUpdateTables.indexOf("service_record_token")).toBeGreaterThan(
                forUpdateTables.indexOf("service_record_day"),
            );
            expect(forUpdateTables.filter((table) => table === "service_record_token")).toHaveLength(1);

            const tokenLockIndex = h.transactionClient.$queryRaw.mock.calls.findIndex(([query]) =>
                ((query as { strings?: string[] }).strings?.join(" ").toLowerCase() ?? "").includes("service_record_token"));
            const tokenLockOrder = h.transactionClient.$queryRaw.mock.invocationCallOrder[tokenLockIndex] ?? 0;
            const tokenLockValues = (h.transactionClient.$queryRaw.mock.calls[tokenLockIndex][0] as { values?: unknown[] }).values;
            expect(tokenLockValues).toEqual([context.tokenId]);
            expect(h.transactionClient.service_record_token.findUnique.mock.invocationCallOrder[0] ?? 0)
                .toBeGreaterThan(tokenLockOrder);
            expect(h.upsert.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(tokenLockOrder);
        });

        it("still accepts a submit with a valid token", async () => {
            const h = createHarness({ schedule: ownedSchedule });

            await expect(h.service.upsertSession(context, 1, createDto(), true)).resolves.toEqual(
                expect.objectContaining({ sessionIndex: 1, locked: true }),
            );
            expect(h.transactionClient.service_record_token.findUnique).toHaveBeenCalledWith({
                where: { id: context.tokenId },
            });
        });
    });

    describe("saveHeader", () => {
        function createHeaderHarness(token: Record<string, unknown> | null) {
            const aggregate = createRecord();
            const lockOrder: string[] = [];
            const transaction = {
                $queryRaw: jest.fn(async (query: { strings?: string[] }) => {
                    const sql = query.strings?.join(" ").toLowerCase() ?? "";
                    lockOrder.push(sql.match(/from\s+"?([a-z_]+)"?/)?.[1] ?? "unknown");
                    return [{ id: CASE_ID }];
                }),
                service_record_token: {
                    findUnique: jest.fn().mockResolvedValue(token === null ? null : createToken(token)),
                },
                employee_schedule: {
                    findUnique: jest.fn().mockResolvedValue(null),
                },
                service_record_case: {
                    findUnique: jest.fn().mockResolvedValue(aggregate),
                    update: jest.fn().mockResolvedValue(aggregate),
                },
                service_record_day: {
                    count: jest.fn().mockResolvedValue(0),
                },
                service_record: {
                    upsert: jest.fn().mockResolvedValue({ ...aggregate, scheduleId: context.scheduleId }),
                },
            };
            const prisma = {
                service_record_case: { findFirst: jest.fn().mockResolvedValue(aggregate) },
                service_record_day: { count: jest.fn().mockResolvedValue(0) },
                $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
            };
            const lifecycle = { recompute: jest.fn().mockResolvedValue(aggregate) };
            const service = new ServiceRecordEntryService(
                prisma as unknown as PrismaService,
                { lockAccessTokenForWrite } as unknown as ServiceRecordTokenService,
                lifecycle as unknown as ServiceRecordLifecycleService,
                createHolidayCalendarStub(),
            );
            return { service, transaction, lifecycle, lockOrder };
        }

        it.each(unusableTokens)("refuses a header save with a %s token and writes nothing", async (_name, token) => {
            const h = createHeaderHarness(token);

            await expectGuardRefusal(h.service.saveHeader(context, headerDto));
            expect(h.transaction.service_record_case.update).not.toHaveBeenCalled();
            expect(h.transaction.service_record.upsert).not.toHaveBeenCalled();
            expect(h.lifecycle.recompute).not.toHaveBeenCalled();
        });

        it("locks the token after the case lock and still saves with a valid token", async () => {
            const h = createHeaderHarness({});

            await h.service.saveHeader(context, headerDto);

            expect(h.lockOrder).toEqual(["service_record_case", "service_record_token"]);
            expect(h.transaction.service_record.upsert).toHaveBeenCalled();
        });
    });

    describe("finalize", () => {
        function createFinalizeHarness(token: Record<string, unknown> | null) {
            const aggregate = createRecord();
            const transaction = {
                $queryRaw: jest.fn().mockResolvedValue([{ id: context.tokenId }]),
                service_record_token: {
                    findUnique: jest.fn().mockResolvedValue(token === null ? null : createToken(token)),
                },
            };
            const prisma = {
                service_record_case: { findFirst: jest.fn().mockResolvedValue(aggregate) },
                eformsign_doc: { findMany: jest.fn().mockResolvedValue([]) },
                $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
            };
            const lifecycle = { recompute: jest.fn().mockResolvedValue(aggregate) };
            const service = new ServiceRecordEntryService(
                prisma as unknown as PrismaService,
                { lockAccessTokenForWrite } as unknown as ServiceRecordTokenService,
                lifecycle as unknown as ServiceRecordLifecycleService,
                createHolidayCalendarStub(),
            );
            return { service, transaction, lifecycle };
        }

        it.each(unusableTokens)("refuses finalize with a %s token before recompute", async (_name, token) => {
            const h = createFinalizeHarness(token);

            await expectGuardRefusal(h.service.finalize(context));
            expect(h.lifecycle.recompute).not.toHaveBeenCalled();
        });

        it("locks the token row and still finalizes with a valid token", async () => {
            const h = createFinalizeHarness({});

            await expect(h.service.finalize(context)).resolves.toEqual(
                expect.objectContaining({ status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS, chunkCount: 0 }),
            );
            expect(h.transaction.$queryRaw).toHaveBeenCalledTimes(1);
            expect(h.lifecycle.recompute).toHaveBeenCalledWith(CASE_ID);
        });
    });
});

describe("ServiceRecordEntryService.linkStatus", () => {
    function createLinkStatusService(resolved: object | null, exists: boolean) {
        const tokenService = {
            resolveLink: jest.fn().mockResolvedValue(resolved),
            linkTokenExists: jest.fn().mockResolvedValue(exists),
        };
        const service = new ServiceRecordEntryService(
            {} as PrismaService,
            tokenService as unknown as ServiceRecordTokenService,
            {} as ServiceRecordLifecycleService,
            createHolidayCalendarStub(),
        );
        return { service, tokenService };
    }

    it("reports a usable link as valid without an existence lookup", async () => {
        const { service, tokenService } = createLinkStatusService(createToken(), true);

        await expect(service.linkStatus("efl_token")).resolves.toEqual({ valid: true });
        expect(tokenService.linkTokenExists).not.toHaveBeenCalled();
    });

    it("reports not_found when no token row exists for the link", async () => {
        const { service, tokenService } = createLinkStatusService(null, false);

        await expect(service.linkStatus("efl_missing")).resolves.toEqual({ valid: false, reason: "not_found" });
        expect(tokenService.linkTokenExists).toHaveBeenCalledWith("efl_missing");
    });

    it("reports unavailable when the row exists but resolveLink rejects it", async () => {
        const { service } = createLinkStatusService(null, true);

        await expect(service.linkStatus("efl_expired")).resolves.toEqual({ valid: false, reason: "unavailable" });
    });
});

function caregiverVector(dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06", "2026-07-07"]) {
    return dates.map((serviceDate, index) => ({
        sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
        assignmentId: `assignment-${index}`, scheduleId: 10, employeeId: 20, provenanceVersion: "revision-1",
        extra: "preserved",
    }));
}
const forwardDetail = "뒷 회차보다 늦게 바꿀 수 없어요. 뒷 회차를 먼저 변경해 주세요.";
const gapDetail = "사이에 아직 안 쓴 회차가 있어요. 그 회차의 날짜를 남겨 주세요.";
const backwardDetail = "앞 회차보다 이르게 바꿀 수 없어요. 앞 회차를 먼저 변경해 주세요.";
function expectDateFailure(promise: Promise<unknown>, detail: string, serviceDateReason: string) {
    return expect(promise).rejects.toMatchObject({
        status: 400,
        response: {
            code: "VALIDATION_FAILED",
            errors: [{ pointer: "/serviceDate", code: "INVALID_VALUE", detail, location: "body" }],
            serviceDateReason,
        },
    });
}

describe("caregiver-selected service dates", () => {
    const gapRecord = () => createRecord({
        startDate: new Date("2026-11-02"), endDate: new Date("2026-11-06"), requiredSessionCount: 5,
        plannedSessions: caregiverVector(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]),
    });
    const gapDays = () => [
        createDay({ serviceDate: new Date("2026-11-02") }),
        createDay({ caseSessionIndex: 4, sessionIndex: 4, serviceDate: new Date("2026-11-05") }),
    ];

    it.each([false, true])("refuses a date leaving no room for session 2 without writes (submit=%s)", async (lock) => {
        const h = createHarness({ days: gapDays(), transactionRecord: gapRecord() });
        await expectDateFailure(h.service.upsertSession(context, 3, createDto({ serviceDate: "2026-11-03" }), lock), gapDetail, "NO_ROOM_FOR_GAP");
        expect(h.upsert).not.toHaveBeenCalled();
        expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
        expect(h.lifecycle.recompute).not.toHaveBeenCalled();
    });

    it.each([false, true])("accepts a date leaving room for session 2 (submit=%s)", async (lock) => {
        const h = createHarness({ days: gapDays(), transactionRecord: gapRecord() });
        await expect(h.service.upsertSession(context, 3, createDto({ serviceDate: "2026-11-04" }), lock)).resolves.toBeDefined();
        expect(h.upsert).toHaveBeenCalledTimes(1);
    });

    it("keeps an unchanged locked date editable even when an empty session has no room", async () => {
        const existing = createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-11-03") });
        const h = createHarness({ existing, days: [gapDays()[0]!], transactionRecord: gapRecord() });
        await expect(h.service.upsertSession(context, 3, createDto({ serviceDate: "2026-11-03", notes: "내용만 수정" }), true)).resolves.toBeDefined();
        expect(h.upsert).toHaveBeenCalledTimes(1);
        expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
    });

    it.each([false, true])("enforces inclusive calendar-day window edges (submit=%s)", async (lock) => {
        for (const [date, accepted] of [["2026-06-23", false], ["2026-06-24", true], ["2026-08-07", true], ["2026-08-08", false]] as const) {
            const h = createHarness();
            const action = h.service.upsertSession(context, 1, createDto({ serviceDate: date }), lock);
            if (accepted) await expect(action).resolves.toBeDefined();
            else {
                await expectDateFailure(action, "고를 수 있는 기간이 아니에요.", "OUT_OF_RANGE");
                expect(h.upsert).not.toHaveBeenCalled();
            }
            expect(h.scheduleUpdate).not.toHaveBeenCalled();
            expect(h.clientUpdate).not.toHaveBeenCalled();
            expect(h.lifecycle.ensureForClient).not.toHaveBeenCalled();
            expect(h.tokenService.extendExpiryForCase).not.toHaveBeenCalled();
            expect(h.reviewItemFindFirst).not.toHaveBeenCalled();
        }
    });

    it.each(["startDate", "endDate"] as const)("treats null %s as unbounded", async (side) => {
        const holidayCalendar = createHolidayCalendarStub();
        const h = createHarness({ transactionRecord: createRecord({ [side]: null }), holidayCalendar });
        await expect(h.service.upsertSession(context, 1, createDto({
            serviceDate: side === "startDate" ? "2026-06-01" : "2026-09-01",
        }), false)).resolves.toBeDefined();
        expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
    });

    it.each([
        ["2026-07-04", false, false], ["2026-07-04", true, true],
        ["2026-07-05", false, false], ["2026-07-05", true, true],
    ])("checks weekend service flags for %s (allowed=%s)", async (date, allowed, accepted) => {
        const h = createHarness({ schedule: {
            id: 10, clientId: 100, branchId: BRANCH_ID, primaryEmployeeId: 20,
            primaryEmployee: { name: "제공자" },
            client: { allowSaturdayService: allowed, allowSundayService: allowed, allowHolidayService: false },
        } });
        const action = h.service.upsertSession(context, 1, createDto({ serviceDate: date as string }), false);
        if (accepted) await expect(action).resolves.toBeDefined();
        else await expectDateFailure(action, "서비스를 하지 않는 날이에요.", "NOT_SERVICE_DAY");
    });

    it("refuses a holiday when holiday service is off", async () => {
        const holidayCalendar = branchHolidayCalendar("2026-07-02");
        const h = createHarness({ holidayCalendar });
        await expectDateFailure(h.service.upsertSession(context, 1, createDto({ serviceDate: "2026-07-02" }), false), "서비스를 하지 않는 날이에요.", "NOT_SERVICE_DAY");
        expect(holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it("returns 400 for a year without holiday data", async () => {
        const h = createHarness({ transactionRecord: createRecord({ startDate: null, endDate: null }) });
        await expectDateFailure(h.service.upsertSession(context, 1, createDto({ serviceDate: "2099-07-01" }), false), "서비스를 하지 않는 날이에요.", "NOT_SERVICE_DAY");
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it.each([
        ["2026-07-01", backwardDetail, "BEFORE_PREVIOUS"], ["2026-06-30", backwardDetail, "BEFORE_PREVIOUS"],
        ["2026-07-06", forwardDetail, "AFTER_NEXT"], ["2026-07-07", forwardDetail, "AFTER_NEXT"],
    ])("refuses out-of-order date %s with the exact field error", async (date, detail, serviceDateReason) => {
        const h = createHarness({ days: [
            createDay(), createDay({ caseSessionIndex: 3, serviceDate: new Date("2026-07-06") , locked: false }),
        ] });
        await expectDateFailure(h.service.upsertSession(context, 2, createDto({ serviceDate: date }), false), detail, serviceDateReason);
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it("keeps an unchanged-date content edit working after calendar and period changes", async () => {
        const existing = createDay({ serviceDate: new Date("2026-07-04") });
        const h = createHarness({ existing, transactionRecord: createRecord({
            startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31"), plannedSessions: caregiverVector(),
        }), holidayCalendar: branchHolidayCalendar("2026-07-04") });
        await h.service.upsertSession(context, 1, createDto({ serviceDate: "2026-07-04", notes: "수정" }), true);
        expect(h.upsert).toHaveBeenCalledTimes(1);
        expect(h.transactionClient.service_record_day.findMany).not.toHaveBeenCalled();
        expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
    });

    it("changes a locked session's date, preserves its author, logs the date and pushes unwritten slots", async () => {
        const plannedSessions = caregiverVector();
        const existing = createDay({ employeeId: 99, employeeNameSnapshot: "최초 제공자" });
        const h = createHarness({ existing, transactionRecord: createRecord({ plannedSessions }) });
        await h.service.upsertSession(context, 1, createDto({ serviceDate: "2026-07-03" }), true);
        expect(h.upsert.mock.calls[0][0].update).toMatchObject({ serviceDate: new Date("2026-07-03"), employeeId: 99, employeeNameSnapshot: "최초 제공자" });
        expect(h.editLogCreate.mock.calls[0][0].data).toMatchObject({
            before: { serviceDate: "2026-07-01" }, after: { serviceDate: "2026-07-03" },
        });
        const write = h.transactionClient.service_record_case.update.mock.calls[0]![0];
        expect(write).toMatchObject({ where: { id: CASE_ID, branchId: BRANCH_ID }, data: { version: { increment: 1 } } });
        expect(write.data.plannedSessions.map((e: { serviceDate: string }) => e.serviceDate)).toEqual(["2026-07-03", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]);
        expect(write.data.plannedSessions[0]).toMatchObject({ originalDate: "2026-07-01", extra: "preserved" });
        expect(h.transactionClient.service_record_case.update.mock.invocationCallOrder[0]).toBeLessThan(h.lifecycle.recompute.mock.invocationCallOrder[0]!);
    });

    it("edits locked session 3 after session 2 was deleted and pulls earlier unwritten entries back", async () => {
        const existing = createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") });
        const h = createHarness({ existing, transactionRecord: createRecord({ plannedSessions: caregiverVector() }) });
        h.transactionClient.service_record_day.findUnique.mockImplementation(({ where }) =>
            Promise.resolve(where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex === 3 ? existing : null));
        await h.service.upsertSession(context, 3, createDto({ serviceDate: "2026-07-01" }), true);
        expect(h.transactionClient.service_record_case.update.mock.calls[0]![0].data.plannedSessions.map((e: { serviceDate: string }) => e.serviceDate)).toEqual(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-06", "2026-07-07"]);
        expect(h.upsert).toHaveBeenCalledTimes(1);
        expect(h.editLogCreate).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("accepts new session 4 when session 1 was deleted but 2 and 3 are submitted (submit=%s)", async (lock) => {
        const h = createHarness({ days: [
            createDay({ caseSessionIndex: 2, sessionIndex: 2, serviceDate: new Date("2026-07-02") }),
            createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") }),
        ] });

        await expect(h.service.upsertSession(context, 4, createDto({ serviceDate: "2026-07-06" }), lock)).resolves.toBeDefined();

        expect(h.upsert).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("accepts new session 4 when all earlier sessions are submitted (submit=%s)", async (lock) => {
        const h = createHarness({ days: [
            createDay(),
            createDay({ caseSessionIndex: 2, sessionIndex: 2, serviceDate: new Date("2026-07-02") }),
            createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") }),
        ] });

        await expect(h.service.upsertSession(context, 4, createDto({ serviceDate: "2026-07-06" }), lock)).resolves.toBeDefined();

        expect(h.upsert).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("accepts new session 1 when later sessions are already submitted (submit=%s)", async (lock) => {
        const h = createHarness({ days: [
            createDay({ caseSessionIndex: 2, sessionIndex: 2, serviceDate: new Date("2026-07-02") }),
            createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") }),
        ] });

        await expect(h.service.upsertSession(context, 1, createDto(), lock)).resolves.toBeDefined();

        expect(h.upsert).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("accepts new session 2 between submitted sessions 1 and 3 after a delete (submit=%s)", async (lock) => {
        const h = createHarness({ days: [
            createDay(),
            createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") }),
        ] });

        await expect(h.service.upsertSession(context, 2, createDto({ serviceDate: "2026-07-02" }), lock)).resolves.toBeDefined();

        expect(h.upsert).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("counts an unsubmitted draft as not submitted for a new write (submit=%s)", async (lock) => {
        const h = createHarness({ days: [
            createDay(),
            createDay({ caseSessionIndex: 2, sessionIndex: 2, serviceDate: new Date("2026-07-02"), locked: false }),
        ] });

        await expectException(h.service.upsertSession(context, 3, createDto({ serviceDate: "2026-07-03" }), lock), ConflictException, "REQUEST_CONFLICT");

        expect(h.upsert).not.toHaveBeenCalled();
    });

    it.each([4, 5])("re-saves an unsubmitted draft only through the next session (day=%s)", async (sessionIndex) => {
        const serviceDate = sessionIndex === 4 ? "2026-07-06" : "2026-07-07";
        const h = createHarness({ existing: createDay({ caseSessionIndex: sessionIndex, sessionIndex,
            serviceDate: new Date(serviceDate), locked: false }), days: [
            createDay({ caseSessionIndex: 2, sessionIndex: 2, serviceDate: new Date("2026-07-02") }),
            createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") }),
        ] });

        const write = h.service.upsertSession(context, sessionIndex, createDto({ serviceDate }), false);
        if (sessionIndex === 4) {
            await expect(write).resolves.toBeDefined();
            expect(h.upsert).toHaveBeenCalledTimes(1);
        } else {
            await expectException(write, ConflictException, "REQUEST_CONFLICT");
            expect(h.upsert).not.toHaveBeenCalled();
        }
    });

    describe.each([
        { submitted: [2, 3], open: [1, 4], refused: [5] },
        { submitted: [3], open: [1, 2, 4], refused: [5] },
        { submitted: [1, 2, 3], open: [4], refused: [5] },
        { submitted: [2], open: [1, 3], refused: [4] },
        { submitted: [2, 4], open: [1, 3, 5], refused: [] },
        { submitted: [], open: [1], refused: [2] },
    ])("every gap plus next with submitted $submitted", ({ submitted, open, refused }) => {
        const dates: Record<number, string> = { 1: "2026-07-01", 2: "2026-07-02", 3: "2026-07-03", 4: "2026-07-06", 5: "2026-07-07" };
        it.each([false, true])("accepts each open session and refuses later sessions (submit=%s)", async (lock) => {
            for (const sessionIndex of [...open, ...refused]) {
                const h = createHarness({ days: submitted.map((index) => createDay({
                    caseSessionIndex: index, sessionIndex: index, serviceDate: new Date(dates[index] ?? ""),
                })) });
                const write = h.service.upsertSession(context, sessionIndex, createDto({ serviceDate: dates[sessionIndex] ?? "" }), lock);
                if (open.includes(sessionIndex)) {
                    await expect(write).resolves.toBeDefined();
                    expect(h.upsert).toHaveBeenCalledTimes(1);
                } else {
                    await expectException(write, ConflictException, "REQUEST_CONFLICT");
                    expect(h.upsert).not.toHaveBeenCalled();
                }
            }
        });
    });

    it("returns TAKEN when a non-monotonic earlier session already uses the selected date", async () => {
        const h = createHarness({ days: [
            createDay({ serviceDate: new Date("2026-07-06") }),
            createDay({ caseSessionIndex: 2, sessionIndex: 2, serviceDate: new Date("2026-07-02") }),
        ] });

        await expectDateFailure(h.service.upsertSession(context, 3, createDto({ serviceDate: "2026-07-06" }), false), "다른 회차가 이미 고른 날이에요.", "TAKEN");

        expect(h.upsert).not.toHaveBeenCalled();
    });

    it.each([null, { invalid: true }])("leaves absent or invalid legacy vector untouched: %j", async (plannedSessions) => {
        const h = createHarness({ transactionRecord: createRecord({ plannedSessions }) });
        await h.service.upsertSession(context, 1, createDto({ serviceDate: "2026-07-02" }), false);
        expect(h.upsert).toHaveBeenCalled();
        expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
    });

    it.each([true, false])("keeps the case version unchanged on content-only edits with the real lifecycle (locked=%s)", async (locked) => {
        const existing = createDay({ locked });
        const record = createRecord({
            version: 7, days: [existing], assignments: [{ schedule: { replaced: false } }],
            plannedSessions: caregiverVector(),
        });
        const h = createHarness({ existing, transactionRecord: record });
        let persistedVersion = 7;
        h.transactionClient.service_record_case.update.mockImplementation(({ data }) => {
            persistedVersion += data.version?.increment ?? 0;
            return Promise.resolve({ ...record, ...data, version: persistedVersion });
        });
        const lifecycle = new ServiceRecordLifecycleService(h.prisma as unknown as PrismaService, createHolidayCalendarStub());
        h.lifecycle.recompute.mockImplementation((id, tx, calendar, options) => lifecycle.recompute(id, tx, calendar, options));
        await h.service.upsertSession(context, 1, createDto({ notes: "내용만 수정" }), locked);
        expect(h.upsert).toHaveBeenCalled();
        expect(h.transactionClient.service_record_case.update).toHaveBeenCalledTimes(1);
        expect(h.transactionClient.service_record_case.update.mock.calls[0]![0].data).not.toHaveProperty("version");
        expect(persistedVersion).toBe(7);
    });

    it("increments the lifecycle version when an existing draft becomes submitted", async () => {
        const h = createHarness({ existing: createDay({ locked: false }) });
        await h.service.upsertSession(context, 1, createDto(), true);
        expect(h.lifecycle.recompute).toHaveBeenCalledWith(CASE_ID, h.transactionClient, expect.anything(), { preserveVersion: false });
    });

    it("writes an aligned vector for a draft and does not bump version for a content-only draft edit", async () => {
        const h = createHarness({ transactionRecord: createRecord({ plannedSessions: caregiverVector() }) });
        await h.service.upsertSession(context, 1, createDto({ serviceDate: "2026-07-02" }), false);
        expect(h.transactionClient.service_record_case.update).toHaveBeenCalledTimes(1);
        const existing = createDay({ locked: false });
        const edit = createHarness({ existing, transactionRecord: createRecord({ plannedSessions: caregiverVector() }) });
        await edit.service.upsertSession(context, 1, createDto({ notes: "내용" }), false);
        expect(edit.transactionClient.service_record_case.update).not.toHaveBeenCalled();
    });

    it.each([false, true])("does not write the vector or increment its version for a new session on its planned date (submit=%s)", async (lock) => {
        const plannedSessions = caregiverVector();
        const previous = createDay();
        const h = createHarness({
            days: [previous],
            transactionRecord: createRecord({ plannedSessions, version: 7 }),
        });
        h.transactionClient.service_record_day.findUnique.mockImplementation(({ where }) =>
            Promise.resolve(where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex === 1 ? previous : null));

        await h.service.upsertSession(context, 2, createDto({ serviceDate: plannedSessions[1]!.serviceDate }), lock);

        expect(h.upsert).toHaveBeenCalledTimes(1);
        expect(h.upsert.mock.calls[0][0].create).toMatchObject({
            caseSessionIndex: 2, serviceDate: new Date(plannedSessions[1]!.serviceDate), locked: lock,
        });
        expect(h.transactionClient.service_record_day.findMany).toHaveBeenCalledTimes(2);
        expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
        expect(h.lifecycle.recompute).toHaveBeenCalledTimes(1);
    });

    it.each([[3, "2026-07-06", gapDetail, "NO_ROOM_FOR_GAP"], [5, "2026-07-06", gapDetail, "NO_ROOM_FOR_GAP"]] as const)(
        "refuses gap collision moving session %s with nothing written", async (index, date, detail, serviceDateReason) => {
            const days = [createDay({ caseSessionIndex: 3, sessionIndex: 3, serviceDate: new Date("2026-07-03") }), createDay({ caseSessionIndex: 5, sessionIndex: 5, serviceDate: new Date("2026-07-07") })];
            const h = createHarness({ existing: days.find((day) => day.caseSessionIndex === index), days, transactionRecord: createRecord({ plannedSessions: caregiverVector() }) });
            await expectDateFailure(h.service.upsertSession(context, index, createDto({ serviceDate: date }), true), detail, serviceDateReason);
            expect(h.upsert).not.toHaveBeenCalled();
            expect(h.editLogCreate).not.toHaveBeenCalled();
            expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
            expect(h.lifecycle.recompute).not.toHaveBeenCalled();
        },
    );
});

describe("caregiver deleteSession", () => {
    it("returns 404 without writes when the transaction record belongs to another branch", async () => {
        const h = createHarness({
            existing: createDay(),
            transactionRecord: createRecord({ branchId: "another-branch" }),
        });

        await expect(h.service.deleteSession(context, 1)).rejects.toMatchObject({
            status: 404, response: { code: "RESOURCE_NOT_FOUND" },
        });

        expect(h.transactionClient.service_record_day_archive.create).not.toHaveBeenCalled();
        expect(h.transactionClient.service_record_day.delete).not.toHaveBeenCalled();
    });

    it("locks the deleted session index in the real write-set day query", async () => {
        const sessionIndex = 3;
        const h = createHarness({
            existing: createDay({ sessionIndex, caseSessionIndex: sessionIndex }),
            schedule: { id: 10, clientId: 100, primaryEmployeeId: 20, primaryEmployee: { name: "제공자" } },
        });

        await expect(h.service.deleteSession(context, sessionIndex)).resolves.toEqual({ deleted: true, sessionIndex });

        const dayLockCall = h.transactionClient.$queryRaw.mock.calls.find(([query]) => {
            const sql = (query as { strings: string[] }).strings.join(" ").toLowerCase();
            return sql.includes('"service_record_day"') && sql.includes("for update");
        });
        expect(dayLockCall).toBeDefined();
        const dayLock = dayLockCall![0] as { strings: string[]; values: unknown[] };
        expect(dayLock.strings.join(" ")).toContain('case_session_index" IN');
        expect(dayLock.values).toContain(sessionIndex);
    });

    it.each([true, false])("archives a full row before deletion and recomputes (locked=%s)", async (locked) => {
        const existing = createDay({ locked });
        const h = createHarness({ existing, schedule: { id: 10, clientId: 100, primaryEmployeeId: 20, primaryEmployee: { name: "제공자" } } });
        await expect(h.service.deleteSession(context, 1)).resolves.toEqual({ deleted: true, sessionIndex: 1 });
        const archive = h.transactionClient.service_record_day_archive.create;
        expect(archive).toHaveBeenCalledWith({ data: expect.objectContaining({
            branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, clientId: 100,
            reason: "caregiver_delete", originalDayId: existing.id, caseSessionIndex: 1,
            serviceDate: SERVICE_DATE, previousStartDate: SERVICE_DATE, newStartDate: SERVICE_DATE,
            archivedByUserId: null, batchId: expect.any(String), payload: JSON.parse(JSON.stringify(existing)),
        }) });
        expect(h.transactionClient.service_record_day.delete).toHaveBeenCalledWith({ where: { id: existing.id, branchId: BRANCH_ID } });
        expect(archive.mock.invocationCallOrder[0]).toBeLessThan(h.transactionClient.service_record_day.delete.mock.invocationCallOrder[0]!);
        expect(h.transactionClient.service_record_day.delete.mock.invocationCallOrder[0]).toBeLessThan(h.lifecycle.recompute.mock.invocationCallOrder[0]!);
        expect(h.lifecycle.recompute).toHaveBeenCalledWith(CASE_ID, h.transactionClient, expect.anything());
        expect(h.transactionClient.service_record_case.update).not.toHaveBeenCalled();
    });

    it.each(["FINALIZING", "FINALIZATION_FAILED", "DOCUMENTS_CREATED", "COMPLETED"])("refuses deletion at %s", async (status) => {
        const h = createHarness({ existing: createDay(), transactionRecord: createRecord({ status }) });
        await expectException(h.service.deleteSession(context, 1), ConflictException, "REQUEST_CONFLICT");
        expect(h.transactionClient.service_record_day_archive.create).not.toHaveBeenCalled();
        expect(h.transactionClient.service_record_day.delete).not.toHaveBeenCalled();
    });

    it.each([
        { replaced: true }, { primaryEmployeeId: 99 }, { clientId: 999 }, { branchId: "another-branch" },
    ])("refuses a changed schedule after the write lock: %j", async (change) => {
        const schedule = { id: 10, clientId: 100, branchId: BRANCH_ID, primaryEmployeeId: 20, primaryEmployee: { name: "제공자" } };
        const h = createHarness({ existing: createDay(), schedule });
        h.transactionClient.employee_schedule.findUnique.mockResolvedValueOnce(schedule).mockResolvedValueOnce({ ...schedule, ...change });
        await expectException(h.service.deleteSession(context, 1), ConflictException, "SERVICE_RECORD_WRITE_TARGET_CHANGED");
        expect(h.transactionClient.service_record_day_archive.create).not.toHaveBeenCalled();
        expect(h.transactionClient.service_record_day.delete).not.toHaveBeenCalled();
    });

    it("uses the archived service date as the new start when the case has no start date", async () => {
        const h = createHarness({ existing: createDay(), transactionRecord: createRecord({ startDate: null }) });
        await h.service.deleteSession(context, 1);
        expect(h.transactionClient.service_record_day_archive.create).toHaveBeenCalledWith({ data: expect.objectContaining({ previousStartDate: null, newStartDate: SERVICE_DATE }) });
    });

    it("returns 404 for a missing record", async () => {
        const h = createHarness();
        await expect(h.service.deleteSession(context, 1)).rejects.toMatchObject({ status: 404, response: { code: "RESOURCE_NOT_FOUND" } });
        expect(h.transactionClient.service_record_day_archive.create).not.toHaveBeenCalled();
    });

    it("rechecks token validity before deletion", async () => {
        const h = createHarness({ existing: createDay(), token: { active: false } });
        await expect(h.service.deleteSession(context, 1)).rejects.toMatchObject({ status: 401 });
        expect(h.transactionClient.service_record_day.delete).not.toHaveBeenCalled();
    });
});
