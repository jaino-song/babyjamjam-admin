const YYMMDD_PATTERN = /^\d{6}$/;

/**
 * Century pivot for a 2-digit birth year: fixed threshold at `yy >= 70`.
 *
 * This mirrors mobile's existing `yymmddToIsoDate` helper (duplicated
 * verbatim in mobile/src/app/(shell)/clients/page.tsx:70-81 and
 * mobile/src/components/app/clients/client-detail.tsx:140-151), which is
 * the canonical rule per this task's "use mobile's existing logic as canon
 * when it exists" instruction. It is a fixed threshold, not relative to the
 * current year: frontend/src/lib/date/format-client-birthday.ts instead
 * pivots on `CURRENT_YEAR % 100` (and additionally reads Korean resident-
 * registration-number century digits when present) — a different, more
 * sophisticated implementation for a different input shape (8-digit and
 * resident-registration-number birthdays) that this module intentionally
 * does not replace. `formatBirthdayYYMMDD` only covers the plain 6-digit
 * `YYMMDD` case actually used at the mobile call sites above.
 */
function resolveBirthYear(yy: number): number {
    return yy >= 70 ? 1900 + yy : 2000 + yy;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/**
 * Formats a 6-digit `YYMMDD` client birthday as `YYYY.MM.DD`.
 *
 * Returns `raw` unchanged when it is not exactly 6 digits or does not
 * resolve to a real calendar date (e.g. `"991332"` or non-numeric input).
 */
export function formatBirthdayYYMMDD(raw: string): string {
    if (!YYMMDD_PATTERN.test(raw)) return raw;

    const yy = Number(raw.slice(0, 2));
    const month = Number(raw.slice(2, 4));
    const day = Number(raw.slice(4, 6));
    const year = resolveBirthYear(yy);

    if (!isValidCalendarDate(year, month, day)) return raw;

    return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}
