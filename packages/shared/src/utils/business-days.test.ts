import {
    addBusinessDaysKr,
    assertSupportedKoreanHolidayYear,
    calcEndDateBusinessDays,
    countBusinessDaysKr,
    diffBusinessDaysKr,
    createKrBusinessDayCalendar,
    DEFAULT_SERVICE_DAY_POLICY,
    KOREAN_HOLIDAY_CALENDAR_VERSION,
    KOREAN_HOLIDAYS,
    isBusinessDayKr,
    KR_BUILTIN_CALENDAR,
    KR_BUILTIN_HOLIDAYS,
    KR_HOLIDAYS,
    nextBusinessDayKr,
    shiftBusinessDaysKr,
    UnsupportedKoreanHolidayYearError,
} from "./business-days";

describe("versioned Korean holiday calendar", () => {
    it("exposes the calendar version and fails closed for an unpopulated year", () => {
        expect(KOREAN_HOLIDAY_CALENDAR_VERSION).toBe("kr-public-holidays-2024-2027.v2");
        expect(() => assertSupportedKoreanHolidayYear(2028))
            .toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => isBusinessDayKr("2028-01-03"))
            .toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => countBusinessDaysKr("2028-01-03", "2028-01-04"))
            .toThrow(UnsupportedKoreanHolidayYearError);
    });
});

describe("KR_HOLIDAYS fixtures", () => {
    it("contains the 2026/2027 Korean public holidays used by both apps", () => {
        expect(KR_HOLIDAYS.has("2026-01-01")).toBe(true); // New Year's Day
        expect(KR_HOLIDAYS.has("2026-07-17")).toBe(true); // Constitution Day (P0-3 fixture date)
        expect(KR_HOLIDAYS.has("2026-06-03")).toBe(true); // local elections
        expect(KR_HOLIDAYS.has("2027-12-25")).toBe(true); // Christmas
        expect(KR_HOLIDAYS.size).toBe(46);
    });

    it("does not flag an ordinary weekday as a holiday", () => {
        expect(KR_HOLIDAYS.has("2026-07-16")).toBe(false);
    });
});

describe("isBusinessDayKr", () => {
    it("treats weekends as non-business days", () => {
        expect(isBusinessDayKr("2026-07-18")).toBe(false); // Saturday
        expect(isBusinessDayKr("2026-07-19")).toBe(false); // Sunday
    });

    it("treats a Korean holiday (P0-3 fixture) as a non-business day even on a weekday", () => {
        expect(isBusinessDayKr("2026-07-17")).toBe(false); // Constitution Day, Friday
    });

    it("treats an ordinary weekday as a business day", () => {
        expect(isBusinessDayKr("2026-07-16")).toBe(true);
    });

    it("returns false for an empty input", () => {
        expect(isBusinessDayKr("")).toBe(false);
    });

    it.each([
        ["2024-10-01"],
        ["2025-01-27"],
        ["2025-06-03"],
        ["2027-05-03"],
        ["2027-07-19"],
        ["2027-10-11"],
        ["2027-12-27"],
    ])("uses the corrected public holiday calendar for %s", (date) => {
        expect(isBusinessDayKr(date)).toBe(false);
    });

    it.each([["2026-09-28"], ["2027-06-07"]])("removes the stale holiday entry for %s", (date) => {
        expect(isBusinessDayKr(date)).toBe(true);
    });
});

