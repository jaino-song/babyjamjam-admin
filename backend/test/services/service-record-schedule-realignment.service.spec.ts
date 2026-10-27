import { ConflictException } from "@nestjs/common";
import type { Request, Response } from "express";

import { ServiceRecordScheduleRealignmentService } from "../../application/services/service-record-schedule-realignment.service";
import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "../../application/services/message-automation-intent-writer";
import { mapHttpProblem } from "../../infrastructure/filters/problem-response";
import { createKrBusinessDayCalendar, KR_BUILTIN_HOLIDAYS } from "../../domain/utils/business-days";

jest.mock("../../application/services/message-automation-intent-writer", () => ({
    persistClientMessageAutomationIntent: jest.fn().mockResolvedValue(undefined),
    persistScheduleMessageAutomationIntent: jest.fn().mockResolvedValue(undefined),
}));

const BRANCH = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = 1;
const CASE_ID = "22222222-2222-4222-8222-222222222222";
// 2026-12-16 12:00 in Korea.
const NOW = new Date("2026-12-16T03:00:00.000Z");

const branchCalendar = createKrBusinessDayCalendar(KR_BUILTIN_HOLIDAYS, { version: "realignment-spec" });

/** Mon 14 .. Fri 18, Mon 21 .. Thu 24, then the 25th is a holiday and the weekend is off: Mon 28. */
const WEEKDAY_LAYOUT = [
    "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
    "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28",
];
/** Saturday on: the 19th is a service day, so the same ten sessions end on the 24th. */
const SATURDAY_LAYOUT = [
    "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
    "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24",
];

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);

interface EntrySpec {
    scheduleId: number;
    assignmentId: string;
    employeeId: number;
}
const A: EntrySpec = { scheduleId: 11, assignmentId: "a-1", employeeId: 7 };
const B: EntrySpec = { scheduleId: 12, assignmentId: "a-2", employeeId: 8 };

function vector(dates: readonly string[], owner: (sessionIndex: number) => EntrySpec = () => A) {
    return dates.map((serviceDate, index) => ({
        sessionIndex: index + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: owner(index + 1).assignmentId,
        scheduleId: owner(index + 1).scheduleId,
        employeeId: owner(index + 1).employeeId,
        provenanceVersion: "1",
    }));
}

interface ScheduleSpec {
    id: number;
    employeeId: number;
    assignmentId: string;
    startDate: string;
    endDate: string;
    replaced?: boolean;
}

interface WorldOptions {
    flags?: { saturday?: boolean; sunday?: boolean; holiday?: boolean };
    planned?: ReturnType<typeof vector> | null;
    requiredSessionCount?: number | null;
    status?: string;
    withCase?: boolean;
    startDate?: string;
    endDate?: string;
    schedules?: ScheduleSpec[];
    days?: Array<{ index: number; date: string; locked?: boolean; submittedAt?: Date | null }>;
}

