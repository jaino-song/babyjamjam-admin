import { Prisma } from "@prisma/client";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { IMMUTABLE_FINALIZATION_STATUSES } from "application/services/service-record-lifecycle.service";
import { ServiceRecordPeriodMismatchService } from "application/services/service-record-period-mismatch.service";
import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "application/services/message-automation-intent-writer";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

jest.mock("application/services/message-automation-intent-writer", () => ({
    persistClientMessageAutomationIntent: jest.fn().mockResolvedValue(undefined),
    persistScheduleMessageAutomationIntent: jest.fn().mockResolvedValue(undefined),
}));

const branchId = "11111111-1111-4111-8111-111111111111";
const otherBranch = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const clientId = 42;
const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const clone = <T>(row: T): T => {
    if (row instanceof Date) return new Date(row.getTime()) as T;
    if (Array.isArray(row)) return row.map(clone) as T;
    if (row && typeof row === "object") return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clone(value)])) as T;
    return row;
};
const day = (index: number, iso: string, overrides: Record<string, unknown> = {}) => ({
    id: `day-${index}`, branchId, serviceRecordCaseId: caseId, caseSessionIndex: index as number | null,
    sessionIndex: index + 10, locked: true, serviceDate: date(iso), periodMismatchKeptAt: null as Date | null,
    scheduleId: 10, notes: "keep notes", ...overrides,
});

function world(days = [day(1, "2026-11-06")]) {
    const order: string[] = [];
    const record = {
        id: caseId, branchId, clientId, status: "IN_PROGRESS", requiredSessionCount: 5 as number | null,
        startDate: date("2026-11-09") as Date | null, endDate: date("2026-11-13") as Date | null,
        plannedSessions: null as Prisma.JsonValue | null, currentRevisionId: null,
        currentUsableRevisionId: null, currentUsableDocumentVersion: null,
    };
    const client = {
        id: clientId, branchId, startDate: date("2026-11-09"), endDate: date("2026-11-13"),
        serviceStatus: "in_progress", bookingConfirmedAt: date("2026-11-01"),
        allowSaturdayService: false, allowSundayService: false, allowHolidayService: false,
    };
    const schedules = [{
        id: 10, branchId, clientId, primaryEmployeeId: 7, secondaryEmployeeId: null,
        startDate: date("2026-11-09"), endDate: date("2026-11-13"), replaced: false, terminatedAt: null,
    }];
    const whereMatches = (where: Record<string, unknown>, row: Record<string, unknown>) =>
        Object.entries(where).every(([key, value]) => {
            if (value && typeof value === "object" && "in" in value) return (value.in as unknown[]).includes(row[key]);
            return row[key] === value;
        });
    const tx = {
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            const text = sql.strings.join("");
            const table = text.match(/FROM "([^"]+)"/)?.[1] ?? "unknown";
            order.push(`lock:${table}`);
            return [{ id: table === "service_record_case" ? caseId : clientId }];
        }),
        client: {
            findFirst: jest.fn(async ({ where }) => whereMatches(where, client) ? clone(client) : null),
            updateMany: jest.fn(async ({ data }) => { order.push("client"); Object.assign(client, data); return { count: 1 }; }),
        },
        service_record_case: {
            findFirst: jest.fn(async ({ where }) => whereMatches(where, record) ? clone(record) : null),
            findUnique: jest.fn(async () => clone(record)),
            update: jest.fn(async ({ data }) => { order.push("case"); Object.assign(record, data); return clone(record); }),
        },
        employee_schedule: {
            findMany: jest.fn(async () => clone(schedules)),
            findFirst: jest.fn().mockImplementation(async () => { order.push("overlap"); return null; }),
            updateMany: jest.fn(async ({ where, data }) => {
                order.push("schedule");
                schedules.filter((row) => whereMatches(where, row)).forEach((row) => Object.assign(row, data));
                return { count: 1 };
            }),
        },
        service_record_day: {
            findMany: jest.fn(async ({ where }) => clone(days.filter((row) => whereMatches(where, row)))),
            updateMany: jest.fn(async ({ where, data }) => {
                order.push("day");
                const matching = days.filter((row) => whereMatches(where, row));
                matching.forEach((row) => Object.assign(row, data));
                return { count: matching.length };
            }),
        },
        service_record_token: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        message_trigger_rule: { upsert: jest.fn() }, message_trigger_job: { upsert: jest.fn() },
    };
    const lifecycle = {
        ensureForClient: jest.fn(async () => {
            order.push("ensure");
            // Simulate legacy recapping; the endpoint must restore the original N.
            record.startDate = client.startDate;
            record.endDate = client.endDate;
            record.requiredSessionCount = 9;
            return clone(record);
        }),
        recompute: jest.fn().mockResolvedValue(undefined),
    };
    const fence = { appendScheduleWriteFence: jest.fn(async () => { order.push("fence"); }) };
    const service = new ServiceRecordPeriodMismatchService(lifecycle as never, fence as never);
    const params = { branchId, clientId, calendar: KR_BUILTIN_CALENDAR };
    const keep = (sessionIndexes = [1], branch = branchId) => service.keepInTransaction(tx as never, { ...params, branchId: branch, sessionIndexes });
    const fit = (branch = branchId) => service.fitInTransaction(tx as never, { ...params, branchId: branch });
    const triggers = {
        syncEmployeeAssignmentRulesForSchedule: jest.fn().mockImplementation(async () => { order.push("syncSchedule"); }),
        syncClientRulesForClient: jest.fn().mockImplementation(async () => { order.push("syncClient"); }),
    };
    const prisma = { $transaction: jest.fn(async (callback) => {
        const result = await callback(tx);
        order.push("commit");
        return result;
    }) };
    const holidayCalendar = createHolidayCalendarStub();
    const admin = new AdminServiceRecordService(prisma as never, {} as never, triggers as never, holidayCalendar, undefined, undefined, service);
    return { record, client, days, schedules, tx, service, keep, fit, order, lifecycle, fence, admin, prisma, triggers, holidayCalendar };
}

