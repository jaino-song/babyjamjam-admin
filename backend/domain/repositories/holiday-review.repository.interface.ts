import type { HolidayChange, ReviewCategory, ReviewClientFacts, ReviewReason } from "domain/utils/holiday-review";

export const HOLIDAY_REVIEW_REPOSITORY = "HOLIDAY_REVIEW_REPOSITORY";

export interface HolidayChangeEventRecord {
    id: string;
    /** Null for a public (KASI) change, otherwise the branch that made it. */
    branchId: string | null;
    /** `YYYY-MM-DD` */
    date: string;
    change: HolidayChange;
    name: string | null;
    source: string;
    createdAt: Date;
}

/** A client whose service period contains the changed date. */
export interface ReviewCandidateClient {
    clientId: number;
    /** The client's own branch (never the event's). */
    branchId: string;
    /** `YYYY-MM-DD` */
    startDate: string;
    endDate: string;
    /** Business days. */
    duration: number;
    facts: ReviewClientFacts;
}

/** The processor's verdict for one candidate; the repository applies the item rules in-transaction. */
export interface ReviewItemDraft {
    clientId: number;
    branchId: string;
    storedEnd: string;
    recalculatedEnd: string;
    /** End date under the calendar the stored end was most likely saved with. */
    previousEnd: string;
    category: ReviewCategory;
    reason: ReviewReason;
}

export interface ApplyReviewEventInput {
    eventId: string;
    drafts: ReviewItemDraft[];
    /**
     * Ids of every unprocessed event the drafts were computed against (the event
     * and the later ones). A new unprocessed event outside this set means the
     * calendar the drafts used may already include it, so nothing is applied.
     */
    expectedUnprocessedEventIds: string[];
}

export type ApplyReviewEventResult =
    | { status: "applied"; created: number; obsoleted: number }
    /** Another run processed it first; nothing to do. */
    | { status: "already_processed" }
    /** An event appeared after the drafts were computed; the event stays unprocessed for the next run. */
    | { status: "events_changed" };

export interface IHolidayReviewRepository {
    /** Every event with `processed_at IS NULL`, ordered by `(created_at, id)`. */
    listUnprocessedEvents(): Promise<HolidayChangeEventRecord[]>;

    /** The branch's add/exclude overrides (`date` is `YYYY-MM-DD`). */
    listBranchOverrides(branchId: string): Promise<Array<{ date: string; kind: "add" | "exclude" }>>;

    /**
     * Clients of the branch with `start_date <= date <= end_date` and a duration,
     * skipping terminated services, with the facts the classification needs.
     */
    findReviewCandidates(branchId: string, date: string): Promise<ReviewCandidateClient[]>;

    /**
     * One event, one transaction: serialize on the processing advisory lock,
     * re-read the event as still unprocessed, apply the item rules for every
     * draft (obsolete the client's older open item first, then insert) and set
     * `processed_at`. Throws on failure, which rolls the transaction back.
     */
    applyEventResult(input: ApplyReviewEventInput): Promise<ApplyReviewEventResult>;
}
