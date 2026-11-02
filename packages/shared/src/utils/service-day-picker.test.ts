import { DEFAULT_SERVICE_DAY_POLICY, KR_BUILTIN_CALENDAR, UnsupportedKoreanHolidayYearError } from "./business-days";
import type { ServiceDayPolicy } from "./business-days";
import {
    autoFillServiceDays,
    classifyServiceDay,
    createServiceDayPicker,
    revertServiceDayPicker,
    serviceDayPickerProgress,
    setServiceDayPolicy,
    toggleServiceDay,
} from "./service-day-picker";

const policy = (saturday: boolean, sunday: boolean, holiday: boolean): ServiceDayPolicy => ({
    saturday,
    sunday,
    holiday,
});
const cal = KR_BUILTIN_CALENDAR;
// 2026-12-14 is a Monday; 12-19/20 are Sat/Sun; 12-25 is Christmas (Friday).
const START = "2026-12-14";

function picker(initialDates: string[], requiredCount = 3, p = DEFAULT_SERVICE_DAY_POLICY, startDate = START) {
    return createServiceDayPicker({ startDate, requiredCount, initialDates, policy: p });
}

describe("createServiceDayPicker", () => {
    it("sorts and de-duplicates initial dates and copies the policy", () => {
        const input = policy(true, false, false);
        const state = picker(["2026-12-16", "2026-12-14", "2026-12-16"], 3, input);
        expect(state.initial).toEqual(["2026-12-14", "2026-12-16"]);
        expect(state.selected).toEqual(["2026-12-14", "2026-12-16"]);
        expect(state.policy).toEqual(input);
        expect(state.initialPolicy).toEqual(input);
        input.saturday = false;
        expect(state.policy.saturday).toBe(true);
    });
});

describe("autoFillServiceDays", () => {
    it("returns the first N service days on/after the start", () => {
        expect(autoFillServiceDays("2026-12-17", 3, cal)).toEqual(["2026-12-17", "2026-12-18", "2026-12-21"]);
    });

    it("honours the calendar policy (Saturday on)", () => {
        const sat = cal.withServiceDays(policy(true, false, false));
        expect(autoFillServiceDays("2026-12-17", 3, sat)).toEqual(["2026-12-17", "2026-12-18", "2026-12-19"]);
    });

    it("returns [] for zero, negative and non-integer counts", () => {
        expect(autoFillServiceDays(START, 0, cal)).toEqual([]);
        expect(autoFillServiceDays(START, -2, cal)).toEqual([]);
        expect(autoFillServiceDays(START, 2.5, cal)).toEqual([]);
    });

    it("propagates the unsupported-year error when the walk leaves the data", () => {
        expect(() => autoFillServiceDays("2027-12-29", 5, cal)).toThrow(UnsupportedKoreanHolidayYearError);
    });

    it("does not truncate a long fill at a fixed calendar-day horizon", () => {
        const dates = autoFillServiceDays("2024-01-01", 600, cal);
        expect(dates).toHaveLength(600);
        // 600th business day from 2024-01-01 (a holiday, so the walk starts 2024-01-02).
        expect(dates[599]).toBe("2026-06-18");
        expect(dates.every((d) => cal.isBusinessDay(d))).toBe(true);
        expect(dates).toEqual([...dates].sort());
    });
});

describe("classifyServiceDay", () => {
    it("classifies before-start, selected, unavailable and available", () => {
        const state = picker(["2026-12-14", "2026-12-15", "2026-12-16"]);
        expect(classifyServiceDay(state, "2026-12-11", cal)).toBe("before-start");
        expect(classifyServiceDay(state, "2026-12-15", cal)).toBe("selected");
        expect(classifyServiceDay(state, "2026-12-19", cal)).toBe("unavailable"); // Saturday
        expect(classifyServiceDay(state, "2026-12-25", cal)).toBe("unavailable"); // holiday
        expect(classifyServiceDay(state, "2026-12-17", cal)).toBe("available");
    });

    it("marks an initial date that was deselected as skipped", () => {
        const state = toggleServiceDay(picker(["2026-12-14", "2026-12-15", "2026-12-16"]), "2026-12-16", cal).state;
        expect(classifyServiceDay(state, "2026-12-16", cal)).toBe("skipped");
    });

    it("marks an unselected gap before the last selected date as skipped, including the start date", () => {
        const state = picker(["2026-12-15", "2026-12-17"]);
        expect(classifyServiceDay(state, "2026-12-14", cal)).toBe("skipped"); // start date itself
        expect(classifyServiceDay(state, "2026-12-16", cal)).toBe("skipped");
        expect(classifyServiceDay(state, "2026-12-18", cal)).toBe("available");
        expect(classifyServiceDay(state, "2026-12-19", cal)).toBe("unavailable"); // gap but not a service day
    });

    it("renders a date in an unsupported year as unavailable instead of throwing", () => {
        const state = picker(["2026-12-14"]);
        expect(classifyServiceDay(state, "2028-01-03", cal)).toBe("unavailable");
    });

    it("rethrows errors that are not the unsupported-year error", () => {
        const broken = { ...cal, isBusinessDay: () => { throw new Error("boom"); } };
        expect(() => classifyServiceDay(picker([]), "2026-12-17", broken)).toThrow("boom");
    });
});