describe("Korean business-day helpers", () => {
    it("counts the start date as the first service day when it is a business day", () => {
        expect(calcEndDateBusinessDays("2026-01-05", 1)).toBe("2026-01-05");
    });

    it("skips weekends when calculating the service end date", () => {
        expect(calcEndDateBusinessDays("2026-01-02", 2)).toBe("2026-01-05");
    });

    it("starts counting from the next business day when the start date is a holiday", () => {
        expect(calcEndDateBusinessDays("2026-01-01", 1)).toBe("2026-01-02");
    });

    it("skips Korean holidays from the shared source-of-truth list", () => {
        expect(isBusinessDayKr("2026-06-03")).toBe(false);
        expect(calcEndDateBusinessDays("2026-06-02", 2)).toBe("2026-06-04");
    });

    it("returns an empty string for invalid inputs", () => {
        expect(calcEndDateBusinessDays("", 10)).toBe("");
        expect(calcEndDateBusinessDays("260602", 10)).toBe("");
        expect(calcEndDateBusinessDays("2026-06-02", 0)).toBe("");
    });

    it("counts business-day distance while skipping weekends and holidays", () => {
        expect(diffBusinessDaysKr("2026-07-08", "2026-07-07")).toBe(1);
        expect(diffBusinessDaysKr("2026-07-06", "2026-07-07")).toBe(-1);
        expect(diffBusinessDaysKr("2026-07-20", "2026-07-07")).toBe(8);
        expect(diffBusinessDaysKr("2026-06-04", "2026-06-02")).toBe(1);
    });
});

describe("nextBusinessDayKr / addBusinessDaysKr", () => {
    it("returns the next business day, skipping a holiday-then-weekend run", () => {
        // 2026-08-15 (Sat, Liberation Day) is already a weekend; the
        // substitute holiday lands on 2026-08-17 (Mon).
        expect(nextBusinessDayKr("2026-08-14")).toBe("2026-08-18");
    });

    it("adds N business days, skipping weekends and holidays", () => {
        // 2026-07-16 (Thu) -> 2026-07-17 (Fri, Constitution Day holiday) and
        // the weekend are skipped, landing on 2026-07-20 (Mon).
        expect(addBusinessDaysKr("2026-07-16", 1)).toBe("2026-07-20");
    });

    it("returns the input unchanged for a non-positive count", () => {
        expect(addBusinessDaysKr("2026-07-16", 0)).toBe("2026-07-16");
    });

    it("does not bypass the calendar for an unsupported zero-step date", () => {
        expect(() => addBusinessDaysKr("2028-01-03", 0))
            .toThrow(UnsupportedKoreanHolidayYearError);
    });
});

describe("shiftBusinessDaysKr", () => {
    it.each([
        ["2024-09-30", "2024-10-02"],
        ["2025-01-24", "2025-01-31"],
        ["2025-06-02", "2025-06-04"],
        ["2026-09-23", "2026-09-28"],
        ["2026-12-31", "2027-01-04"],
        ["2027-04-30", "2027-05-04"],
        ["2027-06-04", "2027-06-07"],
        ["2027-07-16", "2027-07-20"],
        ["2027-10-08", "2027-10-12"],
        ["2027-12-24", "2027-12-28"],
    ])("shifts +1 and reverses across the approved boundary %s -> %s", (base, expected) => {
        expect(shiftBusinessDaysKr(base, 1)).toBe(expected);
        expect(shiftBusinessDaysKr(expected, -1)).toBe(base);
    });
});

