import type {
    HolidayChange,
    ReviewCategory,
    ReviewClientFacts,
    ReviewReason,
    ReviewStatus,
} from "domain/utils/holiday-review";

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
    /**
     * Earliest change date behind the item: the event's date, or the older of it and
     * the open item this one replaces. `category`/`reason` were classified against it.
     */
    affectedFrom: string;
    category: ReviewCategory;
    reason: ReviewReason;
}

/** The client's open item (from an EARLIER event) the drafts were computed against. */
export interface OpenReviewItemRef {
    id: string;
    clientId: number;
    /** `YYYY-MM-DD` */
    affectedFrom: string;
}

export interface ApplyReviewEventInput {
    eventId: string;
    drafts: ReviewItemDraft[];
    /**
     * The open item (of an earlier event) each draft's client had when `affectedFrom` was
     * derived, by client id; a client without one is absent. If the transaction finds a
     * different open item (it was resolved or replaced meanwhile), nothing is applied.
     */
    assumedOpenItemIds: Record<number, string>;
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
    | { status: "events_changed" }
    /** A client's open item changed after the drafts were computed; the event stays unprocessed for the next run. */
    | { status: "items_changed" };

/** An event that still has open items in one branch, with that branch's open counts. */
export interface ReviewEventSummary extends HolidayChangeEventRecord {
    safeOpen: number;
    riskOpen: number;
}

export interface ReviewItemRecord {
    id: string;
    clientId: number;
    clientName: string;
    /** `YYYY-MM-DD` */
    storedEnd: string;
    /** `YYYY-MM-DD` */
    recalculatedEnd: string;
    /** `YYYY-MM-DD`: earliest change date behind the item (see {@link ReviewItemDraft.affectedFrom}). */
    affectedFrom: string;
    category: ReviewCategory;
    reason: ReviewReason;
    status: ReviewStatus;
}

export interface ReviewItemFilters {
    category?: ReviewCategory;
    status?: ReviewStatus;
    /** Case-insensitive substring of the client's name. */
    q?: string;
}

/** What the fix path needs to know about a client right before changing its end date. */
export interface ReviewFixSnapshot {
    /** `YYYY-MM-DD` or null. */
    startDate: string | null;
    endDate: string | null;
    duration: number | null;
    terminated: boolean;
    facts: ReviewClientFacts;
}

/**
 * The HTTP-path methods below always carry the caller's `branchId` in the top-level
 * `where` of every `end_date_review_item` read and write (the tenant extension only
 * checks, it never injects), and read events only as public (`branch_id NULL`) or
 * the caller's own.
 */
export interface IHolidayReviewRepository {
    /**
     * EVERY event with `processed_at IS NULL`, ordered by `(created_at, id)`. Deliberately
     * unbounded: the undo set for an event is all later unprocessed events and the
     * `events_changed` guard compares against the same set, so a cap would either wrongly
     * trip the guard or drop events from the undo. Rows are small (ids, date, direction).
     */
    listUnprocessedEvents(): Promise<HolidayChangeEventRecord[]>;

    /** The branch's add/exclude overrides (`date` is `YYYY-MM-DD`). */
    listBranchOverrides(branchId: string): Promise<Array<{ date: string; kind: "add" | "exclude" }>>;

    /**
     * Clients of the branch with `start_date <= date` and a duration, skipping terminated
     * services, with the facts the classification needs, whose service period contains
     * `date` (`date <= end_date`) or who hold an open item whose `recalculated_end >= date`
     * (a later holiday between the stored and the shown new end must refresh that item).
     */
    findReviewCandidates(branchId: string, date: string): Promise<ReviewCandidateClient[]>;

    /** The open items (of any event but `exceptEventId`) of these clients, by client. */
    listOpenItemsForClients(exceptEventId: string, clientIds: number[]): Promise<OpenReviewItemRef[]>;

    /**
     * One event, one transaction: serialize on the processing advisory lock,
     * re-read the event as still unprocessed, apply the item rules for every
     * draft (obsolete the client's older open item first, then insert) and set
     * `processed_at`. Throws on failure, which rolls the transaction back.
     */
    applyEventResult(input: ApplyReviewEventInput): Promise<ApplyReviewEventResult>;

    /** Events with at least one OPEN item in the branch, newest first, with the branch's open counts. */
    listOpenEventSummaries(branchId: string): Promise<ReviewEventSummary[]>;

    /** One event, only when it is public or the branch's own (never by bare id). */
    findEventRecord(branchId: string, eventId: string): Promise<HolidayChangeEventRecord | null>;

    /** Whether the branch has any item (of any status) for the event. */
    branchHasEventItems(branchId: string, eventId: string): Promise<boolean>;

    /** The branch's items of one event, sorted by client name then id. */
    listEventItems(branchId: string, eventId: string, filters: ReviewItemFilters): Promise<ReviewItemRecord[]>;

    /** The listed ids that belong to this event in this branch (unknown ids are simply absent). */
    findEventItemsByIds(branchId: string, eventId: string, itemIds: string[]): Promise<ReviewItemRecord[]>;

    /**
     * Moves one OPEN item to a final status. Returns false when it was no longer open
     * (or not in this branch/event), so a concurrent resolve is reported, not overwritten.
     * `resolvedBy` is the acting user for fixed/kept and null for a system decision (obsolete).
     */
    closeOpenItem(
        branchId: string,
        eventId: string,
        itemId: string,
        outcome: { status: "fixed" | "kept" | "obsolete"; resolvedBy: string | null },
    ): Promise<boolean>;

    /** Re-files an OPEN item (it stays open) after the fix path found fresher facts. */
    reclassifyOpenItem(
        branchId: string,
        eventId: string,
        itemId: string,
        update: { category: ReviewCategory; reason: ReviewReason; recalculatedEnd: string },
    ): Promise<boolean>;

    /** The client's current dates and classification facts, or null when it is gone from this branch. */
    findFixSnapshot(branchId: string, clientId: number): Promise<ReviewFixSnapshot | null>;
}
