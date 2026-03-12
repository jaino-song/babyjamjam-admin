const FOUR_DIGIT_MIDDLE_PREFIXES = ["010", "011", "016", "017", "018", "019", "070"];

export function normalizePhoneDigits(value: string, maxLength = 11): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

export function isValidKoreanPhoneNumber(value: string): boolean {
  const digits = normalizePhoneDigits(value);

  if (/^02\d{7,8}$/.test(digits)) {
    return true;
  }

  if (/^(010|011|016|017|018|019|070)\d{8}$/.test(digits)) {
    return true;
  }

  return (
    /^0\d{9}$/.test(digits) &&
    !FOUR_DIGIT_MIDDLE_PREFIXES.some((prefix) => digits.startsWith(prefix))
  );
}

export function formatKoreanPhoneNumber(value: string): string {
  const digits = normalizePhoneDigits(value);

  if (!digits) {
    return "";
  }

  if (digits.startsWith("02")) {
    const seoulDigits = digits.slice(0, 10);

    if (seoulDigits.length <= 2) {
      return seoulDigits;
    }

    if (seoulDigits.length <= 5) {
      return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2)}`;
    }

    if (seoulDigits.length <= 9) {
      return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2, 5)}-${seoulDigits.slice(5)}`;
    }

    return `${seoulDigits.slice(0, 2)}-${seoulDigits.slice(2, 6)}-${seoulDigits.slice(6)}`;
  }

  if (digits.length <= 3) {
    return digits;
  }

  const usesFourDigitMiddle = FOUR_DIGIT_MIDDLE_PREFIXES.some((prefix) => digits.startsWith(prefix));
  const formattedDigits = digits.slice(0, usesFourDigitMiddle ? 11 : 10);

  if (usesFourDigitMiddle) {
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