describe("createKrBusinessDayCalendar", () => {
    it("exposes the built-in holidays sorted and in step with KOREAN_HOLIDAYS", () => {
        expect(KR_BUILTIN_HOLIDAYS).toEqual([...KR_BUILTIN_HOLIDAYS].sort());
        expect(new Set(KR_BUILTIN_HOLIDAYS)).toEqual(KOREAN_HOLIDAYS);
        expect(KR_BUILTIN_CALENDAR.version).toBe(KOREAN_HOLIDAY_CALENDAR_VERSION);
    });

    it("built-in calendar classifies every day of 2024-2027 by weekday and holiday set", () => {
        const cursor = new Date(Date.UTC(2024, 0, 1));
        const end = Date.UTC(2027, 11, 31);
        while (cursor.getTime() <= end) {
            const iso = cursor.toISOString().slice(0, 10);
            const weekday = cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6;
            const expected = weekday && !KOREAN_HOLIDAYS.has(iso);
            expect(KR_BUILTIN_CALENDAR.isBusinessDay(iso)).toBe(expected);
            expect(isBusinessDayKr(iso)).toBe(expected);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
    });

    it.each([
        ["2026-09-07", 15, "2026-09-29"], // 9/24-9/25 Chuseok skipped; 9/28 is a business day
        ["2026-09-23", 3, "2026-09-29"],
        ["2024-12-30", 5, "2025-01-06"],
        ["2027-12-20", 8, "2027-12-30"],
        ["2026-10-03", 2, "2026-10-07"], // non-business start rolls forward
    ])("calcEndDateBusinessDays(%s, %i) is %s on both the calendar and the legacy function", (start, n, expected) => {
        expect(KR_BUILTIN_CALENDAR.calcEndDateBusinessDays(start, n)).toBe(expected);
        expect(calcEndDateBusinessDays(start, n)).toBe(expected);
    });

    it("matches hard-coded expectations for add/shift/count/diff/next", () => {
        expect(KR_BUILTIN_CALENDAR.addBusinessDays("2026-09-22", 3)).toBe("2026-09-29");
        expect(KR_BUILTIN_CALENDAR.addBusinessDays("2025-10-02", 2)).toBe("2025-10-13");
        expect(KR_BUILTIN_CALENDAR.addBusinessDays("2027-02-05", 1)).toBe("2027-02-10");
        expect(KR_BUILTIN_CALENDAR.shiftBusinessDays("2026-09-23", 3)).toBe("2026-09-30");
        expect(KR_BUILTIN_CALENDAR.shiftBusinessDays("2026-09-29", -3)).toBe("2026-09-22");
        expect(KR_BUILTIN_CALENDAR.shiftBusinessDays("2024-05-02", -2)).toBe("2024-04-29");
        expect(KR_BUILTIN_CALENDAR.countBusinessDays("2026-09-01", "2026-09-30")).toBe(20);
        expect(KR_BUILTIN_CALENDAR.countBusinessDays("2025-12-20", "2026-01-05")).toBe(9);
        expect(KR_BUILTIN_CALENDAR.countBusinessDays("2027-02-01", "2027-02-28")).toBe(18);
        expect(KR_BUILTIN_CALENDAR.diffBusinessDays("2026-10-12", "2026-09-30")).toBe(6);
        expect(KR_BUILTIN_CALENDAR.diffBusinessDays("2026-09-01", "2026-09-30")).toBe(-19);
        expect(KR_BUILTIN_CALENDAR.diffBusinessDays("2027-01-04", "2026-12-24")).toBe(5);
        expect(KR_BUILTIN_CALENDAR.nextBusinessDay("2026-09-23")).toBe("2026-09-28");
    });

    it("shifts calcEndDateBusinessDays by one business day for an extra holiday", () => {
        const calendar = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-09-10"]);
        expect(KR_BUILTIN_CALENDAR.calcEndDateBusinessDays("2026-09-07", 15)).toBe("2026-09-29");
        expect(calendar.isBusinessDay("2026-09-10")).toBe(false);
        expect(calendar.calcEndDateBusinessDays("2026-09-07", 15)).toBe("2026-09-30");
    });

    it("treats a date removed from the built-in list as a business day", () => {
        const calendar = createKrBusinessDayCalendar(
            KR_BUILTIN_HOLIDAYS.filter((date) => date !== "2026-07-17"),
        );
        expect(isBusinessDayKr("2026-07-17")).toBe(false);
        expect(calendar.isBusinessDay("2026-07-17")).toBe(true);
        expect(calendar.nextBusinessDay("2026-07-16")).toBe("2026-07-17");
    });

    it("ignores duplicate holiday dates and rejects malformed ones", () => {
        const calendar = createKrBusinessDayCalendar(["2026-07-17", "2026-07-17"]);
        expect(calendar.isBusinessDay("2026-07-17")).toBe(false);
        expect(() => createKrBusinessDayCalendar(["2026-7-17"])).toThrow();
        expect(() => createKrBusinessDayCalendar(["2026-02-30"])).toThrow();
    });

    it("supports a year only when declared or when a supplied date falls in it", () => {
        const calendar = createKrBusinessDayCalendar(["2028-01-01"], { supportedYears: [2028] });
        expect(calendar.isBusinessDay("2028-01-03")).toBe(true);
        expect(calendar.isBusinessDay("2028-01-01")).toBe(false);
        expect(() => calendar.assertSupportedYear(2028)).not.toThrow();
        expect(() => calendar.isBusinessDay("2026-07-16")).toThrow(UnsupportedKoreanHolidayYearError);

        const declaredOnly = createKrBusinessDayCalendar([], { supportedYears: [2028] });
        expect(declaredOnly.calcEndDateBusinessDays("2028-01-03", 2)).toBe("2028-01-04");

        const noData = createKrBusinessDayCalendar(["2027-01-01"]);
        expect(() => noData.isBusinessDay("2028-01-03")).toThrow(UnsupportedKoreanHolidayYearError);
    });

    it("lets an explicit supportedYears override the years implied by the holiday dates", () => {
        const calendar = createKrBusinessDayCalendar(["2026-01-01", "2027-05-01"], { supportedYears: [2026] });
        expect(calendar.isBusinessDay("2026-07-16")).toBe(true);
        expect(() => calendar.isBusinessDay("2027-03-02")).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => calendar.assertSupportedYear(2027)).toThrow(UnsupportedKoreanHolidayYearError);
    });

    it("checks year support before the weekend rule", () => {
        // 2028-01-01 is a Saturday, but 2028 is not supported by this calendar, so the year error wins.
        const calendar = createKrBusinessDayCalendar(["2026-01-01"], { supportedYears: [2026] });
        expect(() => calendar.isBusinessDay("2028-01-01")).toThrow(UnsupportedKoreanHolidayYearError);
        const supported = createKrBusinessDayCalendar([], { supportedYears: [2028] });
        expect(supported.isBusinessDay("2028-01-01")).toBe(false);
    });

    it("does not fall back to the built-in years for an unpopulated year", () => {
        const calendar = createKrBusinessDayCalendar(KR_BUILTIN_HOLIDAYS.filter((date) => date.startsWith("2026-")));
        expect(calendar.isBusinessDay("2026-07-16")).toBe(true);
        expect(() => calendar.isBusinessDay("2027-03-02")).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => calendar.assertSupportedYear(2027)).toThrow(UnsupportedKoreanHolidayYearError);
    });

    it("names the calendar's own version in the unsupported-year error", () => {
        const calendar = createKrBusinessDayCalendar(["2026-01-01"], { version: "branch-7.v3" });
        expect(() => calendar.assertSupportedYear(2030)).toThrow("version branch-7.v3");
        expect(() => assertSupportedKoreanHolidayYear(2030)).toThrow(`version ${KOREAN_HOLIDAY_CALENDAR_VERSION}`);
    });
});

