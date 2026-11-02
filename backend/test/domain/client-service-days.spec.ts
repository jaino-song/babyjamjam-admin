import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { withClientServiceDays } from "domain/utils/client-service-days";

describe("withClientServiceDays", () => {
    it.each([
        ["a missing client", undefined],
        ["a null client", null],
        ["a client with every flag false", {
            allowSaturdayService: false,
            allowSundayService: false,
            allowHolidayService: false,
        }],
        ["a client with every flag null", {
            allowSaturdayService: null,
            allowSundayService: null,
            allowHolidayService: null,
        }],
        ["a client row without the flags", {}],
    ])("returns the same calendar instance for %s and never wraps it", (_label, client) => {
        const calendar = { ...KR_BUILTIN_CALENDAR, withServiceDays: jest.fn() };

        expect(withClientServiceDays(calendar, client)).toBe(calendar);
        expect(calendar.withServiceDays).not.toHaveBeenCalled();
    });

    it("returns a +sd- versioned calendar when a flag is on", () => {
        const wrapped = withClientServiceDays(KR_BUILTIN_CALENDAR, { allowSaturdayService: true });

        expect(wrapped).not.toBe(KR_BUILTIN_CALENDAR);
        expect(wrapped.version).toContain("+sd-");
        expect(wrapped.isBusinessDay("2026-12-19")).toBe(true);
        expect(KR_BUILTIN_CALENDAR.isBusinessDay("2026-12-19")).toBe(false);
    });

    it("counts a Saturday-enabled client's service days one longer over the same period", () => {
        const period = ["2026-12-14", "2026-12-24"] as const;

        expect(KR_BUILTIN_CALENDAR.countBusinessDays(...period)).toBe(9);
        expect(
            withClientServiceDays(KR_BUILTIN_CALENDAR, { allowSaturdayService: true }).countBusinessDays(...period),
        ).toBe(10);
    });

    it("replaces a policy already on the calendar instead of composing with it", () => {
        const saturday = withClientServiceDays(KR_BUILTIN_CALENDAR, { allowSaturdayService: true });
        const sunday = withClientServiceDays(saturday, { allowSundayService: true });

        expect(sunday.isBusinessDay("2026-12-19")).toBe(false);
        expect(sunday.isBusinessDay("2026-12-20")).toBe(true);
    });
});
