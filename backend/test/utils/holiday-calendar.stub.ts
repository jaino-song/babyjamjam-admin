import type { EffectiveHolidayYear, HolidayCalendarService } from "application/services/holiday-calendar.service";
import { BUILTIN_PUBLIC_HOLIDAY_NAME } from "domain/repositories/holiday-calendar.repository.interface";
import { KOREAN_HOLIDAY_CALENDAR, KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

function builtinEffectiveYear(year: number): EffectiveHolidayYear {
    const dates = KOREAN_HOLIDAY_CALENDAR[year];
    return {
        year,
        revision: 0,
        supported: dates !== undefined,
        synced: false,
        lastSyncedAt: null,
        holidays: (dates ?? []).map((date) => ({
            date,
            name: BUILTIN_PUBLIC_HOLIDAY_NAME,
            source: "builtin" as const,
            excluded: false,
            overrideId: null,
        })),
        inactiveOverrides: [],
    };
}

/**
 * A `HolidayCalendarService` stand-in for specs: every branch sees the built-in
 * calendar, so expectations written against the built-in list keep holding.
 */
export function createHolidayCalendarStub(): HolidayCalendarService {
    return {
        forBranch: jest.fn(async () => KR_BUILTIN_CALENDAR),
        getEffectiveYear: jest.fn(async (_branchId: string, year: number) => builtinEffectiveYear(year)),
        invalidateRevisionCache: jest.fn(),
    } as unknown as HolidayCalendarService;
}
