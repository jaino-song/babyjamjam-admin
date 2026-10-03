import {
    KOREAN_HOLIDAY_CALENDAR,
    KR_BUILTIN_CALENDAR,
    UnsupportedKoreanHolidayYearError,
} from "./business-days";
import {
    buildCalendarFromHolidayYears,
    holidayYearsToRequest,
    type HolidayYearPayload,
} from "./holiday-calendar";

const payload2026 = (
    holidays: HolidayYearPayload["holidays"],
    over: Partial<HolidayYearPayload> = {},
): HolidayYearPayload => ({ year: 2026, revision: 1, supported: true, holidays, ...over });

describe("buildCalendarFromHolidayYears", () => {
    it("treats excluded dates as business days", () => {
        const calendar = buildCalendarFromHolidayYears([
            payload2026([
                { date: "2026-08-17", name: "대체공휴일" },
                { date: "2026-10-05", name: "대체공휴일", excluded: true },
            ]),
        ]);
        expect(calendar.isBusinessDay("2026-08-17")).toBe(false);
        expect(calendar.isBusinessDay("2026-10-05")).toBe(true);
    });

    it("treats a branch-added date as a holiday", () => {
        const calendar = buildCalendarFromHolidayYears([
            payload2026([{ date: "2026-09-02", name: "지점 휴무" }]),
        ]);
        expect(calendar.isBusinessDay("2026-09-02")).toBe(false);
        expect(calendar.isBusinessDay("2026-09-03")).toBe(true);
    });

    it("fails closed for years without a supported payload", () => {
        const calendar = buildCalendarFromHolidayYears([
            payload2026([]),
            { year: 2027, revision: 2, supported: false, holidays: [] },
        ]);
        expect(() => calendar.isBusinessDay("2027-03-02")).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => calendar.isBusinessDay("2025-03-04")).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => calendar.assertSupportedYear(2027)).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => calendar.assertSupportedYear(2026)).not.toThrow();
    });

    it("ignores holidays of an unsupported payload", () => {
        const calendar = buildCalendarFromHolidayYears([
            payload2026([]),
            { year: 2027, revision: 1, supported: false, holidays: [{ date: "2027-01-01", name: "x" }] },
        ]);
        expect(() => calendar.isBusinessDay("2027-01-01")).toThrow(UnsupportedKoreanHolidayYearError);
    });

    it("builds the version from the max revision and the sorted supported years", () => {
        const calendar = buildCalendarFromHolidayYears([
            { year: 2027, revision: 3, supported: true, holidays: [] },
            { year: 2025, revision: 9, supported: false, holidays: [] },
            { year: 2026, revision: 7, supported: true, holidays: [] },
        ]);
        expect(calendar.version).toBe("kr-api-r9-y2026,2027");
    });

    it("rejects duplicate years and out-of-year dates", () => {
        expect(() => buildCalendarFromHolidayYears([payload2026([]), payload2026([])])).toThrow(/Duplicate/);
        expect(() =>
            buildCalendarFromHolidayYears([payload2026([{ date: "2027-01-01", name: "x" }])]),
        ).toThrow(/outside/);
    });

    it("matches the built-in calendar when built from the built-in 2026 list", () => {
        const holidays = KOREAN_HOLIDAY_CALENDAR[2026]!.map((date) => ({ date, name: "builtin" }));
        const calendar = buildCalendarFromHolidayYears([payload2026(holidays)]);
        const samples: Array<[string, number]> = [
            ["2026-01-02", 20],
            ["2026-02-13", 10],
            ["2026-05-22", 7],
            ["2026-09-21", 15],
            ["2026-10-01", 12],
        ];
        for (const [start, days] of samples) {
            expect(calendar.calcEndDateBusinessDays(start, days)).toBe(
                KR_BUILTIN_CALENDAR.calcEndDateBusinessDays(start, days),
            );
        }
        expect(calendar.countBusinessDays("2026-01-01", "2026-12-31")).toBe(
            KR_BUILTIN_CALENDAR.countBusinessDays("2026-01-01", "2026-12-31"),
        );
    });

    it("computes 2026-09-07 + 15 business days as 2026-09-29", () => {
        const holidays = KOREAN_HOLIDAY_CALENDAR[2026]!.map((date) => ({ date, name: "builtin" }));
        const calendar = buildCalendarFromHolidayYears([payload2026(holidays)]);
        expect(calendar.calcEndDateBusinessDays("2026-09-07", 15)).toBe("2026-09-29");
    });
});

describe("holidayYearsToRequest", () => {
    it("returns previous, current and next year", () => {
        expect(holidayYearsToRequest("2026-10-01")).toEqual([2025, 2026, 2027]);
    });

    it("rejects a malformed date", () => {
        expect(() => holidayYearsToRequest("nope")).toThrow();
    });
});
