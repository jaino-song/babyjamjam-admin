import {
    getExpectedSessionDateFromRecords,
    moveServiceRecordSessionDate,
    shiftServiceRecordScheduleSuffix,
    validateServiceRecordScheduleVector,
} from "./service-record-schedule";
import { createKrBusinessDayCalendar, UnsupportedKoreanHolidayYearError } from "./business-days";

describe("getExpectedSessionDateFromRecords", () => {
    it("falls back to the N-th business day from start when no records exist", () => {
        expect(getExpectedSessionDateFromRecords("2026-01-05", 1, [])).toBe("2026-01-05");
        expect(getExpectedSessionDateFromRecords("2026-01-02", 2, [])).toBe("2026-01-05");
    });

    it("chains an unwritten slot's expected date from the last written session's actual date", () => {
        const records = Array.from({ length: 13 }, (_, i) => {
            const sessionIndex = i + 1;
            if (sessionIndex === 12) return { sessionIndex, serviceDate: "2026-08-28" };
            if (sessionIndex === 13) return { sessionIndex, serviceDate: "2026-08-31" };
            return { sessionIndex, serviceDate: "2026-08-01" };
        });

        expect(getExpectedSessionDateFromRecords("2026-08-01", 14, records)).toBe("2026-09-01");
        expect(getExpectedSessionDateFromRecords("2026-08-01", 15, records)).toBe("2026-09-02");
        expect(getExpectedSessionDateFromRecords("2026-08-01", 18, records)).toBe("2026-09-07");
    });

    it("chains from the closest preceding written record across a gap", () => {
        const records = [
            { sessionIndex: 1, serviceDate: "2026-07-16" },
            { sessionIndex: 3, serviceDate: "2026-07-20" },
        ];

        // Slot 2 has no record at index 2, so it chains from record 1.
        expect(getExpectedSessionDateFromRecords("2026-07-16", 2, records)).toBe("2026-07-20");
        // Slot 4 chains from the closer record 3, not record 1.
        expect(getExpectedSessionDateFromRecords("2026-07-16", 4, records)).toBe("2026-07-21");
    });

    it("returns null when there is no start date and no preceding record", () => {
        expect(getExpectedSessionDateFromRecords(null, 1, [])).toBeNull();
    });
});

describe("shiftServiceRecordScheduleSuffix", () => {
    const vector = [
        "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
        "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
        "2026-09-21", "2026-09-22", "2026-09-23",
    ].map((serviceDate, index) => ({
        sessionIndex: index + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: `assignment-${index + 1}`,
        scheduleId: 10,
        employeeId: 20,
        provenanceVersion: "case-7",
    }));

    it("changes only the selected day when no suffix move was approved", () => {
        const result = moveServiceRecordSessionDate(vector, 1, "2026-09-04", false);
        expect(result.deltaBusinessDays).toBe(-1);
        expect(result.entries.map((row) => row.serviceDate)).toEqual(["2026-09-04", ...vector.slice(1).map((row) => row.serviceDate)]);
    });

    it("rejects an overlapping day until the suffix move is approved", () => {
        expect(() => moveServiceRecordSessionDate(vector, 1, "2026-09-08", false)).toThrow();
        const result = moveServiceRecordSessionDate(vector, 1, "2026-09-08", true);
        expect(result.entries.slice(0, 6).map((row) => row.serviceDate)).toEqual([
            "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15",
        ]);
    });

    it("moves the selected and later sessions by one signed business-day delta", () => {
        const shifted = shiftServiceRecordScheduleSuffix(vector, 3, "2026-09-11");
        expect(shifted.deltaBusinessDays).toBe(2);
        expect(shifted.entries.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
            "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22",
            "2026-09-23", "2026-09-28", "2026-09-29",
        ]);
        expect(shifted.entries.map(({ originalDate }) => originalDate)).toEqual(vector.map(({ originalDate }) => originalDate));
    });

    it("preserves irregular gaps while shifting each suffix date independently", () => {
        const entries = ["2026-09-07", "2026-09-09", "2026-09-14"].map((serviceDate, index) => ({
            ...vector[index]!,
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
        }));
        expect(shiftServiceRecordScheduleSuffix(entries, 2, "2026-09-10").entries.map(({ serviceDate }) => serviceDate))
            .toEqual(["2026-09-07", "2026-09-10", "2026-09-15"]);
    });

    it("rejects unsupported, weekend, duplicate, and inverted vectors", () => {
        expect(() => shiftServiceRecordScheduleSuffix(vector, 3, "2028-01-04")).toThrow();
        expect(() => shiftServiceRecordScheduleSuffix(vector, 3, "2026-09-12")).toThrow();
        expect(() => shiftServiceRecordScheduleSuffix(
            vector.map((entry, index) => index === 4 ? { ...entry, serviceDate: vector[3]!.serviceDate } : entry),
            3,
            "2026-09-11",
        )).toThrow();
    });

    it("orders a shuffled valid vector by session index before checking chronology", () => {
        const shuffled = [vector[1]!, vector[0]!, ...vector.slice(2)];
        expect(validateServiceRecordScheduleVector(shuffled, vector.length).map(({ sessionIndex }) => sessionIndex))
            .toEqual(vector.map(({ sessionIndex }) => sessionIndex));

        const invertedByIndex = [
            { ...vector[0]!, serviceDate: "2026-09-08" },
            { ...vector[1]!, serviceDate: "2026-09-07" },
            ...vector.slice(2),
        ];
        expect(() => validateServiceRecordScheduleVector(invertedByIndex, vector.length))
            .toThrow(/not after the previous session/);
    });
});

