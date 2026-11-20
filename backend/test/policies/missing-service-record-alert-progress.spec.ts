import {
    findMissingServiceRecordAlerts,
    findMissingServiceRecordAlertsWithProgress,
} from "application/policies/missing-service-record-alert.policy";
import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { MISSING_RECORD_BRANCH_ID, missingRecordCandidate } from "../fixtures/missing-service-record-alert.fixture";

const progress = (candidates: ServiceRecordAlertCandidate[], now: string) =>
    findMissingServiceRecordAlertsWithProgress(candidates, MISSING_RECORD_BRANCH_ID, KR_BUILTIN_CALENDAR, new Date(now));

describe("missing service record consecutive progress", () => {
    it.each([
        ["2026-09-08T18:00:00+09:00", 2],
        ["2026-09-09T17:59:00+09:00", 2],
        ["2026-09-09T18:00:00+09:00", 3],
        ["2026-09-10T18:00:00+09:00", 4],
    ])("at %s counts through session %i", (now, expected) => {
        expect(progress([missingRecordCandidate()], now)).toEqual([{
            clientId: 10, clientName: "김산모", primaryEmployeeName: "이관리", scheduleId: 55,
            unwrittenThroughSessionIndex: expected,
        }]);
    });

    it("does not alert before session 2 is due", () => {
        expect(progress([missingRecordCandidate()], "2026-09-08T17:59:00+09:00")).toEqual([]);
    });

    it.each([
        ["2026-09-09", 2],
        ["2026-09-17", 2], // Inclusive end + 7.
        ["2026-09-18", 4],
    ])("session 3 recorded on %s stops progress at %i", (serviceDate, expected) => {
        const row = missingRecordCandidate();
        row.source.sessions.push({ sessionIndex: 3, serviceDate, scheduleId: 55, employeeId: 9, ambiguous: false });
        // Legacy projection takes its dates from records. Wait until all the
        // resulting planned dates are due to isolate the written-date window.
        expect(progress([row], "2026-09-30T18:00:00+09:00")[0]?.unwrittenThroughSessionIndex).toBe(expected);
    });

    it.each(["2026-08-30", "2026-08-31"])("preserves the projection blocker for an out-of-order session 3 on %s", (serviceDate) => {
        const row = missingRecordCandidate();
        row.source.sessions.push({ sessionIndex: 3, serviceDate, scheduleId: 55, employeeId: 9, ambiguous: false });
        expect(progress([row], "2026-09-30T18:00:00+09:00")).toEqual([]);
    });

    it("stops when the projection has no next entry", () => {
        expect(progress([missingRecordCandidate(10, "김산모", 2)], "2026-09-10T18:00:00+09:00")[0]?.unwrittenThroughSessionIndex)
            .toBe(2);
    });

    it("uses revised planned dates for the next session's due time", () => {
        const row = missingRecordCandidate();
        row.source.plannedSessions = ["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11"]
            .map((serviceDate, index) => ({
                sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
                assignmentId: "assignment-1", scheduleId: 55, employeeId: 9, provenanceVersion: "7",
            }));
        expect(progress([row], "2026-09-10T17:59:00+09:00")[0]?.unwrittenThroughSessionIndex).toBe(2);
        expect(progress([row], "2026-09-10T18:00:00+09:00")[0]?.unwrittenThroughSessionIndex).toBe(3);
    });

    it("preserves the exact legacy alert fields, client deduplication and order", () => {
        const first = missingRecordCandidate(20, "나산모");
        const invalid = missingRecordCandidate(30);
        invalid.source.client.branchId = "other-branch";
        const replacement = missingRecordCandidate(20, "변경산모", 3);
        const candidates = [first, invalid, missingRecordCandidate(10), replacement];
        const now = new Date("2026-09-10T18:00:00+09:00");
        const rows = findMissingServiceRecordAlertsWithProgress(candidates, MISSING_RECORD_BRANCH_ID, KR_BUILTIN_CALENDAR, now);
        const alerts = findMissingServiceRecordAlerts(candidates, MISSING_RECORD_BRANCH_ID, KR_BUILTIN_CALENDAR, now);
        expect(alerts).toEqual([
            { clientId: 20, clientName: "변경산모", primaryEmployeeName: "이관리", scheduleId: 55 },
            { clientId: 10, clientName: "김산모", primaryEmployeeName: "이관리", scheduleId: 55 },
        ]);
        expect(alerts).toEqual(rows.map(({ clientId, clientName, primaryEmployeeName, scheduleId }) => ({
            clientId, clientName, primaryEmployeeName, scheduleId,
        })));
    });
});
