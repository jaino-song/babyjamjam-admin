export const RETURN_TO_QUERY_PARAM = "returnTo";
export const OAUTH_RETURN_PATH_STORAGE_KEY = "auth:oauth-return-path";
export const OAUTH_RETURN_PATH_TTL_MS = 10 * 60 * 1000;

const SERVICE_RECORD_ADMIN_PREFIX = "/service-record-admin/";
const SAFE_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Accept only the local editor route that the mobile admin handoff owns.
 *
 * The value is intentionally treated as a path, rather than parsed as a URL:
 * protocol-relative paths, encoded separators, traversal segments, queries,
 * fragments, and backslashes must all fail closed.
 */
export function getSafeServiceRecordAdminReturnPath(
  value: string | null | undefined,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SERVICE_RECORD_ADMIN_PREFIX.length + 128 ||
    !value.startsWith(SERVICE_RECORD_ADMIN_PREFIX)
  ) {
    return null;
  }

  const clientId = value.slice(SERVICE_RECORD_ADMIN_PREFIX.length);
  if (!SAFE_CLIENT_ID_PATTERN.test(clientId)) {
    return null;
  }

  return value;
}

export function getSafeReturnPathFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): string | null {
  return getSafeServiceRecordAdminReturnPath(
    searchParams.get(RETURN_TO_QUERY_PARAM),
  );
}

export function appendSafeReturnPath(
  route: string,
  returnPath: string | null | undefined,
): string {
  const safeReturnPath = getSafeServiceRecordAdminReturnPath(returnPath);
  if (!safeReturnPath) {
    return route;
  }

  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${RETURN_TO_QUERY_PARAM}=${encodeURIComponent(safeReturnPath)}`;
}

export function serializeSafeReturnPathForStorage(
  returnPath: string | null | undefined,
  now = Date.now(),
): string | null {
  const safeReturnPath = getSafeServiceRecordAdminReturnPath(returnPath);
  if (!safeReturnPath) {
    return null;
  }

  return JSON.stringify({
    path: safeReturnPath,
    expiresAt: now + OAUTH_RETURN_PATH_TTL_MS,
  });
}

export function getSafeReturnPathFromStorage(
  value: string | null | undefined,
  now = Date.now(),
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("path" in parsed) ||
      !("expiresAt" in parsed) ||
      typeof parsed.path !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= now
    ) {
      return null;
    }

    return getSafeServiceRecordAdminReturnPath(parsed.path);
  } catch {
    return null;
  }
}
