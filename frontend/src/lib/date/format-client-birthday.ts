interface DateParts {
  year: number;
  month: number;
  day: number;
}

const KOREAN_BIRTHDAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_YEAR_SUFFIX = CURRENT_YEAR % 100;
const MIN_REASONABLE_BIRTH_YEAR = 1900;
const MAX_REASONABLE_BIRTH_YEAR = CURRENT_YEAR;

const CENTURY_BY_REGISTRATION_DIGIT: Record<string, number> = {
  "1": 1900,
  "2": 1900,
  "3": 2000,
  "4": 2000,
  "5": 1900,
  "6": 1900,
  "7": 2000,
  "8": 2000,
};

function isValidDateParts({ year, month, day }: DateParts): boolean {
  if (
    year < MIN_REASONABLE_BIRTH_YEAR ||
    year > MAX_REASONABLE_BIRTH_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseFullYearBirthday(digits: string): DateParts | null {
  if (digits.length !== 8) {
    return null;
  }

  const parts = {
    year: Number(digits.slice(0, 4)),
    month: Number(digits.slice(4, 6)),
    day: Number(digits.slice(6, 8)),
  };

  return isValidDateParts(parts) ? parts : null;
}

function resolveTwoDigitBirthYear(yearSuffix: number, registrationDigit?: string): number {
  const registrationCentury =
    registrationDigit != null ? CENTURY_BY_REGISTRATION_DIGIT[registrationDigit] : undefined;

  if (registrationCentury != null) {
    return registrationCentury + yearSuffix;
  }

  return yearSuffix <= CURRENT_YEAR_SUFFIX ? 2000 + yearSuffix : 1900 + yearSuffix;
}

function parseShortBirthday(digits: string): DateParts | null {
  if (digits.length < 6) {
    return null;
  }

  const yearSuffix = Number(digits.slice(0, 2));
  const registrationDigit = digits.length >= 7 ? digits[6] : undefined;
  const parts = {
    year: resolveTwoDigitBirthYear(yearSuffix, registrationDigit),
    month: Number(digits.slice(2, 4)),
    day: Number(digits.slice(4, 6)),
  };

  return isValidDateParts(parts) ? parts : null;
}

function parseClientBirthday(value: string): DateParts | null {
  const isoMatch = value.match(KOREAN_BIRTHDAY_DATE_PATTERN);
  if (isoMatch) {
    const parts = {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    return parseFullYearBirthday(digits.slice(0, 8)) ?? parseShortBirthday(digits);
  }
  return parseShortBirthday(digits);
}

export function formatClientBirthdayForDisplay(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "-";
  }

  const parts = parseClientBirthday(trimmed);
  if (!parts) {
    return trimmed;
  }

  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}.${month}.${day}`;
}
