import { normalizeApiError } from "@babyjamjam/shared";

/** Read only the validated, whitelisted problem extension. */
export function getStartDateLock(error: unknown): { serviceStarted: boolean; recordedSessionCount: number } | null {
    const normalized = normalizeApiError(error, { operation: "mutation" });
    if (normalized.status !== 409 || normalized.problem?.code !== "SERVICE_RECORD_START_DATE_LOCKED") return null;
    return normalized.problem.startDateLock ?? null;
}
