/**
 * Versioned Korean holiday calendar used by every business-day consumer.
 *
 * A calendar year is deliberately either present here or unsupported. Falling
 * back to weekdays-only for an unknown year changes contractual durations and
 * is therefore unsafe. Add a complete year and bump the version before that
 * year is used in production.
 */
export const KOREAN_HOLIDAY_CALENDAR_VERSION = "kr-public-holidays-2024-2027.v2" as const;

export const KOREAN_HOLIDAY_CALENDAR: Readonly<Record<number, readonly string[]>> = {
    // 2024
    2024: [
        "2024-01-01", // New Year's Day
        "2024-02-09", "2024-02-10", "2024-02-11", "2024-02-12", // Seollal + substitute
        "2024-03-01", // Independence Movement Day
        "2024-04-10", // 22nd National Assembly election
        "2024-05-01", // Labor Day
        "2024-05-05", "2024-05-06", // Children's Day + substitute
        "2024-05-15", // Buddha's Birthday
        "2024-06-06", // Memorial Day
        "2024-08-15", // Liberation Day
        "2024-09-16", "2024-09-17", "2024-09-18", // Chuseok
        "2024-10-01", // Temporary public holiday
        "2024-10-03", // National Foundation Day
        "2024-10-09", // Hangeul Day
        "2024-12-25", // Christmas
    ],
    // 2025
    2025: [
        "2025-01-01", // New Year's Day
        "2025-01-27", // Temporary public holiday before Seollal
        "2025-01-28", "2025-01-29", "2025-01-30", // Seollal
        "2025-03-01", "2025-03-03", // Independence Movement Day + substitute
        "2025-05-01", // Labor Day
        "2025-05-05", "2025-05-06", // Children's Day/Buddha's Birthday + substitute
        "2025-06-03", // Presidential election
        "2025-06-06", // Memorial Day
        "2025-08-15", // Liberation Day
        "2025-10-03", // National Foundation Day
        "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08", // Chuseok + substitute
        "2025-10-09", // Hangeul Day
        "2025-12-25", // Christmas
    ],
    // 2026
    2026: [
        "2026-01-01", // New Year's Day
        "2026-02-16", "2026-02-17", "2026-02-18", // Seollal
        "2026-03-01", // Independence Movement Day
        "2026-03-02", // substitute holiday
        "2026-05-01", // Labor Day
        "2026-05-05", // Children's Day
        "2026-05-24", "2026-05-25", // Buddha's Birthday + substitute
        "2026-06-03", // local elections
        "2026-06-06", // Memorial Day
        "2026-07-17", // Constitution Day
        "2026-08-15", // Liberation Day
        "2026-08-17", // substitute holiday
        "2026-09-24", "2026-09-25", "2026-09-26", // Chuseok
        "2026-10-03", "2026-10-05", // National Foundation Day + substitute
        "2026-10-09", // Hangeul Day
        "2026-12-25", // Christmas
    ],
    // 2027
    2027: [
        "2027-01-01", // New Year's Day
        "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // Seollal + substitute
        "2027-03-01", // Independence Movement Day
        "2027-05-01", // Labor Day
        "2027-05-03", // Substitute holiday for Labor Day
        "2027-05-05", // Children's Day
        "2027-05-13", // Buddha's Birthday
        "2027-06-06", // Memorial Day
        "2027-07-17", // Constitution Day
        "2027-07-19", // Substitute holiday for Constitution Day
        "2027-08-15", "2027-08-16", // Liberation Day + substitute
        "2027-09-14", "2027-09-15", "2027-09-16", // Chuseok
        "2027-10-03", "2027-10-04", // National Foundation Day + substitute
        "2027-10-09", // Hangeul Day
        "2027-10-11", // Substitute holiday for Hangeul Day
        "2027-12-25", "2027-12-27", // Christmas + substitute
    ],
};

/** All dates in the authoritative calendar, useful for diagnostics and parity checks. */
export const KOREAN_HOLIDAYS = new Set<string>(
    Object.values(KOREAN_HOLIDAY_CALENDAR).flat(),
);

