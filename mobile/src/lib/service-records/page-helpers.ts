import { holidayYearsToRequest } from "@babyjamjam/shared/utils/holiday-calendar";
import { isoDateInKorea, type KrBusinessDayCalendar } from "@/lib/date/business-days";

export function isServiceDateMismatch(
    serviceDate: string,
    today = isoDateInKorea(),
): boolean {
    return serviceDate !== today;
}

// Number of business days (on the given branch calendar) the schedule moves
// when the caregiver picks `nextIso` instead of the expected `expectedIso`.
// `countBusinessDays` counts both endpoints inclusive, so subtract 1 to get the
// shift amount.
// Returns `null` (instead of throwing) when either date falls in a year the
// calendar doesn't cover, or when `countBusinessDays` itself returns `null`
// (invalid ISO input) — callers must treat `null` as "the shift cannot be
// computed" and avoid presenting it as a valid value.
// The result decides the schedule-shift confirmation, so callers must pass the
// loaded branch calendar (not the built-in list) before acting on it.
export function getServiceDateShiftBusinessDays(
    expectedIso: string,
    nextIso: string,
    calendar: KrBusinessDayCalendar,
): number | null {
    let count: number | null;
    try {
        count = calendar.countBusinessDays(expectedIso, nextIso);
    } catch {
        return null;
    }
    if (count === null) return null;
    return count - 1;
}

interface LegacyServiceDateContext {
    startDate?: string | null;
    sessions?: ReadonlyArray<{ sessionIndex: number; serviceDate: string }>;
}

// Default service date for `day` when the server sent no planned date vector:
// the first business day on/after the start date, chained one business day per
// session, with any existing row's date taking precedence. Returns "" (instead
// of throwing) when the chain leaves the years the calendar covers.
export function legacyDefaultServiceDate(
    ctx: LegacyServiceDateContext | null,
    day: number,
    calendar: KrBusinessDayCalendar,
    today = isoDateInKorea(),
): string {
    const sessions = ctx?.sessions ?? [];
    try {
        const rawStart = ctx?.startDate ? ctx.startDate.slice(0, 10) : today;
        const start = calendar.isBusinessDay(rawStart) ? rawStart : calendar.nextBusinessDay(rawStart);
        // Row-first recursive chain: an existing row's date (e.g. an approved
        // postpone) shifts every later default, not just the next session.
        const chain = (sessionIndex: number): string => {
            const row = sessions.find((session) => session.sessionIndex === sessionIndex);
            if (row) return row.serviceDate.slice(0, 10);
            if (sessionIndex <= 1) return start;
            return calendar.nextBusinessDay(chain(sessionIndex - 1));
        };
        return chain(day);
    } catch {
        return "";
    }
}

// Calendar years the token page must load: previous/current/next year plus the
// years of every date the case already holds (and the year after the start, so
// a chain that crosses New Year stays inside the loaded window). Only years the
// endpoint accepts (2000-2100) are returned.
export function serviceRecordCalendarYears(
    ctx: (LegacyServiceDateContext & {
        plannedSessionDates?: ReadonlyArray<{ serviceDate: string }> | null;
    }) | null,
    todayIso = isoDateInKorea(),
): number[] {
    const years = new Set<number>(holidayYearsToRequest(todayIso));
    const addYear = (iso: string | null | undefined, extra = 0) => {
        const year = Number(iso?.slice(0, 4));
        if (Number.isInteger(year)) years.add(year + extra);
    };
    addYear(ctx?.startDate, 1);
    addYear(ctx?.startDate);
    for (const session of ctx?.sessions ?? []) addYear(session.serviceDate);
    const planned = ctx?.plannedSessionDates;
    if (Array.isArray(planned)) {
        for (const session of planned) addYear(session.serviceDate);
    }
    return [...years].filter((year) => year >= 2000 && year <= 2100).sort((a, b) => a - b);
}

interface DayButtonState {
    done: boolean;
    open: boolean;
    isRecordFinalized: boolean;
}

export function isDayButtonDisabled({ done, open, isRecordFinalized }: DayButtonState): boolean {
    return (!done && !open) || isRecordFinalized;
}
