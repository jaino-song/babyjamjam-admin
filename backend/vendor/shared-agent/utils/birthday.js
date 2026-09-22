"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBirthdayYYMMDD = formatBirthdayYYMMDD;
exports.normalizeContractBirthday = normalizeContractBirthday;
exports.normalizeBirthdayIsoDate = normalizeBirthdayIsoDate;
exports.isValidBirthdayIsoDate = isValidBirthdayIsoDate;
exports.formatBirthdayInput = formatBirthdayInput;
function isValidCalendarDate(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day);
}
/** 기존 6자리와 YYYY-MM-DD 생년월일을 네 자리 연도로 표시한다. */
function formatBirthdayYYMMDD(raw) {
    const iso = normalizeBirthdayIsoDate(raw);
    return iso ? iso.replace(/-/g, ".") : raw;
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
    const iso = normalizeBirthdayIsoDate(raw, now);
    return iso ? iso.slice(2).replace(/-/g, "") : null;
}
/** 기존 생년월일을 읽되 명시된 네 자리 연도를 보존한다. 신규 입력 검증과는 구분한다. */
function normalizeBirthdayIsoDate(raw, now = new Date()) {
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
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** 신규 생년월일은 세기를 추측하지 않는 YYYY-MM-DD 형식만 허용한다. */
function isValidBirthdayIsoDate(raw, now = new Date()) {
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) && normalizeBirthdayIsoDate(raw, now) === raw;
}
/** 입력 중에는 일부 값도 유지하고, 여덟 자리 숫자에 날짜 구분자를 붙인다. */
function formatBirthdayInput(value) {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4)
        return digits;
    if (digits.length <= 6)
        return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
