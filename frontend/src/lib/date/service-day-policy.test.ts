import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import { calendarWithServiceDays, serviceDayPolicyOfClient } from "./service-day-policy";

describe("serviceDayPolicyOfClient", () => {
  it("defaults every missing flag, and a missing client, to false", () => {
    const none = { saturday: false, sunday: false, holiday: false };
    expect(serviceDayPolicyOfClient()).toEqual(none);
    expect(serviceDayPolicyOfClient(null)).toEqual(none);
    expect(serviceDayPolicyOfClient({})).toEqual(none);
  });

  it("reads each flag from the client", () => {
    expect(serviceDayPolicyOfClient({ allowSaturdayService: true, allowHolidayService: true })).toEqual({
      saturday: true,
      sunday: false,
      holiday: true,
    });
  });
});

describe("calendarWithServiceDays", () => {
  it("returns the same calendar for the default policy and a wrapped one otherwise", () => {
    expect(calendarWithServiceDays(KR_BUILTIN_CALENDAR, serviceDayPolicyOfClient())).toBe(KR_BUILTIN_CALENDAR);
    const wrapped = calendarWithServiceDays(KR_BUILTIN_CALENDAR, serviceDayPolicyOfClient({ allowSaturdayService: true }));
    expect(wrapped.isBusinessDay("2026-07-11")).toBe(true);
    expect(KR_BUILTIN_CALENDAR.isBusinessDay("2026-07-11")).toBe(false);
  });
});
