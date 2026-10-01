import { buildCalendarFromHolidayYears } from "@babyjamjam/shared/utils/holiday-calendar";

import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import {
    getServiceDateShiftBusinessDays,
    isDayButtonDisabled,
    isServiceDateMismatch,
    legacyDefaultServiceDate,
    serviceRecordCalendarYears,
} from "@/lib/service-records/page-helpers";

describe("isServiceDateMismatch", () => {
    it("detects when the service date differs from today", () => {
        expect(isServiceDateMismatch("2026-07-14", "2026-07-15")).toBe(true);
    });

    it("does not flag today's service date", () => {
        expect(isServiceDateMismatch("2026-07-15", "2026-07-15")).toBe(false);
    });
});

describe("isDayButtonDisabled", () => {
    it("keeps a completed day clickable before record finalization", () => {
        expect(isDayButtonDisabled({ done: true, open: false, isRecordFinalized: false })).toBe(false);
    });

    it("disables every day after record finalization", () => {
        expect(isDayButtonDisabled({ done: true, open: false, isRecordFinalized: true })).toBe(true);
        expect(isDayButtonDisabled({ done: false, open: true, isRecordFinalized: true })).toBe(true);
    });
});

describe("getServiceDateShiftBusinessDays", () => {
    it("counts a two-business-day shift", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-28", KR_BUILTIN_CALENDAR)).toBe(2);
    });

    it("counts a one-business-day shift", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-27", KR_BUILTIN_CALENDAR)).toBe(1);
    });

    it("returns zero for the same date", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-26", KR_BUILTIN_CALENDAR)).toBe(0);
    });

    it("counts a one-business-day shift across a weekend", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-28", "2026-08-31", KR_BUILTIN_CALENDAR)).toBe(1);
    });

    it("returns null when the target date falls in an unsupported holiday-calendar year", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2030-07-15", KR_BUILTIN_CALENDAR)).toBeNull();
    });

    it("returns null for an invalid ISO date", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "not-a-date", KR_BUILTIN_CALENDAR)).toBeNull();
    });
});

// A branch calendar for 2026 whose only holiday is 2026-08-27 (a branch-added day off).
const branchCalendar = buildCalendarFromHolidayYears([
    { year: 2026, revision: 3, supported: true, holidays: [{ date: "2026-08-27", name: "지점 휴무" }] },
]);

describe("getServiceDateShiftBusinessDays with a branch calendar", () => {
    it("counts a branch-added holiday as a non-business day", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-28", KR_BUILTIN_CALENDAR)).toBe(2);
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2026-08-28", branchCalendar)).toBe(1);
    });

    it("returns null for a year the branch calendar does not cover", () => {
        expect(getServiceDateShiftBusinessDays("2026-08-26", "2027-01-05", branchCalendar)).toBeNull();
    });
});

describe("legacyDefaultServiceDate", () => {
    const ctx = { startDate: "2026-08-26", sessions: [] };

    it("chains one business day per session on the given calendar", () => {
        expect(legacyDefaultServiceDate(ctx, 2, KR_BUILTIN_CALENDAR, "2026-08-26")).toBe("2026-08-27");
        expect(legacyDefaultServiceDate(ctx, 2, branchCalendar, "2026-08-26")).toBe("2026-08-28");
    });

    it("lets an existing row's date shift every later default", () => {
        const withRow = { startDate: "2026-08-26", sessions: [{ sessionIndex: 1, serviceDate: "2026-08-28T00:00:00.000Z" }] };
        expect(legacyDefaultServiceDate(withRow, 2, branchCalendar, "2026-08-26")).toBe("2026-08-31");
    });

    it("returns an empty string instead of throwing when the chain leaves the covered years", () => {
        expect(legacyDefaultServiceDate({ startDate: "2027-03-02", sessions: [] }, 1, branchCalendar, "2026-08-26")).toBe("");
    });
});

describe("serviceRecordCalendarYears", () => {
    it("covers previous/current/next year plus the years of the case's dates", () => {
        expect(serviceRecordCalendarYears(
            {
                startDate: "2024-12-30",
                sessions: [{ sessionIndex: 1, serviceDate: "2024-12-30T00:00:00.000Z" }],
                plannedSessionDates: [{ serviceDate: "2025-01-02" }],
            },
            "2026-08-26",
        )).toEqual([2024, 2025, 2026, 2027]);
    });

    it("drops years outside the endpoint's accepted range", () => {
        expect(serviceRecordCalendarYears({ startDate: "1999-01-01" }, "2026-08-26")).toEqual([2000, 2025, 2026, 2027]);
    });

    it("falls back to the three-year window without a context", () => {
        expect(serviceRecordCalendarYears(null, "2026-08-26")).toEqual([2025, 2026, 2027]);
    });
});
