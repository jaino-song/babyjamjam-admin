"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeKoreanPhoneDigits = exports.normalizeKoreanPhoneForLookup = void 0;
exports.normalizePhoneDigits = normalizePhoneDigits;
exports.normalizeKoreanPhoneLookupKey = normalizeKoreanPhoneLookupKey;
exports.isValidKoreanPhoneNumber = isValidKoreanPhoneNumber;
exports.formatKoreanPhoneNumber = formatKoreanPhoneNumber;
const FOUR_DIGIT_MIDDLE_PREFIXES = ["010", "011", "016", "017", "018", "019", "070"];
function stripPhoneFormatting(value) {
    return String(value ?? "").replace(/\D/g, "");
}
/** Strip presentation characters without changing the persisted value. */
function normalizePhoneDigits(value, maxLength = 11) {
    return String(value ?? "").replace(/\D/g, "").slice(0, maxLength);
}
/**
 * Canonical lookup-only key for Korean numbers.
 *
 * This key is deliberately separate from the value stored/displayed by a
 * caller: it is only for matching records that use different formatting or
 * the +82 / 0082 country-code representation.
 */
function normalizeKoreanPhoneLookupKey(value) {
    const digits = stripPhoneFormatting(value);
    if (!digits)
        return "";
    // Some providers send the international access prefix instead of "+".
    const nationalDigits = digits.startsWith("0082") ? digits.slice(2) : digits;
    if (!nationalDigits)
        return "";
    if (nationalDigits.startsWith("82")) {
        const domesticDigits = nationalDigits.slice(2);
        if (!domesticDigits)
            return "";
        return domesticDigits.startsWith("0") ? domesticDigits : `0${domesticDigits}`;
    }
    // Some provider payloads omit the leading 0 from a 1xx number.
    if (/^1\d{9}$/.test(nationalDigits))
        return `0${nationalDigits}`;
    // Lookup normalization must preserve overlong values so validation can
    // reject them before a display formatter truncates the value.
    return nationalDigits;
}
exports.normalizeKoreanPhoneForLookup = normalizeKoreanPhoneLookupKey;
exports.normalizeKoreanPhoneDigits = normalizeKoreanPhoneLookupKey;
function isValidKoreanPhoneNumber(value) {
    const digits = normalizeKoreanPhoneLookupKey(value);
    if (/^02\d{7,8}$/.test(digits))
        return true;
    if (/^(010|011|016|017|018|019|070)\d{8}$/.test(digits))
        return true;
    return (/^0\d{9}$/.test(digits)
        && !FOUR_DIGIT_MIDDLE_PREFIXES.some((prefix) => digits.startsWith(prefix)));
}
function formatKoreanPhoneNumber(value) {
    const digits = normalizeKoreanPhoneLookupKey(value);
    if (!digits)
        return "";
    if (digits.startsWith("02")) {
        const seoulDigits = digits.slice(0, 10);
        if (seoulDigits.length <= 2)
            return seoulDigits;
        if (seoulDigits.length <= 5)
            return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2)}`;
        if (seoulDigits.length <= 9) {
            return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2, 5)}-${seoulDigits.slice(5)}`;
        }
        return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2, 6)}-${seoulDigits.slice(6)}`;
    }
    // Korean service numbers (1588-0000, 1600-0000, 1899-0000) are eight digits
    // and use a 4-4 shape. Longer values that start with 1 are not service
    // numbers, so they keep the generic grouping below.
    if (digits.startsWith("1") && digits.length <= 8) {
        if (digits.length <= 4)
            return digits;
        return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    }
    if (digits.length <= 3)
        return digits;
    const usesFourDigitMiddle = FOUR_DIGIT_MIDDLE_PREFIXES.some((prefix) => digits.startsWith(prefix));
    const formattedDigits = digits.slice(0, usesFourDigitMiddle ? 11 : 10);
    if (usesFourDigitMiddle) {
        // A ten-digit 010/01x value uses the standard 3-3-4 form; complete
        // eleven-digit mobile numbers use 3-4-4. Partial input keeps the
        // progressive 3-4-rest shape used by the forms.
        if (formattedDigits.length === 10) {
            return `${formattedDigits.slice(0, 3)}-${formattedDigits.slice(3, 6)}-${formattedDigits.slice(6)}`;
        }
        if (formattedDigits.length <= 7) {
            return `${formattedDigits.slice(0, 3)}-${formattedDigits.slice(3)}`;
        }
        return `${formattedDigits.slice(0, 3)}-${formattedDigits.slice(3, 7)}-${formattedDigits.slice(7)}`;
    }
    if (formattedDigits.length <= 6) {
        return `${formattedDigits.slice(0, 3)}-${formattedDigits.slice(3)}`;
    }
    return `${formattedDigits.slice(0, 3)}-${formattedDigits.slice(3, 6)}-${formattedDigits.slice(6)}`;
}
