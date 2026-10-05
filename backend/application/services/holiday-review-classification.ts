import { IMMUTABLE_FINALIZATION_STATUSES } from "application/services/service-record-lifecycle.service";
import type { ReviewCategory, ReviewClientFacts, ReviewReason } from "domain/utils/holiday-review";

export interface ReviewClassification {
    category: ReviewCategory;
    reason: ReviewReason;
}

/**
 * Whether moving a client's end date to `recalculatedEnd` is safe to offer as a
 * one-click fix, or needs a person to look first. The first matching rule wins:
 *
 * - `finalized`: the service-record case is already in a finalization status.
 * - `session_on_or_after_date`: a session is recorded on or after the changed
 *   holiday, so the change touches work that was already done.
 * - `locked_session_after_new_end`: a locked session lies after the new end
 *   date; `ClientService.update` would reject the move with a 409.
 * - otherwise `safe` / `no_sessions_after_date`.
 *
 * Pure so the resolve endpoint can re-run it against fresh facts at fix time.
 */
export function classifyReviewItem(
    facts: ReviewClientFacts,
    eventDate: string,
    recalculatedEnd: string,
): ReviewClassification {
    if (facts.caseStatus !== null && IMMUTABLE_FINALIZATION_STATUSES.has(facts.caseStatus)) {
        return { category: "risk", reason: "finalized" };
    }
    if (facts.days.some((day) => day.date >= eventDate)) {
        return { category: "risk", reason: "session_on_or_after_date" };
    }
    if (facts.days.some((day) => day.locked && day.date > recalculatedEnd)) {
        return { category: "risk", reason: "locked_session_after_new_end" };
    }
    return { category: "safe", reason: "no_sessions_after_date" };
}
