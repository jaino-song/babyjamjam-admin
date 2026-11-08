import { findMissingServiceRecordAlerts } from "application/policies/missing-service-record-alert.policy";
import { resolveServiceRecordScheduleProjection } from "application/policies/service-record-edit-preview.policy";
import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";

const branchId = "branch-parity";
const threshold = new Date("2026-09-08T18:00:00+09:00");
const expectedAlert = [{
    clientId: 10, clientName: "김산모", primaryEmployeeName: "이관리", scheduleId: 55,
}];
const date = (value: string) => new Date(value);

function schedule(id = 55, startDate = "2026-09-07", endDate = "2026-09-09", replaced = false) {
    return {
        id, branchId, clientId: 10, startDate: date(startDate), endDate: date(endDate),
        replaced, terminatedAt: null, primaryEmployeeId: 9, secondaryEmployeeId: null,
        primaryEmployee: { name: "이관리" },
        serviceRecordAssignment: {
            id: `assignment-${id}`, branchId, serviceRecordCaseId: "case-parity",
            scheduleId: id, employeeId: 9, employeeNameSnapshot: "이관리",
            startDate: date(startDate), endDate: date(endDate),
        },
    };
}

function writtenDay(sessionIndex: number, caseSessionIndex: number | null, serviceDate: string) {
    return {
        id: "day-parity", branchId, serviceRecordCaseId: "case-parity" as string | null,
        scheduleId: 55, employeeId: 9, sessionIndex, caseSessionIndex,
        serviceDate: date(serviceDate), submittedAt: null,
    };
}

