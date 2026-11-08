import { findMissingServiceRecordAlerts } from "application/policies/missing-service-record-alert.policy";
import { resolveServiceRecordScheduleProjection } from "application/policies/service-record-edit-preview.policy";
import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

const branchId = "branch-1";
const threshold = new Date("2026-09-08T18:00:00+09:00");
function candidate(): ServiceRecordAlertCandidate {
    return {
        source: {
            caseId: "case-1", caseVersion: 7, requiredSessionCount: 3,
            startDate: "2026-09-07", endDate: "2026-09-09", plannedSessions: null,
            client: {
                id: 10, branchId, name: "김산모", duration: 3,
                startDate: "2026-09-07", endDate: "2026-09-09", serviceStatus: "completed",
            },
            assignments: [{
                id: "assignment-1", branchId, serviceRecordCaseId: "case-1",
                scheduleId: 55, employeeId: 9, startDate: "2026-09-07", endDate: "2026-09-09",
                replaced: false, employeeName: "이관리", scheduleStartDate: "2026-09-07",
                scheduleEndDate: "2026-09-09", scheduleTerminatedAt: null,
                primaryEmployeeId: 9, secondaryEmployeeId: null, primaryEmployeeName: "이관리",
            }],
            sessions: [],
        },
        assignmentSessions: [],
    };
}
const alerts = (rows: ServiceRecordAlertCandidate[], now = threshold) =>
    findMissingServiceRecordAlerts(rows, branchId, KR_BUILTIN_CALENDAR, now);

