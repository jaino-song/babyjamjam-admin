const STORAGE_PREFIX = "bjj:eformsign-resend-uncertain";

/** The recoverable payload is kept 7 days and purged on an interval, so a marker outlives it by a day. */
export const RESEND_UNCERTAIN_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

/** Keyed by the lowercase job id, the same spelling the `resend:` idempotency key uses. */
export function resendUncertainStorageKey(jobId: string): string {
  return `${STORAGE_PREFIX}:${jobId.toLowerCase()}`;
}

/**
 * Remembers that a resend of this job ended without a definite answer, so the first send may have been
 * accepted. Survives the dialog being closed and reopened. Never throws.
 */
export function markResendUncertain(jobId: string, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(resendUncertainStorageKey(jobId), String(now));
  } catch {
    // Storage can be blocked or full; the dialog's in-memory latch still covers this mount.
  }
}

/**
 * Whether a resend of this job may already have been accepted. Fails closed: if storage cannot be read the
 * answer is "yes". A missing marker (with working storage) is "no"; a marker older than the retention
 * window is removed and ignored. Never throws.
 */
export function isResendUncertain(jobId: string, now: number = Date.now()): boolean {
  try {
    const key = resendUncertainStorageKey(jobId);
    const raw = window.localStorage.getItem(key);
    if (raw === null) return false;
    const markedAt = Number(raw);
    if (!Number.isFinite(markedAt)) return true;
    if (now - markedAt > RESEND_UNCERTAIN_MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Forgets the marker once the old job is resolved. Never throws. */
export function clearResendUncertain(jobId: string): void {
  try {
    window.localStorage.removeItem(resendUncertainStorageKey(jobId));
  } catch {
    // A marker that cannot be removed only keeps asking for the confirmation until it ages out.
  }
}
