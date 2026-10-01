/**
 * Vocabulary and pure rules shared by the holiday-change review pipeline
 * (processor, repository and, later, the resolve endpoints). Values mirror the
 * CHECK constraints on `holiday_change_event` / `end_date_review_item`.
 */

export type HolidayChange = "added" | "removed";
export type ReviewCategory = "safe" | "risk";
export type ReviewStatus = "open" | "fixed" | "kept" | "obsolete";
export type ReviewReason =
    | "finalized"
    | "session_on_or_after_date"
    | "locked_session_after_new_end"
    | "no_sessions_after_date";

/** What the classification needs to know about one client's recorded service. */
export interface ReviewClientFacts {
    /** `service_record_case.status`, or null when the client has no case. */
    caseStatus: string | null;
    /** The case's `service_record_day` rows (`YYYY-MM-DD`). */
    days: ReadonlyArray<{ date: string; locked: boolean }>;
}

/**
 * Whether a candidate client gets a new open item for a change event.
 *
 * - The client already has an open item from an EARLIER event: that item is
 *   obsoleted, and a new one is created whenever the end date still differs
 *   (the newest item always reflects the current combined calendar).
 * - Otherwise an item is created only when this change caused the mismatch,
 *   i.e. the stored end date matched the calendar as it was BEFORE the change.
 *   A client whose stored end already differed (manual edit, an earlier "kept"
 *   decision) is never nagged.
 */
export function decideReviewItemAction(input: {
    hadOpenItem: boolean;
    storedEnd: string;
    recalculatedEnd: string;
    previousEnd: string;
}): { obsoleteOpenItem: boolean; createItem: boolean } {
    const differs = input.recalculatedEnd !== input.storedEnd;
    if (input.hadOpenItem) {
        return { obsoleteOpenItem: true, createItem: differs };
    }
    return { obsoleteOpenItem: false, createItem: differs && input.previousEnd === input.storedEnd };
}