/**
 * Legacy 2026/2027 export retained for callers that only need the original
 * release window. It is derived from the authoritative calendar above (not a
 * second hand-maintained holiday list).
 */
export const KR_HOLIDAYS = new Set<string>([
    ...KOREAN_HOLIDAY_CALENDAR[2026]!,
    ...KOREAN_HOLIDAY_CALENDAR[2027]!,
]);

/** Sorted ISO dates of the built-in calendar, for building derived calendars. */
export const KR_BUILTIN_HOLIDAYS: readonly string[] = Object.values(KOREAN_HOLIDAY_CALENDAR)
    .flat()
    .sort();

export class UnsupportedKoreanHolidayYearError extends Error {
    readonly year: number;

    constructor(year: number, version: string = KOREAN_HOLIDAY_CALENDAR_VERSION) {
        super(`Korean holiday calendar does not support year ${year} (version ${version})`);
        this.name = "UnsupportedKoreanHolidayYearError";
        this.year = year;
    }
}

export function getKoreanHolidays(year: number): ReadonlySet<string> {
    const holidays = KOREAN_HOLIDAY_CALENDAR[year];
    if (!holidays) throw new UnsupportedKoreanHolidayYearError(year);
    return new Set(holidays);
}

export function assertSupportedKoreanHolidayYear(year: number): void {
    if (!KOREAN_HOLIDAY_CALENDAR[year]) {
        throw new UnsupportedKoreanHolidayYearError(year);
    }
}

const KOREA_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

function parseIsoDate(iso: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        Number.isNaN(parsed.getTime())
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return parsed;
}

function isoFromUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function isoDateInKorea(date = new Date()): string {
    const parts = KOREA_DATE_FORMATTER.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${year}-${month}-${day}`;
}

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

export const DEFAULT_SERVICE_DAY_POLICY: ServiceDayPolicy = Object.freeze({
    saturday: false,
    sunday: false,
    holiday: false,
});

function isDefaultServiceDayPolicy(policy: ServiceDayPolicy): boolean {
    return !policy.saturday && !policy.sunday && !policy.holiday;
}

function serviceDayVersionSuffix(policy: ServiceDayPolicy): string {
    return `+sd-${policy.saturday ? 1 : 0}${policy.sunday ? 1 : 0}${policy.holiday ? 1 : 0}`;
}

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

// Ported from mobile/src/lib/date/business-days.ts, which has these two
// helpers but frontend does not. Kept here so this module is a complete
// superset of both call sites' business-day needs.
const NEXT_BUSINESS_DAY_SEARCH_LIMIT = 30;

export function createKrBusinessDayCalendar(
    holidayDates: Iterable<string>,
    opts: KrBusinessDayCalendarOptions = {},
): KrBusinessDayCalendar {
    const dates = [...holidayDates];
    const supplied = opts.supportedYears ? [...opts.supportedYears] : undefined;
    const base = buildCalendar(dates, supplied, opts.version ?? "custom", DEFAULT_SERVICE_DAY_POLICY, null);
    return opts.serviceDays ? base.withServiceDays(opts.serviceDays) : base;
}

/**
 * Builds one calendar over normalized factory inputs. `root` is the policy-free
 * calendar every wrapped calendar derives from; it is null only while building
 * that root itself. Keeping the inputs (not a previous calendar) is what makes
 * withServiceDays replace instead of compose.
 */
function buildCalendar(
    holidayDates: readonly string[],
    suppliedSupportedYears: readonly number[] | undefined,
    baseVersion: string,
    policyInput: ServiceDayPolicy,
    root: KrBusinessDayCalendar | null,
): KrBusinessDayCalendar {
    const policy: ServiceDayPolicy = Object.freeze({
        saturday: policyInput.saturday,
        sunday: policyInput.sunday,
        holiday: policyInput.holiday,
    });
    const version = isDefaultServiceDayPolicy(policy) ? baseVersion : `${baseVersion}${serviceDayVersionSuffix(policy)}`;
    const holidays = new Set<string>();
    const datedYears = new Set<number>();
    for (const date of holidayDates) {
        if (!parseIsoDate(date)) throw new Error(`Invalid holiday date (expected YYYY-MM-DD): ${date}`);
        holidays.add(date);
        datedYears.add(Number(date.slice(0, 4)));
    }
    const supportedYears = new Set<number>();
    for (const year of suppliedSupportedYears ?? datedYears) {
        if (!Number.isInteger(year)) throw new Error(`Invalid supported year: ${year}`);
        supportedYears.add(year);
    }

    function assertSupportedYear(year: number): void {
        if (!supportedYears.has(year)) {
            throw new UnsupportedKoreanHolidayYearError(year, version);
        }
    }

    function assertSupportedIsoYear(iso: string): void {
        assertSupportedYear(Number(iso.slice(0, 4)));
    }

    function isBusinessDay(iso: string): boolean {
        if (!iso) return false;
        const date = parseIsoDate(iso);
        if (!date) return false;

        // Fail closed for a valid date in an unpopulated year. This is intentionally
        // before the weekday check: an unsupported Saturday must not look safe merely
        // because it is a weekend.
        assertSupportedIsoYear(iso);
        const dayOfWeek = date.getUTCDay();
        if (dayOfWeek === 6 && !policy.saturday) return false;
        if (dayOfWeek === 0 && !policy.sunday) return false;
        // A Saturday/Sunday that is also a holiday needs BOTH flags, not either.
        if (holidays.has(iso) && !policy.holiday) return false;
        return true;
    }

    function diffBusinessDays(targetISO: string, baseISO = isoDateInKorea()): number | null {
        const target = parseIsoDate(targetISO);
        const base = parseIsoDate(baseISO);
        if (!target || !base) return null;

        assertSupportedIsoYear(targetISO);
        assertSupportedIsoYear(baseISO);

        const targetTime = target.getTime();
        const baseTime = base.getTime();
        if (targetTime === baseTime) return 0;

        const cursor = new Date(base);
        let count = 0;

        if (targetTime > baseTime) {
            while (cursor.getTime() < targetTime) {
                cursor.setUTCDate(cursor.getUTCDate() + 1);
                if (isBusinessDay(isoFromUtcDate(cursor))) count++;
            }
            return count;
        }

        while (cursor.getTime() > targetTime) {
            if (isBusinessDay(isoFromUtcDate(cursor))) count++;
            cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
        return -count;
    }

    // Counts startISO as day 1. If startISO is not a business day, the next
    // Korean business day becomes day 1.
    function calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string {
        if (!startISO || !Number.isFinite(numberOfBusinessDays) || numberOfBusinessDays <= 0) return "";
        const start = parseIsoDate(startISO);
        if (!start) return "";
        assertSupportedIsoYear(startISO);

        const cursor = new Date(start);
        let counted = 0;

        for (let i = 0; i < 365 && counted < numberOfBusinessDays; i += 1) {
            const iso = isoFromUtcDate(cursor);
            if (isBusinessDay(iso)) {
                counted += 1;
                if (counted === numberOfBusinessDays) return iso;
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        return "";
    }

    function nextBusinessDay(iso: string): string {
        const start = parseIsoDate(iso);
        if (!start) throw new Error(`Invalid Korean calendar date: ${iso}`);
        assertSupportedIsoYear(iso);

        const cursor = new Date(start);
        for (let i = 0; i < NEXT_BUSINESS_DAY_SEARCH_LIMIT; i += 1) {
            cursor.setUTCDate(cursor.getUTCDate() + 1);
            const cursorIso = isoFromUtcDate(cursor);
            if (isBusinessDay(cursorIso)) return cursorIso;
        }

        throw new Error(
            `Unable to find next Korean business day within ${NEXT_BUSINESS_DAY_SEARCH_LIMIT} days after ${iso}`,
        );
    }

    function addBusinessDays(iso: string, n: number): string {
        const parsed = parseIsoDate(iso);
        if (!parsed) throw new Error(`Invalid Korean calendar date: ${iso}`);
        assertSupportedIsoYear(iso);
        if (n <= 0) return iso;

        let cursor = iso;
        for (let i = 0; i < n; i += 1) {
            cursor = nextBusinessDay(cursor);
        }

        return cursor;
    }

    function shiftBusinessDays(iso: string, offset: number): string {
        const parsed = parseIsoDate(iso);
        if (!parsed) throw new Error(`Invalid Korean calendar date: ${iso}`);
        assertSupportedIsoYear(iso);
        if (!Number.isInteger(offset)) {
            throw new Error(`Business-day offset must be an integer: ${offset}`);
        }
        if (offset === 0) return iso;

        const direction = offset > 0 ? 1 : -1;
        let remaining = Math.abs(offset);
        const cursor = new Date(parsed);
        while (remaining > 0) {
            cursor.setUTCDate(cursor.getUTCDate() + direction);
            const cursorIso = isoFromUtcDate(cursor);
            if (isBusinessDay(cursorIso)) remaining -= 1;
        }
        return isoFromUtcDate(cursor);
    }

    function countBusinessDays(startISO: string, endISO: string): number | null {
        const start = parseIsoDate(startISO);
        const end = parseIsoDate(endISO);
        if (!start || !end || start.getTime() > end.getTime()) return null;

        assertSupportedIsoYear(startISO);
        assertSupportedIsoYear(endISO);

        const cursor = new Date(start);
        let count = 0;
        while (cursor.getTime() <= end.getTime()) {
            if (isBusinessDay(isoFromUtcDate(cursor))) count += 1;
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return count;
    }

    function withServiceDays(next: ServiceDayPolicy): KrBusinessDayCalendar {
        if (isDefaultServiceDayPolicy(next)) return root ?? calendar;
        return buildCalendar(holidayDates, [...supportedYears], baseVersion, next, root ?? calendar);
    }

    const calendar: KrBusinessDayCalendar = {
        version,
        assertSupportedYear,
        isBusinessDay,
        calcEndDateBusinessDays,
        addBusinessDays,
        shiftBusinessDays,
        countBusinessDays,
        diffBusinessDays,
        nextBusinessDay,
        withServiceDays,
    };
    return calendar;
}

export const KR_BUILTIN_CALENDAR: KrBusinessDayCalendar = createKrBusinessDayCalendar(KR_BUILTIN_HOLIDAYS, {
    version: KOREAN_HOLIDAY_CALENDAR_VERSION,
    supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number),
});

export function isBusinessDayKr(iso: string): boolean {
    return KR_BUILTIN_CALENDAR.isBusinessDay(iso);
}

export function diffBusinessDaysKr(targetISO: string, baseISO = isoDateInKorea()): number | null {
    return KR_BUILTIN_CALENDAR.diffBusinessDays(targetISO, baseISO);
}

// Counts startISO as day 1. If startISO is not a business day, the next
// Korean business day becomes day 1.
export function calcEndDateBusinessDays(startISO: string, numberOfBusinessDays: number): string {
    return KR_BUILTIN_CALENDAR.calcEndDateBusinessDays(startISO, numberOfBusinessDays);
}

export function nextBusinessDayKr(iso: string): string {
    return KR_BUILTIN_CALENDAR.nextBusinessDay(iso);
}

export function addBusinessDaysKr(iso: string, n: number): string {
    return KR_BUILTIN_CALENDAR.addBusinessDays(iso, n);
}

/**
 * Applies a signed business-day offset using the authoritative Korean
 * calendar. Unlike addBusinessDaysKr this helper is intended for editor
 * suffix moves, where a reverse move must restore the original vector.
 */
export function shiftBusinessDaysKr(iso: string, offset: number): string {
    return KR_BUILTIN_CALENDAR.shiftBusinessDays(iso, offset);
}

export function countBusinessDaysKr(startISO: string, endISO: string): number | null {
    return KR_BUILTIN_CALENDAR.countBusinessDays(startISO, endISO);
}
