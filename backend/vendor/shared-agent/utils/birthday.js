"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBirthdayYYMMDD = formatBirthdayYYMMDD;
exports.normalizeContractBirthday = normalizeContractBirthday;
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
function resolveBirthYear(yy) {
    return yy >= 70 ? 1900 + yy : 2000 + yy;
}
function isValidCalendarDate(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day);
}
/**
 * Formats a 6-digit `YYMMDD` client birthday as `YYYY.MM.DD`.
 *
 * Returns `raw` unchanged when it is not exactly 6 digits or does not
 * resolve to a real calendar date (e.g. `"991332"` or non-numeric input).
 */
function formatBirthdayYYMMDD(raw) {
    if (!YYMMDD_PATTERN.test(raw))
        return raw;
    const yy = Number(raw.slice(0, 2));
    const month = Number(raw.slice(2, 4));
    const day = Number(raw.slice(4, 6));
    const year = resolveBirthYear(yy);
    if (!isValidCalendarDate(year, month, day))
        return raw;
    return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}
const MIN_CONTRACT_BIRTH_YEAR = 1900;
const KOREAN_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
function contractBirthdayParts(raw) {
    // 타임스탬프는 형식과 시간을 검증하되, 생년월일에 시간대 변환을 적용하지 않는다.
    const timestamp = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))?$/);
    if (timestamp) {
        const offsetHour = Number(timestamp[6] ?? 0);
        const offsetMinute = Number(timestamp[7] ?? 0);
        if (Number(timestamp[2]) > 23 || Number(timestamp[3]) > 59 || Number(timestamp[4]) > 59
            || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
            return null;
        }
        raw = timestamp[1];
    }
    const compact = raw.match(/^(\d{4}|\d{2})(\d{2})(\d{2})$/);
    if (compact)
        return [compact[1], compact[2], compact[3]];
    const korean = raw.match(/^(\d{4}|\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/);
    if (korean)
        return [korean[1], korean[2], korean[3]];
    const separated = raw.match(/^(\d{4}|\d{2})\s*([./-])\s*(\d{1,2})\s*\2\s*(\d{1,2})(\.)?$/);
    if (separated) {
        if (separated[5] && separated[2] !== ".")
            return null;
        return [separated[1], separated[3], separated[4]];
    }
    const spaced = raw.match(/^(\d{4}|\d{2}) (\d{1,2}) (\d{1,2})$/);
    return spaced ? [spaced[1], spaced[2], spaced[3]] : null;
}
/**
 * 계약서의 연-월-일 순서 생년월일을 검증하여 YYMMDD로 정규화한다.
 * 한글·공백·전각 표기를 지원하고, 주민번호·혼합 구분자·임의 문자는 거절한다.
 * 두 자리 연도는 현재 연도 끝자리 이하이면 2000년대, 나머지는 1900년대로 읽는다.
 * 한국 날짜 기준 오늘 이후이거나 1900년 이전인 날짜는 추측하지 않고 null을 반환한다.
 */
function normalizeContractBirthday(raw, now = new Date()) {
    const value = raw?.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!value || Number.isNaN(now.getTime()))
        return null;
    const parts = contractBirthdayParts(value);
    if (!parts)
        return null;
    const today = Object.fromEntries(KOREAN_DATE_FORMAT.formatToParts(now).map(({ type, value }) => [type, value]));
    const todayYear = Number(today.year);
    const inputYear = Number(parts[0]);
    const year = parts[0].length === 2
        ? (inputYear <= todayYear % 100 ? 2000 : 1900) + inputYear
        : inputYear;
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (year < MIN_CONTRACT_BIRTH_YEAR || !isValidCalendarDate(year, month, day))
        return null;
    const dateKey = year * 10000 + month * 100 + day;
    const todayKey = todayYear * 10000 + Number(today.month) * 100 + Number(today.day);
    if (dateKey > todayKey)
        return null;
    return `${String(year).slice(-2)}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}
