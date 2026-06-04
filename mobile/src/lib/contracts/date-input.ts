const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const EXACT_ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YYMMDD_PATTERN = /^\d{6}$/;

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

export function isStrictIsoDate(value: string): boolean {
  if (!EXACT_ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeIsoDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const match = value.match(ISO_DATE_PATTERN);
  if (!match) {
    return "";
  }

  const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
  return isStrictIsoDate(isoDate) ? isoDate : "";
}

export function yymmddToIso(value: string): string {
  const trimmed = value.trim();

  if (!YYMMDD_PATTERN.test(trimmed)) {
    return "";
  }

  return normalizeIsoDate(`20${trimmed.slice(0, 2)}-${trimmed.slice(2, 4)}-${trimmed.slice(4, 6)}`);
}

export function isoToYymmdd(value: string | null | undefined): string {
  const isoDate = normalizeIsoDate(value);

  if (!isoDate) {
    return "";
  }

  return `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`;
}

export function todayIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${twoDigit(date.getMonth() + 1)}-${twoDigit(date.getDate())}`;
}