describe("withServiceDays", () => {
    const policy = (saturday: boolean, sunday: boolean, holiday: boolean) => ({ saturday, sunday, holiday });

    it("returns the very same instance for the default policy on the base calendar", () => {
        expect(KR_BUILTIN_CALENDAR.withServiceDays(DEFAULT_SERVICE_DAY_POLICY)).toBe(KR_BUILTIN_CALENDAR);
        expect(KR_BUILTIN_CALENDAR.withServiceDays(policy(false, false, false))).toBe(KR_BUILTIN_CALENDAR);
        expect(KR_BUILTIN_CALENDAR.version).toBe(KOREAN_HOLIDAY_CALENDAR_VERSION);
    });

    it("freezes the default policy with every flag false", () => {
        expect(DEFAULT_SERVICE_DAY_POLICY).toEqual({ saturday: false, sunday: false, holiday: false });
        expect(Object.isFrozen(DEFAULT_SERVICE_DAY_POLICY)).toBe(true);
    });

    it.each([
        [policy(true, false, false), "+sd-100"],
        [policy(false, true, false), "+sd-010"],
        [policy(false, false, true), "+sd-001"],
        [policy(true, true, true), "+sd-111"],
        [policy(true, false, true), "+sd-101"],
    ])("appends the policy to the version (%j -> %s)", (p, suffix) => {
        expect(KR_BUILTIN_CALENDAR.withServiceDays(p).version).toBe(`${KOREAN_HOLIDAY_CALENDAR_VERSION}${suffix}`);
    });

    it("matches the branch-calendar version shape with a suffix", () => {
        const branch = createKrBusinessDayCalendar(["2026-01-01"], { version: "kr-db-abc123def456" });
        expect(branch.withServiceDays(policy(true, false, true)).version).toBe("kr-db-abc123def456+sd-101");
    });

    it("replaces a previous policy instead of composing with it", () => {
        const p1 = policy(true, true, false);
        const p2 = policy(false, false, true);
        const direct = KR_BUILTIN_CALENDAR.withServiceDays(p2);
        const rewrapped = KR_BUILTIN_CALENDAR.withServiceDays(p1).withServiceDays(p2);
        expect(rewrapped.version).toBe(direct.version);
        for (const iso of ["2026-12-19", "2026-12-20", "2026-12-25", "2026-12-21"]) {
            expect(rewrapped.isBusinessDay(iso)).toBe(direct.isBusinessDay(iso));
        }
        // Saturday/Sunday from p1 must be gone.
        expect(rewrapped.isBusinessDay("2026-12-19")).toBe(false);
        expect(rewrapped.isBusinessDay("2026-12-20")).toBe(false);
        expect(rewrapped.isBusinessDay("2026-12-25")).toBe(true);
    });

    it("returns to the policy-free base (same instance, base version) when re-wrapped with the default", () => {
        const wrapped = KR_BUILTIN_CALENDAR.withServiceDays(policy(true, true, true));
        const back = wrapped.withServiceDays(DEFAULT_SERVICE_DAY_POLICY);
        expect(back).toBe(KR_BUILTIN_CALENDAR);
        expect(back.version).toBe(KOREAN_HOLIDAY_CALENDAR_VERSION);
        expect(back.isBusinessDay("2026-12-19")).toBe(false);
    });

    it("applies serviceDays passed as a factory option the same way", () => {
        const viaOption = createKrBusinessDayCalendar(KR_BUILTIN_HOLIDAYS, {
            version: "v",
            supportedYears: [2026],
            serviceDays: policy(true, false, false),
        });
        expect(viaOption.version).toBe("v+sd-100");
        expect(viaOption.isBusinessDay("2026-12-19")).toBe(true);
        expect(viaOption.withServiceDays(DEFAULT_SERVICE_DAY_POLICY).version).toBe("v");
        expect(viaOption.withServiceDays(DEFAULT_SERVICE_DAY_POLICY).isBusinessDay("2026-12-19")).toBe(false);
    });

    it("lets Saturday enable only Saturdays, Sunday only Sundays, holiday only weekday holidays", () => {
        const sat = KR_BUILTIN_CALENDAR.withServiceDays(policy(true, false, false));
        const sun = KR_BUILTIN_CALENDAR.withServiceDays(policy(false, true, false));
        const hol = KR_BUILTIN_CALENDAR.withServiceDays(policy(false, false, true));
        const SAT = "2026-12-19";
        const SUN = "2026-12-20";
        const WEEKDAY_HOLIDAY = "2026-12-25"; // Friday, Christmas
        const WEEKDAY = "2026-12-21";

        expect([sat, sun, hol].map((c) => c.isBusinessDay(WEEKDAY))).toEqual([true, true, true]);

        expect(sat.isBusinessDay(SAT)).toBe(true);
        expect(sat.isBusinessDay(SUN)).toBe(false);
        expect(sat.isBusinessDay(WEEKDAY_HOLIDAY)).toBe(false);

        expect(sun.isBusinessDay(SAT)).toBe(false);
        expect(sun.isBusinessDay(SUN)).toBe(true);
        expect(sun.isBusinessDay(WEEKDAY_HOLIDAY)).toBe(false);

        expect(hol.isBusinessDay(SAT)).toBe(false);
        expect(hol.isBusinessDay(SUN)).toBe(false);
        expect(hol.isBusinessDay(WEEKDAY_HOLIDAY)).toBe(true);
    });

    it("requires BOTH flags for a Saturday that is also a holiday (all four combinations)", () => {
        const HOLIDAY_SATURDAY = "2026-08-15"; // Liberation Day, a Saturday
        expect(KR_HOLIDAYS.has(HOLIDAY_SATURDAY)).toBe(true);
        const answer = (saturday: boolean, holiday: boolean) =>
            KR_BUILTIN_CALENDAR.withServiceDays(policy(saturday, false, holiday)).isBusinessDay(HOLIDAY_SATURDAY);
        expect(answer(false, false)).toBe(false);
        expect(answer(true, false)).toBe(false);
        expect(answer(false, true)).toBe(false);
        expect(answer(true, true)).toBe(true);
    });

    it("requires BOTH flags for a Sunday that is also a holiday (all four combinations)", () => {
        const HOLIDAY_SUNDAY = "2026-03-01"; // Independence Movement Day, a Sunday
        expect(KR_HOLIDAYS.has(HOLIDAY_SUNDAY)).toBe(true);
        const answer = (sunday: boolean, holiday: boolean) =>
            KR_BUILTIN_CALENDAR.withServiceDays(policy(false, sunday, holiday)).isBusinessDay(HOLIDAY_SUNDAY);
        expect(answer(false, false)).toBe(false);
        expect(answer(true, false)).toBe(false);
        expect(answer(false, true)).toBe(false);
        expect(answer(true, true)).toBe(true);
    });

    it("changes counting and end dates under a policy while the default is untouched", () => {
        const sat = KR_BUILTIN_CALENDAR.withServiceDays(policy(true, false, false));
        expect(KR_BUILTIN_CALENDAR.calcEndDateBusinessDays("2026-12-14", 10)).toBe("2026-12-28");
        expect(sat.calcEndDateBusinessDays("2026-12-14", 10)).toBe("2026-12-24");
        expect(KR_BUILTIN_CALENDAR.countBusinessDays("2026-12-14", "2026-12-24")).toBe(9);
        expect(sat.countBusinessDays("2026-12-14", "2026-12-24")).toBe(10);
        expect(sat.nextBusinessDay("2026-12-18")).toBe("2026-12-19");
        expect(KR_BUILTIN_CALENDAR.nextBusinessDay("2026-12-18")).toBe("2026-12-21");
        expect(sat.addBusinessDays("2026-12-18", 2)).toBe("2026-12-21");
        expect(sat.shiftBusinessDays("2026-12-21", -1)).toBe("2026-12-19");
        expect(sat.diffBusinessDays("2026-12-21", "2026-12-18")).toBe(2);
    });

    it("keeps failing closed for an unsupported year on a policy calendar", () => {
        const all = KR_BUILTIN_CALENDAR.withServiceDays(policy(true, true, true));
        expect(() => all.isBusinessDay("2028-01-03")).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => all.isBusinessDay("2028-01-01")).toThrow(UnsupportedKoreanHolidayYearError); // Saturday
        expect(() => all.countBusinessDays("2028-01-03", "2028-01-04")).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => all.assertSupportedYear(2028)).toThrow(UnsupportedKoreanHolidayYearError);
        expect(all.isBusinessDay("")).toBe(false);
        expect(all.isBusinessDay("2026-02-30")).toBe(false);
    });
});
