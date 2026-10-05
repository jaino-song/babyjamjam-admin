import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import type { UseBusinessDayCalendarResult } from "../useBusinessDayCalendar";

// One stable object per module so consumers that put the hook result in effect
// dependencies do not re-run on every render.
const READY_BUILTIN_RESULT: UseBusinessDayCalendarResult = {
    calendar: KR_BUILTIN_CALENDAR,
    ready: true,
    error: null,
    retry: jest.fn(),
    refreshForSave: async () => ({ ok: true, calendar: KR_BUILTIN_CALENDAR, changed: false }),
    version: KR_BUILTIN_CALENDAR.version,
};

export const useBusinessDayCalendar = jest.fn((): UseBusinessDayCalendarResult => READY_BUILTIN_RESULT);