function createWorld(options: WorldOptions = {}) {
    const flags = options.flags ?? {};
    const client = {
        id: CLIENT_ID,
        branchId: BRANCH,
        startDate: date(options.startDate ?? "2026-12-14"),
        endDate: date(options.endDate ?? "2026-12-28"),
        allowSaturdayService: flags.saturday ?? false,
        allowSundayService: flags.sunday ?? false,
        allowHolidayService: flags.holiday ?? false,
    };
    const record: Record<string, unknown> = {
        id: CASE_ID,
        branchId: BRANCH,
        clientId: CLIENT_ID,
        status: options.status ?? "IN_PROGRESS",
        startDate: client.startDate,
        endDate: client.endDate,
        requiredSessionCount: options.requiredSessionCount === undefined ? 10 : options.requiredSessionCount,
        plannedSessions: options.planned === undefined ? vector(WEEKDAY_LAYOUT) : options.planned,
        version: 3,
    };
    const schedules = (options.schedules ?? [{
        id: 11, employeeId: 7, assignmentId: "a-1", startDate: "2026-12-14", endDate: "2026-12-28",
    }]).map((schedule) => ({
        id: schedule.id,
        branchId: BRANCH,
        startDate: date(schedule.startDate),
        endDate: date(schedule.endDate),
        replaced: schedule.replaced ?? false,
        terminatedAt: null,
        primaryEmployeeId: schedule.employeeId,
        secondaryEmployeeId: null,
        primaryEmployee: { name: `Employee ${schedule.employeeId}` },
        serviceRecordAssignment: {
            id: schedule.assignmentId,
            branchId: BRANCH,
            serviceRecordCaseId: CASE_ID,
            scheduleId: schedule.id,
            employeeId: schedule.employeeId,
            startDate: date(schedule.startDate),
            endDate: date(schedule.endDate),
            employeeNameSnapshot: `Employee ${schedule.employeeId}`,
        },
    }));
    const days = (options.days ?? []).map((day) => ({
        id: `day-${day.index}`,
        branchId: BRANCH,
        serviceRecordCaseId: CASE_ID,
        caseSessionIndex: day.index,
        sessionIndex: day.index,
        serviceDate: date(day.date),
        locked: day.locked ?? false,
        submittedAt: day.submittedAt ?? null,
    }));

    const apply = (target: Record<string, unknown>, data: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object" && "increment" in (value as object)) {
                target[key] = (target[key] as number) + (value as { increment: number }).increment;
            } else {
                target[key] = value;
            }
        }
    };

    const tx = {
        client: {
            findUnique: jest.fn(async () => client),
            updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                apply(client as unknown as Record<string, unknown>, data);
                return { count: 1 };
            }),
        },
        service_record_case: {
            findUnique: jest.fn(async () => (options.withCase === false ? null : record)),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                apply(record, data);
                return record;
            }),
        },
        service_record_day: {
            findMany: jest.fn(async () => [...days].sort((left, right) => left.caseSessionIndex - right.caseSessionIndex)),
            updateMany: jest.fn(async ({ where, data }: { where: { id: string; locked?: boolean }; data: Record<string, unknown> }) => {
                const row = days.find((candidate) => candidate.id === where.id && (where.locked === undefined || candidate.locked === where.locked));
                if (!row) return { count: 0 };
                apply(row as unknown as Record<string, unknown>, data);
                return { count: 1 };
            }),
        },
        employee_schedule: {
            findMany: jest.fn(async () => schedules),
            findFirst: jest.fn(async () => null as unknown),
            updateMany: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
                const row = schedules.find((candidate) => candidate.id === where.id);
                if (!row) return { count: 0 };
                apply(row as unknown as Record<string, unknown>, data);
                return { count: 1 };
            }),
        },
        service_record_assignment: {
            updateMany: jest.fn(async () => ({ count: 1 })),
        },
        service_record_token: {
            updateMany: jest.fn(async () => ({ count: 1 })),
        },
        message_trigger_rule: { upsert: jest.fn() },
        message_trigger_job: { upsert: jest.fn() },
    };
    const store = { appendScheduleWriteFence: jest.fn().mockResolvedValue(undefined) };
    const service = new ServiceRecordScheduleRealignmentService(store as never);
    const run = (extra: Partial<Parameters<ServiceRecordScheduleRealignmentService["realignForServiceDayChangeInTransaction"]>[1]> = {}) =>
        service.realignForServiceDayChangeInTransaction(tx as never, {
            branchId: BRANCH,
            clientId: CLIENT_ID,
            calendar: branchCalendar,
            now: NOW,
            ...extra,
        });
    const plannedDates = () => (record["plannedSessions"] as Array<{ serviceDate: string }>).map((entry) => entry.serviceDate);
    return { client, record, schedules, days, tx, store, service, run, plannedDates };
}

const written = (count: number, layout: readonly string[] = WEEKDAY_LAYOUT) =>
    Array.from({ length: count }, (_, index) => ({ index: index + 1, date: layout[index]!, locked: true }));

beforeEach(() => {
    jest.clearAllMocks();
});

