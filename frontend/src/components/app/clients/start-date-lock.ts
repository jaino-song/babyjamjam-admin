import { normalizeApiError } from "@babyjamjam/shared";

export interface StartDateLock {
    serviceStarted: boolean;
    recordedSessionCount: number;
    /** The household has a finalized case, so its sessions can only move with the new start. */
    finalized?: true;
}

/** Read only the validated, whitelisted problem extension. */
export function getStartDateLock(error: unknown): StartDateLock | null {
    const normalized = normalizeApiError(error, { operation: "mutation" });
    if (normalized.status !== 409 || normalized.problem?.code !== "SERVICE_RECORD_START_DATE_LOCKED") return null;
    return normalized.problem.startDateLock ?? null;
}
