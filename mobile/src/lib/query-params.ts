const POSITIVE_INT_QUERY_PARAM_REGEX = /^[1-9]\d*$/;

export function parsePositiveIntQueryParam(raw: string | null): number | null {
  if (!raw) return null;
  if (!POSITIVE_INT_QUERY_PARAM_REGEX.test(raw)) return null;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return null;

  return parsed;
}
