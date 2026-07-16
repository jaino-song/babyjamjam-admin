const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/;

export function formatDateForDisplay(
  value: string | number | Date | null | undefined,
  fallback = "-",
): string {
  if (value === null || value === undefined || value === "") return fallback;

  if (typeof value === "string") {
    const match = value.trim().match(DATE_ONLY_PATTERN);
    if (match) {
      return `${match[1]}.${match[2].padStart(2, "0")}.${match[3].padStart(2, "0")}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join(".");
}