describe("ServiceRecordScheduleRealignmentService", () => {
    describe("planned vector", () => {
        it("keeps written sessions and moves the unwritten suffix onto the new Saturday service days", async () => {
            const world = createWorld({
                flags: { saturday: true },
                days: [...written(3), { index: 7, date: "2026-12-22" }],
            });

            const result = await world.run();

            expect(result).toMatchObject({ changed: true, mode: "planned", endDate: "2026-12-24" });
            expect(world.plannedDates()).toEqual(SATURDAY_LAYOUT);
            // Sessions 1-3 untouched and nothing about them rewritten.
            expect(world.days.filter((day) => day.caseSessionIndex <= 3).map((day) => iso(day.serviceDate)))
                .toEqual(["2026-12-14", "2026-12-15", "2026-12-16"]);
            // Case + client end follow the last session.
            expect(iso(world.record["endDate"] as Date)).toBe("2026-12-24");
            expect(world.record["version"]).toBe(4);
            expect(iso(world.client.endDate)).toBe("2026-12-24");
            // The unlocked row of a re-laid index moves; sessions that did not move write nothing.
            expect(iso(world.days.find((day) => day.caseSessionIndex === 7)!.serviceDate)).toBe("2026-12-21");
            expect(world.tx.service_record_day.updateMany).toHaveBeenCalledTimes(1);
            // Only the outer end of the single caregiver moves, in both tables.
            expect(world.tx.service_record_assignment.updateMany).toHaveBeenCalledWith({
                where: { id: "a-1", branchId: BRANCH, serviceRecordCaseId: CASE_ID },
                data: { startDate: date("2026-12-14"), endDate: date("2026-12-24") },
            });
            expect(world.tx.employee_schedule.updateMany).toHaveBeenCalledWith({
                where: { id: 11, branchId: BRANCH },
                data: { startDate: date("2026-12-14"), endDate: date("2026-12-24") },
            });
            // Token expiry follows the new end date (midnight Korea after it).
            expect(world.tx.service_record_token.updateMany).toHaveBeenCalledWith({
                where: { branchId: BRANCH, serviceRecordCaseId: CASE_ID, active: true, revokedAt: null },
                data: { expiresAt: new Date("2026-12-24T15:00:00.000Z") },
            });
        });

        it("keeps each session's provenance and original date, changing only the service date", async () => {
            const world = createWorld({ flags: { saturday: true }, days: written(3) });

            await world.run();

            const stored = world.record["plannedSessions"] as Array<Record<string, unknown>>;
            const moved = stored[5]!;
            expect(moved).toMatchObject({
                sessionIndex: 6,
                serviceDate: "2026-12-19",
                originalDate: "2026-12-21",
                assignmentId: "a-1",
                scheduleId: 11,
                employeeId: 7,
                provenanceVersion: "1",
            });
        });

        it("restores the weekday layout for the unwritten suffix when Saturday is turned off again", async () => {
            const world = createWorld({
                planned: vector(SATURDAY_LAYOUT),
                endDate: "2026-12-24",
                schedules: [{ id: 11, employeeId: 7, assignmentId: "a-1", startDate: "2026-12-14", endDate: "2026-12-24" }],
                days: written(3),
            });

            const result = await world.run();

            expect(result).toMatchObject({ changed: true, endDate: "2026-12-28" });
            expect(world.plannedDates()).toEqual(WEEKDAY_LAYOUT);
            expect(iso(world.client.endDate)).toBe("2026-12-28");
        });

        it("leaves a past unwritten session where it is and re-lays only what follows it", async () => {
            // Today is Friday the 18th: session 4 (the 17th) is past, unwritten and therefore fixed.
            const world = createWorld({ flags: { saturday: true }, days: written(3) });

            await world.run({ now: new Date("2026-12-18T03:00:00.000Z") });

            expect(world.plannedDates()).toEqual(SATURDAY_LAYOUT);
            expect(world.plannedDates().slice(0, 4)).toEqual(WEEKDAY_LAYOUT.slice(0, 4));

            // And a fixed unwritten session in the middle is not pulled along when the rest moves.
            const gap = createWorld({
                flags: { saturday: true },
                planned: vector(["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28"]),
                days: [{ index: 1, date: "2026-12-14", locked: true }],
            });
            await gap.run({ now: new Date("2026-12-18T03:00:00.000Z") });
            expect(gap.plannedDates().slice(0, 4)).toEqual(["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17"]);
            expect(gap.plannedDates()[4]).toBe("2026-12-18");
            expect(gap.plannedDates()[5]).toBe("2026-12-19");
        });

        it("treats a submitted row as written even when it is not locked", async () => {
            const world = createWorld({
                flags: { saturday: true },
                days: [{ index: 1, date: "2026-12-14", locked: true }, { index: 2, date: "2026-12-15", submittedAt: new Date("2026-12-15T09:00:00Z") }],
                planned: vector(WEEKDAY_LAYOUT),
            });

            await world.run({ now: new Date("2026-12-14T03:00:00.000Z") });

            expect(world.plannedDates().slice(0, 2)).toEqual(["2026-12-14", "2026-12-15"]);
            expect(world.plannedDates()[2]).toBe("2026-12-16");
        });

        it("writes nothing when the vector is already laid on the client's service days", async () => {
            const world = createWorld({
                flags: { saturday: true },
                planned: vector(SATURDAY_LAYOUT),
                endDate: "2026-12-24",
                schedules: [{ id: 11, employeeId: 7, assignmentId: "a-1", startDate: "2026-12-14", endDate: "2026-12-24" }],
                days: written(3),
            });

            const result = await world.run();

            expect(result.changed).toBe(false);
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
            expect(world.tx.client.updateMany).not.toHaveBeenCalled();
            expect(world.tx.service_record_day.updateMany).not.toHaveBeenCalled();
            expect(world.tx.employee_schedule.updateMany).not.toHaveBeenCalled();
            expect(world.tx.service_record_token.updateMany).not.toHaveBeenCalled();
            expect(world.store.appendScheduleWriteFence).not.toHaveBeenCalled();
            expect(persistClientMessageAutomationIntent).not.toHaveBeenCalled();
        });

        it("fences every moved schedule and persists the re-evaluation intents", async () => {
            const world = createWorld({ flags: { saturday: true }, days: written(3) });

            await world.run();

            expect(world.store.appendScheduleWriteFence).toHaveBeenCalledTimes(1);
            expect(world.store.appendScheduleWriteFence).toHaveBeenCalledWith(world.tx, expect.objectContaining({
                branchId: BRANCH,
                clientId: CLIENT_ID,
                scheduleIds: [11],
            }));
            expect(persistClientMessageAutomationIntent).toHaveBeenCalledWith(world.tx, expect.objectContaining({
                branchId: BRANCH,
                clientId: CLIENT_ID,
                includePast: false,
                suppressGreeting: true,
            }));
            expect(persistScheduleMessageAutomationIntent).toHaveBeenCalledWith(world.tx, expect.objectContaining({
                branchId: BRANCH,
                clientId: CLIENT_ID,
                scheduleId: 11,
                includePast: false,
            }));
        });

        it("leaves the client end date to the caller when the same update supplied one", async () => {
            const world = createWorld({ flags: { saturday: true }, days: written(3) });

            await world.run({ callerSuppliedEndDate: true });

            expect(world.plannedDates()).toEqual(SATURDAY_LAYOUT);
            expect(world.tx.client.updateMany).not.toHaveBeenCalled();
            expect(world.tx.service_record_token.updateMany).not.toHaveBeenCalled();
            expect(world.record["endDate"]).toEqual(date("2026-12-28"));
        });

        it.each([
            ["a closed case", { status: "COMPLETED" }],
            ["a case under migration review", { status: "MIGRATION_REVIEW_REQUIRED" }],
            ["no case at all", { withCase: false }],
        ])("does nothing for %s", async (_label, options) => {
            const world = createWorld({ flags: { saturday: true }, ...options });

            const result = await world.run();

            expect(result.changed).toBe(false);
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
            expect(world.tx.client.updateMany).not.toHaveBeenCalled();
        });

        it("refuses a stored vector it cannot trust", async () => {
            const world = createWorld({ flags: { saturday: true }, planned: vector(WEEKDAY_LAYOUT).slice(0, 4) });

            await expect(world.run()).rejects.toMatchObject({
                response: expect.objectContaining({ code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE" }),
            });
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
        });
    });

    describe("two caregivers", () => {
        const handoverSchedules = (handover: string): ScheduleSpec[] => [
            { id: 11, employeeId: 7, assignmentId: "a-1", startDate: "2026-12-14", endDate: handover, replaced: true },
            { id: 12, employeeId: 8, assignmentId: "a-2", startDate: handover, endDate: "2026-12-28" },
        ];

        it("allows a handover inside the written prefix and moves only the outer edge", async () => {
            // A works the 14th-15th, B takes over on the 15th and owns sessions 3-10.
            const world = createWorld({
                flags: { saturday: true },
                planned: vector(WEEKDAY_LAYOUT, (index) => (index <= 2 ? A : B)),
                schedules: handoverSchedules("2026-12-15"),
                days: written(3),
            });

            const result = await world.run();

            expect(result).toMatchObject({ changed: true, endDate: "2026-12-24" });
            // Only the tail schedule moves; the replaced caregiver's end (the handover) stays.
            expect(world.tx.employee_schedule.updateMany).toHaveBeenCalledTimes(1);
            expect(world.tx.employee_schedule.updateMany).toHaveBeenCalledWith({
                where: { id: 12, branchId: BRANCH },
                data: { startDate: date("2026-12-15"), endDate: date("2026-12-24") },
            });
            expect(world.store.appendScheduleWriteFence).toHaveBeenCalledWith(world.tx, expect.objectContaining({ scheduleIds: [12] }));
        });

        it("rejects, and writes nothing, when the suffix would cross an inner handover", async () => {
            // A owns sessions 1-5, B owns 6-10 and starts on the 21st (session 6's date). The Saturday
            // layout puts session 6 on the 19th: before B's period.
            const world = createWorld({
                flags: { saturday: true },
                planned: vector(WEEKDAY_LAYOUT, (index) => (index <= 5 ? A : B)),
                schedules: handoverSchedules("2026-12-21"),
                days: written(3),
            });

            const error = await world.run().then(() => null, (thrown: unknown) => thrown as ConflictException);

            expect(error).toBeInstanceOf(ConflictException);
            expect(error!.getResponse()).toMatchObject({
                code: "REQUEST_CONFLICT",
                scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE",
            });
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
            expect(world.tx.client.updateMany).not.toHaveBeenCalled();
            expect(world.tx.service_record_day.updateMany).not.toHaveBeenCalled();
            expect(world.tx.employee_schedule.updateMany).not.toHaveBeenCalled();
            expect(world.store.appendScheduleWriteFence).not.toHaveBeenCalled();
        });

        it("rejects when the new last session ends before the last caregiver's period starts", async () => {
            // B owns only session 10 and starts on the 28th; the Saturday layout ends on the 24th.
            const world = createWorld({
                flags: { saturday: true },
                planned: vector(WEEKDAY_LAYOUT, (index) => (index <= 9 ? A : B)),
                schedules: handoverSchedules("2026-12-28"),
                days: written(3),
            });

            await expect(world.run()).rejects.toMatchObject({
                response: expect.objectContaining({ scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE" }),
            });
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
            expect(world.tx.employee_schedule.updateMany).not.toHaveBeenCalled();
        });

        it("keeps scheduleCode on the serialized 409 problem", async () => {
            const world = createWorld({
                flags: { saturday: true },
                planned: vector(WEEKDAY_LAYOUT, (index) => (index <= 5 ? A : B)),
                schedules: handoverSchedules("2026-12-21"),
                days: written(3),
            });
            const error = await world.run().then(() => null, (thrown: unknown) => thrown as ConflictException);

            const problem = mapHttpProblem(error, { method: "PATCH" } as Request, { locals: {} } as unknown as Response);

            expect(problem).toMatchObject({
                code: "REQUEST_CONFLICT",
                status: 409,
                scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE",
            });
        });
    });

    describe("overlap", () => {
        const saturdayTurnedOff = () => createWorld({
            flags: {},
            planned: vector(SATURDAY_LAYOUT),
            endDate: "2026-12-24",
            schedules: [{ id: 11, employeeId: 7, assignmentId: "a-1", startDate: "2026-12-14", endDate: "2026-12-24" }],
            days: written(3),
        });

        it("checks the active schedules of the client when an end moves later", async () => {
            const world = saturdayTurnedOff();

            await world.run();

            expect(world.tx.employee_schedule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    branchId: BRANCH,
                    clientId: CLIENT_ID,
                    replaced: false,
                    id: { not: 11 },
                }),
            }));
            expect(iso(world.schedules[0]!.endDate)).toBe("2026-12-28");
        });

        it("rejects, and writes nothing, when the later end lands on another active schedule", async () => {
            const world = saturdayTurnedOff();
            world.tx.employee_schedule.findFirst.mockResolvedValueOnce({
                id: 99, clientId: CLIENT_ID, primaryEmployeeId: 7, secondaryEmployeeId: null,
            });

            await expect(world.run()).rejects.toMatchObject({
                response: expect.objectContaining({ scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE" }),
            });
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
            expect(world.tx.employee_schedule.updateMany).not.toHaveBeenCalled();
            expect(world.store.appendScheduleWriteFence).not.toHaveBeenCalled();
        });

        it("skips the overlap check when the end moves earlier", async () => {
            const world = createWorld({ flags: { saturday: true }, days: written(3) });

            await world.run();

            expect(world.tx.employee_schedule.findFirst).not.toHaveBeenCalled();
        });
    });

    describe("legacy case (no planned vector)", () => {
        const legacy = (options: WorldOptions = {}) => createWorld({ planned: null, ...options });

        it("derives the end date from the projected session N, not from start + duration", async () => {
            const off = legacy({ flags: { saturday: false }, endDate: "2026-12-24" });
            const offResult = await off.run();
            expect(offResult).toMatchObject({ changed: true, mode: "legacy", endDate: "2026-12-28" });
            expect(iso(off.client.endDate)).toBe("2026-12-28");
            expect(iso(off.record["endDate"] as Date)).toBe("2026-12-28");

            const on = legacy({ flags: { saturday: true }, endDate: "2026-12-28" });
            const onResult = await on.run();
            expect(onResult).toMatchObject({ changed: true, mode: "legacy", endDate: "2026-12-24" });
            expect(iso(on.client.endDate)).toBe("2026-12-24");
        });

        it("keeps the stored session count and touches no day or schedule rows", async () => {
            const world = legacy({ flags: { saturday: true }, days: written(2) });

            const result = await world.run();

            expect(result.restoreRequiredSessionCount).toBe(10);
            expect(world.record["requiredSessionCount"]).toBe(10);
            expect(world.record["plannedSessions"]).toBeNull();
            expect(world.tx.service_record_day.updateMany).not.toHaveBeenCalled();
            expect(world.tx.employee_schedule.updateMany).not.toHaveBeenCalled();
            expect(world.tx.service_record_assignment.updateMany).not.toHaveBeenCalled();
        });

        it("chains from the written rows, so delay extensions are not rolled back", async () => {
            // Session 4 happened on the 28th (a postponement); six more sessions follow it.
            const world = legacy({
                flags: { saturday: true },
                days: [...written(3), { index: 4, date: "2026-12-28", locked: true }],
            });

            const result = await world.run();

            expect(result.endDate).toBe("2027-01-05");
            expect(iso(world.client.endDate)).toBe("2027-01-05");
        });

        it("never ends earlier than the last written row", async () => {
            // Session 5 was written late (the 31st) while an unwritten draft row 8 sits on the 22nd.
            const world = legacy({
                flags: { saturday: true },
                days: [
                    ...written(3),
                    { index: 5, date: "2026-12-31", locked: true },
                    { index: 8, date: "2026-12-22" },
                ],
            });

            const result = await world.run();

            expect(result.endDate).toBe("2026-12-31");
        });

        it("writes nothing when the end date already matches", async () => {
            const world = legacy({ flags: { saturday: true }, endDate: "2026-12-24" });

            const result = await world.run();

            expect(result.changed).toBe(false);
            expect(world.tx.client.updateMany).not.toHaveBeenCalled();
            expect(world.tx.service_record_case.update).not.toHaveBeenCalled();
        });

        it("leaves the end date alone when the same update supplied one", async () => {
            const world = legacy({ flags: { saturday: true } });

            const result = await world.run({ callerSuppliedEndDate: true });

            expect(result.changed).toBe(false);
            expect(world.tx.client.updateMany).not.toHaveBeenCalled();
        });
    });

    describe("assertCanCombineWithAssignmentChange", () => {
        it("refuses a flag change that arrives with an assignment change on a planned case", async () => {
            const world = createWorld({ flags: { saturday: true } });

            await expect(world.service.assertCanCombineWithAssignmentChange(world.tx as never, {
                branchId: BRANCH,
                clientId: CLIENT_ID,
            })).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({
                    code: "REQUEST_CONFLICT",
                    scheduleCode: "REALIGNMENT_REQUIRES_MANUAL_SCHEDULE",
                }),
            });
        });

        it.each([
            ["a legacy case", { planned: null }],
            ["a closed case", { status: "COMPLETED" }],
            ["no case", { withCase: false }],
        ])("allows the combination for %s", async (_label, options) => {
            const world = createWorld(options);

            await expect(world.service.assertCanCombineWithAssignmentChange(world.tx as never, {
                branchId: BRANCH,
                clientId: CLIENT_ID,
            })).resolves.toBeUndefined();
        });
    });
});