// Export no fixture: scheduler tests exercise its own source-shaped repository response.
describe("missing service record eligibility", () => {
    it("starts exactly at the second authoritative date at 18:00 KST", () => {
        expect(alerts([candidate()], new Date(threshold.getTime() - 1))).toEqual([]);
        expect(alerts([candidate()])).toEqual([{
            clientId: 10, clientName: "김산모", primaryEmployeeName: "이관리", scheduleId: 55,
        }]);
    });

    it("uses revised authoritative dates instead of approximating weekdays", () => {
        const row = candidate();
        row.source.plannedSessions = ["2026-09-07", "2026-09-10", "2026-09-11"].map((serviceDate, index) => ({
            sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
            assignmentId: "assignment-1", scheduleId: 55, employeeId: 9, provenanceVersion: "7",
        }));
        expect(alerts([row])).toEqual([]);
        expect(alerts([row], new Date("2026-09-10T18:00:00+09:00"))).toHaveLength(1);
    });

    it.each([1, 2])("counts a canonical case draft for session %i as written", (sessionIndex) => {
        const row = candidate();
        row.source.sessions.push({ scheduleId: 55, employeeId: 9, ambiguous: false, sessionIndex, serviceDate: `2026-09-0${sessionIndex + 6}` });
        expect(alerts([row])).toEqual([]);
    });

    it("uses global slot 2 when the active assignment owns only entries 3+", () => {
        const row = candidate();
        row.source.assignments.unshift({ ...row.source.assignments[0]!, id: "old", scheduleId: 54,
            replaced: true, startDate: "2026-09-03", endDate: "2026-09-04",
            scheduleStartDate: "2026-09-03", scheduleEndDate: "2026-09-04" });
        row.source.requiredSessionCount = 5;
        row.source.startDate = "2026-09-03";
        row.source.plannedSessions = ["2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09"].map((serviceDate, index) => ({
            sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
            assignmentId: index < 2 ? "old" : "assignment-1", scheduleId: index < 2 ? 54 : 55,
            employeeId: 9, provenanceVersion: "7",
        }));
        expect(alerts([row])).toHaveLength(1);
    });

    it("keeps unlinked replaced-assignment rows from suppressing a case warning", () => {
        const row = candidate();
        row.source.assignments.unshift({ ...row.source.assignments[0]!, id: "old", scheduleId: 54,
            replaced: true, scheduleStartDate: "2026-09-03", startDate: "2026-09-03" });
        // A legacy row without a case link belongs only to the replaced schedule.
        row.assignmentSessions = [{ scheduleId: 54, sessionIndex: 1, serviceDate: "2026-09-07" }];
        expect(alerts([row])).toEqual([{
            clientId: 10, clientName: "김산모", primaryEmployeeName: "이관리", scheduleId: 55,
        }]);
    });

    it("partitions canonical rows outside the case period", () => {
        const row = candidate();
        row.source.sessions = [{ scheduleId: 55, employeeId: 9, ambiguous: false, sessionIndex: 1, serviceDate: "2026-09-01" }];
        expect(alerts([row])).toHaveLength(1);
    });

    it.each([0, 1])("rejects fewer than two configured sessions (%s)", (count) => {
        const row = candidate();
        row.source.requiredSessionCount = count;
        row.source.client.duration = 3;
        expect(alerts([row])).toEqual([]);
    });

    it.each([{ plannedSessions: null }, { plannedSessions: [] }])("keeps the null-count projection blocker with planned sessions $plannedSessions", ({ plannedSessions }) => {
        const row = candidate();
        row.source.requiredSessionCount = null;
        row.source.client.duration = 3;
        row.source.plannedSessions = plannedSessions;
        // mapCase derives legacy N from the case period, or displays unknown N=0
        // for a persisted vector. The unchanged projection requires a stored N.
        expect(resolveServiceRecordScheduleProjection(row.source, KR_BUILTIN_CALENDAR).blockingReasons)
            .toEqual([expect.objectContaining({ code: "INVALID_SESSION_COUNT" })]);
        expect(alerts([row])).toEqual([]);
    });

    it("uses stored case N independently of client duration and client period", () => {
        const row = candidate();
        row.source.client.duration = 1;
        row.source.client.startDate = "2026-09-09";
        row.source.client.endDate = "2026-09-09";
        expect(alerts([row])).toHaveLength(1);
    });

    it.each(["2026-02-30", "invalid"])("does not treat invalid case service date %j as written", (serviceDate) => {
        const row = candidate();
        row.source.sessions = [{ scheduleId: 55, employeeId: 9, ambiguous: false, sessionIndex: 1, serviceDate }];
        // Invalid evidence must remain fail-closed through the real projection.
        expect(alerts([row])).toEqual([]);
    });

    it("does not count an empty case service date as written when legacy projection resolves it", () => {
        const row = candidate();
        row.source.sessions = [{ scheduleId: 55, employeeId: 9, ambiguous: false, sessionIndex: 1, serviceDate: "" }];
        expect(alerts([row])).toHaveLength(1);
    });

    it("rejects a projection with only one owned slot", () => {
        const row = candidate();
        row.source.requiredSessionCount = 1;
        expect(alerts([row])).toEqual([]);
    });

    it.each(["missing start", "invalid date", "invalid client date", "reversed client period", "blank client", "blank employee", "foreign client", "foreign assignment", "wrong case", "missing assignment", "replaced", "projection blocker", "ambiguous rows"])("fails closed: %s", (scenario) => {
        const row = candidate();
        const assignment = row.source.assignments[0]!;
        switch (scenario) {
            case "missing start": row.source.startDate = null; break;
            case "invalid date": assignment.scheduleStartDate = "2026-02-30"; break;
            case "invalid client date": row.source.client.startDate = "2026-02-30"; break;
            case "reversed client period": row.source.client.endDate = "2026-09-06"; break;
            case "blank client": row.source.client.name = "  "; break;
            case "blank employee": assignment.primaryEmployeeName = "  "; break;
            case "foreign client": row.source.client.branchId = "other"; break;
            case "foreign assignment": assignment.branchId = "other"; break;
            case "wrong case": assignment.serviceRecordCaseId = "other"; break;
            case "missing assignment": assignment.id = null; break;
            case "replaced": assignment.replaced = true; break;
            case "projection blocker": row.source.plannedSessions = {}; break;
            case "ambiguous rows": row.source.sessions = [{ sessionIndex: 3, serviceDate: "2026-09-09", scheduleId: 55, employeeId: 9, ambiguous: true }]; break;
        }
        expect(alerts([row])).toEqual([]);
    });

    it("selects the newest non-replaced schedule by start date, then id", () => {
        const row = candidate();
        row.source.assignments.push({ ...row.source.assignments[0]!, id: "new", scheduleId: 56 });
        // Both live schedules overlap: projection must refuse ambiguous ownership.
        expect(alerts([row])).toEqual([]);
        row.source.assignments[0]!.replaced = true;
        expect(alerts([row])[0]?.scheduleId).toBe(56);
    });

    it("skips a newer replaced schedule when selecting the active assignment", () => {
        const row = candidate();
        row.source.assignments.push({ ...row.source.assignments[0]!, id: "newer-replaced", scheduleId: 56,
            replaced: true, startDate: "2026-09-10", endDate: "2026-09-11",
            scheduleStartDate: "2026-09-10", scheduleEndDate: "2026-09-11" });
        expect(alerts([row])[0]?.scheduleId).toBe(55);
    });

    it("isolates unsupported calendar years from other clients", () => {
        const invalid = candidate();
        invalid.source.client.id = 11;
        invalid.source.startDate = "2099-01-01";
        invalid.source.endDate = "2099-01-03";
        Object.assign(invalid.source.client, { startDate: "2099-01-01", endDate: "2099-01-03" });
        Object.assign(invalid.source.assignments[0]!, {
            startDate: "2099-01-01", endDate: "2099-01-03",
            scheduleStartDate: "2099-01-01", scheduleEndDate: "2099-01-03",
        });
        expect(alerts([invalid, candidate()], new Date("2099-01-05T18:00:00+09:00"))).toEqual([{
            clientId: 10, clientName: "김산모", primaryEmployeeName: "이관리", scheduleId: 55,
        }]);
    });

    it("isolates a projection blocker from other clients", () => {
        const invalid = candidate();
        invalid.source.client.id = 11;
        invalid.source.plannedSessions = {};
        expect(alerts([invalid, candidate()]).map((alert) => alert.clientId)).toEqual([10]);
    });

    it("honors weekend and holiday client flags", () => {
        const row = candidate();
        row.source.startDate = "2026-10-08";
        row.source.endDate = "2026-10-14";
        Object.assign(row.source.client, { startDate: "2026-10-08", endDate: "2026-10-14" });
        Object.assign(row.source.assignments[0]!, { startDate: "2026-10-08", endDate: "2026-10-14", scheduleStartDate: "2026-10-08", scheduleEndDate: "2026-10-14" });
        const friday = new Date("2026-10-09T18:00:00+09:00");
        expect(alerts([row], friday)).toEqual([]); // Hangul Day
        row.source.client.allowHolidayService = true;
        expect(alerts([row], friday)).toHaveLength(1);
        row.source.startDate = "2026-09-11";
        row.source.endDate = "2026-09-16";
        Object.assign(row.source.client, { startDate: "2026-09-11", endDate: "2026-09-16", allowHolidayService: false });
        Object.assign(row.source.assignments[0]!, { startDate: "2026-09-11", endDate: "2026-09-16", scheduleStartDate: "2026-09-11", scheduleEndDate: "2026-09-16" });
        expect(alerts([row], new Date("2026-09-12T18:00:00+09:00"))).toEqual([]);
        row.source.client.allowSaturdayService = true;
        expect(alerts([row], new Date("2026-09-12T18:00:00+09:00"))).toHaveLength(1);
        row.source.client.allowSaturdayService = false;
        expect(alerts([row], new Date("2026-09-13T18:00:00+09:00"))).toEqual([]);
        row.source.client.allowSundayService = true;
        expect(alerts([row], new Date("2026-09-13T18:00:00+09:00"))).toHaveLength(1);
    });

    it("returns at most one alert per client without excluding stored completed status", () => {
        expect(alerts([candidate(), candidate()])).toHaveLength(1);
    });
});
