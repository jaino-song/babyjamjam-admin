const FOUR_DIGIT_MIDDLE_PREFIXES = ["010", "011", "016", "017", "018", "019", "070"] as const;

export type PhoneInput = string | number | null | undefined;

/** Strip presentation characters without changing the persisted value. */
export function normalizePhoneDigits(value: PhoneInput, maxLength = 11): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, maxLength);
}

/**
 * Canonical lookup-only key for Korean numbers.
 *
 * This key is deliberately separate from the value stored/displayed by a
 * caller: it is only for matching records that use different formatting or
 * the +82 country-code representation.
 */
export function normalizeKoreanPhoneLookupKey(value: PhoneInput): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("82")) {
    const domesticDigits = digits.slice(2);
    return normalizePhoneDigits(
      domesticDigits.startsWith("0") ? domesticDigits : `0${domesticDigits}`,
    );
  }

  // Some provider payloads omit the leading 0 from a 1xx number.
  if (/^1\d{9}$/.test(digits)) return `0${digits}`;

  return normalizePhoneDigits(digits);
}

export const normalizeKoreanPhoneForLookup = normalizeKoreanPhoneLookupKey;
export const normalizeKoreanPhoneDigits = normalizeKoreanPhoneLookupKey;

export function isValidKoreanPhoneNumber(value: PhoneInput): boolean {
  const digits = normalizeKoreanPhoneLookupKey(value);

  if (/^02\d{7,8}$/.test(digits)) return true;

  if (/^(010|011|016|017|018|019|070)\d{8}$/.test(digits)) return true;

  return (
    /^0\d{9}$/.test(digits)
    && !FOUR_DIGIT_MIDDLE_PREFIXES.some((prefix) => digits.startsWith(prefix))
  );
}

export function formatKoreanPhoneNumber(value: PhoneInput): string {
  const digits = normalizeKoreanPhoneLookupKey(value);
  if (!digits) return "";

  if (digits.startsWith("02")) {
    const seoulDigits = digits.slice(0, 10);
    if (seoulDigits.length <= 2) return seoulDigits;
    if (seoulDigits.length <= 5) return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2)}`;
    if (seoulDigits.length <= 9) {
      return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2, 5)}-${seoulDigits.slice(5)}`;
    }
    return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2, 6)}-${seoulDigits.slice(6)}`;
  }

  if (digits.length <= 3) return digits;

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