function fixture() {
    const plannedSessions = ["2026-09-07", "2026-09-08", "2026-09-09"].map((serviceDate, index) => ({
        sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
        assignmentId: "assignment-55", scheduleId: 55, employeeId: 9, provenanceVersion: "7",
    }));
    const record = {
        id: "case-parity", clientId: 10, branchId, version: 7, requiredSessionCount: 3,
        startDate: date("2026-09-07"), endDate: date("2026-09-09"), plannedSessions,
    };
    const db = {
        client: { findMany: jest.fn().mockResolvedValue([{
            id: 10, branchId, name: "김산모", duration: 3,
            startDate: date("2026-09-07"), endDate: date("2026-09-09"), serviceStatus: "completed",
            allowSaturdayService: false, allowSundayService: false, allowHolidayService: false,
        }]) },
        employee_schedule: { findMany: jest.fn().mockResolvedValue([schedule()]) },
        service_record_case: { findMany: jest.fn().mockResolvedValue([record]) },
        service_record_day: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repository = new SbClientRepository(db as unknown as PrismaService);
    return { db, record, load: () => repository.findServiceRecordAlertCandidates(branchId) };
}

function alerts(rows: ServiceRecordAlertCandidate[], now = threshold) {
    return findMissingServiceRecordAlerts(rows, branchId, KR_BUILTIN_CALENDAR, now);
}

describe("missing service record parity regressions (carried F1/F2)", () => {
    it.each([
        { raw: 3, canonical: 1, effective: 1, serviceDate: "2026-09-07" },
        { raw: 3, canonical: 2, effective: 2, serviceDate: "2026-09-08" },
        { raw: 1, canonical: null, effective: 1, serviceDate: "2026-09-07" },
    ])("F1: persisted draft raw $raw / case $canonical counts as written UI slot $effective", async ({ raw, canonical, effective, serviceDate }) => {
        const { db, load } = fixture();
        db.service_record_day.findMany.mockResolvedValue([writtenDay(raw, canonical, serviceDate)]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.assignmentSessions).toEqual([{ scheduleId: 55, sessionIndex: effective, serviceDate }]);
        expect(rows[0]!.source.sessions[0]!.sessionIndex).toBe(effective);
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        // Drafts count without any submission-status predicate on the candidate query.
        expect(JSON.stringify(db.service_record_day.findMany.mock.calls[0]![0].where)).not.toContain("submittedAt");
        expect(alerts(rows)).toEqual([]);
    });

    it("F1: raw 2 / case 3 writes only UI slot 3 and leaves the warning eligible", async () => {
        const { db, load } = fixture();
        db.service_record_day.findMany.mockResolvedValue([writtenDay(2, 3, "2026-09-09")]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.assignmentSessions).toEqual([{ scheduleId: 55, sessionIndex: 3, serviceDate: "2026-09-09" }]);
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        expect(alerts(rows)).toEqual(expectedAlert);
    });

    it("F2: active slots 2/3 alert exactly at slot 2's date at 18:00 KST without an active slot 1 date", async () => {
        const { db, record, load } = fixture();
        db.employee_schedule.findMany.mockResolvedValue([
            schedule(54, "2026-09-07", "2026-09-07", true),
            schedule(55, "2026-09-08", "2026-09-09"),
        ]);
        Object.assign(record.plannedSessions[0]!, { assignmentId: "assignment-54", scheduleId: 54 });
        const rows = await load();
        expect(rows).toHaveLength(1);
        const projection = resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR);
        expect(projection.blockingReasons).toEqual([]);
        expect(projection.entries.filter((entry) => entry.scheduleId === 55).map((entry) => ({
            sessionIndex: entry.sessionIndex, serviceDate: entry.serviceDate,
        }))).toEqual([
            { sessionIndex: 2, serviceDate: "2026-09-08" },
            { sessionIndex: 3, serviceDate: "2026-09-09" },
        ]);
        expect(alerts(rows, new Date(threshold.getTime() - 1))).toEqual([]);
        expect(alerts(rows)).toEqual(expectedAlert);
    });

    it("case parity: active slots 3/4 still alert at global slot 2 without renumbering", async () => {
        const { db, record, load } = fixture();
        record.requiredSessionCount = 4;
        record.endDate = date("2026-09-10");
        record.plannedSessions.push({
            sessionIndex: 4, serviceDate: "2026-09-10", originalDate: "2026-09-10",
            assignmentId: "assignment-55", scheduleId: 55, employeeId: 9, provenanceVersion: "7",
        });
        for (const entry of record.plannedSessions.slice(0, 2)) {
            Object.assign(entry, { assignmentId: "assignment-54", scheduleId: 54 });
        }
        db.client.findMany.mockResolvedValue([{
            id: 10, branchId, name: "김산모", duration: 4,
            startDate: date("2026-09-07"), endDate: date("2026-09-10"), serviceStatus: "completed",
            allowSaturdayService: false, allowSundayService: false, allowHolidayService: false,
        }]);
        db.employee_schedule.findMany.mockResolvedValue([
            schedule(54, "2026-09-07", "2026-09-08", true),
            schedule(55, "2026-09-09", "2026-09-10"),
        ]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        const projection = resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR);
        expect(projection.blockingReasons).toEqual([]);
        expect(projection.entries.filter((entry) => entry.scheduleId === 55).map((entry) => entry.sessionIndex)).toEqual([3, 4]);
        expect(projection.entries.find((entry) => entry.sessionIndex === 2)?.serviceDate).toBe("2026-09-08");
        expect(alerts(rows, new Date(threshold.getTime() - 1))).toEqual([]);
        expect(alerts(rows)).toEqual(expectedAlert);
    });

    it("case parity: a replaced schedule's case-linked slot 1 draft before the active period suppresses", async () => {
        const { db, record, load } = fixture();
        db.employee_schedule.findMany.mockResolvedValue([
            schedule(54, "2026-09-07", "2026-09-07", true),
            schedule(55, "2026-09-08", "2026-09-09"),
        ]);
        Object.assign(record.plannedSessions[0]!, { assignmentId: "assignment-54", scheduleId: 54 });
        db.service_record_day.findMany.mockResolvedValue([{
            ...writtenDay(3, 1, "2026-09-07"), scheduleId: 54,
        }]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.source.sessions).toEqual([{
            sessionIndex: 1, serviceDate: "2026-09-07", scheduleId: 54, employeeId: 9, ambiguous: false,
        }]);
        expect(rows[0]!.source.assignments.find((assignment) => assignment.scheduleId === 55)?.scheduleStartDate).toBe("2026-09-08");
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        expect(alerts(rows)).toEqual([]);
    });

    it("case parity: an active writer's earlier case record outside the active period suppresses", async () => {
        const { db, record, load } = fixture();
        db.employee_schedule.findMany.mockResolvedValue([
            schedule(54, "2026-09-07", "2026-09-07", true),
            schedule(55, "2026-09-08", "2026-09-09"),
        ]);
        Object.assign(record.plannedSessions[0]!, { assignmentId: "assignment-54", scheduleId: 54 });
        db.service_record_day.findMany.mockResolvedValue([writtenDay(3, 1, "2026-09-07")]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.source.sessions[0]).toMatchObject({ sessionIndex: 1, scheduleId: 55, serviceDate: "2026-09-07" });
        const projection = resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR);
        expect(projection.blockingReasons).toEqual([]);
        expect(projection.entries[0]).toMatchObject({ sessionIndex: 1, scheduleId: 55, serviceDate: "2026-09-07" });
        expect(alerts(rows)).toEqual([]);
    });

    it("case parity: a case-linked draft with a null schedule suppresses", async () => {
        const { db, load } = fixture();
        db.service_record_day.findMany.mockResolvedValue([{
            ...writtenDay(3, 1, "2026-09-07"), scheduleId: null,
        }]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.assignmentSessions).toEqual([]);
        expect(rows[0]!.source.sessions).toEqual([{
            sessionIndex: 1, serviceDate: "2026-09-07", scheduleId: null, employeeId: 9, ambiguous: false,
        }]);
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        expect(alerts(rows)).toEqual([]);
    });

    it("case parity: stored N=3 alerts even when client duration and period allow only one", async () => {
        const { db, load } = fixture();
        const client = (await db.client.findMany())[0]!;
        db.client.findMany.mockResolvedValue([{
            ...client, duration: 1, startDate: date("2026-09-09"), endDate: date("2026-09-09"),
        }]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.source.requiredSessionCount).toBe(3);
        expect(rows[0]!.source.client.duration).toBe(1);
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        expect(alerts(rows)).toEqual(expectedAlert);
    });

    it("case parity: stored N=1 refuses even when client duration and calendar allow three", async () => {
        const { record, load } = fixture();
        record.requiredSessionCount = 1;
        record.plannedSessions.splice(1);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.source.client.duration).toBe(3);
        const projection = resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR);
        expect(projection.blockingReasons).toEqual([]);
        expect(projection.entries.map((entry) => entry.sessionIndex)).toEqual([1]);
        expect(alerts(rows)).toEqual([]);
    });

    it.each([
        { boundary: "start (inclusive)", start: "2026-09-07", end: "2026-09-09", index: 1, serviceDate: "2026-09-07", written: true },
        { boundary: "before start", start: "2026-09-08", end: "2026-09-09", index: 1, serviceDate: "2026-09-07", written: false },
        { boundary: "end (inclusive)", start: "2026-09-07", end: "2026-09-08", index: 2, serviceDate: "2026-09-08", written: true },
        { boundary: "after end", start: "2026-09-07", end: "2026-09-07", index: 2, serviceDate: "2026-09-08", written: false },
    ])("case period: $boundary partitions written evidence independently of the active schedule", async ({ start, end, index, serviceDate, written }) => {
        const { db, record, load } = fixture();
        record.startDate = date(start);
        record.endDate = date(end);
        db.service_record_day.findMany.mockResolvedValue([writtenDay(3, index, serviceDate)]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.source.sessions[0]).toMatchObject({ sessionIndex: index, serviceDate });
        const active = rows[0]!.source.assignments[0]!;
        expect(serviceDate >= active.scheduleStartDate && serviceDate <= active.scheduleEndDate).toBe(true);
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        expect(alerts(rows)).toEqual(written ? [] : expectedAlert);
    });

    it("F1: an unlinked replaced schedule draft does not suppress the case warning", async () => {
        const { db, load } = fixture();
        db.employee_schedule.findMany.mockResolvedValue([
            schedule(54, "2026-09-03", "2026-09-09", true), schedule(),
        ]);
        // A legacy row without a case link is still mapped as assignment evidence.
        db.service_record_day.findMany.mockResolvedValue([{
            ...writtenDay(3, 2, "2026-09-08"), scheduleId: 54, serviceRecordCaseId: null,
        }]);
        const rows = await load();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.assignmentSessions).toEqual([{ scheduleId: 54, sessionIndex: 2, serviceDate: "2026-09-08" }]);
        expect(rows[0]!.source.sessions).toEqual([]);
        expect(resolveServiceRecordScheduleProjection(rows[0]!.source, KR_BUILTIN_CALENDAR).blockingReasons).toEqual([]);
        expect(alerts(rows)).toEqual(expectedAlert);
    });
});
