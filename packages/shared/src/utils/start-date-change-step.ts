import { isoDateInKorea } from "./business-days";

/** The SERVICE_RECORD_START_DATE_LOCKED extension (see ProblemDetails.startDateLock). */
export interface StartDateChangeLock {
    serviceStarted: boolean;
    recordedSessionCount: number;
    finalized?: true;
}

export type StartDateChangeStep = "started" | "records";

/**
 * The first question a locked start-date change asks, or null when it needs none and saves
 * with CONFIRM_STARTED.
 *
 * - A finalized household always has written sessions, so it goes straight to the records question.
 * - "서비스 시작 후 변경" is asked only while the service is running (진행중): it has started and
 *   its saved end date has not passed yet, counted in Korea and inclusive of the end date.
 * - Otherwise only written sessions need a question.
 */
export function getStartDateChangeStep(
    lock: StartDateChangeLock,
    savedEndDate: string | null | undefined,
    today: string = isoDateInKorea(),
): StartDateChangeStep | null {
    if (lock.finalized) return "records";
    const endDate = savedEndDate ? savedEndDate.slice(0, 10) : "";
    const ended = endDate !== "" && today > endDate;
    if (lock.serviceStarted && !ended) return "started";
    return lock.recordedSessionCount > 0 ? "records" : null;
}