const noWrites = (w: ReturnType<typeof world>) => {
    expect(w.tx.service_record_day.updateMany).not.toHaveBeenCalled();
    expect(w.tx.client.updateMany).not.toHaveBeenCalled();
    expect(w.tx.employee_schedule.updateMany).not.toHaveBeenCalled();
    expect(w.tx.service_record_case.update).not.toHaveBeenCalled();
    expect(w.tx.service_record_token.updateMany).not.toHaveBeenCalled();
    expect(w.fence.appendScheduleWriteFence).not.toHaveBeenCalled();
    expect(w.lifecycle.ensureForClient).not.toHaveBeenCalled();
    expect(persistClientMessageAutomationIntent).not.toHaveBeenCalled();
};

describe("ServiceRecordPeriodMismatchService", () => {
    beforeEach(() => jest.clearAllMocks());

    it("keeps overview indexes, scopes the write and preserves the first timestamp on retry", async () => {
        const w = world();
        await expect(w.keep()).resolves.toEqual({ keptSessionIndexes: [1] });
        const first = w.days[0]!.periodMismatchKeptAt;
        expect(first).toBeInstanceOf(Date);
        await w.keep();
        expect(w.days[0]!.periodMismatchKeptAt).toBe(first);
        expect(w.tx.service_record_day.updateMany).toHaveBeenCalledWith({
            where: { branchId, serviceRecordCaseId: caseId, id: { in: ["day-1"] }, periodMismatchKeptAt: null },
            data: { periodMismatchKeptAt: expect.any(Date) },
        });
        expect(w.tx.client.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        day(1, "2026-11-09"), day(1, "2026-11-13"), day(1, "2026-11-01"), day(1, "2026-11-21"),
        day(1, "2026-11-06", { locked: false }), day(0, "2026-11-06"), day(6, "2026-11-06"),
    ])("rejects an ineligible day atomically: %j", async (row) => {
        const w = world([row]);
        await expect(w.keep([row.caseSessionIndex!])).rejects.toMatchObject({ response: {
            code: "VALIDATION_FAILED", errors: [expect.objectContaining({ pointer: "/sessionIndexes" })],
        } });
        noWrites(w);
    });

    it.each([[], [1, 1], [1, 2], [0], [1.5]])("validates every requested index before writing: %j", async (...indexes) => {
        const w = world();
        await expect(w.keep(indexes)).rejects.toMatchObject({ response: { code: "VALIDATION_FAILED" } });
        noWrites(w);
    });

    it("uses sessionIndex for a legacy null case index", async () => {
        const w = world([day(1, "2026-11-06", { caseSessionIndex: null, sessionIndex: 3 })]);
        await expect(w.keep([3])).resolves.toEqual({ keptSessionIndexes: [3] });
    });

    it.each(["2026-11-02", "2026-11-20"])("includes the seven-day calendar boundary: %s", async (iso) => {
        await expect(world([day(1, iso)]).keep()).resolves.toEqual({ keptSessionIndexes: [1] });
    });

    it.each(["keep", "fit"] as const)("returns 404 for another branch or missing case on %s", async (method) => {
        const w = world();
        await expect(method === "keep" ? w.keep([1], otherBranch) : w.fit(otherBranch))
            .rejects.toMatchObject({ response: { code: "RESOURCE_NOT_FOUND" } });
        w.tx.service_record_case.findFirst.mockResolvedValue(null);
        await expect(method === "keep" ? w.keep() : w.fit()).rejects.toMatchObject({ response: { code: "RESOURCE_NOT_FOUND" } });
        noWrites(w);
    });

    it.each([...IMMUTABLE_FINALIZATION_STATUSES])("refuses both writes on immutable %s cases", async (status) => {
        const w = world();
        w.record.status = status;
        await expect(w.keep()).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_FINALIZED" } });
        await expect(w.fit()).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_FINALIZED" } });
        noWrites(w);
    });

    it.each([
        [[day(1, "2026-11-06")], "2026-11-06", "2026-11-13"],
        [[day(5, "2026-11-16")], "2026-11-09", "2026-11-16"],
        [[day(1, "2026-11-06"), day(5, "2026-11-16")], "2026-11-06", "2026-11-16"],
    ] as const)("widens only the necessary boundaries without moving a session", async (rows, startDate, endDate) => {
        const w = world([...rows]);
        w.record.plannedSessions = [{ sessionIndex: 1, serviceDate: "2026-11-09" }];
        const beforeDays = clone(w.days);
        const beforePlan = clone(w.record.plannedSessions);
        await expect(w.fit()).resolves.toMatchObject({ startDate, endDate, changed: true });
        expect(w.client).toMatchObject({ startDate: date(startDate), endDate: date(endDate) });
        expect(w.record).toMatchObject({ startDate: date(startDate), endDate: date(endDate), requiredSessionCount: 5 });
        expect(w.schedules[0]).toMatchObject({ startDate: date(startDate), endDate: date(endDate) });
        expect(w.days).toEqual(beforeDays);
        expect(w.record.plannedSessions).toEqual(beforePlan);
        expect(w.tx.service_record_day.updateMany).not.toHaveBeenCalled();
        expect(w.lifecycle.recompute).toHaveBeenCalledWith(caseId, w.tx, expect.anything());
        expect(w.tx.service_record_token.updateMany).toHaveBeenCalledWith({
            where: { branchId, serviceRecordCaseId: caseId, active: true, revokedAt: null },
            data: { expiresAt: getServiceRecordTokenExpiresAt(date(endDate)) },
        });
        expect(persistClientMessageAutomationIntent).toHaveBeenCalledWith(w.tx, expect.objectContaining({ branchId, clientId }));
        expect(persistScheduleMessageAutomationIntent).toHaveBeenCalledWith(w.tx, expect.objectContaining({ branchId, clientId, scheduleId: 10 }));
    });

    it("fits unkept dates only; a farther kept date is ignored", async () => {
        const kept = date("2026-11-01");
        const w = world([day(1, "2026-11-02", { periodMismatchKeptAt: kept }), day(2, "2026-11-06")]);
        await expect(w.fit()).resolves.toMatchObject({ startDate: "2026-11-06" });
        expect(w.days[0]!.periodMismatchKeptAt).toEqual(kept);
    });

    it.each([[], [day(1, "2026-11-09")], [day(1, "2026-11-06", { periodMismatchKeptAt: date("2026-11-01") })]])
        ("performs no writes or trigger work without an unkept mismatch: %j", async (...rows) => {
            const w = world(rows);
            await expect(w.admin.fitPeriodMismatch(branchId, clientId)).resolves.toEqual({ startDate: "2026-11-09", endDate: "2026-11-13" });
            noWrites(w);
            expect(w.triggers.syncClientRulesForClient).not.toHaveBeenCalled();
        });

    it.each(["startDate", "endDate"] as const)("treats missing %s as no out-of-period sessions", async (field) => {
        const w = world(); w.record[field] = null;
        await w.fit(); noWrites(w);
        await expect(w.keep()).rejects.toMatchObject({ response: { code: "VALIDATION_FAILED" } });
    });

    it("preserves legacy N after lifecycle recapping", async () => {
        const w = world();
        await w.fit();
        expect(w.record.requiredSessionCount).toBe(5);
        expect(w.lifecycle.recompute).toHaveBeenCalledTimes(1);
    });

    it("reuses overview's derived total when legacy N is null", async () => {
        const w = world([day(5, "2026-11-16"), day(6, "2026-11-17")]);
        w.record.requiredSessionCount = null;
        await expect(w.keep([6])).rejects.toMatchObject({ response: { code: "VALIDATION_FAILED" } });
        await expect(w.fit()).resolves.toMatchObject({ endDate: "2026-11-16" });
        expect(w.record.requiredSessionCount).toBe(5);
    });

    it("keeps the replacement caregiver's later start when fitting the outgoing caregiver's early date", async () => {
        const w = world();
        w.schedules[0]!.replaced = true;
        w.schedules[0]!.endDate = date("2026-11-10");
        w.schedules.push({ ...w.schedules[0]!, id: 11, replaced: false, primaryEmployeeId: 8, startDate: date("2026-11-10"), endDate: date("2026-11-13") });
        await w.fit();
        expect(w.schedules[0]!.startDate).toEqual(date("2026-11-06"));
        expect(w.schedules[1]!.startDate).toEqual(date("2026-11-10"));
        expect(w.schedules[0]!.endDate).toEqual(date("2026-11-10"));
        expect(w.lifecycle.ensureForClient).toHaveBeenCalledWith(clientId, w.tx, expect.anything());
    });

    it("copies the shared lock, overlap, fence, writes, lifecycle order, then syncs only after commit", async () => {
        const w = world();
        await w.admin.fitPeriodMismatch(branchId, clientId);
        expect(w.order).toEqual([
            "lock:client", "lock:employee", "lock:service_record_case", "lock:employee_schedule",
            "lock:service_record_assignment", "lock:service_record_day", "overlap", "fence", "schedule", "client",
            "ensure", "case", "case", "commit", "syncSchedule", "syncClient",
        ]);
        expect(w.triggers.syncEmployeeAssignmentRulesForSchedule).toHaveBeenCalledWith(branchId, 10, true);
        expect(w.triggers.syncClientRulesForClient).toHaveBeenCalledWith(branchId, clientId, false);
        expect(w.holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
    });

    it("surfaces the existing overlap conflict before any writes or sync", async () => {
        const w = world();
        w.tx.employee_schedule.findFirst.mockResolvedValue({ id: 999 } as never);
        await expect(w.admin.fitPeriodMismatch(branchId, clientId)).rejects.toMatchObject({ response: { code: "EMPLOYEE_SCHEDULE_OVERLAP" } });
        noWrites(w);
        expect(w.triggers.syncClientRulesForClient).not.toHaveBeenCalled();
    });

    it("does not sync when a transaction fails to commit", async () => {
        const w = world();
        w.prisma.$transaction.mockRejectedValue(new Error("commit failed"));
        await expect(w.admin.fitPeriodMismatch(branchId, clientId)).rejects.toThrow("commit failed");
        expect(w.triggers.syncClientRulesForClient).not.toHaveBeenCalled();
    });

    it("opens keep in the admin transaction with a fresh branch calendar", async () => {
        const w = world();
        await expect(w.admin.keepPeriodMismatch(branchId, clientId, [1])).resolves.toEqual({ keptSessionIndexes: [1] });
        expect(w.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(w.holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });
    });
});