describe("calendar parameter", () => {
    // 2028 exists only in the custom calendar, so the built-in default must reject it.
    const calendar = createKrBusinessDayCalendar(["2028-01-05"], { supportedYears: [2028] });
    const vector = ["2028-01-03", "2028-01-04", "2028-01-06"].map((serviceDate, index) => ({
        sessionIndex: index + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: `assignment-${index + 1}`,
        scheduleId: 10,
        employeeId: 20,
        provenanceVersion: "case-9",
    }));

    it("honours a custom calendar in year support and holiday checks", () => {
        expect(() => validateServiceRecordScheduleVector(vector)).toThrow(UnsupportedKoreanHolidayYearError);
        expect(validateServiceRecordScheduleVector(vector, undefined, calendar)).toHaveLength(3);
        expect(() => validateServiceRecordScheduleVector(
            vector.map((row) => (row.sessionIndex === 2 ? { ...row, serviceDate: "2028-01-05", originalDate: "2028-01-05" } : row)),
            undefined,
            calendar,
        )).toThrow("Korean business day");
    });

    it("threads the calendar through move and shift helpers", () => {
        expect(() => moveServiceRecordSessionDate(vector, 1, "2028-01-07", false)).toThrow(UnsupportedKoreanHolidayYearError);
        const moved = moveServiceRecordSessionDate(vector.slice(0, 2), 2, "2028-01-07", false, calendar);
        expect(moved.entries.map((row) => row.serviceDate)).toEqual(["2028-01-03", "2028-01-07"]);
        const shifted = shiftServiceRecordScheduleSuffix(vector, 3, "2028-01-07", calendar);
        expect(shifted.deltaBusinessDays).toBe(1);
        expect(shifted.entries.map((row) => row.serviceDate)).toEqual(["2028-01-03", "2028-01-04", "2028-01-07"]);
    });

    it("honours the custom calendar when moving with shiftFollowing (the production default)", () => {
        expect(() => moveServiceRecordSessionDate(vector, 3, "2028-01-07", true)).toThrow(UnsupportedKoreanHolidayYearError);
        const moved = moveServiceRecordSessionDate(vector, 3, "2028-01-07", true, calendar);
        expect(moved.deltaBusinessDays).toBe(1);
        expect(moved.entries.map((row) => row.serviceDate)).toEqual(["2028-01-03", "2028-01-04", "2028-01-07"]);
        // 2028-01-05 is a holiday on the custom calendar, so it is rejected as a target.
        expect(() => moveServiceRecordSessionDate(vector, 3, "2028-01-05", true, calendar)).toThrow();
    });

    it("computes expected session dates with the custom calendar", () => {
        // 2028-01-05 is a holiday on the custom calendar, so 3rd business day from 01-03 is 01-06.
        expect(getExpectedSessionDateFromRecords("2028-01-03", 3, [], calendar)).toBe("2028-01-06");
        expect(getExpectedSessionDateFromRecords("2028-01-03", 2, [{ sessionIndex: 1, serviceDate: "2028-01-04" }], calendar)).toBe("2028-01-06");
        expect(() => getExpectedSessionDateFromRecords("2028-01-03", 3, [])).toThrow(UnsupportedKoreanHolidayYearError);
    });
});
