import { alignPlannedSessionsToCaregiverDate, CaregiverDateAlignmentError } from "application/policies/service-record-caregiver-date.policy";
import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR, UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";

const entries = (dates: string[]) => dates.map((serviceDate, i) => ({
    sessionIndex: i + 1, serviceDate, originalDate: serviceDate,
    assignmentId: `assignment-${i}`, scheduleId: 10, employeeId: 20, provenanceVersion: "revision-1", extra: { retained: true },
}));

describe("alignPlannedSessionsToCaregiverDate", () => {
    it("pushes colliding unwritten slots forward, sorts and preserves provenance without mutating input", () => {
        const input = entries(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-09"]).reverse();
        const before = JSON.stringify(input);
        const result = alignPlannedSessionsToCaregiverDate(input, 1, "2026-07-03", new Set(), KR_BUILTIN_CALENDAR);
        expect(result.map((entry) => entry.serviceDate)).toEqual(["2026-07-03", "2026-07-06", "2026-07-07", "2026-07-09"]);
        expect(result[0]).toMatchObject({ originalDate: "2026-07-01", assignmentId: "assignment-0", extra: { retained: true } });
        expect(JSON.stringify(input)).toBe(before);
    });

    it("pulls earlier unwritten slots back and stops once dates are already in order", () => {
        const result = alignPlannedSessionsToCaregiverDate(entries(["2026-06-24", "2026-07-02", "2026-07-03"]), 3, "2026-07-01", new Set(), KR_BUILTIN_CALENDAR);
        expect(result.map((entry) => entry.serviceDate)).toEqual(["2026-06-24", "2026-06-30", "2026-07-01"]);
    });

    it.each([[1, "2026-07-02", [3], "forward"], [3, "2026-07-02", [1], "backward"]] as const)(
        "reports %s's collision direction without moving written slots", (index, date, written, direction) => {
            const action = () => alignPlannedSessionsToCaregiverDate(entries(["2026-07-01", "2026-07-02", "2026-07-03"]), index, date, new Set(written), KR_BUILTIN_CALENDAR);
            expect(action).toThrow(CaregiverDateAlignmentError);
            try { action(); } catch (error) { expect(error).toMatchObject({ direction }); }
        },
    );

    it("stops at a written slot even when later unwritten slots could be repaired", () => {
        const result = alignPlannedSessionsToCaregiverDate(entries(["2026-07-01", "2026-07-06", "2026-07-07"]), 1, "2026-07-03", new Set([2]), KR_BUILTIN_CALENDAR);
        expect(result.map((entry) => entry.serviceDate)).toEqual(["2026-07-03", "2026-07-06", "2026-07-07"]);
    });

    it("uses calendar days when a forward repair crosses into a year without holiday data", () => {
        const calendar = createKrBusinessDayCalendar([], { version: "only-2027", supportedYears: [2027] });
        expect(() => calendar.addBusinessDays("2027-12-31", 1)).toThrow(UnsupportedKoreanHolidayYearError);
        const result = alignPlannedSessionsToCaregiverDate(entries(["2027-12-29", "2027-12-30", "2027-12-31"]), 1, "2027-12-31", new Set(), calendar);
        expect(result.map((entry) => entry.serviceDate)).toEqual(["2027-12-31", "2028-01-01", "2028-01-02"]);
    });

    it("uses a calendar day when a backward repair enters an unsupported year", () => {
        const calendar = createKrBusinessDayCalendar([], { version: "only-2028", supportedYears: [2028] });
        const result = alignPlannedSessionsToCaregiverDate(entries(["2028-01-03", "2028-01-04"]), 2, "2028-01-01", new Set(), calendar);
        expect(result.map((entry) => entry.serviceDate)).toEqual(["2027-12-31", "2028-01-01"]);
    });
});