describe("toggleServiceDay", () => {
    it("adds a selectable date and keeps selected sorted", () => {
        const state = picker(["2026-12-16"], 3);
        const result = toggleServiceDay(state, "2026-12-14", cal);
        expect(result.outcome).toBe("added");
        expect(result.state.selected).toEqual(["2026-12-14", "2026-12-16"]);
        expect(state.selected).toEqual(["2026-12-16"]); // input not mutated
    });

    it("removes a selected date, even when full", () => {
        const state = picker(["2026-12-14", "2026-12-15", "2026-12-16"], 3);
        const result = toggleServiceDay(state, "2026-12-15", cal);
        expect(result.outcome).toBe("removed");
        expect(result.state.selected).toEqual(["2026-12-14", "2026-12-16"]);
    });

    it("refuses a date when the selection is already full and drops nothing", () => {
        const state = picker(["2026-12-14", "2026-12-15", "2026-12-16"], 3);
        const result = toggleServiceDay(state, "2026-12-17", cal);
        expect(result.outcome).toBe("full");
        expect(result.state).toBe(state);
    });

    it("refuses before-start, non-service and unsupported-year dates", () => {
        const state = picker(["2026-12-14"], 3);
        for (const iso of ["2026-12-11", "2026-12-19", "2026-12-25", "2028-01-03"]) {
            const result = toggleServiceDay(state, iso, cal);
            expect(result.outcome).toBe("not-selectable");
            expect(result.state).toBe(state);
        }
    });

    it("allows a Saturday once the calendar opens Saturdays", () => {
        const sat = cal.withServiceDays(policy(true, false, false));
        expect(toggleServiceDay(picker([], 3), "2026-12-19", sat).outcome).toBe("added");
    });
});

describe("setServiceDayPolicy", () => {
    it("drops selected dates the new policy forbids and reports them ascending, adding nothing", () => {
        const state = picker(["2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20"], 4, policy(true, true, false));
        const result = setServiceDayPolicy(state, policy(false, true, false), cal);
        expect(result.dropped).toEqual(["2026-12-19"]);
        expect(result.state.selected).toEqual(["2026-12-17", "2026-12-18", "2026-12-20"]);
        expect(result.state.policy).toEqual(policy(false, true, false));
        expect(result.state.initialPolicy).toEqual(policy(true, true, false));
    });

    it("drops nothing when every selected date stays valid", () => {
        const state = picker(["2026-12-17", "2026-12-18"], 2);
        const result = setServiceDayPolicy(state, policy(true, true, true), cal);
        expect(result.dropped).toEqual([]);
        expect(result.state.selected).toEqual(["2026-12-17", "2026-12-18"]);
    });

    it("evaluates against the base calendar, replacing rather than composing policies", () => {
        const state = picker(["2026-12-19"], 1, policy(true, false, false));
        const result = setServiceDayPolicy(state, policy(false, true, false), cal);
        expect(result.dropped).toEqual(["2026-12-19"]);
    });
});

describe("revertServiceDayPicker", () => {
    it("restores both the dates and the policy", () => {
        const start = picker(["2026-12-17", "2026-12-19"], 2, policy(true, false, false));
        const changed = setServiceDayPolicy(start, policy(false, false, false), cal).state;
        const edited = toggleServiceDay(changed, "2026-12-18", cal).state;
        expect(edited.selected).toEqual(["2026-12-17", "2026-12-18"]);
        expect(edited.policy).toEqual(policy(false, false, false));
        const reverted = revertServiceDayPicker(edited);
        expect(reverted.selected).toEqual(["2026-12-17", "2026-12-19"]);
        expect(reverted.policy).toEqual(policy(true, false, false));
    });
});

describe("serviceDayPickerProgress", () => {
    it("is complete with exactly N valid dates", () => {
        const state = picker(["2026-12-14", "2026-12-15", "2026-12-16"], 3);
        expect(serviceDayPickerProgress(state, cal)).toEqual({
            selectedCount: 3,
            requiredCount: 3,
            invalid: [],
            complete: true,
        });
    });

    it("is not complete when N dates include an invalid one", () => {
        const state = picker(["2026-12-14", "2026-12-15", "2026-12-25"], 3);
        const progress = serviceDayPickerProgress(state, cal);
        expect(progress.selectedCount).toBe(3);
        expect(progress.invalid).toEqual(["2026-12-25"]);
        expect(progress.complete).toBe(false);
    });

    it("is not complete with too few or too many valid dates", () => {
        expect(serviceDayPickerProgress(picker(["2026-12-14"], 3), cal).complete).toBe(false);
        expect(serviceDayPickerProgress(picker(["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17"], 3), cal).complete).toBe(false);
    });

    it("counts unsupported-year dates as invalid without throwing", () => {
        const progress = serviceDayPickerProgress(picker(["2028-01-03"], 1), cal);
        expect(progress.invalid).toEqual(["2028-01-03"]);
        expect(progress.complete).toBe(false);
    });
});
