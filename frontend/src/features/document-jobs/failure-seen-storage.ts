const STORAGE_PREFIX = "eformsign-job-failures-seen";

export function failureSeenStorageKey(userId: string, branchId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${branchId}`;
}

/** Ids this browser session has already told the user about. Never throws. */
export function readSeenFailureIds(storageKey: string): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function writeSeenFailureIds(storageKey: string, ids: Iterable<string>): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage can be blocked or full; the in-memory set still de-duplicates this page load.
  }
}
