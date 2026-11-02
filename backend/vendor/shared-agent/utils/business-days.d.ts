/**
 * Versioned Korean holiday calendar used by every business-day consumer.
 *
 * A calendar year is deliberately either present here or unsupported. Falling
 * back to weekdays-only for an unknown year changes contractual durations and
 * is therefore unsafe. Add a complete year and bump the version before that
 * year is used in production.
 */
export declare const KOREAN_HOLIDAY_CALENDAR_VERSION: "kr-public-holidays-2024-2027.v2";
export declare const KOREAN_HOLIDAY_CALENDAR: Readonly<Record<number, readonly string[]>>;
/** All dates in the authoritative calendar, useful for diagnostics and parity checks. */
export declare const KOREAN_HOLIDAYS: Set<string>;
/**
 * Legacy 2026/2027 export retained for callers that only need the original
 * release window. It is derived from the authoritative calendar above (not a
 * second hand-maintained holiday list).
 */
export declare const KR_HOLIDAYS: Set<string>;
/** Sorted ISO dates of the built-in calendar, for building derived calendars. */
export declare const KR_BUILTIN_HOLIDAYS: readonly string[];
export declare class UnsupportedKoreanHolidayYearError extends Error {
    readonly year: number;
    constructor(year: number, version?: string);
}
export declare function getKoreanHolidays(year: number): ReadonlySet<string>;
export declare function assertSupportedKoreanHolidayYear(year: number): void;
export declare function isoDateInKorea(date?: Date): string;
/**
 * Which non-weekday days a client accepts service on. Every flag defaults to
 * false: a plain business day (Mon-Fri, not a public holiday) is always a
 * service day, and each flag opens up exactly one more kind of day.
 */
export interface ServiceDayPolicy {
    saturday: boolean;
    sunday: boolean;
    holiday: boolean;
}
export declare const DEFAULT_SERVICE_DAY_POLICY: ServiceDayPolicy;
/**
 * A business-day calendar bound to one holiday list. The backend serves many
 * branches from one process, so holiday-aware callers pass a calendar around
 * instead of relying on any module-global state.
 */
export interface KrBusinessDayCalendar {
    readonly version: string;
    /** Throws UnsupportedKoreanHolidayYearError when the year has no holiday data. */
    assertSupportedYear(year: number): void;
    isBusinessDay(iso: string): boolean;
    /** Counts startISO as day 1; a non-business start rolls to the next business day. */
    calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string;
    addBusinessDays(iso: string, n: number): string;
    /** Signed business-day offset; a reverse shift restores the original date. */
    shiftBusinessDays(iso: string, offset: number): string;
    countBusinessDays(startISO: string, endISO: string): number | null;
    diffBusinessDays(targetISO: string, baseISO?: string): number | null;
    nextBusinessDay(iso: string): string;
    /**
     * Returns this calendar's holidays and supported years under another
     * service-day policy. The policy REPLACES any policy already applied (it
     * never composes), and an all-false policy returns the policy-free calendar
     * this one was derived from, so the default path keeps its identity and
     * version. A non-default policy appends `+sd-<sat><sun><holiday>` to the
     * version, which keeps preview signatures apart.
     */
    withServiceDays(policy: ServiceDayPolicy): KrBusinessDayCalendar;
}
export interface KrBusinessDayCalendarOptions {
    version?: string;
    /**
     * Years the holiday list is complete for. When omitted, only years that
     * have at least one supplied date are supported, so an unpopulated year
     * still fails closed.
     */
    supportedYears?: Iterable<number>;
    /** Applied on top of the policy-free calendar; defaults to no extra service days. */
    serviceDays?: ServiceDayPolicy;
}
export declare function createKrBusinessDayCalendar(holidayDates: Iterable<string>, opts?: KrBusinessDayCalendarOptions): KrBusinessDayCalendar;
export declare const KR_BUILTIN_CALENDAR: KrBusinessDayCalendar;
export declare function isBusinessDayKr(iso: string): boolean;
export declare function diffBusinessDaysKr(targetISO: string, baseISO?: string): number | null;
export declare function calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string;
export declare function nextBusinessDayKr(iso: string): string;
export declare function addBusinessDaysKr(iso: string, n: number): string;
/**
 * Applies a signed business-day offset using the authoritative Korean
 * calendar. Unlike addBusinessDaysKr this helper is intended for editor
 * suffix moves, where a reverse move must restore the original vector.
 */
export declare function shiftBusinessDaysKr(iso: string, offset: number): string;
export declare function countBusinessDaysKr(startISO: string, endISO: string): number | null;
